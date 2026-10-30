# Batch D2aR handover: Codex D2a review repairs (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (persistence, configuration rules). Base: laptop
`c8bfac213e535b291461008488a6fbad673e6265` (BatchD2a). Review: `docs/independent-d2a-review-2026-10-29.md`.

## Findings repaired

| ID | What was wrong | What it does now |
|---|---|---|
| D2A-F01 (S2) | Save and Reset compared the revision only; a view of programme A saved after its project moved to programme B, at an equal revision, replaced B's choices | The view returns `scopeKey` (`programme:<id>` or `project:<id>`); Save and Reset take `{ scope, revision }`, checked at the server action (`expectedFrom`) and again under the project row's lock. A project moved since the view is refused with `moved: true` and the scope it is in now, its revision and choices; neither scope changes. After a reload the save goes to the new scope. |
| D2A-F02 (S2) | `trial` and `frequent_usage` were recognised but refused on save: a second stage list in `trackerDashboard.ts` had diverged | One list, `FUNNEL_STAGES` in `trackerRoles.ts`; `FunnelStage` is derived from it and the save check reads it. |
| D2A-F03 (S2) | An unchanged "weighted" choice blocked unrelated saves from a wave without a weight | Kept when unchanged from the stored choice; that wave shows unweighted results with the "weight" notice; a later wave with a weight is weighted again. A new weighted choice on a weightless wave is still refused. |
| D2A-F04 (S3) | Choosing a recommend (or stay, switch) variable left its ambiguity question open | Each CSM question is answered by an applicable choice of its role (a variable in this file, or an intentional none); a carried choice the file lacks keeps the question and its reason; a "partly labelled list" question is answered only by choosing that very variable. |

Why the tests missed them: F01, no test moved a project between programmes; F02, the stage list was duplicated
and only the recogniser's copy was tested; F03 and F04, the carry tests covered stages, brands and CSM variables but
not weighting or the CSM questions. Each now has its family of tests.

## Proof

- `trackerDashboardsScope.db.test.ts` (new, real database and engine): equal revisions across a move; both scopes
  empty; project to programme and programme to project; a stale Reset; retry after a reload. All four fail with the
  scope check removed, pass with it.
- `trackerDashboard.test.ts` (+9): every stage in `FUNNEL_STAGES` saves, unknown refused, trial and frequent use
  applied; weighting kept / refused / reapplied; CSM questions answered by applicable choices, kept for missing ones,
  the partial-scale question only by its own variable. 4 fail on the old rules.
- Existing D2a database tests updated to send `{ scope, revision }`; same-programme concurrency and cross-tenant
  controls unchanged and passing.

All on the combined tested tree `523f4de7` (BatchD2aR then BatchUI1 on c8bfac21; worktree b86), real disposable
PostgreSQL 16:
- `npx tsc --noEmit -p .`: clean. `npx eslint src e2e --quiet`: clean.
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 312 files passed, 2 skipped; 2,377 tests
  passed, 91 skipped, 0 failed.
- Disposable stack, full browser suite: 141 passed, 1 skipped, 1 failed: `review-action-failure.check.mjs` timed out
  opening the Objectives section (an area neither batch touches); it passed in the two previous full runs today
  (D2a 7c4d6bcc, UI1 alone 52cd0e00) and passed 3 of 3 when rerun alone on the same stack. Recorded as a flaky
  navigation wait, not a defect of these batches. Smoke: 1 passed.
- Documents added after the gates (no code): the two handovers and the status file.

## Files

`src/lib/trackerRoles.ts` (FUNNEL_STAGES), `src/lib/trackerDashboard.ts`, `src/lib/trackerDashboards.ts`,
`src/lib/trackerDashboardActions.ts`, tests above, `claude/d2-design-2026-10-29.md`, `claude/rules-registry.md`.
No migration.

## Limits

No screen uses the configuration yet (D3); the action signatures changed (`expected` object), which D3 will call.
