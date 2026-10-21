# Handover: GT500 repairs (main copy), 21 October 2026

Status: **implemented, ready for independent review.** Repairs for `docs/golden-thread-500-independent-review-2026-10-21.md` (frozen `4a4563b`), main copy (`C:\Personal\InsighsAI\app`, port 3000) only; 3001 stays out of scope. Prior GTR repairs and DESIGN-GTR-01 stay accepted at their recorded boundaries. Last accepted scope `1e0f2a3`, release baseline 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; **no migration**.

## Review targets

| Commit | What |
|---|---|
| `0e37127` | GT500-F01, F02, F03, P01 and M-GT500-01 (correctness, briefs and comments) |
| `b07a79a` | UI-GT500-01: the Findings category strip wraps (design) |
| this commit | Handover and status line |

Package hashes: `.fnd001/overnight/{m-gt500,m-strip}/hashes.txt`; both applied with zero committed-byte mismatches. The six commits between `5a47fb2` and `4a4563b` (Grant's requests and DESIGN-GTR-01) were reviewed in the 500-case review and are not repeated here; their behaviour is now described in the new briefs.

## GT500-F01: imported objectives keep their lineage

`saveRunContext` (`src/lib/runContextActions.ts`) records, in each successful fill's `brief_intake_used` trace row, `extractedKeys` (the `objectiveIdentityKey` of every objective the fill read from its documents, added or not) and `addedCandidateIds`. A later fill skips any document line whose key an earlier fill of the project already read, whatever has happened to that objective since (edited, rejected or deleted). Lineage is per project, so it holds across documents and identical file names. Genuinely new source lines are still added. Typed lines are not checked against lineage, so typing an imported objective in again is a deliberate re-add. The check and the write run under the existing `runs` row lock in one transaction: concurrent fills add each objective once, and a failed save records no lineage, so its retry adds the objectives. The save returns `alreadyInProject` and `importedBefore`, and the form says what was not added again ("Not added again: 1 imported by an earlier fill (edited, rejected or deleted since)").

Chosen over a migration because the trace already belongs to the fill and is written in its transaction. Limit: fills recorded before this change carry no lineage and are covered by the current-wording check only (development data only).

## GT500-F02: a failed fill is visible

When the document read or the extraction fails, the typed fields are saved and the action returns `fill.status = "failed"` with the documents, the reason, the document ids and whether the failure could be recorded. `RunContextForm` (now a client component) shows the alert from the response itself, so it appears even when recording failed, with "Try the fill again" (resubmits the form with the same documents). The earlier record reads "The last successful fill was…". `loadFailedBriefFill` (`src/lib/briefFillRecord.ts`) shows a recorded failure after a reload until a later fill succeeds. Good manual work is never rolled back.

## GT500-F03: stale edits conflict

Setup edits (`editStatedObjective`) lock the run row and check the wording the editor opened with. When neither that Setup line nor a researcher-authored candidate with that wording still exists, the save returns a conflict with a message and writes nothing (it used to append the edit as a new objective). The Review save sends the wording it opened with; a changed or deleted candidate is a conflict there too. Both lock the run row first, so Setup and Review edits of one objective are serialized. The compare-and-swap retry loop is replaced by that lock. `attemptResult` (`src/app/runs/[id]/actionFailure.ts`) treats a returned refusal like a thrown error, so the editor stays open with the draft. Add stays a separate action.

## GT500-P01: one identity for Add, Fill and scoring

`addOwnObjectiveCandidate` (`src/lib/objectiveCandidateActions.ts`) uses `objectiveIdentityKey`, the rule Fill and the score lookup use. A match with a pending or accepted objective of any source is refused with a message naming it; a rejected match may still be re-added deliberately (unchanged). The `insert … on conflict` path and its missing-index fallback are replaced by a check under the run lock, which leaves the index from migration 0083 untouched.

## M-GT500-01: briefs and comments

New: `claude/objective-identity-and-import-lineage.md` (identity, fill lineage, edit, add, reject, retry, source visibility, partial fills), `claude/objective-quality-scoring.md` (automatic scoring: batches of 20, at most 200, model call during save, partial failure, reasons), `claude/upload-type-suggestions.md`. Updated: `claude/pane-layout-recovery.md` (per-section band and split keys, DESIGN-GTR-01), `claude/trust-milestone-contract.md` (the old trimmed-text own-add guard). Superseded comments corrected in `runContextActions.ts`, `ObjectiveReviewTable.tsx` and `briefFillRecord.ts`.

## UI-GT500-01: the category strip wraps

The All / Chart / Stated findings strip (`FindingsTable.tsx`, `data-testid="findings-category-strip"`) is `inline-flex max-w-full flex-wrap`: it wraps inside its column instead of widening the page. No category is hidden and no name is shortened.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

Full suite on the final tree (`b07a79a`; cloud review tree `2fb2a14`, packages applied with zero byte mismatches):

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| Browser checks (`e2e/ui/ui-check.config.mjs`, 1 worker) | 71 passed, 1 failed, 1 skipped (16.2 min). The failure: `sign-in-access`, `page.goto` returned `net::ERR_INSUFFICIENT_RESOURCES` in the browser (the auth-outage step), not an assertion. Rerun alone on the same build: 9 of 9 passed. It passed in the previous full run. |
| Golden-thread smoke | 1 passed |
| Objective review acceptance | 3 of 3 passed |
| Unit and database tests (`vitest --pool=forks`, `src/lib/__tests__`) | 1,300 passed, 67 skipped (176 files passed, 1 skipped) |
| `npx eslint .` | 349 errors, 40 warnings (errors unchanged from Codex's baseline) |

Targeted before committing (same build plus the objective changes): `objective-gt500` (3 of 3, after the harness stopped waiting for the action stream to close; the first run timed out in that wait with the correct result on screen), `objective-setup-review-identity`, `objective-marker-variants`, `objective-regeneration-native`, `review-action-failure`, `add-files-panel`, objective review acceptance; `findings-narrow`, `findings-insights-overview`, `band-preferences`.

New tests:
- `objectiveImportLineage.db.test.ts` (16, real PostgreSQL; extraction, scoring and validator mocked): reread after an edit; rejected and deleted imported objectives stay out while a new one is added; two documents with one file name and a different document repeating an objective; typed lines bypass lineage; concurrent fills; a failed save leaves no lineage and the retry adds; an extraction outage keeps the typed save, says the fill did not happen and survives a reload until a retry succeeds; a deleted or foreign document fails visibly; an unrecordable failure is still reported; two stale editors; simultaneous saves of one objective (one wins, one conflicts); simultaneous edits of two objectives both land; deletion between opening and saving in Setup and Review; a Review editor opened before a Setup edit is refused, one opened after saves; a spelling variant is refused by name and a rejected one may be re-added; concurrent spelling variants add one. `actionFailure.test.ts` +2.
- Browser `objective-gt500` (3): edit then refill (the edited wording stays, the original is not brought back, one accepted row); a 503 extraction shown after the response and after a reload, typed text kept, retry fills once; two tabs on one objective, the stale save refused with its draft kept. The checks wait for the response to start and the Save button to return, not for the action's stream to close (it can stay open after the result renders).
- Browser `findings-narrow`: 44 findings, 43 long themes; at 320, 375 and 768 px no page overflow, the strip inside its column with every name and count, the chosen category kept, keyboard.

Previous-code controls: on `4a4563b`, `objectiveImportLineage.db` fails 14 of 16; a scratch database-rows check (not retained) showed the edited objective returned as a second row, a deleted one resurrected and "measure rural demand." added beside "Measure rural demand", all passing on the repair; the F03 cases fail on behaviour (the stale edit returns `{ ok: true }`, both simultaneous saves succeed). `findings-narrow` fails on `4a4563b` at 320 px (page 346 px wide). The `objective-gt500` browser checks were not run on the previous code.

375 px: with the strip wrapping, `findings-narrow` passes at 320, 375 and 768 px on its fixture. This is not a full mobile certification: Recommendations, Report claims and other sections were not measured.

## Limits

- Fill lineage starts with this change; earlier fills rely on the current-wording check.
- Objective identity is exact after normalisation; a reworded objective is a different objective.
- Automatic scoring calls the model during the save, so a save that adds objectives waits for it; objectives beyond the first 200 are not scored.
- GTR-02 and GT100-F02 limits stand as in `docs/gtr-repair-handover-2026-10-21.md`.
- Analytics (results kept across visits, one card grid) is separate work, not in this review set.
