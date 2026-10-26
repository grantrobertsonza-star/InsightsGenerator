# Handover: GT1000 repairs (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Repairs for `docs/golden-thread-1000-independent-review-2026-10-21.md` (frozen `011ac23`), main copy (`C:\Personal\InsighsAI\app`, port 3000) only; 3001 out of scope. Earlier accepted repairs stand at their recorded boundaries. Last accepted scope `1e0f2a3`, release baseline 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; **no migration**.

## Review targets

| Commit | What |
|---|---|
| `63d50af` | GT1000-F03: Review edit baseline captured at open; a conflict shows the stored wording and asks |
| `522df47` | UI-GT1000-01 (unreadable posted state shown as not known) and M-GT1000-01 (Analytics brief, comments); design and documentation |
| `190ae7f` | GT1000-F01 (driver finding provenance) and GT1000-F02 (driver request contract) |
| this commit | Handover and status line |

Package hashes: `.fnd001/overnight/{m-g1000-f03,m-g1000-ui,m-g1000-drv}/hashes.txt`, zero committed-byte mismatches; all 28 files changed since `011ac23` were then compared with the cloud review tree, all equal. The `522df47` commit was finished by hand after stale git lock files (left by an earlier commit's ref maintenance when deletion was not yet permitted on the laptop folder) blocked it; its 7 files were checked against the package hashes, all equal, and the stale locks from that commit were removed (the older `gc.log.lock` of 20 October is left as found).

## GT1000-F01: driver findings carry their data file and saved analysis

`runDriverAnalysisFor` records provenance with the result: the data file, a snapshot of its corrections (`loadVariableOverrides`) and the variables the analysis used (outcome, predictors, weight, group, stated importance). `addDriverFindings` inserts each finding with `source_document_id` set to the saved analysis's data file and `stated_stats.provenance`; restoring a rejected legacy finding fills in its `source_document_id`. A save is refused when the result's provenance names a different file.

Support (both loaders and the shared rule, `supportStatus.ts`, `supportStatusShared.ts`): a driver link takes its file from `source_document_id`, falling back to the saved analysis's file, and requires the saved analysis to exist. A missing analysis or file is **no longer valid** with the reason; differing corrections for the analysis's own variables are **changed**; no recorded corrections is **not checked**, never current. Survey design is not compared (it does not enter a driver analysis). Excel's Support column and the Accepted deck follow from these rules.

Deletion (`documentActions.ts`, `documentDeletionImpact.ts`, rule in `driverFindingSource.ts`): `deleteDocument` removes driver findings with the file's other linked findings, as it already did for ordinary linked findings; legacy driver findings (no `source_document_id`) are reached through their saved analysis before the cascade removes it. The deletion confirmation counts use the same rule. Legacy rule: a legacy finding whose saved analysis exists reads not checked; once the analysis is gone it reads no longer valid. No backfill.

## GT1000-F02: one request contract for driver analyses

`parseDriverRequest` (`src/lib/driverRequest.ts`) is applied in `runDriverAnalysisFor` (all callers, including CSM and wave tracking) and `saveDriverAnalysis`, before any read, calculation or write, refusing with "This driver analysis request cannot be run: …". Rules: outcome type `continuous` or `binary`; at least two distinct predictors, none the outcome, at most 500; a finite top box only for a binary outcome; weight and group distinct from the outcome, the predictors and each other; stated importance only for listed predictors. Bootstrap: omitted means 200; otherwise an integer, 0 (no ranges, which the report says) or 20 to 300; anything else refused. `driverAnalysis.ts` also refuses an unsupported type or a non-integer bootstrap and warns when a binary exact split is capped at 60 resamples. Variable existence is checked when the engine reads those columns. Analytics memory (`analyticsWorkspaceMemory.ts`) now uses the same parser, so it is stricter than before (fewer than two predictors, or a bootstrap of 1 to 19, are not remembered). Figures are unchanged: existing reference tests pass, and bootstrap 0 versus 20 gives identical R² and shares.

## GT1000-F03: a Review edit keeps the wording it opened with

`useObjectiveRowActions` (both consumers: `ObjectiveReviewTable`, `ObjectivesWorkspace`) captures the wording when editing starts and sends it as the expected state; a refresh of the rows never moves that baseline under an old draft. A refused save keeps the draft and shows the stored wording, which `acceptObjectiveCandidate` now returns with the conflict (`currentText`, read under the same lock; null when deleted), so the panel is right even before the page refreshes. `ObjectiveEditConflict` offers **Use the current wording** (draft and baseline become it, nothing saved) or **Replace it with mine** (saved against the wording now shown, refused again if it changed once more); for a deleted objective it says so and offers neither. Edit and Cancel start from the current wording. The server CAS is unchanged. Found while testing: the first version of this repair showed the row's props (not yet refreshed) in the conflict panel; the stored wording from the refusal replaced that.

## UI-GT1000-01 and M-GT1000-01

Chart and NPS cards (`AnalyticsBuilder.tsx`, `postedState.ts`) keep a failed posted-state read as not known, for new and remembered cards and the NPS build and restore paths: the card shows the error with Retry (`chart-post-unknown`, `nps-post-unknown`) and offers neither Post nor Remove until the state is known; the toggles refuse while it is unknown. The NPS build path no longer keeps a previous posted value when its read fails. New brief `claude/analytics-workspace-memory.md` (what is remembered, version, the 60-card cap, blocked storage, restore including historical saved driver reports versus recalculated results, superseding, retry, clear, posted-state uncertainty, scatter ordering, tests, limits). The overbroad freshness comment in `analyticsWorkspaceMemory.ts` and the stale count comment in `findings-narrow.check.mjs` are corrected. New brief `claude/driver-finding-provenance.md`; `claude/objective-identity-and-import-lineage.md` updated for the edit-session rule.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| Unit and database tests (`TEST_DATABASE_URL=… npx vitest run src/lib/__tests__ --pool=forks`, final tree) | 1,368 passed, 67 skipped (182 files passed, 1 skipped) |
| Targeted browser, all GT1000 changes except the conflict-wording fix | 26 of 27 passed: `objective-gt500` (all F01 to R500-R01 cases and GT1000-F03 table), `analytics-posted-unknown`, `analytics-kept`, `scatter-wording-review`, `driver-posted-state`, `driver-reopen`, `objective-marker-variants`, `objective-regeneration-native`, `objective-setup-review-identity`, `review-action-failure`, `findings-narrow`, `journey-changes` (7), `journey-exports`, `main-recommendation-exports`. The failure (GT1000-F03 detail case) found the stale conflict panel above. |
| Targeted browser, final tree | 13 of 13 passed: `objective-gt500` (8, including GT1000-F03 table and detail), `objective-marker-variants`, `objective-regeneration-native`, `objective-setup-review-identity`, `review-action-failure`, `setup-objective-save-failure` |
| `npx eslint` on changed files | 0 errors |

**Not run:** the full 77-check browser suite on the final tree. My cloud full-suite runs tonight first ran out of disk (leftover test temp folders, cleared) and then hung when a Next server left by an earlier stack kept the port (the restart script now stops it). Please run the full native suite here.

New tests:
- `driverProvenance.db.test.ts` (9, real PostgreSQL, actual driver actions, `deleteDocument`, both support loaders, the Excel and Accepted-deck export routes; storage and request plumbing stubbed).
- `driverRequestContract.test.ts` (26; only the file boundary mocked and asserted never reached).
- `postedState.test.ts` (4).
- `objectiveImportLineage.db.test.ts`: conflicts report the stored wording (`currentText`), null when deleted.
- Browser `analytics-posted-unknown`: post a chart, leave, revoke SELECT on `findings` from the disposable app role and confirm it, reopen (failure shown, no Post or Remove), restore the grant, Retry (Remove), reopen (Remove); rows unchanged; grant restored in `finally`.
- Browser `objective-gt500` GT1000-F03 table (Codex's path: Review draft open, Setup edits in another page, Unaccept Bravo, wait for Accept, Save is a conflict, database unchanged, Use the current wording) and detail (the detail pane has no other row to act on, so the save follows the Setup edit directly; conflict, stored wording shown, Replace it with mine saves under the same id); both then reload and Edit starts from the current wording.

Previous-code controls (`011ac23`; cloud `29a56b1`): `driverProvenance.db` 8 of 9 fail (the remove/add control passes on both); 7 of 7 engine and action contract cases fail (the 18 parser cases need the new module); browser `analytics-posted-unknown` and GT1000-F03 table both fail. The detail browser case and `postedState.test.ts` were not run on the previous code.

## Limits

- Driver: the saved result is the one the browser sends back, not recalculated on save; data-layout changes are not compared (as for calculated tables); deleting a saved analysis keeps its findings, which then read no longer valid.
- F03: both Review views share the hook; the refreshed-props path is exercised in the table, the detail case exercises conflict without a refresh.
- UI-GT1000-01: the browser check covers the bar chart; the NPS paths rely on the shared helper and its unit test.
- Earlier limits stand (fill lineage starts with GT500-F01; exact identity after normalisation; scoring during save, capped at 200; no full mobile certification).

## Separately noticed (not in this set)

`runLocalStatsPython` (`src/lib/parseStatsFile.ts`) writes a `stats-src-<hash>` copy of each data file to the system temp folder as a 10-minute cache and never removes it; 3,484 such files filled the cloud workspace tonight. The `over-limit-refusal` check also leaves a 192 MB temp folder per run. Proposed as a separate change.
