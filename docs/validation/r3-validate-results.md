# R3 repair package: cloud validation results

Date: 30 October 2026. This was a verification-only run, so no application code was changed. Nothing was deployed, and no Supabase project or live database was used. Every database was a disposable one on a local PostgreSQL 16 server at `localhost:55432`.

## What was tested

| | |
|---|---|
| Branch | `claude/r3-validate` (GitHub), unchanged on the remote during the run |
| Commit | `8553568a801211c59d28ac1cf6e3f2626338bdff` ("R3 repair package tree (local r3 at d5effbe) ...") |
| Tree hash | `0bbf4fa512bf82ac7d8c6ddc5f00e7021d66115c` |
| Working tree | Private detached worktree `/home/claude/r3v-own`. It stayed clean throughout: a watcher logged `HEAD` and `git status` every minute, and `HEAD` read `8553568a` with 0 changed tracked files at every sample |

All results in sections 1 to 6 come from this commit. The appendix covers an earlier attempt that turned out to have run on a different commit. That attempt is excluded from these results.

## Container

| | |
|---|---|
| CPU | 2 vCPU (Intel Xeon @ 2.10GHz) |
| Memory | 8,027 MB total. All shell processes, including the parallel sessions, share one memory cgroup with a limit of 6,270,050,304 bytes (about 5.8 GiB). No swap |
| Disk | Root volume reports 252 GB, but the real backing limit is about 44 GB. Free space ranged from 0 to 6 GB during the day |
| Load | Several other Claude sessions shared this container, each running its own stacks, builds, lint and vitest. Load average was 7 to 15 on 2 CPUs. Available memory went as low as 1,288 MB during the suite run |
| Software | Node v22.22.0, npm 10.9.4, TypeScript 5.9.3, ESLint 9.39.5, vitest 2.1.9, Playwright 1.56.0 (preinstalled chromium-1194 in `/opt/pw-browsers`), Python 3.13 with pandas 3.0.5, numpy 2.5.3, scipy 1.18.1, pyreadstat 1.2.8, PostgreSQL 16.15, LibreOffice 24.2.7.2 (`LIBREOFFICE_PATH=/usr/bin/soffice`) |

The memory cgroup killed processes (Chromium renderers, node, python, next-server) many times during the day, and the disk filled to 0 MB twice. Those events explain most failures in the excluded attempt and one failure below.

## Setup and deviations from the brief

- **Dependencies.** `node_modules` was hard-linked from a fresh `npm ci` of the same `package-lock.json`. The lock file is byte-identical between the two trees (`git diff` shows no change to `package.json`, `package-lock.json`, `requirements.txt` or `vendor/`). After that, `npx next typegen` ran on this tree. Python packages came from `requirements.txt` plus scipy and numpy.
- **PostgreSQL.** The container's existing server on port 55432 (trust auth for `postgres`) was used. A second cluster could not be created on the same port.
- **Ports and names.** Because other sessions shared the container, I avoided the shared defaults:
  - storage stand-in on 39128 instead of 39123
  - app on 3228 (`E2E_APP_PORT`) instead of 3210
  - build database `ie_test_build_r3vown` instead of `ie_test_build`

  The build inlined `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39128` to match.
- **Built directory.** The production build was made in place in the private worktree, and `E2E_NEXT_START` pointed at it. That worktree is already a private copy, so no second copy was needed.
- **UI suite command.** I ran the brief's command exactly first, without `GOLDEN_SMOKE_TARGET_MANIFEST`. It did not start: 0 tests ran, because two files read that variable when they load (details in section 4). All suite runs reported below therefore use the documented form from `docs/validation.md`: `GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`. No filters were added.
- **Sign-in lifetime.** The stack was started with `E2E_AUTH_ACCESS_SECONDS=21600`. This is a setting of `scripts/e2e/local-stack.mjs`, not app code. In the excluded attempt, the one-hour synthetic sign-in expired partway through and every later check landed on the sign-in page. With the 6-hour lifetime, the full suite ran on one stack with no sign-in failures, so no sign-in reruns were needed.

## 1. Typecheck, lint, engine self-test

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, 0 errors (155 s). The first two attempts were killed by the shared memory cgroup (exit 137) before finishing. The third was started once at least 3 GB of memory was available |
| `npx eslint src e2e --quiet` | exit 0, 0 errors (357 s) |
| `python3 scripts/crosstab_selftest.py` | exit 0, 558 PASS, 0 FAIL, "All indicator checks passed" and "All checks passed". The first attempt reported 556 PASS, 2 FAIL: the 249,113-row "long FinData" measurement (peak about 1.2 GB) was killed by the cgroup and returned `{'error': ''}`, which also failed its parent "indicator data reader self-test" line. Rerun with memory available: 558/0 |

## 2. Production build

