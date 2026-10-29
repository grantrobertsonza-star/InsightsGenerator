# L4 map: aggregated tables and reports with embedded tables

Written 28 October 2026 from the code in this worktree (read only), before any case was built.
"Deterministic" means the same input always gives the same output with no model call. "Model" means
an Anthropic call decides the answer. File references are to `src/lib/` unless stated.

## 1. How a file becomes a "table" or a "report"

| Upload type (Import screen, `uploadPurposes.ts`) | Form field | Server call (`documentUploadActions.ts`) | Stored as |
|---|---|---|---|
| Tables ("Already aggregated: totals or percentages") | `tableFiles` | `storeUploadedDocument(..., "table", f, "aggregated")` | `documents.kind='table'`, `ingestion_type='aggregated'` |
| Raw data | `rawTableFiles` | `storeUploadedDocument(..., "table", f, "raw")` | `kind='table'`, `ingestion_type='raw'` |
| Report (PDF, Word, PowerPoint) | `reportFiles` | `storeAndRead(runId, "report", f)` | `kind='report'` |
| Statistical output (zip of models, clusters, logs) | `outputFiles` | `ingestOutputFiles` (`outputIngest.ts`) | `kind='output'` in an output set |

- The type is suggested in the browser (`suggestPurposeFor`, deterministic: extension, words in the
  name such as "tables", "banner", "cross tab", and for a CSV `csvLooksLikeTables`: a Total/Base row in
  the first 40 lines or 20% of cells written as percentages). The researcher can change it.
- Tables accepts `.csv .tsv .txt .xlsx .xls .sav .dta .sas7bdat .xpt .rds .rdata .rda .parquet`
  (browser check `purposeMismatch`). The server (`assertImportFileSupported`) only refuses a short list
  of data formats and size; it does not refuse a `.pdf`, `.docx` or `.pptx` sent under `tableFiles`.
  So the Word/PDF/PowerPoint branch of the table pipeline (below) is reachable only by a request the
  current Import screen does not make.
- `ingestion_type` is fixed by the upload slot. Nothing reads the file to confirm it is aggregated.

## 2. Path A: an aggregated table file (Excel or CSV)

Entry points: `processTableDocument` (called by the per-document "Generate findings" action and by the
run processing loop in `src/app/runs/[id]/page.tsx`), and `extractAndStoreDocumentTables` alone (from
`dataSetupActions.ts` after a layout change).

