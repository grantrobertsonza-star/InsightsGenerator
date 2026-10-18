# Independent third repair acceptance — 2026-10-18

**Accept `6bb2a3f` and `1e0f2a3` at the agreed finite repair scope.** Reviewed documentation release `6f61c09`, final application **`1e0f2a3`**, in a separate immutable copy. The benchmark's two uncertain-statement reproductions, expired task-row publication and concurrent-start deadlock are repaired and independently verified. No remaining defect was demonstrated in those closing cases. This is not overall acceptance or public-release authorization.

| Finding | Independent disposition |
|---|---|
| Benchmark modal/conditional false positives | Both exact original sentences now report unestablished/not counted; original split findings, explicit positive, female-only, wrong/reversed and unrelated figures remain correct. **Repaired and verified.** |
| Expired publication after task-row wait | Both original extraction/assessment counterexamples now refuse after confirmed expiry before unlock, leaving tasks running without published results. Valid waiting writes, failure-result writes, accounting and reclaim controls pass. **Repaired and verified.** |
| Concurrent review-start deadlock | Original controlled same-key repository reproduction now returns one review to both callers without40P01. Actual-action repeat, distinct-key consecutive sequences, sequential repeat and tenant refusal pass. Failed creation rolls back; corrected retry and repeat leave one task. **Repaired and verified.** |
| Accepted sign-in/storage, purge and interrupted retry | Preserve their recorded finite closures; accepted sign-in/storage source hashes match, and affected RQC regression/recovery checks pass. |

Canonical partition stays **37 Closed /6 Blocked=43**, priorities34/9/0. These repairs add no canonical rows or count promotions. IMP-001/016 deployed identity/storage/access/role/schema/migration/backup-process requirements remain a separate Blocked public-release gate. SET004/005 and REV003/010/M03 remain five Blocked, deferrable historical-definition dispositions. Approved SAS and flipped separate-Codebook exclusions are scope decisions, not unresolved supported requirements. Reference curation and fresh real-model semantic quality remain separate limitations.

## Independent evidence against the failures

Evidence root: `scripts/workflow-tenant-review/third-repair-review-20261018/`. `paths.json` names the exact final copy. `scope-equivalence.json` proves both benchmark repair paths match `6bb2a3f` and all four original DB probes match their retained bytes. Benchmark probes change only their evidence output destination, preserving all case inputs/expectations.

| Executed boundary | Result, native exit0 |
|---|---|
| Retained benchmark suite |1 file,8 passed/0 failed |
| Original benchmark cases |7 passed/0 failed |
| Expanded benchmark uncertainty cases |9 passed/0 failed, previously7/2 |
| Retained RQC/rules/request-coverage |3 files,44 passed/0 failed |
| Unchanged source-lock expiry probe |1 file,19 passed/0 failed |
| Unchanged task-row expiry probe |1 file,19 passed/0 failed, previously18/1 |
| Unchanged controlled concurrent-start probe |1 file,20 passed/0 failed, previously19/1 |
| Unchanged original recovery probe |1 file,16 passed/0 failed |
| Additional creation rollback/retry control |1 file,20 passed/0 failed, including repeated fixture cases |
| Exact final production build/full TypeScript |Pass |

Shared fixture cases repeat across commands; these counts are not a total of unique tests. No independent1011-test or49-browser-suite rerun is claimed.

The original task-row probe observes a real lock wait, confirms expiry from another connection before releasing the unchanged row, then calls the actual publisher to completion. Both stages now return false, rather than the previously observed true. The source-lock reproduction remains passing. Retained actual-DB tests also exercise expired and live extraction, assessment and failure writes, paid-usage accounting, replacement/current lease and reclaim. Synthetic cost figures test accounting only; no provider spend occurs.

The original controlled concurrent-start probe uses actual repository calls and valid owned metadata; both calls now fulfill with the same review ID. Retained tests separately establish one durable same-key row and consecutive sequences for different requests. The additional independent recovery control deliberately supplies duplicate task keys so PostgreSQL rejects insertion after the review insert. The entire transaction rolls back; retry with one valid task creates one review/task, and another identical call returns that review without duplication. It does not seed the result being asserted.

Engineering-standard assessment: the benchmark continues to separate structured numerical evidence from conservative text classification. Its uncertainty explanation now matches the tested modal/conditional/question controls. This is finite deterministic measurement, not proof of arbitrary prose understanding or model calibration. In persistence, one shared task-lock function precedes lease evaluation in each result-write path; source-before-task ordering remains intact. Review creation acquires one tenant-scoped run lock before checking the key, avoiding the previous lock upgrade. Ownership, transaction rollback and existing UI/business/statistical layer boundaries remain preserved. No new statistical calculation or measured performance change was introduced; no speculative performance finding is asserted.