- `node scripts/e2e/prepare-build-db.mjs postgres://postgres@localhost:55432/postgres ie_test_build_r3vown` created the build database with 133 migrations.
- The build ran as `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/home/claude/r3v-own/scripts/e2e/font-mock.cjs DATABASE_URL=postgres://postgres@localhost:55432/ie_test_build_r3vown NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39128 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-stand-in SUPABASE_SECRET_KEY=local-stand-in ANTHROPIC_API_KEY=stand-in NEXT_TELEMETRY_DISABLED=1 npx next build --webpack`.
  - Exit 0 in 415 s; all 32 static pages generated.
  - One warning, from a third-party package (not app code): `./node_modules/unpdf/dist/index.mjs` "Critical dependency: Accessing import.meta directly is unsupported", imported via `src/lib/extractFindings.ts` and `src/app/runs/[id]/page.tsx`.
- `... ie_test_build_r3vown --drop` removed the build database.

## 3. Stack

`E2E_AUTH_ACCESS_SECONDS=21600 E2E_NEXT_START=/home/claude/r3v-own E2E_STORAGE_PORT=39128 E2E_APP_PORT=3228 E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:55432/postgres LIBREOFFICE_PATH=/usr/bin/soffice node scripts/e2e/local-stack.mjs`

- The manifest was written at 15:54 UTC.
- The stack ran in production mode (`next start`) with a restricted non-owner application role, a model replay, and the storage and auth stand-ins.
- Each stack dropped its database and role when stopped. I confirmed this in `pg_database` afterwards.

## 4. Full browser suite

The suite has 118 check files and 158 tests. Run: `GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`. It started at 15:54:42 UTC and took 73.8 min.

**Result: 155 passed, 2 failed, 1 skipped, 0 flaky, 0 did not run.**

- **Skipped:** `real-model-quality.check.mjs:88`. This is its own guard, "Replay stack: model quality cannot be measured from replay answers.", and it is expected on a replay stack.
- **Earlier attempt with the brief's command unchanged** (no `GOLDEN_SMOKE_TARGET_MANIFEST`): Playwright stopped while loading the tests, with 0 tests run. Two files read the variable without a fallback:
  - `e2e/ui/independent-upload-controls.check.mjs:10`
  - `e2e/ui/output-selection-lost-reply.check.mjs:12`

  Both fail with `TypeError: The "path" argument must be of type string ... Received undefined` at `readFileSync(process.env.GOLDEN_SMOKE_TARGET_MANIFEST,'utf8')`. The other 116 files fall back to `e2e-results/target-manifest.json`. This is a test-harness inconsistency, not a product defect. The documented command sets the variable.

### Failures

**F1. `e2e/ui/over-limit-refusal.check.mjs:38`**: "one byte and one case over the limits are refused visibly, stay refused after reload, and the corrected files import"

- **Error:** `Error: page.goto: Page crashed` (navigating to `http://127.0.0.1:3228/`), after 40.0 s.
- **Alone, on a fresh stack:** passed (1 passed, 1.3 min).
- **Cause (environment).** The Chromium renderer crashed while the check was handling a file one byte over 100 MB in the page. The shared cgroup had been killing processes about 5 minutes earlier (a node process and a renderer), and available memory was around 3 GB. There is no app error in the server log. The same check crashed or stalled the same way in the excluded attempt, which ran under heavier memory pressure.

**F2. `e2e/ui/recommendations-report-overview.check.mjs:27`**: "Recommendations and Insights report overviews count the records and open them"

