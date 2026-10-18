# Independent second repair review — 2026-10-18

Release HEAD `180d293`; repairs `fdac176` and `37193d6`. **Request changes on both packages.** The original benchmark counterexamples and source-lock expiry reproduction now pass, but uncertainty classification and task-row lease expiry still fail. A retained concurrent-start test also failed with a real deadlock, confirmed independently.

| Commit / scope | Verdict and disposition |
|---|---|
| `fdac176` benchmark attribution | **Request changes.** All seven original independent cases and seven retained tests pass. Two hypothetical/conditional statements still falsely count as an observed effect. |
| `37193d6` lease expiry | **Request changes.** Original source-lock wait now refuses, with valid-lease/reclaim controls passing. Task-row lock wait still accepts expired extraction/assessment results. Concurrent review creation also needs the bounded correction below. |
| Accepted `7ca0848`, `a9cb5de`; purge and interrupted retry | Preserve their recorded finite closures. No unrelated gate reopened. |

Counts remain **37 Closed /6 Blocked=43**, priorities34/9/0. Security/deployment remains Blocked; five archived historical definitions remain Blocked and deferrable. Approved SAS and flipped separate-Codebook exclusions remain explicit. No overall acceptance/public-release authorization.

Evidence: `scripts/workflow-tenant-review/second-repair-review-20261018/`. The isolated immutable copy is recorded in `paths.json`. Both benchmark repair paths hash-match `fdac176` in final application `37193d6`; all584 core source paths and all885 tracked paths match after execution. Application source remained read-only. Only untracked independent probes were added in the copy. Earlier [six-repair findings and failures](six-repair-independent-review-2026-10-18.md) remain untouched.

## 1. Benchmark: hypothetical figures are not affirmative findings

**S2 measurement correctness:** [omitted-effect-measure.mjs](../e2e/ui/omitted-effect-measure.mjs:70), sentence filtering124 and attribution134–137. `NEGATION` handles the previous explicit denials, but it does not reject modal or conditional uncertainty. A clause naming the answer automatically anchors its percentages despite that uncertainty.

Actual module results on the original saved computed findings:

- `Convenience might be chosen by 70% of men and by 50% of women.`
- `If Convenience were chosen by 70% of men and by 50% of women, we would change the campaign.`

Both yield `states the effect` and `found in the computed findings and stated by an insight`. They express a possibility or hypothesis, not an observed target contrast. This contradicts the repair's claimed affirmative attribution and its comment that hedged sentences are unestablished. It is a benchmark defect, not evidence about fresh model quality.

Original independent probe: **7 passed/0 failed**, versus previous5/2. Expanded probe: **7 passed/2 failed**, exit1; original seven cases unchanged, plus the two texts above. Retained test suite: **7 passed/0 failed**, exit0. Evidence: `benchmark-independent.json`, `benchmark-attribution-boundary.json`, logs and exact executable probe text.

Fix acceptance: keep all seven original cases passing; refuse positive classification of these exact uncertain statements and retain an unverified/related explanation. Affirmative correct controls must still count. Uncertainty must not become a measured positive merely because a clause names the answer and right numbers. Correct the unconditional hedging explanation together with the implementation. No general prose-understanding feature is required to return uncertainty conservatively.

## 2. Lease: source-lock repair verified; task-row wait still fails

**S2 task reliability:** [researchQualityRepository.ts](../src/lib/researchQualityRepository.ts:285), `CURRENT_LEASE`, used by extraction and assessment publication. Changing `now()` to `clock_timestamp()` resolves the original source-lock reproduction. The unchanged independent source-lock probe now gives **19 passed/0 failed**, exit0, including its prior18 retained cases and the two-stage wait assertion. The new retained source-lock expiry/live/reclaim case also passes.

The predicate can nevertheless be evaluated before waiting to lock an unchanged **task row**. In that ordering, release of a lock without a row update does not make the publisher re-evaluate its earlier eligibility decision against the later clock.

Independent actual-repository reproduction for extraction and assessment separately:

1. Create/claim an owned task; set its synthetic lease expiry two seconds ahead.
2. Another connection holds that task row `FOR UPDATE`, without changing it.
3. Call the actual publisher and observe a database lock wait.
4. Wait2.2seconds; independently confirm expiry before unlocking.
5. Unlock: both calls return **true** and mark the task succeeded; expected false/no published result.

`rq-task-wait-observations.json` records waiting=true, expiredBeforeUnlock=true, published=true for both stages, elapsed2237/2249ms. `rq-task-wait.log`: **18 passed/1 failed**, exit1, with two failed stage assertions. This extends the original independent fixture by changing the held row from source to task and moving fixture expiry setup before acquiring the holder's lock; application code is unchanged.

Fix acceptance: acquire the task lock in the established source-before-task order, then establish current matching lease validity using the actual clock after the wait, atomically with publication. Verify expired source-lock and task-row waits for extraction, assessment and the shared failure-result boundary; preserve valid waiting publication, paid-usage accounting, replacement-token refusal and safe reclaim/retry. The repository header explicitly claims task-row waiting is covered; it currently is not. Requirements3/4/8 apply. This is correctness under contention, not a measured performance allegation.

