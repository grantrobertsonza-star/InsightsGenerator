# Handover: R500-02, R500-01 and UI-R500-01 (main copy), 21 October 2026

Status: **implemented, ready for independent review.** Repairs for `docs/independent-gt500-repair-review-main-2026-10-21.md` (frozen `6307ca2`), main copy (`C:\Personal\InsighsAI\app`, port 3000) only; 3001 and the uncommitted Analytics work stay out of scope. GT500-F01, P01, M-GT500-01 and the UI-GT500-01 category strip stay accepted at their recorded boundaries. Last accepted scope `1e0f2a3`, release baseline 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; **no migration**.

## Review targets

| Commit | What |
|---|---|
| `678bbf8` | R500-02 and R500-01 (correctness, brief) |
| `26a37ee` | UI-R500-01: the How it was drawn control wraps (design) |
| this commit | Handover and status line |

Package hashes: `.fnd001/overnight/{m-r500,m-ev}/hashes.txt`; both applied with zero committed-byte mismatches.

## R500-02: Setup edits are bound to their candidate

The page gives each Setup line the candidate it stands for (`setupLineCandidateIds`, `src/lib/objectiveLines.ts`: the same marker-stripped wording match as before, earliest candidate first, each candidate used once). `StatedObjectivesList` sends that id, with the wording the editor opened with, on every edit and delete. `editStatedObjective` (`src/lib/runContextActions.ts`), under the existing `runs` row lock, requires that candidate to still exist with that wording and changes or removes only that id. A deleted original is a conflict, with nothing written, even when a candidate with the same wording (exact or normalised) was added since: the replacement record and the open draft are both kept. A malformed id, or an id that belongs to no current candidate of the project, is refused.

**Compatibility rule.** A Setup-only line with no candidate (lists saved before candidates were kept) is sent with `candidateId: null`. It is edited in place, and given its candidate, only while that line is still in the Setup list and no researcher-authored candidate has its wording; a candidate added since means it is no longer the line the editor opened on, so the save is a conflict. A caller that sends no target takes this strict path, so nothing edits a record by wording alone. Limit: where old duplicate candidates share one wording, an edit changes only the one its line maps to.

## R500-01: a failed fill stays shown through ordinary saves

Every save result carries `unresolvedFailure`, read with `loadFailedBriefFill` after the save: the same stored state a reload shows, or `{ error }` when it cannot be read. `RunContextForm` shows this save's own failed fill first, otherwise the save's `unresolvedFailure`, and before any save the page's `failedFill`. An ordinary save (no document chosen) keeps the alert and Try the fill again; another failed attempt replaces it; only a successful fill clears it; an unreadable state shows "Could not check whether the last fill from a document succeeded." after any save. Typed text is saved in every case. `claude/objective-identity-and-import-lineage.md` describes both rules.

## UI-R500-01: the How it was drawn control wraps

All evidence / From words / From numbers (`FindingsTable.tsx`) is `inline-flex max-w-full flex-wrap`, a labelled `role="group"` with `aria-pressed` on each choice and `type="button"`. The Insights review tab bar (`SynthesizedInsightsReview.tsx`), the only other control written with the same unwrapped class pattern (a search of `src/app`, not a layout audit), gets the same wrapping; this is disclosed here as a same-pattern fix, not a reported finding. No choice is hidden or shortened.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

Full suite on the final tree (`26a37ee`; cloud review tree `11acfe0`, packages applied with zero byte mismatches):

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| Browser checks (`e2e/ui/ui-check.config.mjs`, 1 worker) | 72 passed, 2 failed, 1 skipped (14.8 min). Both failures were the browser refusing a navigation with `net::ERR_INSUFFICIENT_RESOURCES` (`native-formats` on a reload, `sign-in-access` on a `goto`), not an assertion; the same error hit `sign-in-access` once in the previous full run. Rerun alone on the same build: `native-formats` and `sign-in-access`, 10 of 10 passed. The cause of the resource error late in a long single-worker run is not established. |
| Golden-thread smoke | 1 passed |
| Objective review acceptance | 3 of 3 passed |
| Unit and database tests (`vitest --pool=forks`, `src/lib/__tests__`) | 1,311 passed, 67 skipped (177 files passed, 1 skipped) |
| `npx eslint .` | 349 errors, 40 warnings (errors unchanged from Codex's baseline) |

Targeted before committing, production build with both packages: `objective-gt500` (5 of 5, including the two new cases below), `objective-setup-review-identity`, `objective-marker-variants`, `objective-regeneration-native`, `review-action-failure`, `setup-objective-save-failure`, `findings-narrow`: 11 of 11; objective review acceptance passed. Earlier on the UI-R500-01 build: `band-preferences`, `findings-insights-overview`, `journey-changes` (7), `research-quality`: 10 of 10.

New tests:
- Database (real PostgreSQL; extraction, scoring and validator mocked), in `objectiveImportLineage.db.test.ts` and `candidateLifecycle.db.test.ts`: delete on Review then re-add as "Objective A" or "- objective a.", after which the stale Setup edit and the stale Setup delete are refused, the replacement and the Setup list unchanged, and an editor opened on the replacement saves; no target, a malformed id and a foreign id refused; a legacy line edited in place, a stale legacy edit refused, and a legacy edit refused once a candidate with its wording exists; a failed fill then an ordinary save still reports the failure, another failure replaces it, a successful fill resolves it, and an unreadable state (the trace table renamed for the test) returns `{ error }`. Existing tests now open their editors through `helpers/setupTarget.ts`, which gives the target the page would.
- Rendered component `runContextFormFailure.test.tsx` (5): the form for each save result; only `useActionState` is mocked to supply the result.
- Browser `objective-gt500`, two new cases: two tabs, a Setup editor open with a draft while Review deletes the objective and adds the same wording; the old save is refused, the draft kept, the replacement row and Setup list unchanged, and the stale wording absent after a reload. A 503 fill (stack model fixture), then an ordinary save: alert and retry still shown and no successful fill recorded; after a reload still shown; the retry fills once, clears the failure and stays cleared after a reload. Settled means the response started and Save is usable again.
- Browser `findings-narrow` (extended): the category strip and the How it was drawn control at 320, 375 and 768 px, in the app font and again in a wider fallback font (DejaVu Sans, as an offline build lays text out wider), with no page overflow, every choice inside its column, the chosen category and evidence type kept, keyboard Enter, and exact filtering (From numbers shows all of this crosstab-only project's findings, From words none). Its project has the findings the golden-thread helper posts plus 43 copies (47 here), not Codex's exact 44.

Previous-code controls: on `6307ca2` (cloud `2fb2a14`), 7 of the new database and component cases fail (the exact re-add returns `{ ok: true }` and changes the replacement; a no-target edit succeeds; a legacy edit with a candidate added since edits that candidate; both R500-01 database cases lack `unresolvedFailure`; the component cases "ordinary save keeps it" and "unreadable stays unknown"); the normalised "- objective a." re-add and `candidateLifecycle` pass on both. `findings-narrow` fails on the previous code at 320 px in the wider font ("From numbers is cut off", right edge 308 px). The two new `objective-gt500` browser cases were not run on the previous code.

## Limits

- Fill lineage starts with GT500-F01; earlier fills rely on the current-wording check.
- Objective identity is exact after normalisation.
- Automatic scoring runs during the save, capped at 200 objectives.
- Narrow screens: Findings at 320/375/768 px in two fonts and the Insights tab bar wrap; no full mobile certification, and other sections were not measured.
- GTR-02 and GT100-F02 limits stand as in `docs/gtr-repair-handover-2026-10-21.md`.
