# L1 data-file reading: conformance report (28 October 2026)

Run: `python3 conformance/l1/run.py --rebuild` (348 cases; about 16 s on 2 cores with the 100,000-case limit cases;
`--skip-heavy` about 4 s). Results: `conformance/l1/results.json`. Cases and their declared truth: `conformance/l1/gen.py`.

Reader functions called (api/parse-stats-file.py loaded as a module; no storage, no network): `read_table` (the stored
preview of CSV, TSV, .txt and Excel), `_read_raw` (the calculation read: frame plus labels, value labels, missing
declarations and measure levels), `convert` (the stored preview of SPSS, Stata and SAS), `dictionary` (weight-like flag
only), `_check_import_limits` (byte-limit boundaries).

## Counts

| Result | Cases |
|---|---|
| Pass | 310 |
| Fail | 14 (5 distinct faults) |
| Question for Grant | 24 |

Coverage: delimited text 214 (separators by quoting, delimiter choice, 13 encoding variants, 58 number spellings, 36
missing-marker variants, names, identifiers, dates, booleans, flipped layout); Excel 71 (.xlsx and .xls); stats files
51 (.sav, .zsav, .dta, .xpt); limits 12.

## Failures

### F1. Excel whole numbers beyond 2^53 reach the preview as JSON numbers and merge (S1)

Cases: `X-xlsx-big-int`, `X-xlsx-flip-big-int` (S1); `X-xlsx-big-int-double` (S3, same cause).

Repro: `bigint.xlsx`, sheet Data: A1 `acct`, B1 `q`; A2 a number cell `9007199254740993` (`<v>9007199254740993</v>`,
as pandas, xlsxwriter and most export tools write an int64); A3 the number `9007199254740992`; A4 `12`; B2:B4 `1, 2, 3`.

Expected: `"9007199254740993"` and `"9007199254740992"` as text, two distinct values.

Actual: `_as_numbers` correctly refuses to type the variable as numeric, but the non-numeric branch of `_typed_series`
keeps the cells as Python ints, so `read_table` emits JSON integers. Read as doubles by the app, both become
9007199254740992: the stored preview shows two respondents with one identifier, while the calculation (Python ints)
keeps them apart. Same in columns-as-cases. For `1e+20` the value is exact as a double, so only the typing differs.

Clause: one-reader-import.md: "a whole-number Excel cell arrives as an int and is held to the same 2^53 magnitude
rule"; "a magnitude beyond 2^53 makes the variable text ... so preview and calculation keep the same, distinct
values"; "Distinct written values therefore never merge". This is B38-F01, fixed for R and Parquet by
`_exact_whole_numbers`, still open for Excel.

### F2. Identifier zero-pad format not applied in columns-as-cases Excel (S2)

Case: `X-xlsx-flip-id-zero-pad`. Repro: `flipidpad.xlsx`, layout `columns_are_cases`: row 1 `var, c1, c2`; row 2
`Respondent ID, 7, 8` with B2:C2 formatted `0000`; row 3 `q, 1, 2`.

