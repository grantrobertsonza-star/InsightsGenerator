# Later additions

Capabilities deliberately left out of the current scope, by owner decision. Each says what is not
supported, what the app does instead, and what an implementation would need. These are not
defects; a review should not count them as such, and the app must keep saying plainly when a
request falls outside them.

## 1. SAS value labels (SAS files themselves supported since 2026-10-26)

- **Supported now:** `.sas7bdat` and `.xpt` uploads: names, variable labels, dates and missing values
  (a blank text value is missing, as SAS defines it), verified against the published reference files in
  `fixtures/sas` (`dataFileFormats.db.test.ts`, `e2e/ui/data-file-formats.check.mjs`).
- **Not supported:** value labels kept in a separate SAS format catalog (`.sas7bcat`); coded answers
  show as their numbers.
- **Instead:** export to SPSS (`.sav`) or Stata (`.dta`) with formats applied, or upload the
  questionnaire so its answer lists can be matched.
- **Would need:** reading the catalog (pyreadstat `read_sas7bcat`) and applying it as value labels,
  with a reference file pair.

## 2. A columns-as-cases workbook with a separate Codebook (owner-approved exclusion, 2026-10-16)

- **Not supported:** weight or multiple-response declarations in a separate Codebook sheet when the
  data sheet is laid out with variables in rows (IMP-009). The engine refuses these with "Unsupported
  flipped workbook ... Re-export as one row per respondent" before any analytical result.
- **Instead:** re-export as one row per respondent, or declare the weight and sets on the data sheet.

## 3. Weights and survey design from a separate file, and composite strata (Grant, 2026-10-24)

Raised with FinScope SA 2024: the statistician's weighting workbook (`Finscope24_benchwgt_MY24.xlsx`,
one row per respondent, keyed by `QID`) carries `BENCHWGT`, `HH_WEIGHT`, `EA_CODE11` and `FOREIGN`,
and the design's variance strata combine five variables (FOREIGN, metro, NLI group, province, race:
116 initial strata, 20 singletons merged with a partner) as in the R preparation script
`R_00_prepare_survey_design_v1_final`.

- **Supported now:** weight variables in the data file itself (found by name, offered in Cross tabs
  and Analytics, never as rows or columns); a survey design in Cross tabs with **one** cluster (PSU)
  variable and **one** stratum variable, used for Taylor series standard errors, design-based column
  tests and the Rao-Scott table test (`api/parse-stats-file.py` `_Design`), and by the analyses built
  on cross tabs (NPS, Objectives evidence, brand health, CSM, wave tracking). Single-cluster strata are
  pooled, which can only widen intervals. Analytics (driver analysis, regression) uses weights only.
- **Not supported:**
  - attaching columns (weights, design fields such as FOREIGN) from a second file joined by respondent
    ID;
  - a stratum defined by several variables, or the singleton-stratum merge the R script performs;
  - the survey design in Analytics.
- **Instead (works today):** merge the workbook into the data file in R and export it with the final
  weight and a single final variance-stratum column (the R script's `strat_analysis` /
  `variance_stratum`); then choose that weight, `EACode` as the cluster and that column as the stratum
  in Cross tabs.
- **Would need:**
  1. A "Weights and design" file type: choose the respondent ID in each file and the columns to bring
     in; refuse, with counts, unless IDs are unique in both files and the sets match exactly, a shared
     cluster code agrees for every respondent, weights are present, finite and positive, and
     cluster-level fields are constant within a cluster; attach nothing on a partial match; record the
     source file and version on every result that uses an attached column (a migration).
  2. Composite strata built in the app from several variables, with a documented singleton rule,
     checked against the R script's outputs (116 initial strata, 20 singletons, final strata EA counts).
  3. Keeping the existing real-data check passing once the strata are built in the app: the engine's
     Taylor series standard errors already match R `survey::svymean` on FinScope 2024 to within 0.3% in
     all 18 cells compared (ratio median 1.000, range 0.997 to 1.003; engineering brief v19 section 8.4),
     but only with the FOREIGN flag merged from the workbook and the R run's initial-to-final strata map
     applied outside the app, by `scripts/finscope_verify.py`. That script and the synthetic self-test
     (`scripts/crosstab_selftest.py`) are run by hand, not by the automated suites.

## 4. Visuals for coded qualitative data (Grant, 2026-10-26)

- **Idea:** a word cloud of the codes and themes, sized by how many turns or participants each
  covers, beside the codebook; possibly key phrases with sample passages and a map of which codes
  occur together (Inspirient's semantic analysis shows key phrases with excerpts and a semantic
  network).
- **Care needed:** size by coded counts the app already holds (turns, speakers, transcripts), never
  by raw word frequency alone, and keep every shape clickable to the passages behind it, so the
  picture can be checked. Word clouds are poor for comparison, so a ranked bar view sits beside it.
- **Order:** after the codebook and stability work in `claude/coding-module-learnings-2026-10-26.md`.

## Related open fix (not a later addition)

The Research assistant told a researcher that FinScope SA 2024 has no weight variable, because
weight variables are hidden from the variable list it searches. It should report the weight-like
variables (here `HH_WEIGHTS` and `BENCHWGT_Mid_year`) and which one tables use.