| Step | Code | Kind | What happens |
|---|---|---|---|
| A1 read | `documentTables.extractAndStoreDocumentTables` then `parseTable.parseTableDocument` then engine `read_table` (`api/parse-stats-file.py`, `_read_raw`, `_read_plain`) | deterministic | The same reader as case-level data. Row 1 of the chosen sheet is the header row; every later row is a "case". Excel cells are read as the workbook holds them (a percentage-formatted 0.45 is the number 0.45; the format is not read). Header names are literal text, blanks and repeats allocated by `_dedupe_header_names`. A variable is numeric only if every value is a plain number; otherwise text exactly as written ("45%B", "-", "*" stay text). Blank rows dropped. Sheet: the persisted choice, else the non-dictionary sheet with the most data rows. Layout for aggregated documents is always rows-as-cases (the data setup is read only for raw). |
| A2 store | same function, `insert ... on conflict (document_id, table_index) do update` | deterministic | One `document_tables` row, `table_index` 0, `label` null, `source_page` null, `headers`, `rows`, `ingestion_type='aggregated'`, `read_provenance` {reader, sheet, layout, encoding, dateColumns}. A file with no headers and no rows is refused ("No tables were found"). |
| A3 findings | `generateFindingsFromTable` then `tableComputation.computeTablePatterns` | deterministic | For aggregated tables only (raw tables never get this scan): the first 15 columns are classified numeric (every present value a number, at least 5) or categorical (2 to 10 distinct values, at least 10 present). Patterns: segment_difference (t-test of a numeric column between the two largest groups of a categorical column), relationship (Pearson r between every pair of numeric columns across rows, r >= 0.3 and p < 0.05), outlier (`flagOutlier` per value against the rest of its column). Up to 25 patterns, stored as findings with `origin='generated'`, `status='accepted'`, replacing earlier generated findings for that table (`archiveAndReplaceFindings`). |
| A4 quality panel | `aggregatedQuality.computeAggregatedQuality` (called from the run page for non-raw documents with tables, `table_index < 100`) | deterministic | Base detection (a first-column row label like Base/n/Sample size, a header with "n=", a column named Base/n), weighting words, percentage columns adding to 100 (only columns holding at least one cell written with "%"), count columns against a Total row, duplicate tables, extraction damage (blank or generic headers, empty columns, header repeated in body), banner layouts. |
| A5 claim checks | `claimTableChecks.checkClaimsPending` (from `claimTableChecksActions.ts` and `verifyAfterGenerate.ts`) with `tableClaims.fromGeneric` and `checkAtom` | model points at cells; everything else deterministic | For each accepted stated quantitative report claim: every non-raw `document_tables` row is turned into a view (`fromGeneric`: first column is the row label, other columns are columns; the first row whose label reads Base/n/Sample size is the base; a cell is a percentage when written with "%" or when the label/headers mention % and the number is 0 to 100; duplicate row labels keep the first). Up to 6 candidate tables chosen by shared words (deterministic). The model (`record_atoms`) names table, row, column(s), the claim's stated figure, threshold, direction. Then tier a: stated figure against the cell within rounding; tier b: level against threshold or two-column gap with a 95% interval from p and base. Stored in `claim_table_checks` (delete then insert per finding). Combined stance per data set (`combineStances`). |
| A6 digest charts | `tableDigestCharts.buildTableDigest` | deterministic | Describes each column on its own as a distribution, raw or aggregated alike. |
| A7 downstream | `getTableGroundingDigest` (top generated findings as grounding text for report extraction), insights, recommendations, exports | model for prose | Generated findings from A3 feed the report reading prompt as "facts computed directly from table data". |

Saved cross tabs (built in the app from raw data, `crosstabs.ts`) are also stored in `document_tables`
with `ingestion_type='aggregated'`, `table_index >= 100` and a structured `crosstab` JSON; A5 reads those
through `fromCrosstab` (real column identities, bases, standard errors). That path is covered by L1/L3
and the cross tab tests, not here.

Not on this path: no step recognises a title row, a footnote, a second header row, a column group,
significance letters, a net, a weighted base, several tables on one sheet, or a CSV/Excel percentage
format. `aggregatedQuality` recognises a base row and percent text but runs after the table is stored
and changes nothing in it.

## 3. Path B: a table document that is Word, PDF or PowerPoint (`kind='table'`)

`extractAndStoreDocumentTables`, else-branch. Reachable only by a request outside the Import screen
(section 1).

| Step | Code | Kind | What happens |
|---|---|---|---|
| B1 page text | `extractFindings.extractDocumentText` | deterministic | Download from storage. PDF: `unpdf` text per page. DOCX/PPTX: LibreOffice (`convertToPdf.ts`, `soffice --headless --convert-to pdf`, one queue per process) then `unpdf`; one PDF page per Word page or slide; the converted PDF is uploaded as `<path>.preview.pdf`. Anything else: UTF-8 text with no pages. No page text gives the refusal "No page text could be extracted ... scanned or image-based PDF ... isn't supported yet". |
| B2 find tables | `detectTablesAcrossPages` | model | Pages in chunks of 5, 3 at a time. Tool `record_tables`: page_number, optional label, headers, rows (arrays of string/number/null). Kept when there are headers and rows. Row arrays are mapped onto headers by position with `setCell`. Chunks with no tool answer contribute nothing. |
| B3 store | as A2 | deterministic | One `document_tables` row per table found, `table_index` in order found, `label`, `source_page` from the model, `read_provenance` null. Upsert keeps ids stable; tables beyond the new count are left in place. |
| B4 onwards | as A3 to A7 | as above | |