## 3. Concurrent start: retained failure is an application deadlock

**S2 reliability/idempotency:** [researchQualityRepository.ts](../src/lib/researchQualityRepository.ts:206), `createReview`, calls `assertRunOwned` (run `FOR SHARE`) before upgrading the same run to `FOR UPDATE` at206 for sequence allocation. Two starts can each hold the shared lock and then wait to upgrade it. This code predates the latest repair; it is not attributed to the clock change.

The first exact retained suite failed its actual-action `a repeated start with the same request key creates one review` assertion. PostgreSQL reports **40P01 deadlock detected**, while locking `runs`; one action returns failure. This is not a missing role, environment prerequisite or selector failure.

Independent isolation uses two actual `createReview` calls with the same new request key and an owned existing review's valid metadata. A third connection briefly holds the run lock so both callers reach their ownership lock, then releases it. Result: one promise rejects with40P01; the other creates the review. No copied creation SQL substitutes for the repository. Evidence: `rq-concurrent-start.log`, structured observations and `independent-concurrent-start.probe.txt`. **19 retained cases pass/1 independent case fails**, exit1.

Fix acceptance: establish one consistent run-lock acquisition path for review creation, rechecking tenant/run ownership and same-key idempotency inside it. Concurrent identical starts must both return the same durable review; distinct requests must allocate valid separate sequences. Verify original retained action case, controlled concurrent entry, ordinary sequential repeat, failed attempt/retry and cross-tenant refusal. Preserve successful tasks/researcher work. This is a newly demonstrated supported-workflow finding in the reviewed repository, not a new canonical release row.

## Commands and exact results

All test commands use the `37193d6` copy from `paths.json`; benchmark paths are byte-identical to `fdac176`. Actual PostgreSQL17 disposable cluster, non-owner RQC application role and controlled model/storage boundaries only.

```powershell
npx.cmd vitest run src/lib/__tests__/omittedEffectMeasure.test.ts
node review-benchmark.mjs
node review-benchmark-boundary.mjs
$env:TEST_DATABASE_URL='postgres://supabase_admin@127.0.0.1:55527/postgres'
npx.cmd vitest run src/lib/__tests__/researchQualityRules.test.ts src/lib/__tests__/researchQuality.db.test.ts src/lib/__tests__/requestTenantCoverage.test.ts
npx.cmd vitest run src/lib/__tests__/independentLockExpiry.db.test.ts
npx.cmd vitest run src/lib/__tests__/independentTaskLockExpiry.db.test.ts
npx.cmd vitest run src/lib/__tests__/independentConcurrentStart.db.test.ts
npx.cmd vitest run src/lib/__tests__/independentResearchQualityRecovery.db.test.ts
npx.cmd next typegen
npx.cmd tsc --noEmit
```

| Execution | Result |
|---|---|
| Retained benchmark |1 file,7 pass/0 fail, exit0 |
| Original benchmark cases |7 pass/0 fail, exit0 |
| Expanded uncertainty cases |7 pass/2 fail, exit1 |
| Retained RQC/rules/coverage |3 files,41 pass/1 fail, exit1; original concurrent-start deadlock above |
| Unchanged original source-wait probe |1 file,19 pass/0 fail, exit0 |
| Independent task-row wait |1 file,18 pass/1 fail, exit1; two stage assertions |
| Controlled concurrent start |1 file,19 pass/1 fail, exit1 |
| Unchanged original16-case recovery probe |1 file,16 pass/0 fail, exit0 |
| Installed Next type generation/full TypeScript |Pass, exit0 |

Repeated shared fixture cases are not additional unique coverage. Ordinary concurrent-start scheduling passed in some later commands; that does not erase the retained failure or the controlled reproduction. Purge/interrupted-retry and prior already-expired/replaced-lease evidence remains passing at its stated scope. No new full-suite, production build, browser, Office-rendering or real-model execution is claimed. These focused behavioral failures prevent package acceptance; unrelated successful broad runs would not resolve them.

Container command used `docker run --rm -d --name codex-second-repair-20261018 --label codex.task=second-repair-20261018 -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55527:5432 public.ecr.aws/supabase/postgres:17.11.0.004`. Only its authentication was configured; each DB fixture applies its migration chain and removes its DB/role. No deployed prerequisite was awaited or used.

One retention helper initially used the copy cwd as the workspace and failed before copying/renaming files. Type generation and TypeScript then passed including the untracked independent probes; retention was corrected afterward. This helper failure is retained separately in `inspection-history.json`, not counted as an application failure. Original failed runs and counterexamples remain local. All tests use replay/controlled model responses; no paid calls or new quality score.

Source manifests, logs/exit records, exact probes and structured outcomes are retained under the evidence root. No native stack was started. Owned disposable DBs/roles were absent before labelled container shutdown;55527 is clear and container removed. No live/development writes, push, deployment, history rewrite or scheduled-watch change. No application code edited.

Handoff **READY_FOR_CLAUDE** for the three concrete findings above. Preserve the passing original cases, accepted sign-in/storage and purge/retry mechanisms. Return exact stable repair commits for independent verification. Public-release security/process checks, reference curation, exclusions, archived definitions and real-model quality remain separately dispositioned; overall acceptance remains incomplete.
