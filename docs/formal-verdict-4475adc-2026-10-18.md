# Formal independent verdict on 4475adc — 2026-10-18

**Verdict: request changes; do not accept the complete package.** Accept the bounded latest-verdict and GT-008/009/010 application repairs at the evidence levels below. The storage-privacy release checker has an independently reproduced fail-open result and needs repair. This does not reopen the 37 closed canonical technical rows or certify deployed security. Partition remains **37 Closed /6 Blocked=43**; overall acceptance/public release remains incomplete.

Reviewed exact `4475adc910b04228522385e0075dfc655c34c25f`, released at `f41946b`. The later `d5c03e1` real-model kit changes tooling only and is separate. Application source remained read-only; 548 source/engine/migration paths matched the prior executed production copy before reuse. No push, deployment or development/live mutation.

## Required repair — IMP-001/016 storage gate

**Severity: S2, false assurance at a required public-release boundary.** `scripts/release-gate/check-storage-privacy.mjs:104`, `:106` and `:127` classify HTTP status alone too broadly:

- After confirming a sample object exists, anonymous public/anon HTTP 500 responses print PASS and the summary prints STORAGE PRIVACY: ENFORCED. A server outage is not evidence of authorization refusal.
- A freshly working signed link followed by HTTP 503 prints PASS for expiry, summary ENFORCED, exit 0.
- A freshly working signed link followed by connection reset/status 0 also prints PASS for expiry, summary ENFORCED, exit 0.
- Public or anon HTTP 206 responses containing sample object data print PASS and ENFORCED, although partial object contents were disclosed.

Reproduction: run the unchanged script as a real child process against the owned loopback HTTP server in `scripts/workflow-tenant-review/formal-4475adc-20261018/storage-counterexamples.mjs` and `storage-partial-content.mjs`. The server returns private bucket metadata and a successful server-key sample-object read; subsequent responses vary as listed. Evidence: `storage-independent-counterexamples.json`, `storage-partial-content-counterexamples.json`. No real bucket or key used.

Smallest fix: classify verified authorization/expiration refusals explicitly. Treat network failure, rate limiting, server errors and ambiguous responses as COULD NOT CHECK, never PASS. Successful content responses, including 206, must FAIL privacy/expiry as applicable. Keep the sample-existence prerequisite. A skipped signed-link check must not imply that expiry was verified.

Closing tests: original 503 and connection-reset signed-link cases must return incomplete/exit 1; anonymous/public outages must be incomplete; public/anon partial-content success must fail/exit 2. Preserve genuine private/denied/expired success, public/readable/nonexpiring failure, missing-object and unreachable-service controls, plus recovery from outage to a conclusively checked result. Claude implements; Codex independently reruns the unchanged original counterexamples on the exact repair commit. Intended deployed authorization remains a separate gate even after a local repair.

## Accepted bounded application changes

| Scope | Independent disposition |
|---|---|
| Latest-verdict consumers: narrative DOCX/PPTX chart/list readers, discovery report, research assistant, stated-insight evidence pool, page counts/readers and contradiction tie order | Accept at code and disposable-persistence boundaries. Shared newest-created-at/larger-ID rule agrees with support snapshots. Refusal after robust history, recovery, duplicates and equal-time controls execute in actual reader/route tests; prompts/charts are controlled boundaries, not provider-quality claims. Including null finding_kind computed evidence fixes the documented SQL exclusion. |
| GT-008 connection message | Accept at shared mapper and native dropped-save/retry scope. The ten-journey C3 records preserved draft, truthful uncertainty, one durable retry and reload. The two fetch-panel call sites use the same mapper; no independent native Firefox/Safari or full panel matrix claim. |
| GT-009 qualifications slide | Accept at affected native correction/export scope. C5 records no unqualified affected insight in DOCX/PPTX, including the qualifications slide; human work remains unchanged. |
| GT-010 delete warning | Accept at actual deletion/count/fallback scope. C1 records 8 findings, one reviewed decision, one note and 10 dependent insights in the confirmation. Actual deletion qualifies lost support and preserves the researcher recommendation. Disposable read-failure tests establish the general-wording fallback; unchanged shared component supplies attached-instrument/transcript controls. |
| Release-gate runbook | Retain as preparation, not executed deployed evidence. G6 authentication/request tenant mapping is explicitly missing. G1–G5 commands and owner deployment/backup procedures do not establish intended-role equivalence merely by being documented. G4 checker cannot be accepted until the finding above is fixed. |

Existing independent evidence: [ten replay journeys](ten-simulated-golden-threads-2026-10-17.md), exact production build exit 0; four focused files, 26 passes/3 explicit skips including actual PostgreSQL and numerical references; nine Playwright plus one qualitative journey pass; 762 persisted links without integrity findings. These are retained executed results, not a newly rerun full suite. No source change occurred between that execution and this review.

## Failed-run history and coding-standard assessment

The additional retained storage test file executed here reports **6 passed /1 failed**, not seven passes. Its missing-object case printed COULD NOT CHECK as expected but the Node child aborted with exit 3221226505 instead of 1. The independent short no-sign 500/206 probes also print a Windows libuv assertion after their false ENFORCED summary. Preserve these process failures separately; the 503/reset counterexamples independently exit 0 and establish the classification defect without relying on an abnormal exit. No claim about the precise runtime cause or deployed reproduction is made.

A read-only progress inspection initially used `trace.created_at` instead of `occurred_at`; corrected inspection is retained separately. It changes no application state and is not an application failure.

Layering and authoritative-rule reuse are appropriate in the reviewed application changes: the database deletion-impact read lives in src/lib, presentation consumes its result, and the latest-verdict order is shared rather than reimplemented by each reader. No changed statistical calculation or measured performance problem was found. The release script's comments promise PASS/FAIL/COULD NOT CHECK semantics that its outage branches violate; correct the implementation and corresponding regression coverage together under coding-standard requirements 3, 4 and 8. No speculative refactor or performance finding is added.

The separately authorised US$5 real-model measurement is recorded in its own result artifacts; it cannot repair or waive the storage-check finding. Approved SAS and flipped separate-Codebook exclusions, five archived-definition dispositions and remaining deployed identity/storage/role/schema/migration/backup requirements stay explicit. The owner may commit this report and notes locally; this review performs no commit or push and does not promote acceptance counts.
