# L3 real datasets: conformance report

The data reader got every cell of every real dataset tested right, and the four Findex formats agree with each other. No
fault silently changes research meaning (S1). There are 5 S2 issues (one wrong first-read sheet choice and four misread
codebook cells); S3 issues and questions below. Status: implemented, ready for review. The harness finds faults; it does
not fix the engine.

Run of 28 October 2026 against `api/parse-stats-file.py` (sha1 `5fb78e1e1071a593eae89f34c1ebc8f417f2c69e`), with
`api/import-limits.json` = `{maxFileBytes: 100000000, maxCases: 100000}`. Python 3, pandas 3.0.5, pyreadstat 1.2.8.
Machine: 2 cores, 8 GB, shared with another test run, so timings are upper bounds.

- Full run: `python3 conformance/l3/run.py` (1,096 s). `--no-full` skips the full-size Findex reads; `--only <ids>`
  runs some datasets.
- Raw results: `conformance/l3/results.json`.

## How the expected values were made (never from the engine)

| Source of truth | Used for |
|---|---|
| pyreadstat called directly (`read_sav(user_missing=True)` with declared user-missing values masked by the harness; `read_dta`) | .sav, .dta |
| pandas `read_csv` with every cell as text; the contract's missing tokens and number rule applied by the harness | .csv, .txt |
| openpyxl directly (cached values); calendar cells as ISO text by the contract's rule; wholly blank rows skipped | .xlsx |
| The harness's own parse of the .sps `DATA LIST`, `VARIABLE LABELS`, `VALUE LABELS`, slicing each .dat record (CP1252) | Findex ASCII (a fourth reading using no engine code) |
| Agreement of the four Findex formats | cross-format |
| 32 cells read by eye (Findex records 1 and 5,000); an awk hand count of `survey_missing_values.csv` | hand cells |
| The workbooks' own computations (EV `Tables` and `Multiple Response Q's`; the synthetic tracker's `Metric checks`) | anchors |

Engine calls (module loaded by importlib, called with local bytes, bypassing storage): `dictionary`, `convert`,
`read_table`, `categories`, `codebook_items`, `crosstab` (one variable, weighted, no banner; plus wave as banner for the
synthetic tracker), `_read` (read only), `_non_answer_codes`. Per variable the harness compares an order-sensitive hash
of every cell, the frequency of each raw code, the weighted total per code, missing count, type, variable label and
value labels by raw code.

Same-library caveat: for .sav and .dta the independent reading also uses pyreadstat, so it checks what the engine adds on
top (masking, caching, typing, labels, previews, tables). The CSV and fixed-width readings use no pyreadstat, and all four
formats agree.

The reduction is mine: `findex_first5000.sav` (7,638,343 bytes) and `.dta` (4,327,619) written with pyreadstat from the
first 5,000 cases keeping names and labels; `findex_first5000.csv` (1,648,089) is the header plus the first 5,000 records
byte for byte. Their truth is the independent reading of the originals cut to 5,000 cases. Written to the harness work
folder, not the repo.

## Counts

| Dataset | Pass | Fail | Skipped | Observation | Discrepancies |
|---|---|---|---|---|---|
| Findex (.sav, .dta, .csv full and first 5,000; .dat) | 138 | 5 | 0 | 1 | 13 |
| FinScope SA 2025 .sav | 17 | 1 | 2 | 0 | 2 |
| IGS may2026.txt | 11 | 2 | 0 | 0 | 2 |
| IGS codebook | 2 | 0 | 0 | 0 | 0 |
| FinScope bench weights .xlsx | 9 | 0 | 0 | 0 | 0 |
| EV Tesla .xlsx | 8 | 1 | 0 | 0 | 1 |
| CSM wave 1 .xlsx | 12 | 1 | 0 | 0 | 4 |
| Brand tracker Oct 2025 .xlsx | 12 | 1 | 0 | 0 | 8 |
| Synthetic brand tracker .xlsx | 14 | 2 | 0 | 0 | 5 |
| survey_degenerate_banner, survey_many_categories, survey_missing_values | 33 | 0 | 0 | 0 | 0 |
| Hand anchors | 8 | 0 | 0 | 0 | 0 |
| **Total** | **264** | **13** | **2** | **1** | **35** |

Skipped (not counted as passed): FinScope `SPName` categories and preview counts (1,292 distinct places; cell hash only).
Of the 35: no S1, 5 S2, the rest S3, 1 file difference.

### What held

- Every cell of every variable agrees with the independent reading for Findex .sav, .dta and .csv (full size with the
  limit lifted, and first 5,000), FinScope (5,562 x 3,960), IGS (8,578 x 264), and all eight workbooks and CSVs.
- Row counts, names and order, types, variable labels, value labels by raw code, declared missing values (none in these
  files), weighted totals per code, the variables list's `nCases` and `nValid`.
- The four independent Findex readings agree on 183 variables and 144,090 cases, cell for cell; so do the engine's .sav,
  .dta and .csv readings; `wgt` sums agree within 1e-12 relative.
- The 32 hand cells agree in every reading.
- Crosstabs: weighted and unweighted cells and bases agree. Findex `No/DK/Ref` (code 0) is kept as an answer while
  `DK/ref`, `Don't know`, `Refused` are excluded, as an independent label rule says.
