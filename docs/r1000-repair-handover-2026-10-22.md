# Handover: R1000-01, UI-R1000-01, M-R1000-01 and V-R1000-01 (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Repairs for `docs/independent-gt1000-repair-review-main-2026-10-22.md` (frozen `91f0216`), main copy only; 3001 out of scope. GT1000-F02, GT1000-F03 and M-GT1000-01 stay accepted at their recorded boundaries. Last accepted scope `1e0f2a3`, release baseline 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; **no migration**.

## Review targets

| Commit | What |
|---|---|
| `20e49ab` | R1000-01 (driver dependencies from the checked request) and M-R1000-01 (bootstrap comments and cap warnings) |
| `88f092a` | UI-R1000-01: NPS shows neither Post nor Remove while its posted state is being read (design) |
| `7d9fd96` | V-R1000-01 (findings order tie-break) and the objectiveDecisionClosure test isolation |
| this commit | Handover and status line |

Package hashes: `.fnd001/overnight/{m-r1000a,m-r1000b,m-r1000c}/hashes.txt`, zero committed-byte mismatches. Grant's Import screen changes were made at the same time and are **not** in this set (held for his approval); `page.tsx` in `7d9fd96` carries only the `getFindings` ordering change, built from the previous file plus that hunk.

## R1000-01: dependencies come from the checked request

`saveDriverAnalysis` (`src/lib/drivers.ts`) replaces `report.provenance.variables` with `driverRequestVariables` of the checked saved request. Replace was chosen over refuse: the list holds no researcher choice, it is a function of the request, so refusing would only add a failure mode for the same outcome. A corrections snapshot that is not a plain object is stored as null (support then reads not checked). `addDriverFindings` (`savedProvenance`) records the same canonical list on each finding, ignoring the saved report's list. Both support loaders (`src/lib/supportStatus.ts`) join `driver_analyses.request` and take the variables from it rather than from the finding; when the request cannot be read the variables are null, every correction of the file is compared, and any change reads as changed. Legacy findings with no snapshot stay not checked. The recorded historical report is kept; there is no second calculation on save.

## M-R1000-01: what the bootstrap code says

`src/lib/driverAnalysis.ts`: the comment separates the server policy (`parseDriverRequest`: omitted 200, 0 or 20 to 300) from what the function accepts when called directly (1 to 19 runs with no ranges and says so; above the cap is drawn at the cap). The cap is described as a run-time bound: at most 300 resamples, or 60 for a binary exact Shapley split; the warning now differs for continuous and binary outcomes, so a continuous run no longer mentions a binary limit. No formula or policy change. `claude/driver-finding-provenance.md` states the final dependency contract.

## UI-R1000-01: pending is not unposted

`postedState.ts` adds a pending state and `postedControl` (checking, unknown, post, remove); only post and remove offer an action. `runNps`, Retry and the restore path set pending before the figures show; a newer request or Clear makes a late answer ignored (the existing NPS sequence number); `toggleNpsFinding` refuses while pending. Both NPS render paths show "Checking whether this is already in findings..." (`nps-post-checking`). Chart cards had no such gap: a card is published only after its posted-state read answers. `claude/analytics-workspace-memory.md` updated.

## V-R1000-01: one findings order

`getFindings` (both queries in `src/app/runs/[id]/page.tsx`) orders by `created_at, id`; the findings Excel and deck routes add the same `id` tie-break after their theme grouping (their order still differs from the screen by design, theme first). No assertion was weakened.

## objectiveDecisionClosure full-run failure

Cause: Vitest does not stop a test that times out; the timed-out objective case's regeneration loop kept setting the shared mocked model answer (`state.suggestions`) during the next case, which is why the decision case saw objective suggestions and zero rows. Fix: a per-test epoch with `answer(epoch, list)`, so a leftover loop throws at its next answer. Timing: each padded case runs 30 regenerations; measured alone the objective case takes 0.3 to 1.6 s and the decision case 0.2 to 2.3 s, and under Codex's full-run load the objective case passed 5 s, so only those two cases have 30 s, with the measurement in a comment. Control: with the objective case forced to a 200 ms timeout, the previous file cascaded to 3 failures in 3 of 5 runs; the new file never cascaded.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

| Gate | Tree | Result |
|---|---|---|
| `npx tsc --noEmit -p .` | exact committed tree (`91f0216` plus the three packages) | pass |
| Focused tests (`driverDependency.db`, `driverRequestContract`, `postedState`, `objectiveDecisionClosure.db`) | exact committed tree | 49 passed |
| Unit and database tests, `TEST_DATABASE_URL=… npx vitest run src/lib/__tests__ --pool=forks`, twice | these repairs plus the Import changes | 1,380 passed, 67 skipped, both runs |
| Full native browser suite (`ui-check.config.mjs`, 1 worker, no filter) | these repairs plus the Import changes | 79 passed, 1 failed, 1 skipped. The failure was the new `nps-pending-status` check finding its button by a wrong name ("NPS" instead of "Net Promoter Score"); corrected, it passes. |
| Golden-thread smoke | same | 1 passed |
| Objective review acceptance | same | passed |
| `nps-pending-status` (corrected) | same | 1 passed |
| `npx eslint` on changed files | | 0 errors |

The full browser suite ran on a tree that also contained the uncommitted Import changes; it was not repeated on the exact committed tree. Please run the full native suite here.

New tests:
- `driverDependency.db.test.ts` (6; real PostgreSQL; actual save, post and `saveVariableOverrideAction`, both loaders, the Excel export all and accepted; request plumbing, storage and the dictionary stubbed): omitted, empty, subset, foreign, mistyped and non-list variable lists; each role (outcome, predictor, weight, group, stated importance); an unrelated-variable correction control; a recorded list shortened after posting; clear and rebuild; a non-object snapshot; refusal for another file then retry.
- `driverRequestContract.test.ts`: +1 (direct engine call with 19 and 301; 27 pass).
- `postedState.test.ts`: +4 (8 pass).
- Browser `nps-pending-status`: holds only the posted-state request (identified by its next-action body `[runId, documentId, variable]`), for an unposted result, a posted one (Codex's repro) and a Clear during the hold; asserts no Post or Remove while held, then the right one; the finding row unchanged.

Previous-code controls (`91f0216`; cloud `f3b0c43`): `driverDependency.db` 6 of 6 fail on behaviour (lists not canonical, support current where it should be changed); `nps-pending-status` fails (no checking state). The test-isolation change is shown by the forced-timeout comparison above.

## Limits

- The saved driver result is still the one the browser sends back; its figures are not recalculated on save (the dependency list is now derived on the server).
- The exports group findings by theme first, so their order differs from the screen by design; within a theme they use the same tie-break.
- Earlier limits stand as in `docs/gt1000-repair-handover-2026-10-22.md`.
- The local stats cache temp files (`stats-src-*`) remain a separate open item.
