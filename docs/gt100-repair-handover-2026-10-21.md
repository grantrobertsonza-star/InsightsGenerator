# Handover: GT100-F01 to F03, RRV-01, the rename and the new section design (main copy), 21 October 2026

Status: **implemented, ready for independent review.** Main copy (`C:\Personal\InsighsAI\app`, port 3000) only: Grant is retiring the redesign copy (3001), so it is out of scope. Repairs for `docs/golden-thread-100-independent-review-2026-10-21.md` (GT100-F01 to F03) and `docs/independent-rr-review-2026-10-21.md` (RRV-01); Grant's rename of Reports and decks to Secondary analysis; and, at Grant's request, the Findings, Insights, Recommendations and Insights report overview design first trialled on 3001, carried here together with the repairs of Codex's OV-01 to OV-04. The last accepted scope stays `1e0f2a3`; the release baseline stays 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; no migration added.

## Review targets (after `663a775`, the commit Codex's 100-case review froze)

| Commit | What |
|---|---|
| `df90a55` | RRV-01: a reviewed choice for scatter wording kept over changed figures |
| `053a475` | Rename to Secondary analysis |
| `2322679` | GT100-F01: a failed read of confirmed questionnaire meaning stops calculations |
| `ddb4c00` | GT100-F02 and F03 (one commit: both change `supportStatusShared.ts`) |
| `670eb38` | The new section design with the OV-01 to OV-04 repairs (please review apart from the repairs) |

Package hashes: `.fnd001/overnight/{m-rrv,m-ren,m-f01,m-f23,m-port}/hashes.txt`; each applied with zero committed-byte mismatches. The design was carried by a three-way merge from 3001 (base: 3001 before the overviews); the only conflict was 3001's two-letter rail codes, which this copy does not have, kept as they are here.

## GT100-F01: failed questionnaire meaning stops calculations

`instruments.getConfirmedItemsForData` returns an empty list only when the file has no confirmed links or the questionnaire tables are absent (42P01 / 42703, the supported old schema, commented as such). Any other error raises `InstrumentMeaningUnavailableError` ("The confirmed questionnaire labels could not be read, so this was not calculated: answer meanings and Don't know codes would be wrong. Try again."). `crosstabs.overlayFor` no longer catches; its old-schema-only comment is replaced. Callers: `loadVariableDictionary(WithStatus)`, `loadCategories` and `buildCrosstab` refuse before the engine is called and write nothing; `runScatterAction` and `drivers.runDriverAnalysis` refuse; `scatterFindingStatusAction` reports unknown; the Import quality check (display only) runs on the routing detected in the data and says the confirmed questionnaire could not be read. Confirmed links and saved tables are never changed by a refusal. Three tests that mock the whole database now mock `getLabelOverlay` (their questionnaire query used to fail inside them, hidden by the old catch).

## GT100-F02: a missing quote makes support no longer valid

New reason `quote_missing`, at the level of `source_missing` (evidence gone from its source is treated as a deleted source). The support loader checks each report finding's quote live and read-only against its report's current `documents.extracted_text`, in the same read transaction as the links, using the extraction's own quote rule (moved unchanged to `lib/quoteMatch.ts`). Only report findings (origin `stated`, no source table) with a quote are checked; report text missing or under 50 characters gives not checked, never invalid. No stored grounding record and no migration, so existing insights are judged now, not left "not recorded". Finding id, wording, review decision and original quote are untouched; accepted exports leave the insight out with the reason, all-scope exports qualify it, recommendations and the narrative inherit it. A later reread with the quote back returns to current without a duplicate. `supportReplacementDuplicates.db.test.ts` now stores report text as a first read does, keeps a still-present control and expects no longer valid when the quote is gone (Codex's point that it asserted the problem).

