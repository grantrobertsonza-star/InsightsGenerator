# Table method version and the column tests (batch 47, 27 October 2026)

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

## Method version and freshness

`TABLE_METHOD = "2026.10.27"` covers the pooled test and the run-together non-answer labels
(`claude/answer-domain.md`). A table with another version, or none (built before it was recorded), is
"earlier":

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

Every table built before 27 October 2026 is marked, including ones whose figures a rebuild would not
change (a table with no 0% or 100% cell and no run-together labels); the record cannot tell those apart
without rebuilding.