- **Error:** `expect.poll ... Timeout 180000ms exceeded while waiting on the predicate`, at `ui.expectReadyOrActionableRecovery` (`e2e/adapter/golden-thread-adapter.mjs:224`, called from the check's line 37). Duration 8.0 min.
- **Screenshot:**
  - `golden-survey-documented.xlsx` is marked "Processing: Read failed", with "Could not read this file: The statistics worker stopped. Try again."
  - At the same time, the page banner still says "WORKING 1 file is still being read: golden-survey-documented.xlsx is still being read".
- **Alone, on a fresh stack:** passed (1 passed, 43.2 s).
- **Order-dependence.** Each sequence below ran on its own fresh stack, with the worker process ID logged every 2 s:

| Sequence | Result |
|---|---|
| raw-file-reopen → real-model-quality (skip) → recommendation-edit-and-add → recommendations-report-overview (the suite order) | **F2 reproduced** (same screenshot). The only `parse_stats_worker.py` process vanished at 17:29:48, 4 min 38 s into the failing check and about 5 min after raw-file-reopen finished (17:24:44). It was not replaced while the check waited |
| recommendation-edit-and-add → recommendations-report-overview | passed (2 passed, 1.5 min) |
| raw-file-reopen → recommendations-report-overview | **F2 reproduced**. raw-file-reopen finished at 17:38:41, and the worker vanished at 17:43:42, 5 min 1 s later |
| (a first try of the full sequence) | failed differently: the check's own `postgres` connection and the app's database connections were ended with `terminating connection due to administrator command`. No code in this repository does that, and it was not reproduced, so it was put down to another session on the shared server |

- **Cause: probable product defect (order-dependent), not test timing.**
  - The worker disappears 5 minutes after raw-file-reopen ends, matching `WORKER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000` in `src/lib/parseStatsFile.ts`.
  - That suggests a request started at the end of raw-file-reopen did not finish within the limit. Its step 3 makes the page read the 5,000 x 301 file again in a changed layout.
  - The timeout then killed the single shared statistics worker. Every request queued behind it was rejected through `fail("The statistics worker stopped. Try again.")` on the worker's `exit`, including the next check's 13 KB `golden-survey-documented.xlsx` from a different project.
  - So one slow or stuck read blocks every other read for up to 5 minutes, then fails reads that had nothing to do with it. The page also kept its "still being read" banner beside the "Read failed" state.
  - **Not established:** whether the occupying request is a genuine hang or just very slow on this contended 2-CPU container. No OOM kill was recorded at those times.
  - The same symptom appeared in the excluded attempt's full run on another commit, so it does not look specific to R3.

## 5. Smoke checks (run against the same stack)

| Command | Result |
|---|---|
| `GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json GOLDEN_SMOKE_ADAPTER=e2e/adapter/golden-thread-adapter.mjs npx playwright test` | exit 0, **1 passed** (`e2e/golden-thread-smoke.spec.mjs:28` "retained raw-data-to-export smoke, qualification and reload", 1.2 min) |
| `node scripts/e2e/objective-review-acceptance.mjs` | exit 0 (25 s). `e2e-results/objective-review-native.json` has **3 of 3 checks passed**: detail edit/accept/unaccept/reaccept/reject and overview restore preserve human wording; overview transitions and edit preserve the same candidate identity; native regenerate/reload preserves human wording, the rejected exclusion and the original brief |

## 6. Library tests

The library ran after the stack was stopped: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres LIBREOFFICE_PATH=/usr/bin/soffice npx vitest run src/lib/__tests__ --pool=forks`

**Result: exit 0.**

- Test files: 371 passed, 2 skipped (373).
- Tests: 2,826 passed, 92 skipped (2,918).
- Duration: 1,582.6 s.

Two whole files were skipped:

- `researchQualityModel.real.test.ts`, 13 tests, needs a real model.
- `indicatorLimitMeasure.db.test.ts`, 1 test, an opt-in measurement.

The other skips are conditional skips inside files. Database tests used real disposable databases on the local server. LibreOffice was available for the render tests.

## Summary

| Check | Result |
|---|---|
| tsc | 0 errors |
| eslint | 0 errors |
| crosstab self-test | 558 / 0 |
| next build --webpack | success (unpdf third-party warning) |
| UI suite (158) | 155 passed, 2 failed, 1 skipped |
| F1 over-limit-refusal | passes alone; renderer crash under memory pressure (environment) |
| F2 recommendations-report-overview | passes alone; reproduces 2 of 2 after raw-file-reopen; probable product defect: the shared statistics worker is held by a request for 5 minutes, then killed, failing queued reads with "worker stopped" while the banner still says "being read" |
| Golden-thread smoke | 1 / 1 passed |
| Objective review acceptance | 3 / 3 passed |
| vitest library | 2,826 passed, 92 skipped, 0 failed |

Test harness note: `independent-upload-controls.check.mjs` and `output-selection-lost-reply.check.mjs` need `GOLDEN_SMOKE_TARGET_MANIFEST` set, unlike the other 116 checks. Without it, the whole suite stops before any test runs.

## What used real infrastructure and what was simulated

- **Real:** PostgreSQL 16, with a restricted non-owner app role and row-level security; the Python engine; LibreOffice; Chromium; and the production Next.js server.
- **Simulated:** Supabase Auth and Storage were local in-memory stand-ins, and the model was an explicit replay, so the model results show orchestration only, not AI quality.
- No hosted service was contacted.

## Appendix: excluded attempt (different commit)

An earlier attempt ran in the shared worktree `/home/claude/b128`. Its reflog shows that 5 seconds after `claude/r3-validate` was checked out there (11:57:07 UTC), another session switched that worktree to other branches. It ended at `6ad110a8` ("r5moments: work so far ..."). The typecheck, lint, self-test (564/0), build and UI runs of that attempt therefore tested `6ad110a8`, not R3, and are excluded.

That attempt also hit environment failures that make its UI numbers unusable anyway:

- the memory cgroup killed its app server twice, and Chromium renderers many times ("Page crashed" and "Target crashed")
- the disk filled to 0 MB, which crashed the stack (`ENOSPC`) and put PostgreSQL into recovery mode
- the one-hour sign-in expired, so later checks landed on the sign-in page

Its databases and roles were all dropped. The R3 run above used a private worktree that no other session touched.

Logs (in the session scratchpad, not committed): `/tmp/claude-0/-home-claude/2029d29d-347f-5d3f-9a5d-a57af1db9390/scratchpad/r3v/own/` holds `ui1.log`, `smoke.log`, `objacc.log`, `vitest.log`, `build.log`, `tsc3.log`, `eslint.log`, `selftest2.log`, `iso/`, `seq1/` to `seq4/` and `watch.log`.