## Exact commands and environment

Commands execute in the final copy unless explicitly marked workspace. Benchmark source is byte-identical to its individual repair commit.

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
npx.cmd vitest run src/lib/__tests__/independentCreateRecovery.db.test.ts
node review-build-db.cjs
npx.cmd next build --webpack
node scripts/e2e/local-stack.mjs
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs research-quality
$env:REAL_MODEL_QUALITY_HARNESS_TEST='1'
$env:REAL_MODEL_QUALITY_SYNTH_TIMEOUT_MS='20000'
npx.cmd playwright test -c e2e/ui/ui-check.config.mjs real-model-quality
# workspace: audit actual saved numerical evidence before cleanup
node scripts/workflow-tenant-review/third-repair-review-20261018/saved-values.cjs
python scripts/workflow-tenant-review/third-repair-review-20261018/reference-audit.py
```

Local PostgreSQL17 image `public.ecr.aws/supabase/postgres:17.11.0.004`, owned container `codex-third-repair-20261018`, label codex.task=third-repair-20261018, loopback55527. Required DB suites use its supabase_admin prerequisite; native app role is non-owner/NOSUPERUSER/NOBYPASSRLS. Only this disposable cluster's local authentication was configured. All migrations apply only to disposable fixture/build/runtime databases.

Build DATABASE_URL points at `ie_test_build_third`; NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39134, publishable/secret keys are local stand-in values, NEXT_FONT_GOOGLE_MOCKED_RESPONSES uses the retained ten-journey font fixture. Full TypeScript and production build pass with explicit exit0. Offline font substitution is a compile boundary; the existing unpdf warning remains, not a new failure. Untracked DB probes were retained and renamed out of TypeScript discovery before building.

Native launcher uses E2E_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55527/postgres, E2E_APP_PORT=3247, E2E_STORAGE_PORT=39134, E2E_NEXT_START=the exact final copy, E2E_OUT_DIR=the evidence root's native directory, PYTHON_EXECUTABLE=python, PYTHONUTF8=1 and installed LIBREOFFICE_PATH=C:/Program Files/LibreOffice/program/soffice.exe. GOLDEN_SMOKE_TARGET_MANIFEST points at native/target-manifest.json. No E2E_MODEL_GATEWAY; explicit replay only.

## History, final consolidation and handoff

All previous failed runs, including the intermittent retained actual-action deadlock, remain unchanged in their original evidence roots. Passing repaired invocations do not relabel those runs. Deliberate rejected task insertion in the new rollback control is an expected, asserted fault/recovery case. No unexpected application or harness failure occurred in this review.

Final production native, numerical audit, retention and shutdown outcomes: No application source edits, paid calls, live/development writes, push, deployment, author/history rewrite or scheduled-watch change. Final acceptance is bounded to these returned repairs; overall acceptance remains incomplete pending the separate gates and model-quality evidence.


- **Research Quality native: 1 passed/0 failed, exit0.** Actual opening without a model call, start, pinned quotes, researcher decision/attribution, reload, two-tab revision conflict, clarification and actual DOCX output pass on this final build (`native-rq-report.json` and output files).
- **Benchmark native: 1 passed/0 failed, exit0.** Six saved tables produce18 computed findings,18 insights,5 syntheses and23 recommendations. Both one-group insights remain related rather than a full comparison; omitted effect is found in the computed findings, with no insight stating it. All ten report claims are `not extracted` on replay, not quality passes (`benchmark-replay-result.json`).
- **Saved numerical audit: 5 passed/0 failed.** Satisfaction mean3.5, Purchase Yes total50% and groups40/60, NPS25, and split Convenience Male70/Female50 agree with the independent references (`independent-values.json`).
- All **584** tracked core paths remain unchanged after execution, across **886** tracked paths. Only tracked launcher adaptation is the graceful stop-file poll; no application/engine/migration/test-source edit (`source-after.json`).
- Password-free synthetic runtime dump, storage inventory/reads, replay log, actual DOCX output, traces/screenshots, exact probes, structured passing observations and source/artifact hashes remain local. Graceful shutdown removed the runtime DB/app role; labelled cluster stopped/auto-removed;3247/39134/55527 clear, no owned application/conversion process remains (`cleanup.json`, `process-check.json`). User services untouched.

Handoff **READY_FOR_CLAUDE** for documentation/owner consolidation. No further application repair is required by this bounded review. Preserve all original failed history, six Blocked dispositions, approved exclusions, empty approved-reference catalogue/insufficient-support behavior and replay-only quality limits. This acceptance does not authorize a deployment, deployed security certification, reference approval or paid-model execution. Overall acceptance remains incomplete.