- Stored previews: `read_table` cells equal the calculation read; `convert` decoded counts equal the independent ones.
- Anchors: EV owns a vehicle 91/24, vehicle type 59/28/3/1, benefit mentions 92/89/66/13/12/6; synthetic tracker funnel
  counts (3 waves x 6 brands x 4 measures) equal the workbook's Metric checks.
- Case limit: the full Findex .sav, .dta and .csv are refused by `dictionary` and `convert` with "This file exceeds the
  supported 100,000 case limit. Split it into smaller files, then retry; no partial result was published."

## Discrepancies

| # | Dataset | Variable | Expected | Actual | Severity |
|---|---|---|---|---|---|
| D1 | EV Tesla | data sheet | first read uses `Data` (115 respondents) | uses `Tables` (173 rows of pivot output) until the researcher changes the sheet; the stated rule (most data rows) fails on an ordinary Qualtrics-plus-analysis workbook | S2 |
| D2 | Synthetic tracker | `satisfaction_primary` | `1=Very dissatisfied to 5=Very satisfied; blank=Not asked`: labels for 1 and 5, or reported unread | `{1: "Very dissatisfied to 5=Very satisfied"}`, 5 unlabelled | S2 |
| D3 | Synthetic tracker | `nps_primary` | same pattern 0 to 10 | `{0: "Not at all likely to 10=Extremely likely"}` | S2 |
| D4 | Synthetic tracker | `main_brand` | `0=None...; 1 to 6=brand code` | `{0: "None of listed brands used P3M; 1 to 6=brand code"}` | S2 |
| D5 | Synthetic tracker | `attr_probability_b1` to `_b6` | `0=...; 1=Always selected if aware; rotated rival=...` | label for 1 swallows the next entry; a continuous probability carries value labels | S2 |
| D6 | FinScope | `EN11` code 11 | "Don't Know with which mobile networks or companies" arguably an answer | excluded as a non-answer (prefix match) | S3 |
| D7 | FinScope | `F18b_1` and 12 more, code 6 | "Not sure" excluded by the harness's label rule | kept as an answer | S3 (question) |
| D8 | Findex, IGS, synthetic tracker | `inc_q`, `educ`, `receive_wages`, `con12`, `con32`, `Q1`, `SEX`, `satisfaction_primary` | unlabelled code shown as `1`, `2` | shown as `1.0`, `2.0` in `categories()` and as crosstab row labels when the column also holds blanks; counts and `rawCode` right | S3 |
| D9 | CSM, Brand Oct 2025 | 12 variables | labels from the `Data Dictionary` sheet (`Column`/`Meaning`) | not used: `Meaning` is not a recognised label header | S3 |
| D10 | IGS | `w1` | recognised as a weight ("Statewide weights") | `weightLike` false until the codebook label is applied | S3 |
| OBS | Findex .dat vs .sav | `fin24d3` label | | trailing space in the .sps label only; a file difference | observation |

D2 to D5 come from the in-workbook codebook reader (`_excel_codebook` / `_parse_code_entries`). The separate codebook
reader (`codebook_items`, `claude/codebook-import.md`) reports such a cell unread; the in-workbook reader glues the next
entry into a label. Two readers of the same notation disagree (coding standard rule 1).

## Resource measurements

