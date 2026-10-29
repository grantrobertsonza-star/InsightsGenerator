# L4 report: aggregated tables and reports with embedded tables

28 October 2026. Worktree `/home/claude/b66`. Nothing was edited outside `conformance/l4/`, and nothing
was committed. `MAP.md` maps the code paths. `results.json` holds the machine-readable results: every
check with its expected value, actual value, basis and severity guess. Its `observations` section holds
the engine readings, the generated findings and the page text.

## How to run

`bash conformance/l4/run.sh` (about 3 minutes). It does four things:

1. Regenerates the fixtures from their declared truth (`generate.py`).
2. Prepares the real-file readings (`real_prep.py`).
3. Runs the three vitest files one at a time with one fork (`runner/aggregated.test.ts`,
   `runner/documents.test.ts` and `runner/real.test.ts`, config `vitest.config.mjs`).
4. Merges the results (`summarize.py`).

The database parts use `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres` through
`disposableDb.ts`. Each file gets a fresh database, dropped afterwards. Nothing calls a model API or
cloud storage: the model is replaced by recorded answers and storage by an in-memory map. LibreOffice is
real (`/usr/bin/soffice`).

Expected values come from `cases.json` and from hand readings of rendered pages recorded in
`real_prep.py`. `cases.json` is written by `generate.py` from three sources: the declared truth, Python's
csv and openpyxl readings of the real files, and python-pptx reads of native tables and chart series.
No expected value comes from the app.

## Counts (last run)

