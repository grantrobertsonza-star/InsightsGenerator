# Import test library (conformance corpus)

Owner decision, Grant, 28 October 2026: "proceed with the test library. I think what we currently have is
well-specced out in terms of features, we just need to make sure what we have works."

## Purpose and finish line

A fixed, permanent set of import cases, each with its correct reading written out independently of the
code (from the generator's declared truth, from a hand reading, or from agreement between independent
readers), so a fault shows up in minutes on our side rather than in a later Codex round.

The import module is called done when:
1. every case in this library passes (or is a documented, owner-accepted limitation), and
2. two consecutive Codex blind stress rounds of new cases find no S1 or S2.

## Rules for every case

- **Truth comes first and from outside the reader.** Synthetic files are generated from a declared truth
  (the generator writes the file from the expected reading, never the other way round). Real files are
  checked against an independent reading (pyreadstat or pandas directly, a hand count, or agreement
  between the same data in different formats). The app's own output is never the expected value.
- **A refusal is a result.** Where the contract says a file is refused, the case expects the refusal and
  the gist of its message; a silent guess is a failure.
- **Identity, not wording.** Expected values use raw codes and variable names; labels are checked as
  labels.
- **Contracts are the specification:** `claude/one-reader-import.md`, `claude/codebook-import.md`,
  `claude/questionnaire-variable-linking.md`, `claude/instrument-reread-coverage.md`,
  `claude/import-resource-boundary.md`, `claude/table-method.md`, `claude/starter-tables.md`.
  A case whose correct answer the contracts do not settle is listed as a question for Grant, not guessed.

## Layers

| Layer | What | Runs against | Speed |
|---|---|---|---|
| L1 data reading | raw data files in every supported format and variation | the engine's read functions directly | seconds |
| L2 codebooks and questionnaires | codebook layouts, questionnaire documents, and how they link to data | engine codebook reading; linking via the library on a disposable database | minutes |
| L3 real datasets | Findex (same data as .dta, .sav, .csv, .xlsx, ASCII SPSS), FinScope, IGS, brand and CSM trackers | independent readings and cross-format agreement | minutes |
| L4 tables and reports | aggregated tables (banner tables), and reports with embedded tables (Word, PDF, PowerPoint) | the table readers; the model-dependent steps through recorded responses | minutes |

## Case matrix (L1, summary)

- **Delimited text** (.csv, .tsv, .txt): comma, semicolon, tab, pipe; quoted separators, doubled quotes,
  line breaks in quotes; short rows, trailing separators, surplus values (refused); ambiguous separator
  (refused); single column; UTF-8 with and without BOM, UTF-16, Windows-1252, invalid bytes (refused);
  blank lines; header-only; duplicate and empty header names; leading zeros, large integers, decimals,
  exponents, negative numbers, decimal commas, thousands separators, percentages, dates and times,
  booleans, missing markers (empty, NA, ".", 99/98 coded), mixed numeric and text.
- **Excel** (.xlsx, .xls): several sheets (data and dictionary), formatted numbers, dates, formulas,
  merged and multi-row headers, hidden rows and columns, leading title rows, identifier formats.
- **Stats files** (.sav, .zsav, .dta, .sas7bdat, .xpt): value labels, variable labels, user-missing
  values and ranges, string variables, long labels, measure levels, weights, dates, multiple-response
  sets declared in the file, unusual encodings.
- **Layouts**: rows as cases and columns as cases.
- **Resource limits**: file size and case limits at, just under and just over the limits.

L2 to L4 matrices are in their own files in this folder as they are built.
