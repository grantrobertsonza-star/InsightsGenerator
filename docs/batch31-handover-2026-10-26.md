# Handover: overview tiles, module roll-up and local worker freshness (main copy), 26 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch30 (`d744997`). Grant's
requests of 26 October (07:05, 07:06) and the local worker fault he hit at 06:57. No migration. Nothing
pushed or deployed. Tiers (AGENTS.md as proposed in batch 32): the screens are B; the worker change is A.

| Commit | What | Kind |
|---|---|---|
| repair commit | Tiles, roll-up, worker freshness; tests | UI, reliability |
| docs commit | This handover and the status line | |

## Module pages: the rest of the module's items rolled up on the page

`SectionDashboard.ModuleStatusBar` shows the state, headline and first item as before; "N more" (with
`aria-expanded`/`aria-controls`) opens the module's other items and its "Keep in mind" caveats in place,
from the same `lib/sectionStatus.ts` rule as the overview card; "Show less" closes it. The overview stays
one link further inside the opened bar ("See every module on the ... overview"). Before, "N more on the
... overview" left the page.

## Overview pages: tiles

The module cards are a grid of as many columns of about 17rem as the page holds (four at 1440px, two
on a narrow laptop window), with tighter padding and type, the first three items and two caveats shown
and the rest behind "Show all". Before, two wide cards per row.

## Local statistics worker answers only with the code on disk

Grant's dev server had kept a worker from before batch 26, which ran a workbook's "table" request as an
SPSS "convert" and refused ".xlsx". `scripts/parse_stats_worker.py` now (a) refuses an action it does not
know rather than running another one, and (b) when its own script changes on disk answers
`{"restart": true}` and exits; `parseStatsFile.ts` then sends the request once to a fresh worker
(`WorkerRestarting`, `callWorker`/`callWorkerOnce`), and an exiting old worker can no longer clear the
new one (`forgetWorker`). `scripts/parse_stats_local.py` refuses unknown actions too. Engine changes were
already reloaded in place. Vercel is unaffected (a fresh process per deploy). Why the tests missed it:
every test starts its own worker, so none had a worker older than the code.

## Files

- `src/app/runs/[id]/SectionDashboard.tsx`
- `scripts/parse_stats_worker.py`, `scripts/parse_stats_local.py`, `src/lib/parseStatsFile.ts`
- Tests: `statsWorkerFreshness.test.ts` (new, 4); browser `e2e/ui/module-bar-rollup.check.mjs` (new);
  `e2e/ui/stage-status.check.mjs` (comment).

## Checks run

Real disposable PostgreSQL 16, the actual engine and the disposable browser stack.

- `npx tsc --noEmit`: clean. `npx eslint .`: 0 errors.
- `statsWorkerFreshness.test.ts`: **4 passed**: an unknown action refused and a known one answered by
  the real worker; a worker whose script changed answers restart and exits; through
  `runEngineConversion`, a request after the script changed is answered by a fresh worker (new process);
  the one-shot runner refuses an unknown action. Mutation (no retry): the third fails.
- Browser: `module-bar-rollup` (two unread reports: "1 more" opens the second in place, aria-expanded,
  "Show less", the item link, the overview link; at least three tiles in the first row of the Prepare
  overview at 1440px), `stage-status`, `transcript-coding-incomplete` **3 passed**. Screenshots
  inspected and sent to Grant.
- `python3 scripts/crosstab_selftest.py`: all passed.
- Full library: **1,763 passed, 72 skipped, 0 failed** (235 files passed, 1 skipped).
- Full browser suite (no filters): **108 passed, 1 skipped, 0 failed**; smoke 1 passed.

Mocks: storage, the model (never reached).

## Limits

- The roll-up's open state is not remembered across page loads.
- Tiles narrower than 17rem are not used; on a very narrow screen there is one column.