## 4. Path C: a report (`kind='report'`)

| Step | Code | Kind | What happens |
|---|---|---|---|
| C1 page text | `extractDocumentText` | deterministic | As B1. Table cells arrive as runs of text in the order `unpdf` emits them; no table structure, no chart data, no text inside images. |
| C2 claims | `extractFindingsFromDocument` / `extractFindingsFromChunk` | model | Pages joined with `[[PAGE n]]` markers into chunks; the model returns findings with finding_kind, theme, data_type, verbatim `source_quote`, page. Table grounding digest from A7 included. |
| C3 quote check | `quoteMatch.quoteAppearsIn` | deterministic | The quote must appear (case, whitespace, dash and quote normalised) in the stated page, or a neighbouring page; else `quote_verified=false` (kept, flagged). A claim read from a table cell has no sentence; whether its quote verifies depends on the text order from C1. |
| C4 replacement | `planReplacement`, `publishReplacement` | deterministic | Staged, then published; human wording and decisions preserved (covered by other suites). |
| C5 claim checks | A5 | model + deterministic | Report claims are checked only against tables stored in `document_tables`; tables printed inside the report itself are never stored, so a report cannot be checked against its own tables. |

## 5. Path D: statistical output sets (`kind='output'`)

`outputIngest.ts`, `outputClassify.ts`, `outputAnalysis.ts`: a zip or files of model output (coefficients,
odds ratios, proportions with intervals, cluster profiles, Word tables via `mammoth` raw text). Its own
SheetJS/CSV reader (`parseDelimited`, `XLSX.read`), first non-empty row as header, first non-empty sheet.
Deterministic. Not a banner-table reader; out of L4 scope except to note it is a second, separate table
reader (one-reader-import.md, Limits).

## 6. Export

`docxReport.buildNarrativeReportDocx` embeds chart images per theme and finding text; it does not embed
source tables. Not exercised here.

## 7. Documented contracts that apply

- `claude/one-reader-import.md`: the reading rules for CSV/TSV/Excel (A1). Written for respondent-level
  data; it is the only contract the aggregated reader has.
- `claude/table-method.md`, `claude/starter-tables.md`, `claude/crosstab-ai-reading.md`: tables built
  in the app from raw data. Not the aggregated upload.
- `claude/upload-type-suggestions.md`: the suggested type (section 1).
- `claude/output-set-integrity.md`: path D.
- `claude/model-call-completion.md`, `claude/evidence-chain.md`: report extraction completeness and
  quote evidence (path C).
- Code comments in `tableClaims.ts` ("where the base is missing or the measure unclear the result is
  silent with the reason, never a guess") and `aggregatedQuality.ts` act as the only statement of A4
  and A5 behaviour.

## 8. Where no contract exists (gaps found while mapping)

1. What an aggregated table file is: title rows, multi-row banner headers, column groups, several tables
   on one sheet or across sheets, footnotes, significance letters, nets, weighted and unweighted bases,
   "-" and "*" conventions, percentage formats. No contract; the case-level reader is used as is.
2. Which sheet(s) of a multi-sheet banner workbook are read: one sheet only (most data rows); the others
   are read as label sheets, not tables.
3. The open pattern scan (A3) on an aggregated table: what a "row" is (an answer category, a base row,
   a net) and whether t-tests, correlations and outliers across answer categories mean anything. No
   contract; the scan's comments describe raw-like rows.
4. Table detection in Word/PDF/PowerPoint (B2): no contract for label, page, header identity (duplicate
   sub-headers under different groups), short or long rows, or model failure versus "no tables".
5. Tables, charts and images inside reports (C1/C5): no stated behaviour for chart data, image tables,
   tables spanning pages, or checking a report against its own tables.
6. Claim checking (A5) against an aggregated upload: which base row is used (weighted or unweighted),
   what a fraction cell (0.45 formatted as 45%) means, which of several same-named rows is meant.
7. `ingestion_type` is never checked against the content (a case-level file uploaded as Tables).
