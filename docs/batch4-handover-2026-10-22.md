# Handover: B3-01, B3-02, one-page Objectives and Grant's evening changes (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch3-review-main-2026-10-22.md` (frozen `e5f9608`), whose closures stand. No
migration; nothing pushed or deployed; no development or live database touched.

| Commit | What | Kind |
|---|---|---|
| `458a829` | Research quality bars on one length (fixed em score and band columns, bar sections 58cqw of the list); a rolled-up sidebar group hides all its entries, its heading marked when it holds the open section | design |
| `587636a` | Import: Roll up in the Sources pane header (`SourcesPane`), second count line removed; the Needs attention chip replaced by Preview not verified (the read chip already says a partial or failed read) | design |
| `8f256ef` | Research quality: the highlighted action follows the choice (`aria-pressed`); state and number on the file name's line; project header without `runs.status` (always "draft": nothing moves it) | design, correctness of a cue |
| `66fe59d` | Objectives on one page, the 3001 prototype ported (seven prototype commits; band columns `BandColumns.tsx`; selected objective's coverage under its detail); one merge conflict, the re-read result, resolved by keeping IR-03's `rereadResultText`; re-read messages point to the objectives list; knowledge article and identity brief updated | design |
| `c9390ac` | Cross tabs: Table settings rolled up by default, its heading saying what is set; opens itself while the design needs a choice | design |
| `49d8026` | AI Insights: `insightTableText` sends every question whole with bases, means and (higher)/(lower) test flags and the correction, up to about 30,000 characters, and says when it stopped; an empty or cut-off model answer throws (the old fallback headline "No clear pattern emerged" made a failure look like a reading) | correctness |
| `9b5c123` | B3-01 and B3-02 (documentation) | documentation |
| this commit | Handover and status line | |

## B3-01 and B3-02

- B3-01: Cross tabs article ("many tests" and the commit paragraph), Findings article (caveat table, "table findings" limit), manual raw-data (WhyBox) and verification (caveat note, Does not): the false discovery rate default per row of each banner variable, Bonferroni or none selectable, caveats that follow the table (`crosstabs.ts` 464 to 474), named-design support in cross tabs and NPS; the banner plan and the aggregated-table scan kept explicit as uncorrected and random-sample. Rendered pages compared for remaining contradictions (grep of "not correct", "uncorrected", "assumed random", "not built").
- B3-02: Objectives article: an incomplete coverage check fails, records no Gap and keeps the previous results (`objectiveValidator.ts` guards), Check again re-runs; scoring 20 at a time up to 200 per run with the rest left unscored and reported; navigation already rewritten for the one page in `66fe59d`.
- Sidebar brief precision note: malformed JSON or a non-array opens in full; in an array, non-string members are ignored.

## Checks run (cloud workspace, disposable PostgreSQL 16, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| Full library | one-page Objectives tree (before Table settings and Insights) | 1,455 passed, 69 skipped |
| Full native browser suite | same | 86 passed, 0 failed, 1 skipped |
| Golden-thread smoke; objective acceptance | same | passed |
| Browser: crosstab-ask (2), crosstabs-entry (settings rolled up), import-file-detail (Sources header), objective-coverage-degraded, objectives-band-resize, research-quality (highlight, equal tracks at 100% and 130%), sidebar (fold hides all), starter-banners, knowledge pages render, one-page Objectives screenshots | `49d8026` equivalent | 11 of 11 |
| `crosstabInsights.test.ts` (model mocked) | final | 4 passed |
| Knowledge pages render (index, import, objectives, crosstabs, research quality, findings, three manual pages) | final docs | pass, no page errors |
| `npx tsc --noEmit -p .` | final | pass |

**Not run:** the full suites on the exact final tree (`9b5c123` plus this commit); Table settings and Insights came after the full run. The real model's Insights wording was not exercised.

## Limits

- Insights: a table larger than the limit is read in part, and the panel says how much; the correction note covers only the table's own tests.
- The one-page Objectives keeps every rule of the two pages; the old tab names remain in some test helper names.
- Earlier limits stand.
