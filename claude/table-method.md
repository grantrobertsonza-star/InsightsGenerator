# Table method version, the column tests and row and response percentages (batches 47 and 59)

Rule owner: engine `TABLE_METHOD` (`api/parse-stats-file.py`), written to every table's
`notes.methodVersion`; compared by `src/lib/tableMethod.ts` (`CURRENT_TABLE_METHOD`, `tableMethodStatus`),
which must equal the engine value (`tableMethod.test.ts` reads the engine source).

## The column tests

- **Shares, no design:** each column is compared with all other cases of its banner variable, and column
  pairs for the letters, with a two-proportion z-test pooled under the null hypothesis on effective bases:
  p0 = (p1 n1 + p2 n2) / (n1 + n2), se = sqrt(p0 (1 - p0) (1/n1 + 1/n2)). Before batch 47 the variance was
  unpooled, p1(1-p1)/n1 + p2(1-p2)/n2, which is zero for a 0% or 100% cell, so a 0% cell against a small
  share was flagged: 0 of 53 against 11 of 947 gave p = 0.0008 (flagged lower), where the pooled test gives
  p = 0.430 and Fisher's exact test p = 1.0.
- **Shares, under a survey design:** the linearised (Taylor) variance of the difference is unchanged. A
  share at 0% or 100% has no linearised variance, so such a cell or column pair is left untested (no p, no
  flag, no letter) and the notes count them (`notes.degenerateUntested`, shown under "About these tests").
- **Means and scores:** unchanged (difference of means).
- Reference checks: `scripts/crosstab_selftest.py`, the complement and letters references are pooled; the
  0 of 53 case, a clear difference still flagged (0 of 200 against 60 of 800), and the design case. The
  0 of 53 checks fail on the unpooled engine.

## Row % and share of responses (batch 59, CT5K-F01, 28 October 2026)

- **Rule:** a figure is computed from unrounded figures and only the result is rounded (one decimal for
  shares and counts). `count`, `pct` and `se` are rounded for display and are never read back for a
  calculation. Multiplying every positive weight by one constant changes counts, never percentages or
  which cells are blank.
- **The unrounded figures, saved with the table:** every share row carries `countExact`, `pctExact` and
  `seExact` per column, and `countExact`/`pctExact` on its Total and on each banner's NET column; a mean or
  score row carries `pctExact` (the unrounded mean); a histogram bar carries `pctExact`. `pctExact` is null
  exactly where `pct` is (suppressed or empty base). They are part of the documented result
  (`parseStatsFile.ts` `CrosstabRow`), kept in the saved table, and read in `src/lib` only through
  `src/lib/crosstabExact.ts`.
- **Row %:** the answer's weighted count in a column over its sum across the columns of the same banner
  variable. Each banner variable is its own domain; with overlapping columns (a multiple-response set as
  the banner) a case counts once in each column it is in, as before. Applies to single answers, NETs,
  each option of a multiple-response question and researcher-defined nets. The NET column's row % stays
  100 where the answer was given.
- **Share of responses:** an option's weighted mentions over all options' mentions, per column, for the
  total and for each banner's NET column.
- **Blanks:** an unweighted column base under 10 is suppressed (None), as before. A denominator of zero
  (nobody gave the answer in that banner, or chose no option in that column) is None, never 0. Before the
  fix a small positive denominator could round to zero: with weights of 1/1024 the selected answer's row
  % read 0/0/100 instead of 10/30/60 and a column's share of responses was blank despite 100 cases.
- **Elsewhere in the engine:** no other percentage, share, net score, mean or index is computed from a
  rounded value. Means, net scores, eta, the whole-table test, the NPS contrast and histograms use
  unrounded arrays; Fisher's exact test rounds unweighted integer counts, which are exact.