| | checks | pass | fail |
|---|---|---|---|
| all | 296 | 182 | 114 |
| basis: contract (a documented rule or a guarantee stated in code comments) | 56 | 50 | 6 |
| basis: research (no contract; an independent researcher's reading) | 240 | 132 | 108 |
| runner aggregated (path A: 25 table cases and 1 codebook case) | 240 | 151 | 89 |
| runner documents (paths B and C: synthetic Word, PDF and PowerPoint; disposable database) | 35 | 22 | 13 |
| runner real (FinScope databook subset, Tesla deck, BRC PDF) | 21 | 9 | 12 |

Failures by severity guess: S1 5, S2 70, S3 39. There are 49 case ids, and 10 pass every check. The vitest
logs count tests, not checks (one test per case), so they read like "21 failed (21)". The check counts
above are the ones that matter.

Mocked: the model (recorded answers written from the truth), storage (in-memory), `apiUsage`,
`requestContext` and the Next cache.

Real: the Python engine (`api/parse-stats-file.py`), LibreOffice, unpdf, PostgreSQL with every
migration, `extractAndStoreDocumentTables`, `processTableDocument`, `generateFindingsFromTable`,
`checkClaimsPending`, `tableClaims`, `aggregatedQuality`, `tableComputation`, `uploadPurposes` and
`quoteMatch`.

## What passes

- **Engine reading.** The engine reads every aggregated CSV and Excel file without refusing it, exactly
  as the one-reader contract says: the first row gives the names, text is kept literally, blank and
  repeated names are allocated, and text percentages stay as text. The DHS long and wide files and the
  two case-level real files match their independent readings.
- **Page text from Word, PDF and PowerPoint.** Page counts are right (explicit page breaks in Word, one
  page per slide). Every native table cell is on its page. Rows of simple tables can be quoted as
  "Yes 60% 64% 56%". The generated chart's data labels reach the page text.
- **Path B storage with a faithful model answer.** Label, page and cell identity are stored correctly
  for a simple Word table and a native PowerPoint table.

## Failures

To reproduce any row, run `bash conformance/l4/run.sh` and look up the case id in `results.json`.

| # | Case(s) | Expected | Actual | Sev |
|---|---|---|---|---|
| 1 | AGG-02, C-01 (end to end) | "60% have heard of Brand X" checked against an Excel table holding 0.6 formatted as 60%: supports | against ("the table gives 0.6 ... a difference of -59.4"), stored in `claim_table_checks` | S1 |
| 2 | AGG-12 (Findex) | "81% of adults have an account" checked against 0.811 labelled "(%, age 15+)": supports | against (0.81 vs 81) | S1 |
| 3 | AGG-08 | "34% of men very satisfied" checked against a counts table (163 of 480): supports or silent | against (163 vs 34). `fromGeneric` compares a count with a stated percentage. | S1 |
| 4 | AGG-19 (DHS long) | a claim on observation 2 (42.4): supports or silent | against. Every row collapses onto the constant first column `STRUCTURE`, so the only row is "datastructure", which holds row 1 (42.3). | S1 |
| 5 | AGG-13, AGG-19, AGG-20 | 332, 607 and 607 distinct rows, identified by the label or dimension columns | 1 row ("2024" or "datastructure"). `fromGeneric` uses the first column as the row label and keeps only the first row per label. | S2 |
| 6 | AGG-06, AGG-16 | the label "55+" resolves to the 55+ column or to none | resolves to " (5)", which is the 18-34 column (`matchLabel` loose containment: "55" contains "5") | S2 |
| 7 | AGG-06, 07, 16 (title rows, group rows, stacked tables) | columns Total, Male, Female, 18-34 ... | the headers are the title and blanks. At most 1 of 30 cells is found by identity, and the claims come out silent. | S2 |
| 8 | AGG-07, AGG-11 | 2 tables (stacked on one sheet; one per sheet) | 1 table. In AGG-11 the Q1 sheet is not read at all, and nothing says so. | S2 |
| 9 | AGG-08, C-01 | no generated finding treats the Total row as data | 3 accepted findings such as "Total value of 1000 at row 5 ... 6.7 SD", stored by `processTableDocument` | S2 |
| 10 | AGG-19 | no finding treats year or country as a measure | "TIME_PERIOD and OBS_VALUE move together across 607 rows (r=0.47)", pooled over 71 countries; "TIME_PERIOD value of 2025 ... outlier"; and OBS_VALUE outliers named only by row number | S2 |
| 11 | AGG-01, 03, 10 | in a Count and Percent table, Count 50 is a count | read as 50 percent. Any header containing "Percent" makes every number from 0 to 100 a percentage. | S2 |
| 12 | AGG-17 | the base used for the interval is the unweighted base | the first base row is used, here the weighted one (490, 510 ...) | S2 |
| 13 | AGG-01..03, 08, 10 (Total row); AGG-18 (n= in headers) | base 1000 / 480 / 520 | no base. Only a row labelled Base or n is read, not a Total row or a header like "Male (n=480)". | S2 |
| 14 | B-02 (PDF banner: Wave 1 Yes/No, Wave 2 Yes/No) | 4 value columns | headers are stored as [Province, Yes, No, Yes, No], but each row keeps only the Wave 2 values (`setCell` works by name). Wave 1 is lost silently, and the group row has nowhere to go. | S2 |
| 15 | B-03 (Word table on pages 5 to 6) | 1 table with 70 rows | 2 tables, the second unlabelled. Pages go to the model 5 at a time, and nothing joins a table that continues into the next call. | S2 |
| 16 | B-04 | the model returned no tool answer: an error saying detection did not complete | "No tables were found in this document". A failed read is reported as absence. | S2 |
| 17 | B-08, DOC-04, R-TES-s13 | chart data available as a table to check claims against | never available. Charts are not tables in path B, and path C stores no tables. The Tesla claim "33% would buy" (Likely 23% + Very likely 10%) cannot be checked. | S2 |
| 18 | R-DB (FinScope databook) | header "2025 (n=5600)"; all rows of slide 60 | wrapped header cells come out as "(n=560 0)". Three rows that run off the bottom of slide 60 are clipped by LibreOffice and lost. | S2 |
| 19 | CB-01 (Data360 DATADICT read as a codebook) | 41 variables, labels from VARIABLE_LABEL | 42 variables (the header "VARIABLE_ID" becomes a variable), and labels come from VARIABLE_DESCRIPTION | S2 |
| 20 | C-01 | the model is shown the stored values 0.6, 0.35, 0.05 | it is shown 0.6, 0.4, 0.1 (`render` rounds to one decimal) | S3 |
| 21 | C-02 | the claim's own table is among the tables offered to the model | not offered. Six report tables sharing more words fill the six slots, and the result is "No table in this project speaks to this claim". | S3 |
| 22 | AGG-04, 05, 06, 16, 17, 18 | Data quality: percentage columns add to 100 with nets excluded; letters read as significance | nets are included, so every column reads as "further off"; fractions with a % format are not checked at all; letters stay inside the text ("34%C") | S3 |
| 23 | AGG-09 | "-" read as 0 and "*" as under 0.5% | both read as null. A claim of 0% comes out silent instead of supported. | S3 |
| 24 | AGG-12, 13, 19, 20; CB-01 | suggested type: tables (codebook for the DATADICT file) | raw for aggregated CSVs with no Total or Base row and no % text; raw for the DATADICT file | S3 |
| 25 | B-05, B-06 | a page the document does not have, or a row longer or shorter than the headers: refused or flagged | page 99 is stored. Extra cells are dropped and missing cells left blank, with no record. | S3 |
| 26 | B-07 | an image-only PDF is refused with the "scanned or image-based" message and no model call | it is sent to the model (a page with empty text), then "No tables were found" | S3 |
| 27 | AGG-14, AGG-15 | a case-level file uploaded as Tables is recognised | stored as aggregated; for AGG-14 the open scan stores 3 accepted findings | S3 |
| 28 | DOC-04, DOC-05 | a picture of a table is read or flagged | invisible, with no flag | S3 |
| 29 | R-BRC page 17 | rows quotable as "label value" | 7 of 9 rows are not, because a significance note line sits between label and value. All cells are present. | S3 |

The six contract-basis failures are rows 3, 4, 6 (two cases), 16 and 26.

## Not covered, and why

- **Model quality.** Whether the real model finds tables, reads chart images or points at the right cell
  is not tested. The tests cover only what the app does with a recorded answer.
- **Report claim extraction itself** (`extractFindingsFromChunk`). Only its deterministic quote check is
  probed, through `quoteAppearsIn` on real and synthetic page text.
- **The full FinScope databook.** In this sandbox (8 GB shared with another stack), LibreOffice was
  killed for memory after 141 s at about 2.4 GB resident. A three-slide subset (slides 10, 15 and 60) is
  used instead, and it took 37 s; the 34-slide Tesla deck took 20 s. Whether production can convert a
  652-slide, 28 MB deck within its limits is unknown.
- **Other paths.** Saved cross tabs built in the app (`fromCrosstab`), output sets (path D), the
  narrative DOCX export, the UI panels and upload form (browser), and freshness of findings after a
  table is re-read.
- **Hand readings.** These cover BRC page 17, Tesla slide 13 and spot checks of two databook slides. The
  other real slides were checked only against python-pptx reads of the file.
- **Formats.** .xls, .tsv, and banner workbooks where the researcher chose a sheet.

## Questions for Grant

1. What is a Tables upload meant to contain? Should it be read as banner output (title, group and column
   header rows, base rows, several tables per sheet or per workbook)? Or must each file hold one table
   with a single header row? Today the case-level reader is used unchanged.
2. When a percentage is stored as a fraction (0.6 with a % format, or Findex's 0.811 with "(%...)" in the
   label), should the reader apply the cell format or the label? Or should the claim check treat a 0 to 1
   column as a proportion when the claim states a percentage?
3. When a table gives both weighted and unweighted bases, which one should a re-derived test use? (The
   cases assume unweighted.)
4. Should the open pattern scan run on aggregated tables at all? On banner and indicator tables, its rows
   are answer categories, totals and country-years. It currently stores accepted findings such as
   "Total is an outlier" and "TIME_PERIOD correlates with OBS_VALUE".
5. For indicator datasets (Findex, Data360 SDMX long and wide), is row identity given by the dimension
   columns (plus the year column in the wide form), with constant metadata columns ignored? Should these
   be a supported Tables shape, or a separate "indicator data" type?
6. Should the claim check refuse to compare a stated percentage with a count, or derive the percentage
   from the column total?
7. Should a report's own tables (and its chart data) be stored, so its claims can be checked against
   them?
8. The server accepts Word, PDF and PowerPoint files sent as Tables, although the Import screen does not
   offer that. Should path B be kept (and failures 14 to 16 fixed), or should the server refuse them?
9. Should "-" and "*" be read as 0 and "under 0.5%", or left unreadable (silent)?
10. Data360 DATADICT: should "DATADICT" match the dictionary name rule? Should the codebook reader prefer
    VARIABLE_LABEL over VARIABLE_DESCRIPTION?

## Feature gaps for normal market research reports

- **No reader for banner tables.** Nothing handles a title, multi-row headers, column groups (banner
  variables), a letters row, significance letters, nets, weighted, unweighted or effective bases,
  footnotes, or several tables per sheet or across sheets.
- **Charts without data tables.** Chart series are stored in PowerPoint files but never extracted, so
  claims drawn from charts cannot be checked. Such claims are very common in decks and databooks.
- **Tables as images.** Pictures of tables and image-only PDFs get no OCR and no flag saying the content
  was not read.
- **Multi-page tables.** They are split at every 5-page model call. Nothing joins continuations or
  repeated headers.
- **Tables wider or longer than the slide.** LibreOffice clips them, and wrapped cells split numbers
  ("560 0").
- **Side-by-side tables and notes between label and value.** The text order is unpdf's, so row quotes
  do not verify.
- **A report is never checked against its own tables,** only against tables uploaded separately.
- **Repeated sub-headers in path B.** Duplicate sub-headers under different groups are merged by name.
- **Indicator datasets.** In SDMX long and wide files, row identity is lost and constant metadata columns
  are offered as data.
- **No downstream semantics.** Significance letters, nets and bases mean nothing in the quality panel,
  the claim checks or the generated findings.

## Files

- Map and report: `MAP.md`, `REPORT.md`.
- Generators and readings: `generate.py`, `real_prep.py`, `cases.json`, `real_expected.json`.
- Fixtures: `fixtures/` (synthetic files and real files: the Findex, DHS and two case-level copies).
- Runners: `runner/*.ts`, `vitest.config.mjs`, `run.sh`, `summarize.py`.
- Results: `out/*.results.json`, `results.json`.

`work/` (the databook subset) and `.cache/` are regenerated, and are listed in `.gitignore`.