Deliberate choice to review: a reread whose text download fails changes nothing, but a reread whose text was stored and whose model call then failed is judged against the stored new text (the text read succeeded, so the quote's absence is a known fact). Saying not checked there would need a recorded text version and a migration.

## GT100-F03: NET members and every other read input count for freshness

`supportStatusShared.tableVariablesFromSavedRequest` returns the variables in the order the engine reads them, deduplicated: banner columns, every row item's `vars` (batteries included), `nets[].vars`, filter variables and the older `layer` filter, the weight, and the design's PSU and strata when named. It returns null (whole-file comparison, the existing cautious path) for no saved request, a multiple-response banner `set:<key>` (members resolved from the file, not recorded in the request), and any shape the engine would not read. Never an empty list for an unreadable request.

## RRV-01

`scatterActions.resolveScatterWordingReviewAction(runId, documentId, xVar, yVar, weightVar, choice, expectedSuggestedText)`, offered on the Analytics scatter card in place of "Reword it in Findings":
- **Keep my wording**: text and human-edit provenance unchanged; `wording_review` cleared; `stated_stats.wording_confirmed_for` records the figures it was kept for. A repost with the same figures does not raise the flag again; changed figures do.
- **Use the current wording**: `finding_text` becomes the offered sentence; the previous wording is appended to `stated_stats.wording_history` (`text`, `human_edited_fields`, `human_edited_at`, `replaced_at`, `reason`, `replaced_with`); `finding_text` leaves `human_edited_fields` and `human_edited_at` is set, as `revertFindingWordingTx` marks text no longer the researcher's. Later reposts regenerate the text; the history stays.
- Locks the document row (id, run, tenant) then the finding row; either lock finding nothing is a refusal. A suggestion that differs from the stored one, or no flag, is `{ ok: false, stale: true }` with nothing written; the card reads the status again. Repeating a decision is `{ ok: true, changed: false }`. Refused without migration 0094. Each decision writes a trace row. Id, figures, theme and status never change.
- Every repost now carries `wording_confirmed_for` and `wording_history` forward.

## OV-01 to OV-04, carried into this copy with the design

- **OV-01.** `evidenceOverview.insightMatches(row, filter)` produces every Insights count from the filter its click opens, and the review lists with the same function; in-use figures add `review: "accepted"` through `inUseWith`. Not scored and every corroboration and review segment open their records; headlines that sum several figures open nothing; "All N insights" stays unfiltered. Findings: `findingNeedsAttention` is shared by the summary and the review filter; the reviewed headline and the report-verdict segments are plain counts (the claims tab has no verdict filter), with a separate "Open all N report claims" link; a drill-down resets the review's tab to All.
- **OV-02.** `corroborationStateOf` is "unchecked" whenever `independent_source_count` is null, whatever the stored tier, and "unrated" for checked rows without a tier. The tile counts "strongly corroborated, sources checked" and shows Independence not checked and No tier apart. Stored values and scoring are untouched.
- **OV-03.** `themeKeyOf` (trimmed; null, empty and whitespace-only share `NO_THEME_KEY`, which is not a readable word, so a theme literally named "No theme" stays its own) is used by the summary, the theme dropdown, pills and the review filter. Stored theme text is never rewritten.
- **OV-04.** Tiles use `minmax(min(100%,16rem),1fr)`; panels `min-w-0` and `min(100%, …)` bases; top-insight rows wrap so the wording takes the full width. Most of the 375px problem was the main menu (about 270px open): `CollapsibleRail` now starts hidden below 768px when no choice is remembered, and when opened there lies over the page instead of pushing it, the page keeping the strip's width. The global-rail check's content locator follows the new wrapper.

## Rename

Section label, title, how-it-works heading and rail code (SA). Counts inside still name the files "reports or decks". `sidebar` and `coding-reports-sections` checks updated.

## Recommendations and Insights report overviews

- **Recommendations.** Overview tab (review, priority, quality, support of the insight behind each, decisions written for), Action plan (accepted, current support, priority then stored score, top 5 with a link to all), Needs a decision. `recommendationOverview.recommendationMatches` decides every count and what each click opens, and `SynthesizedRecommendationsReview` filters with the same function (`request` prop, chips, "Showing X of Y"). Unknown support is never current. The review stays mounted while the overview shows.
- **Insights report.** Overview tab: what goes in and what is left out or qualified, by the export routes' rules (`story/export/route.ts` 391 to 442: no longer valid left out, changed and not checked included with a qualification, recommendations inherit their insight's support); the narrative's cited insights and its date; the figure check when it loaded; the exports (same hrefs; gating unchanged). Rows that only open a section say "(not filtered)". No edit time is stored for insights or recommendations, so whether they changed after the narrative was generated is said to be not checked. `generated_at` arrives as a Date or a string; both are handled (an earlier build crashed the section on a Date: journey-changes C1). The remount key moved onto the narrative screen, so regenerating stays on its tab.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

Full suite on the final tree (`670eb38`, the same tree as the cloud clone's `b7e27eb`):

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| Browser checks (`e2e/ui/ui-check.config.mjs`, 1 worker) | 67 passed, 1 skipped |
| Golden-thread smoke | 1 passed |
| Objective review acceptance | passed |
| Unit and database tests (`vitest --pool=forks`) | 1,257 passed, 65 skipped (173 files, 1 skipped) |
| `npx eslint .` | 349 errors, 40 warnings (errors unchanged from Codex's baseline) |

Earlier full suite on `ddb4c00` (the three GT100 repairs, before the design): browser 65 passed, 1 skipped; unit 1,223 passed, 65 skipped; smoke and objective acceptance passed.

Targeted before each commit: RRV-01 `scatter-wording-review`, `sidebar`, `coding-reports-sections`, `analytics-landing`, `driver-posted-state` (5 of 5). The design on this copy: `findings-insights-overview`, `recommendations-report-overview`, `journey-changes` (7), `journey-exports`, `main-recommendation-exports`, `review-action-failure`, `global-rail` (2), `sidebar`, `three-pane` (5): 20 of 20.

Previous-code controls: RRV-01, the 4 new resolution cases fail on the committed scatter action; GT100-F01, the failure case fails on the old lookup (the two controls pass); GT100-F02, 6 of the 9 grounding cases fail on the old loader; GT100-F03, 6 of the new NET tests fail on the old helper (the 5 controls pass).

## Limits

- GT100-F01: the Import screen's dictionary fallback for trimmed files still shows the capped view on any error (display only).
- GT100-F02: the findings Excel "Quote verified" column shows the value recorded at extraction, not the live check; findings whose quote was never verified at extraction behave as before unless the quote is also missing now.

- The Findings card still shows no mark for a scatter finding whose wording was kept over changed figures; the decision is made on the Analytics card.
- A remembered choice to keep the main menu open is honoured below 768px too; it then lies over the page until hidden. Only a window with no remembered choice starts hidden.
- The Insights report overview cannot say whether anything changed after the narrative was generated (no edit time is stored).