How taken: one child process per measured read (`run.py --child app <spec>`); in each child the engine is loaded and the
whole file read into memory first, then one engine call is timed with `time.time()` around that call only (import and
disk read excluded). Peak memory is `getrusage(RUSAGE_SELF).ru_maxrss` just after the call (process peak, including the
interpreter and libraries: baseline 81 MB in Findex children, 84 to 96 MB elsewhere, plus the file's bytes). Watchdog:
VmRSS polled every 0.2 s, cap 3,500 MB, timeout 900 s; none hit. The limit was lifted only in the loaded module's memory
(`IMPORT_LIMITS["maxCases"] = 10**12`). An earlier run gave figures within about 10%. Deployed limits: 2,048 MB and 60 s
per engine call.

| File | Bytes | Cases x variables | Engine call | Limit | Time (s) | Peak (MB) | Within 2,048 MB and 60 s |
|---|---|---|---|---|---|---|---|
| Findex .sav | 40,331,072 | 144,090 x 183 | `dictionary` | in force (refused) | 3.5 | 938 | yes |
| Findex .sav | 40,331,072 | 144,090 x 183 | `convert` | in force (refused) | 3.8 | 937 | yes |
| Findex .dta | 32,834,405 | 144,090 x 183 | `dictionary` | in force (refused) | 4.6 | 916 | yes |
| Findex .dta | 32,834,405 | 144,090 x 183 | `convert` | in force (refused) | 4.0 | 916 | yes |
| Findex .csv | 47,713,835 | 144,090 x 183 | `dictionary` | in force (refused) | 38.4 | 1,247 | yes, slow for a refusal |
| Findex .sav | 40,331,072 | 144,090 x 183 | `dictionary` | lifted | 7.4 | 944 | yes |
| Findex .dta | 32,834,405 | 144,090 x 183 | `dictionary` | lifted | 13.7 | 938 | yes |
| Findex .csv | 47,713,835 | 144,090 x 183 | `dictionary` | lifted | 46.2 | 1,247 | yes (77% of 60 s) |
| Findex .sav | 40,331,072 | 144,090 x 183 | `convert` | lifted | 32.1 | 1,540 | yes (75% of memory) |
| Findex .dta | 32,834,405 | 144,090 x 183 | `convert` | lifted | 24.8 | 937 | yes |
| Findex .csv | 47,713,835 | 144,090 x 183 | `read_table` | lifted | **124.8** | **1,737** | **no: about twice 60 s** |
| Findex first 5,000 .sav | 7,638,343 | 5,000 x 183 | `dictionary` | in force | 0.5 | 116 | yes |
| Findex first 5,000 .dta | 4,327,619 | 5,000 x 183 | `dictionary` | in force | 0.6 | 113 | yes |
| Findex first 5,000 .csv | 1,648,089 | 5,000 x 183 | `dictionary` | in force | 2.2 | 118 | yes |
| FinScope SA 2025 .sav | 80,811,074 | 5,562 x 3,960 | `dictionary` | in force | 10.3 | 814 | yes |
| FinScope SA 2025 .sav | 80,811,074 | 5,562 x 3,960 | `convert` | in force | 22.6 | 1,481 | yes (72% of memory) |
| IGS may2026.txt | 5,892,287 | 8,578 x 264 | `dictionary` | in force | 7.3 | 230 | yes |
| Synthetic tracker .xlsx | 983,111 | 1,200 x 233 | `dictionary` | in force | 16.8 | 104 | yes, slow for its size |

What this means for raising the 100,000-case limit:
- SPSS and Stata fit at 144,090 cases: under 1 GB for the variables list, at most 1.54 GB for the preview, under 35 s.
- CSV decides the limit: at 144,090 cases the calculation read took 46 s and the stored preview 125 s. If time grows
  linearly with cases, a CSV this wide reaches 60 s for the preview at roughly 70,000 cases.
- Refusals cost a full read: the case count is checked only after the whole file is read, in every format.
- The preview narrows at large sizes: the stored preview of the full Findex keeps 17 of 183 variables (100 MB result
  budget); FinScope's keeps 201 of 3,960. Calculations read every variable.

## Questions for Grant

1. Byte limit: `api/import-limits.json` says 100,000,000; `claude/import-resource-boundary.md` says 20,000,000. Which is
   current?
2. Case limit: differ by format? Check the case count before the full read (pyreadstat `number_rows` from metadata; a
   CSV's lines counted cheaply)?
3. Sheet choice (D1): prefer a sheet that looks like respondent data, or always ask when a workbook has several
   non-dictionary sheets?
4. Range-style codebook cells (D2 to D5): label the end points, or report unread as `codebook_items` does? Show
   `blank=...` entries?
5. Non-answers (D6, D7): is "Not sure" a non-answer? Is a "Don't know" that names its subject an answer?
6. Blank SPSS text: 216 of FinScope's 232 text variables hold blanks (`M4_o` blank for all 5,562 cases), reported 100%
   valid, as SPSS does. Count blank text as no answer?
7. `Column`/`Meaning` dictionary sheets with pattern names (`CallReason_<Reason>`, `A / B / C`): support, or leave to the
   codebook link?
8. Weight detection (D10): offer `w1` as a weight when a linked codebook calls it one, or is manual choice enough?

## Formats in these files the app cannot read yet

- Fixed-width ASCII with SPSS syntax (Findex `.dat` + `.sps`: CP1252, `LRECL=296`): column ranges and `(A)` fields,
  labels continued with `+`, value-label blocks shared by several variables, double-quoted labels holding apostrophes,
  `FORMATS` disagreeing with the column width (`wgt (F19.16)` in an 18-column field).
- Qualtrics "Selected Choice" multiple-choice questions (EV): one column per option holding the option text or blank; no
  multiple-response set is found, so each option would be tabulated on the base of those who chose it (100%) rather than
  the 115 respondents.
- Benchmark weights in a separate workbook (FinScope `Finscope25_benchwgt_MY25.xlsx`, keyed by `QID`): cannot be joined
  to the .sav.
- Mis-decoded text in the source (EV `donâ€™t`): read as written (correct) but not flagged.
- Analysis sheets beside the data (EV `Tables`, `Pivot Table`, `Multiple Response Q's`): see D1.
- Codebook names absent from the data (IGS `w2`).
- Very wide SPSS files: the stored preview keeps 201 of FinScope's 3,960 variables; calculations read all.