- **Derived figures in `src/lib`, from the unrounded figures (batch 59 follow-up):** each rule keeps its
  one owner and now adds or divides `pctExact`/`countExact`/`seExact`, rounding once:
  - NPS, promoters, passives, detractors and their interval: `descriptiveFindings.computeNps` (callers
    `npsActions.runNpsAction`, overall and per segment, and the automatic level finding).
  - Top-two and bottom-two box, single shares, NET shares and their intervals: `descriptiveFindings.levelFindings`.
  - CSM top-N box and coded mean: `csmMetrics.summarizeSeries`, from the chart bars' `share` (`chartActions`
    copies `pctExact`); it returns `value` (display) and `exact`. A suppressed bar makes the reading
    unavailable (before: a suppressed segment's box read 0).
  - Brand health: category average (`brandHealthMetrics.categoryAverageExact`, displayed through
    `categoryAverage`), funnel conversion ratios, the gap to the category, and the above/at/below band,
    all from the unrounded scores.
  - The export's Total line (`crosstab/export/route.ts`): the answers' unrounded shares and weighted counts
    added, then rounded.
  - The ranking gap of a column finding (`crosstabs.crosstabFindings`), so ties are not decided by display
    rounding.
- **Tables saved before the unrounded figures were kept** (no `pctExact`): the readers in
  `crosstabExact.ts` return the rounded figure, the arithmetic used before. Such a table is already reported
  as built with an earlier method (below) until it is rebuilt.
- Reference checks: `scripts/crosstab_selftest.py` CT5K cases (the reproduction at weights x1, x1/1024,
  x1e-6, x1000, x3.7; NETs, options, researcher nets, two banners and an overlapping banner; the unrounded
  fields equal hand counts, are null where pct is, and exist on mean rows and histograms; zero-selected
  answers and options; fractional weights against a direct calculation; rescaling keeps every figure and
  blank). `weightScalePercentages.db.test.ts`: saved, reloaded, listed and exported tables.

## Method version and freshness

`TABLE_METHOD = "2026.10.28"` covers the row % and share-of-responses rule above; `"2026.10.27"` covered
the pooled test and the run-together non-answer labels (`claude/answer-domain.md`). A table with another
version, or none (built before it was recorded), is "earlier":

- Cross tabs list: an "earlier method" badge, with what changed in its title.
- Findings: "Table built with an earlier method" under the source, for a finding from a calculated table.
- Support (`supportStatusShared.classifyInsightSupport`): reason `method_changed`, status "stale", so an
  insight, pre-insight, recommendation or narrative resting on such a finding reads "Support changed since
  drafted" with the reason in words, on screen and in exports. Read from the table itself, so it is
  reported even when the data file's settings cannot be resolved.
- Nothing is recalculated automatically: wording, review decisions and exclusions are kept. Rebuilding the
  table records the current version. Findings from report text are never judged on table method.

Pinned by `supportStatus.test.ts` (batch 47 cases fail without the rule), `tableMethod.test.ts`.

## Limits

Every table recorded as "2026.10.27" is marked by the batch 59 change, including unweighted tables (whose
counts are whole numbers, so their row % and shares were already exact) and weighted tables with no
affected figure; the record cannot tell those apart without rebuilding.

Every table built before 27 October 2026 is marked, including ones whose figures a rebuild would not
change (a table with no 0% or 100% cell and no run-together labels); the record cannot tell those apart
without rebuilding.

## Workbook tables read before the label reader repair (R1-F01, 29 October 2026)

R1 changed how a workbook's Labels sheet is read without changing the table method. Before R1, a table built from
an .xlsx or .xls file could name every answer by its question's label ("First choice brand" three times), merging
answers.

- **What the engine records.** It now records `labelReader` (`LABEL_READER`, "2026.10.29") in every table's notes.
- **How a table is judged.**
  - `tableMethodStatus(methodVersion, source)` reports a workbook table without the current label reader as
    "earlier".
  - `earlierMethodText` gives the reason in words: rebuild to read the labels sheet correctly.
  - Tables from other formats are judged on the method version alone, as before.
  - A caller that cannot name the table's source is also judged on the method version alone.
- **Where it shows.** The Cross tabs list, the Findings page and insight support status (`method_changed`, with
  the reason as detail).
- **What is kept.** Nothing is recalculated; wording, review and the saved table stay until an explicit rebuild.