Expected: `"0007"`, `"0008"` as the rows-as-cases read gives (`X-xlsx-id-zero-pad` passes), or the variable reported in
`unsupportedIdentifierColumns`. Actual: `"7"`, `"8"`, nothing reported; `_apply_zero_padded_id_formats` runs only in the
rows-as-cases branch of `_read_plain`. Clause: one-reader-import.md, Identifier formats ("a zero-padding Excel format on
an identifier column is applied (0007)"; layouts not excepted). S2: counts unchanged, but identifiers silently differ
from Excel's display and from the other layout, so a later match on respondent ID would fail. Other identifier formats
in the flipped layout were not cased separately.

### F3. .zsav refused by both readers (S2, partly a gap)

Cases: `S-zsav-base`, `S-zsav-sysmiss`, `S-zsav-user-missing`, `S-zsav-string-user-missing`, `S-zsav-measure`.
Repro: any `pyreadstat.write_sav(df, "x.zsav", compress=True)`.

Expected: read like .sav (import-resource-boundary.md: "SAV/ZSAV readers retain formal missing declarations"; the engine
has `.zsav` branches in `_read_raw_uncached` and `_rq_raw_answers`; `crosstabs.ts` sets a .zsav dictionary minimum).
Actual: `Unsupported data file extension: .zsav` (calculation) and `Unsupported stats file extension: .zsav` (preview):
`READERS` has no `.zsav` key, and `uploadPurposes.ts` omits it, so it cannot be uploaded. The same bytes named `.sav`
read correctly (`S-zsav-as-sav-name`).

### F4. A skipped empty row still turns a whole-number variable into float (S3)

Cases: `D-BLANK-separators-only`, `D-BLANK-na-row`, `X-xlsx-blank-row-middle`, `X-xls-blank-row-middle`.
Repro: `a,b\n1,2\n,\n3,4\n` (or a row of `NA,N/A`, or an empty Excel row between data rows).
Expected: 2 cases, int64 (`1`, `3`). Actual: 2 cases, float (`1.0`, `3.0`): `_typed_frame` types each variable before
`dropna(how="all")`. Clause: one-reader-import.md, Missing values plus Types ("Whole numbers with no gaps are int64").

### F5. Written byte limit disagrees with the enforced one (S3, documentation)

Case: `LIM-doc-drift`. import-resource-boundary.md says "The approved initial scope is 20,000,000 bytes";
`api/import-limits.json` and `importLimits.ts` enforce 100,000,000. All 11 limit cases pass (100,000 cases read;
100,001 refused in CSV, flipped CSV and .sav, preview and calculation; 100,000,001 bytes refused by `read_table`,
`convert` and `_read_raw` before reading).

## Questions for Grant

Each was run; the observed reading is in `results.json`. None counted as pass or fail.

Encodings
1. `D-ENC-mixed-utf8-cp1252`: mostly UTF-8 with one stray Windows-1252 byte is read entirely as Windows-1252 (`€5`
   becomes `â‚¬5`), with only the encoding note. Refuse instead?
2. `D-ENC-macroman`: Mac Roman ("CSV (Macintosh)") is also valid Windows-1252, so `café` reads as `cafŽ`. The contract
   says other legacy encodings are "refused, not guessed". Is the encoding note enough?
3. `D-ENC-utf16-nobom`: UTF-16 without a byte-order mark is accepted as UTF-8 with NUL characters in every name and
   value. Refuse it?

Empty and malformed tables
4. `D-EMPTY-file`, `X-xlsx-empty-sheet`: an empty CSV or workbook reads as a table with no variables and no cases.
   Refuse?
5. `D-NAME-empty-middle`, `D-NAME-two-empty`, `X-xlsx-leading-blank-col`: blank header names become `""` and `" (2)"`
   in rows-as-cases; the flipped layout names them `Variable n`. One rule for both?
6. `D-NAME-trailing-sep-header`, `L-FLIP-trailing-sep`: a trailing separator on every line adds an empty-named,
   all-missing variable (in the flipped layout, a phantom case). Drop them?
7. `L-FLIP-empty-case`: rows-as-cases drops an all-empty case; the flipped layout keeps it. Drop it there too?

Excel structure
8. Header rows: `X-xlsx-title-rows` (title rows above the header make the title the only name and the real header a
   case), `X-xlsx-leading-blank-row` (an empty row 1: names `""`, `" (2)"`, real header a case; CSV skips leading blank
   lines), `X-xlsx-merged-header` (the second header row is read as a respondent). Refuse, detect the header row, or let
   the researcher choose it?
9. `X-xlsx-data-sheet-named-value`: the dictionary-sheet name rule matches `value`, `code`, `label` or `notes` anywhere
   in a sheet name, so a 5-case data sheet "Brand Value Tracker" is passed over for a 1-row "Sheet2". Whole known names
   only, or decide by shape?
10. `X-xlsx-formula-nocache`: formulas saved without cached values read as blank, so a variable becomes missing with no
    message. Refuse and ask for the file to be opened and saved in Excel?
11. `X-xlsx-number-and-text-1`: number 1 and text "1" in one variable stay two categories both shown as "1". Intended?
12. `X-xlsx-id-text-format`: number identifiers with Excel's Text format `@` are blanked and reported, per the written
    rule for "any other custom number format". Treat `@` like General?
13. `X-xls-id-zero-pad`: .xls formats are not read, so `7` stays `7` and nothing is reported. Accept, and report it?
14. `X-xls-big-int`: a .xls number beyond 2^53 is already rounded in the file. Flag identifiers that may be rounded?

Values
15. `D-MISS-namibia`: `NA` (Namibia's ISO code) is a declared missing token, so Namibian respondents vanish from every
    base without warning. Keep, make it per variable, or warn?
16. `D-NUM-padded-space`: `" 5"` and `"6 "` are typed as numbers although the contract says other text is kept
    "exactly as written". Confirm?
17. `S-sav-blank-string`, `S-dta-blank-string`: a blank string is missing in CSV, Excel and SAS but an answer (and in
    bases) in SPSS and Stata. One rule for all formats?

Contract drift
18. import-resource-boundary.md says `.sas7bdat` is excluded and upload controls disclose this, but `uploadPurposes.ts`
    accepts it and the engine reads it. Which is current?

## Feature gaps (not faults)

- Decimal commas (`3,5`, `1.234,5`) are never numbers; European thousands such as `1.234` are read as the decimal 1.234
  (silently scaled; follows the written rule).
- Missing markers `.`, `-`, `?`, `missing` are values, so the variable becomes text; coded missing values (99, 98, -99)
  are not declared in CSV or Excel unless a questionnaire is linked.
- Percentages, currency, thousands separators and units stay text.
- No header row choice in Excel (title rows, multi-row and merged headers, data below row 1).
- One sheet per file.
- Not read: `.zsav` upload (F3), `.xlsm`, `.xlsb`, `.ods`, Triple-S, fixed-width ASCII with SPSS syntax, `.sas7bdat`
  status unclear (Q18), JSON data.
- Mac Roman, ISO-8859-2 and BOM-less UTF-16 misread rather than refused.
- SPSS file weight (`WEIGHT BY`) and multiple-response sets inside a .sav are not read; pyreadstat cannot write them, so
  not cased. The engine's `mr_sets` lookup is keyed by variable while pyreadstat's `meta.mr_sets` is keyed by set name:
  check with a real file in L3.
- Formulas without cached values (Q10).

## Not covered

`.sas7bdat` (no writer); real-file encodings in stats files; SPSS MR sets and file weights; Stata extended missing values
beyond `.a`; Excel 1904 dates beyond one date; R and Parquet; codebook behaviour (L2).
