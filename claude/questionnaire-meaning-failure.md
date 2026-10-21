# Confirmed questionnaire meaning: required, or refused

Confirmed questionnaire links define what a data file's codes mean: answer wording and which codes
are "Don't know". `getConfirmedItemsForData` (`src/lib/instruments.ts`) is the one source of that
meaning for calculations; `getLabelOverlay` and `crosstabs.overlayFor` build the engine's label
overlay from it.

**Contract.**
- *No confirmed links* is returned in exactly two cases: the file has none, or the questionnaire
  feature is positively absent (`questionnaireSchemaAbsent`: neither `instrument_links` nor
  `instrument_items` exists, checked with `to_regclass`, the clean schema before migration 0060).
- Every other failure is a failed required lookup and raises `InstrumentMeaningUnavailableError`:
  permission or connection errors, and any schema drift while questionnaire tables exist (a missing
  column such as `routing_text`, a missing links table beside existing items). The presence check
  fails closed: if it errors, the lookup refuses. There is no compatibility query that keeps labels
  while dropping routing; refusal was chosen because a partial read could change missing-code rules.
- `overlayFor` does not catch. The dictionary loaders, `loadCategories`, `buildCrosstab`,
  `runScatterAction` and `drivers.runDriverAnalysis` refuse before the engine is called and write
  nothing; `scatterFindingStatusAction` reports unknown. The Import quality check, display only,
  runs on the routing detected in the data and says the confirmed questionnaire could not be read.
- A refusal never clears or changes confirmed links or saved tables. A retry after the fault clears
  computes with the confirmed overlay again.

**Why.** Codex GT100-F01 and GTR-01 (21 October 2026): with 20 Yes, 20 No and 20 Don't know, a
silent "no overlay" moved the valid base from 40 to 60 and Yes from 50% to 33.3%.

**Tests.** `src/lib/__tests__/instrumentMeaningLookup.db.test.ts` (real disposable PostgreSQL,
restricted role): healthy no links, confirmed links, SELECT revoked, renamed `routing_text`, links
table missing beside items, presence-check failure (the one mocked boundary), retry, and the clean
old schema (both tables absent: no overlay, engine called).

**Limit.** The Import screen's dictionary fallback for trimmed files still shows the capped view on
any error (display only).
