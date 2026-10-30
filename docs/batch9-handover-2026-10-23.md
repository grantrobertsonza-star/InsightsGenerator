# Handover: B8-F01, B8-F02, M-B8-01, M-B8-02 and a movable, resizable assistant window (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch8-review-main-2026-10-23.md` (frozen `36addba`), whose closures (B7-F01)
and acceptance (the compact window) stand. No migration. Nothing pushed or deployed; no
development or live database touched.

| Commit | What | Kind |
|---|---|---|
| `d5b5f66` | The assistant window opens on the right, moves and resizes (Grant, 2026-10-23) | design |
| `0bc3ec2` | B8-F01, B8-F02, M-B8-01, M-B8-02 | correctness, tooling, documentation |
| this commit | Handover and status line | |

## B8-F01: claims no longer exhaust the pool their work needs

Request claims were session advisory locks on connections of the app's one pool (10), and each
answer's own reads and writes borrowed from the same pool, so ten distinct questions at once could
hold every connection as claims and wait for an eleventh. Claims now come from a separate
`claimPool` (`db.ts`): 3 connections by default (`ASSISTANT_CLAIM_POOL_MAX`; with the main 10 it
stays under Supabase session mode's 15), each wait bounded to 2 s, idle connections closed after
30 s. The work uses `pool`, which no claim holds, so a holder always progresses and releases its
claim. At most `claimPool` size answers run at once; the rest wait holding nothing, retrying every
250 ms until `requestClaimWaitMs()`, then fail visibly: `AssistantBusyError` if no claim
connection came free ("The assistant is answering as many questions as it can at once. Nothing was
sent to it; try again in a moment."), `RequestInProgressError` if the request itself stayed
claimed. Neither runs or stores anything. A claim connection whose lock query fails is destroyed.

Tests (`researchAssistantTools.db.test.ts`, real database; model and build mocked): ten distinct
questions at once at the configured capacity, the first round of each held at a gate: no more
than the claim pool's size reach the model while held; an ordinary tenant query completes in under
2 s during the hold with nothing waiting on the main pool; after release all ten finish (ten
builds, twenty model calls). With every claim held, a further question past a 2.5 s wait is
`AssistantBusyError`, makes no model call and stores nothing, and is answered when asked again
after the holders finish. The one-execution (same-id overlap), failure-recovery, wait-limit,
table-reuse and revision-atomicity tests still pass.

## B8-F02: the migration check survives a missing record

`scripts/migration-history-check.mjs` reads the CLI record under a savepoint inside its read-only
transaction; when the record table is missing it rolls back to the savepoint, says so, and carries
on with the object checks for every file. Test (`migrationHistoryCheck.db.test.ts`, a second
real disposable database with no `supabase_migrations` schema): the script completes, reports 0
recorded, reports 0109 as present and 0001 as partly present (its `claims` table was renamed by a
later migration, the stated limit), suggests repair for 0002 and 0109 and not 0001, writes nothing
(no schema created, table count unchanged); after an empty record is created, the same report
follows. The partial-history control is kept.

## M-B8-01: stats cache brief

New `claude/stats-cache.md`: scope (the local reading path only), file names and `.part` files,
the 10-minute reuse and 30-minute deletion eligibility with the worker margin, the
activity-driven cadence (no timer: eligibility, not a deadline), best-effort failure, and the
real-folder tests.

## M-B8-02: one list of browser network wordings

`components/connectionError.ts` holds the one list (`isBrowserNetworkErrorMessage`); both
`app/runs/[id]/actionFailure.ts` (project controls, still TypeError only, its own wording) and
`plainConnectionError` (the assistant, its own wording) use it. Test (`connectionError.test.ts`):
each wording gives both surfaces' sentences; a server `Error("fetch failed")` is still shown as it
is by the project controls; a longer message is not recognised. `actionFailure.test.ts` passes
unchanged.

## Movable, resizable window

Grant, 2026-10-23: "pops up on the right and can be moved around", "and it should be resizable".
`components/movableWindow.ts`: the window opens 20 px from the right and 80 px from the top, 380 by
up to 560 px; the header drags it (its buttons keep their clicks), the arrow keys on its Move
handle move it 24 px; the bottom-left grip resizes it by pointer or arrow keys (left wider, down
taller, the right edge fixed), minimum 300 by 320, at most the viewport less 8 px each side; Home
or a header double-click resets. The frame is clamped inside the viewport (also on resize) and
remembered under `assistant-window:v2` with guarded storage. Below the sm breakpoint it spans the
width at the bottom and neither moves nor resizes. Tests: `movableWindow.test.ts` (default frame,
clamping of position and size); `assistant-drawer.check.mjs` fourth test (opens on the right; drag
by -400/+100; arrow keys; pushed past the top edge stops 8 px in; grip drag +120/+60 with the
right edge fixed; grip keys and minimum width; remembered after closing and reload; a narrower
browser pulls it inside; Home resets position and size; double-click resets; Close still closes;
phone has no handles; blocked storage still moves it with no page error).

## Checks run (cloud workspace, disposable PostgreSQL 16 with all migrations to 0109, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| Full library | `0bc3ec2` content | 1,512 passed, 72 skipped (203 files, 1 skipped) |
| Full native browser suite | same | 91 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | same | passed; passed |
| `researchAssistantTools.db` | same | 21 passed, 1 placeholder skipped |
| `migrationHistoryCheck.db` | same | 2 passed, 1 placeholder skipped |
| `connectionError` with `actionFailure`; `movableWindow` | same | 11 passed; 4 passed |
| Browser: assistant-drawer (4), research-assistant-tools, knowledge page | window tree | 6 of 6 |
| `npx tsc --noEmit`; lint on changed files | same | pass; no errors or warnings |

## Limits

- At most three assistant answers run at once by default; more wait, then are refused as busy.
- The stats cache has no background purge (eligibility, not a deadline).
- No live model; the caching saving and live tool choices remain unmeasured.
