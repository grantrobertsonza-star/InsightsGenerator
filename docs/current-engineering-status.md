# Current engineering status

Updated: 2026-10-22. State: **READY_FOR_CODEX** (main copy only): B3-01 and B3-02 (`docs/independent-batch3-review-main-2026-10-22.md`) and, at Grant's request, the one-page Objectives, AI Insights reading the whole table, and design changes; see `docs/batch4-handover-2026-10-22.md`. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked unchanged.

## Claude: B3-01, B3-02, one-page Objectives and Grant's evening changes, main copy (2026-10-22)

Implemented, ready for review: `458a829`, `587636a`, `8f256ef`, `66fe59d`, `c9390ac`, `49d8026`, `9b5c123` and this docs commit. Checks and limits in `docs/batch4-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022g/`.


## Claude: M-B2-01, M-B2-02 and the knowledge base, main copy (2026-10-22)

Implemented, ready for review: `41cdc49` (knowledge base and manual), `8ff226d` (M-B2-01, M-B2-02) and this docs commit. Checks and limits in `docs/batch3-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022f/`.


## Claude: M-BATCH-01, sidebar roll-up and 10 point scales, main copy (2026-10-22)

Implemented, ready for review: `f8f0420` (M-BATCH-01), `1f220a6` (sidebar), `9a03ad7` (10 point scales) and this docs commit. Checks and limits in `docs/batch2-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022e/`.


## Claude: IR repairs and design batch, main copy (2026-10-22)

Implemented, ready for review: `2e0ba53` (Research quality), `d10d28b` (multiple-response links), `5628913` (IR-01, IR-02, IR-03, M-IMPORT-01), `b78ceae` (SemanticTabs mean), `9af17ed` (SemanticTabs memory), `90e2753` (StarterTabs) and this docs commit. Checks and limits in `docs/design-batch-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022d/`.


## Claude: Import screen and proposal re-read rule, main copy (2026-10-22)

Implemented, ready for review: `2ad3ece`, `650735c`. Checks and limits in `docs/import-and-reread-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022c/`.


## Claude: repairs for Codex's GT1000 repair review, main copy (2026-10-22)

Implemented, ready for review: `20e49ab`, `88f092a`, `7d9fd96`. Checks and limits in `docs/r1000-repair-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022b/`.


## Claude: repairs for Codex's GT1000 review, main copy (2026-10-22)

Implemented, ready for review: `63d50af`, `522df47`, `190ae7f`. Checks and limits in `docs/gt1000-repair-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022a/`.


## Claude: repairs for Codex's GT500 re-review, main copy (2026-10-21)

Implemented, ready for review: `678bbf8` (R500-02 Setup edits bound to their candidate; R500-01 failed fill kept through ordinary saves) and `26a37ee` (UI-R500-01). Checks and limits in `docs/r500-repair-handover-2026-10-21.md`. Codex's previous status line is kept in `.fnd001/backup-status-1021c/`.


## Claude: repairs for Codex's GT500 review, main copy (2026-10-21)

Implemented, ready for review: `0e37127` (GT500-F01 import lineage, F02 visible failed fills, F03 stale-edit conflicts, P01 one identity for Add, Fill and scoring, M-GT500-01 briefs and comments) and `b07a79a` (UI-GT500-01). Checks and limits in `docs/gt500-repair-handover-2026-10-21.md`. Codex's previous status line is kept in `.fnd001/backup-status-1021b/`.


## Claude: repairs for Codex's GT100 re-review, main copy (2026-10-21)

Implemented, ready for review: `9ff70e5` (keys), `12ae030` (GTR-01), `bfb6df5` (GTR-02), `b007ef4` (SEC-01, SEC-02), `979cdc9` (M-GTR-01 briefs), `74ed2ef` (filters across the top and theme tiles, design) and this docs commit. Full suite on `74ed2ef`: browser 67 passed (1 skipped), unit 1,269 passed, smoke and objective acceptance passed, lint errors unchanged at 349. Details: `docs/gtr-repair-handover-2026-10-21.md`.

## Claude: repairs for Codex's 100-case and RR re-reviews, and the new section design (2026-10-21)

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE**: the full 100-case golden-thread review found shared GT100-F01 to GT100-F03; RRV-01 remains open. See `docs/golden-thread-100-independent-review-2026-10-21.md` and its case matrix. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked unchanged."

Implemented, ready for review, main copy only: `df90a55` (RRV-01), `053a475` (rename), `2322679` (GT100-F01), `ddb4c00` (GT100-F02, F03), `670eb38` (Findings, Insights, Recommendations and Insights report overviews with OV-01 to OV-04; please assess apart from the repairs) and this docs commit. Full suite on `670eb38`: browser 67 passed (1 skipped), unit 1,257 passed, smoke and objective acceptance passed, lint errors unchanged at 349. Details, controls and limits: `docs/gt100-repair-handover-2026-10-21.md`.

## Claude: repairs for Codex's 21 October re-review (2026-10-21)

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE**: independent repair review found five remaining correctness issues (RR-01 to RR-05); see `docs/independent-review-2026-10-21.md`. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked remain unchanged."

Implemented, ready for review: repairs (3000 `bf244dd`, 3001 `7282c71`), a follow-up closing two acceptance gaps (3000 `d433992`, 3001 `5520856`) and this docs commit. On 3001 the Findings and Insights overviews (`18cb7e7`, Grant's design trial) sit between them and touch none of the repaired files; please assess them apart from the repair verdict. Full suites on both copies: browser checks 64 and 65 passed (1 skipped each), unit 1,193 / 1,206 passed, smoke and objective acceptance passed, lint errors unchanged at 349. Details, previous-code controls and limits: `docs/rr-repair-handover-2026-10-21.md`.

## Claude: repairs for Codex's 20 October review (2026-10-21)

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE**: independent A–E review of both copies found 11 correctness issues and 2 maintainability concerns; see `docs/independent-review-2026-10-20.md`. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked remain unchanged."

Implemented, ready for review: three packages per copy (3000 `bee2612`, `356a3e9`, `dcefdc0`; 3001 `b8b4299`, `d8e4ba2`, `40be83b`) and this docs commit. Full suites on both copies: 63 browser checks passed (1 skipped), unit 1,184 / 1,192 passed, smoke and objective acceptance passed, lint unchanged at 349. Details, previous-code controls and limits: `docs/repair-handover-2026-10-21.md`.

## Claude: 18 to 20 October work ready for review (2026-10-20)

Implemented, ready for review. Review targets: main copy (`app`, port 3000) at `6a8dc08` (Coding and Reports and decks carried from 3001 at Grant's request, 20 October evening), redesign copy (`app-import-redesign`, port 3001) at `0afd1c3`; the check fixes and docs-only commits around them are named in the handover. The last independently accepted scope stays `1e0f2a3`; the release baseline stays 37 Closed / 6 Blocked.

- What changed, the checks run with their counts, mocks versus real infrastructure, migrations (0106 and 0107 new) and limits: `docs/handover-2026-10-20.md`.
- What to double-check tonight, sequenced as the standard asks (calculations and identity, persistence and concurrency, asynchronous UI state, parity between the copies, comments and checks): `docs/codex-double-checks-2026-10-20.md`.
- Nothing pushed or deployed; no development or live database touched.


## Claude repair of recommendation currentness (2026-10-17; commit `8fa326c`)

Implemented, ready for review. Base: application `1f21f71`, docs `9225d95`. Scope: only the recommendation-currentness gap, with the schema extension recorded in the handoff before editing.

**Reproduced first.** Codex's DB probe assertion (`independentRecommendationContext.db.test.ts`, no-context insight with an older recommendation) fails on the previous code with `expected 0 to be greater than 0`; the native generator replay was already recorded failing by Codex (`native-unframed-reworded.log`, `native-unframed.log`).

**Repair.**
- Migration `0102_recommendation_decision_context.sql` (additive, idempotent): `recommendations.decision_context`. Existing rows stay null.
- `recommendationAgent.ts`: both generators (per-finding and synthesized) store the decision statement their prompt was built from. It is read before the model call, so a change committed during drafting is not mistaken for what the model saw. Stored only when 0102 is applied.
- `decisionContext.ts`: recommendations are judged on their own record, never inferred from their insight. With a record: "earlier" when it differs from the current statement (whitespace ignored). AI recommendation without a record: "unknown", counted and said as unknown, never assumed current. Without 0102 applied, every AI recommendation is unknown. Researcher-written and rejected recommendations are not counted.
- `decisionRefresh.ts`: `decisionContextMismatch` now returns `{ insights, recommendations, recommendationsUnknown }`; recommendations counts earlier plus unknown.
- `DecisionBriefReview.tsx`: the standing notice names earlier insights, earlier recommendations and unknown recommendations separately, after reload too; "Could not check" when the lookup fails. The misplaced comment Codex noted is moved back above `DecisionRefreshNotice`.
- Nothing is rewritten, deleted or reworded.

**Migration.** `0102` must be applied wherever the app runs before new recommendations carry a record; until then every AI recommendation shows as unknown (conservative). Not applied to any live or development database (not authorised).

**Limitations.** Existing AI recommendations written before 0102 stay "unknown" until rewritten; there is no rewrite action (a product decision). Recommendation lists, synthesized-insight cards, decks and the narrative still carry no per-item mark; the panel count is their qualification.

**Checks on the final tree (cloud workspace, disposable PostgreSQL 16, real Python; model replay or mock only):**
- `npx tsc --noEmit -p .`: pass. ESLint on the changed files: clean.
- `vitest run src/lib/__tests__ --pool=forks`: 122 files, **868 passed, 0 failed, 40 skipped**.
- New `recommendationDecisionContext.db.test.ts` (actual generators, actual decision actions, mocked model that echoes the decision it was shown): Codex's replay A to C to A with researcher-edited wording kept; insight and recommendation recording different decisions (returning to the insight's decision leaves the recommendation counted); synthesized path; decision committed during drafting (record = prompt); unknown, researcher-written, rejected and other-run controls; Codex's original probe assertion. **All 6 fail on the previous application code** (migration kept), pass now.
- `decisionRefreshReconciliation.db.test.ts` updated to the new count shape; its seeded AI recommendation now carries a record, as generated ones do.
- Production `next build --webpack`: pass. Against it: **30 of 30 UI checks**, including the new native replay (page's own background refresh runs the actual generator; recommendation records Decision A; native reword to C, reload, "1 recommendation was written for earlier ones", text unchanged, insight context still null; reword back to A, reload, notice gone). Smoke 1, adapter 2, objective review acceptance passed.
- Codex's native probes, unchanged except the port in their disposable-target guard (55519 to this stack's 55432): `independent-unframed-reworded`, `independent-unframed-recommendation`, `independent-decision-context`: **3 passed**.
- Codex's DB probe file run unchanged: its new probe passes; its embedded copy of the earlier regression fails as intended by this contract change (expects the two-field counts, and a recommendation with no record is now unknown).
- Original two closed repairs (post-commit containment, insight qualification): their regressions and Codex's original probes still pass.

**Failed invocations this round (retained).** The first test run hit a stopped PostgreSQL (restarted). The mocked model first looked for the decision in the user message instead of the system prompt (test harness; the stored record was already correct). One stack launch lacked its environment and refused to start. My earlier generate-mode browser check failed once because its seeded recommendation had no record and is now correctly reported unknown; the seed now carries a record.

Resources: stack stopped; 0 disposable databases or roles remain. No model calls, push, deployment, or live/development change. Spend unchanged at US$3.817316 of US$10. Overall acceptance awaits Codex's review.

## Latest independent business follow-up

Reviewed2c6417e/repair1f21f71. State READY_FOR_CLAUDE for the remaining recommendation-currentness repair. Original postcommit failure and recorded-context insight probes independently pass; preserved as accepted subcases. Remaining actual native generation failure: null-context pre-decision insight acquires a recommendation for Decision A, native reword to Decision C clears markers but produces no warning for the unchanged old recommendation. Parent insight context cannot establish recommendation generation context. See latest independent disposition and handoff for exact scope/closing tests.

43-row partition unchanged36 Closed/1 Confirmed defect/6 Blocked; overall acceptance incomplete. Independent20 focused passes/3 placeholders, native4/4, build/TypeScript pass, lint0 errors/6 existing warnings. Separate DB and native recommendation-boundary expected assertions fail; old full-probe ordering failure retained as test contamination. All original failures/exclusions/archived historical/security/provider/Office limits preserved. Source read-only,424 paths unchanged. Evidence retained under scripts/workflow-tenant-review/business-followup-20261017/, all owned resources stopped. No paid calls, push/deployment or author rewrite. Older queues below are historical where superseded here.

## Claude repair of the two business-row findings (2026-10-17; commit `1f21f71`)

Implemented, ready for review. Base: application checkpoint `091663e`, docs `6dba539`. Scope: only the two repairs Codex released, plus the boundary extension recorded in the handoff before editing.

**1. Saved change reported as not saved after a post-commit failure.** `afterDecisionChange` (`src/lib/decisionCandidateActions.ts`) runs only after the change committed and now never throws: a failure in the marker lookup, the refreshes or revalidation is returned as `{ ok: true, refreshError }`. The committed marker stays, so the panel keeps offering "Update them now", and a retry takes the same path. A change that fails before commit still throws and marks nothing.

**2. Warning cleared while existing insights kept the old decision context.** The refresh only writes insights for findings that have none. Rewriting or deleting existing insights would discard reviewed recommendations and the synthesized-insight support links (cascade), so no regeneration was added. Instead:
- One rule, `src/lib/decisionContext.ts`: an insight is "written for earlier decisions" when it recorded a decision context and that differs from the run's current statement (whitespace ignored). No recorded context (generate run before any decision) is not marked.
- `decisionContextMismatch` (`src/lib/decisionRefresh.ts`) counts per-finding and synthesized insights under that rule, plus the recommendations built on them; null when it cannot be checked.
- The decisions panel shows a standing amber notice with those counts (separate from the refresh notice; "Update them now" does not claim to clear it). Each pre-insight card carries "Written for earlier decisions". The pre-insights Excel export qualifies the "Decision this serves" cell the same way.
- Derived from data, so it survives reloads and clears by itself when the decisions match again. No migration. Insight text and human recommendation wording are untouched.

**Limitations (not fixed here).** Recommendations store no decision snapshot; each inherits the mark of its insight. Synthesized-insight cards, recommendation lists, decks and the narrative carry no per-item mark; the panel count is their only qualification. A way to rewrite affected insights safely is a separate product decision.

**Changed files.** `src/lib/decisionContext.ts` (new), `src/lib/decisionRefresh.ts`, `src/lib/decisionCandidateActions.ts`, `src/app/runs/[id]/DecisionBriefReview.tsx`, `src/app/runs/[id]/page.tsx` (`getInsights` flag; panel prop), `src/app/runs/[id]/InsightsReview.tsx`, `src/app/api/runs/[id]/insights/export/route.ts`, `src/lib/__tests__/decisionRefreshReconciliation.db.test.ts`, `e2e/ui/decision-refresh-failure.check.mjs`.

**Checks run on the final tree (cloud workspace, disposable PostgreSQL 16, real Python engine; model replay only):**
- `npx tsc --noEmit -p .`: pass. ESLint on the changed files: 0 errors, 6 warnings, all pre-existing (unused imports in `page.tsx` and `InsightsReview.tsx`).
- `vitest run src/lib/__tests__ --pool=forks`: 121 files, **862 passed, 0 failed, 39 skipped**.
- New real-database cases: post-commit lookup outage on add (saved, owed, statement updated), the retry itself meeting the outage (reported, not thrown), idempotent re-add then reconcile; existing insight plus a synthesized insight written for "Decision one", a researcher-edited recommendation, a no-context control and another run's control. After a successful accept: refresh clean, marker clear, mismatch {2 insights, 1 recommendation}, wording unchanged; the real export route qualifies the framed row and leaves the control empty; unaccepting back to "Decision one" gives 0; a read outage gives null.
- Counterfactual: both new cases fail on the previous `decisionCandidateActions.ts` / `decisionRefresh.ts`.
- `next build --webpack` (production): pass. Against that server: **29 of 29 UI checks** (including the decision-refresh check's validate replay and new generate replay: panel notice before and after reload, pre-insight card mark, Excel cell, unchanged insight row), Codex's unchanged `independent-decision-context.check.mjs`: **passed**, smoke 1 passed, adapter 2 passed, objective review acceptance passed (3 checks).
- Codex's `independentDecisionLookup.db.test.ts` run unchanged: its post-commit case now passes; its following "cannot commit marks nothing" case fails only because its post-commit case leaves the owed marker without a retry (test ordering inside the probe). The retained regression covers the same case with a retry.

**Failed invocations this round (retained).** First native run: the check waited for the literal "Decision B" after rewording it, a harness locator error. Second: it opened the synthesized Insights section instead of Working data, Pre-insights. Both fixed in the check; the app output was correct in the failure snapshots. Smoke and adapter were first launched without their manifest and fixture variables (not run, skipped); rerun with them and passed. The historical `scripts/verification-objective-addition/checks.cjs` and `error-mapping.cjs` fail identically on the unchanged base (stale fakes for an earlier SQL shape); not part of this gate.

Resources: stack stopped; 0 disposable databases or roles remain. No model calls, push, deployment, or live/development change. Spend unchanged at US$3.817316 of US$10. Overall acceptance awaits Codex's review.

## Latest independent four-remainder review

Current release091663e / reviewed HEAD e2739b2. Canonical43 rows:36 Closed /0 awaiting verification /1 Confirmed defect /0 Untested /6 Blocked; priorities34/9/0. IMP-004, IMP-017 and FND finite remainders independently verified; business refresh partly repaired but two original failure probes demonstrate unresolved saved-result/currentness defects. Exact repros, source references, closing tests and all43 dispositions are in the latest independent disposition. Prior33 closures, approved exclusions and failed history preserved. Five missing definitions explicitly archived as unsubstantiated, remain Blocked; security/staging gates remain unauthorised and separate. Overall acceptance incomplete.

Independent35 passes/4 inactive placeholders; production build/TypeScript pass; lint0 errors/5 existing warnings; released native4/4. Separate real-DB saved-then-read-outage assertion and native existing-insight decision edit/currentness assertions fail in generate/validate mode. Two review-locator interruptions are harness failures only. Application source read-only,423 paths match. Local evidence retained in scripts/workflow-tenant-review/four-remainders-20261017/. All owned resources stopped. No paid model calls/push/deployment. Claude released only for the two business repairs and their exact closing regressions; see authoritative handoff.

Earlier version/queues below are historical where superseded by this section.

## Active version and ownership

- Dedicated local branch: `checkpoint/trust-hardening-20261016`; accepted source/testing checkpoint `40198b015c406be699326c7e0115037d2c1a1275`, with docs-only release `460815c`. Application bytes are unchanged from the independently built/reviewed `5f63038` source. The following local Codex checkpoint records this reconciliation; runtime and unrelated diagnostics stay outside Git.
- Repair7 accepted and27 manifest files integrated after full base/archive/hash reconciliation. Both separately released legacy-test bases match. Authoritative lockfile unchanged. [agent-handoff.md](agent-handoff.md) records current ownership and the retained exact manifests.
- Integration evidence: `scripts/workflow-tenant-review/repair7/integration-comparison.json` and `applied.json`. Parked hydration archive excluded. Recorded bounded fixes and self-validation remain valid at their exact scopes; overall trust-hardening acceptance is incomplete as reconciled below.

## Working queue

Use the existing [canonical baseline](technical-release-acceptance-baseline-2026-10-15.md), current Row-level reconciliation 2026-10-17 and finite43-row checklist. It records33 Closed /4 awaiting verification /6 Blocked. Older dated queues and count notices are historical where superseded. This file is the operational status; the handoff is authoritative for editing ownership.

After takeover, coherent batches are:

1. Reconcile and integrate released bytes; resolve conflicts explicitly. Prioritise incorrect calculations/identity (E1–E3), misleading semantic grounding/selector output, and cross-tenant access (T1–T2), preserving researcher corrections and wording.
2. Close backup privilege validation (T3) and supported adapter/download workflows (A1–A3), including targeted downstream regressions.
3. Complete the [existing closing checklist](../scripts/workflow-tenant-review/repair-closing-checklist.md) and other agreed acceptance remainders where prerequisites exist. Record unavailable prerequisites separately from demonstrated defects; no general audit or full golden-thread restart.
4. Run the full validation gate once at the milestone with disposable DB/Python prerequisites and explicit skip accounting. Review the final diff, exclude secrets/generated/runtime artifacts, and create the authorised local checkpoint on a dedicated branch.

Security/deployment requirements remain separate from local functional closure. Deferred improvements and the design-only Research Quality Review feature are not implicit implementation work in this milestone.

## Completed and preserved

All results below are Codex **self-validation** of integrated/changed code, not independent review of Codex's own repairs. Existing canonical closures and historical failed invocations are preserved; no whole-row/module or public-release sign-off is inferred.

- Repair7's27 archive/base/manifest entries reconciled and integrated; parked hydration bytes excluded. Lockfile remains the supplied authoritative hash. E1/E2 exact engine identity, E3 cache upgrade/failure/retry and T1/T2/T3 disposable role/backup checks pass at their finite recorded scopes.
- Wrong-group numerical tracing and ambiguous two-channel response enforcement have focused regression passes. Actual real-provider generator/evaluator checks retain explicit Yes Male60/Female40 and ambiguous refusal; scripted persistence/planner boundaries remain disclosed.
- Actual PostgreSQL candidate lifecycle covers cross-module identity, edit/delete/regeneration, original-brief preservation, missing-index concurrent fallback and business status/bulk/statement transitions. Reproduced duplicate addition/refresh-retry faults repaired with owned-run locking/idempotency; prior REV-009 and DEC-001 closures preserved.
- Actual evaluator concurrency/recovery checks pass. Failed durable writes now remain pending instead of escaping the batch catch. Integral/duplicate/omitted/extra index boundaries preserve prior results when coverage is incomplete; valid coverage attaches correctly. Removing accepted-insight prerequisites clears obsolete coverage.
- IMP-007 deletion and upload now commit durable cleanup intent before losing the last reference or writing storage. Actual PostgreSQL insert/storage/later-trace failures, safe retries and upload-versus-cleanup concurrency pass. Storage remains controlled in these fault tests; native seeded cleanup visibility/retry also passed.
- IMP-012 complete-to-partial reread retains item/link identities and confirmations; repeated partial and complete retries do not duplicate. Coverage is now durably recorded and loaded after reread. IMP-013 actual chart-post/status/remove/revive callers retain three separate document finding identities.
- Frozen native full replay passes with the permanent adapter and actual setup-created restricted role. A1 nested continuous-table mean7.1 and raw-code subgroup40/60 pass; original6.5 reference retained. A3 injectedHTTP500 fails boundedly and actual single-download retry passes.
- Native label-conflict tables/Excel/reload retain both labels and unmatched-name warning; corrected workbook control passes. Initial notices still require dictionary construction; same-project supported deletion/corrected reupload also passes; no in-place replacement claim.
- Valid and truncated SAV/DTA native import/calculation/error/reload/provenance checks pass; raw processing_status remains null and is not reported as truthful ready/failed certification.
- **2026-10-19: file limit raised to 100,000,000 bytes (Grant).** The 20 MB limit added 2026-10-16 blocked FinScope SA 2024.sav (26.7 MB), accepted on 2026-10-11 before the limit existed, in Cross tabs. Measured: FinScope SA 2025.sav (80.8 MB, 5,562 cases by 3,960 variables) reads in about 10 s at 1.5 GB peak memory, inside the reader's 2,048 MB and 60 s (vercel.json). Messages are now built from `api/import-limits.json`. New regression check `e2e/ui/large-spss-crosstab.check.mjs` (synthetic 25 MB SPSS file of survey shape, cross tab built; confirmed to fail on the old limit). Hosted upload of files this size still needs the direct-to-storage path (next.config.ts note).
- (Superseded 2026-10-19) Grant approved20,000,000 bytes and100,000 cases per file, with visible refusal/recovery. Shared TS/Python contract and UI/server enforcement implemented. Engine exact/one-over/cached-pair boundary checks pass. Native byte overflow and SAS exclusion pass; native100,001-case refusal persists after reload and corrected100,000-case upload succeeds. Cold concurrent deployed load is not certified.
- Grant excluded SAS pending verification. Upload/server and user-facing documentation disclose this exclusion.
- Native finding-body edit survives reload and qualifies the dependent insight/report and actual DOCX. Browser PPTX invocation timed out and stays failed; targeted HTTP PPTX continuation returns a valid qualified deck. Native revert/reload preserves researcher note and unchanged computed control. Browser PPTX event completion remains separate.
- Final full validation: **107files /804passed /33skipped**, real PostgreSQL and Python suites executed with strict prerequisites (`repair7/validate-checkpoint-final.log`). Final production build passes (`repair7/build-checkpoint-final.log`), using migrated synthetic DB. Dependency unpdf/import.meta warning retained.

## Boundaries and accounting

Claude remains paused; Codex owns the milestone. Only synthetic disposable resources are used. No development/live database or deployed-role changes, push or deployment. Prepared source snapshots/runtime evidence, dumps, keys, profiles and generated exports must be excluded from the local Git checkpoint.

Cumulative model spend at latest completed native calls: **US$3.817316 ofUS$10**; reservations approximatelyzero (floating-point residue only). Gateway disabled and its verified process stopped; memory-only key cleared. No new budget or fresh authorization is implied.

## In progress and remaining limits

After source checkpoint b5a2a4d, the remaining finite checks reproduced and repaired three recovery/metadata gaps: native instrument reread lacked Read again after items existed; Import defaulted smaller files' declared MR members to Single mention; Continue reading disappeared after reload despite pending evidence. Native instrument complete/confirmed/partial/reload/retry and type/group correction/clear/reload now pass. The definition loader uses the underlying imported dictionary separately from researcher corrections and fails visibly unknown. Continuation count uses the evaluator's own pending rule inside the same repeatable-read snapshot; affected Rule B one-client assertions pass.

A further actual SAV check reproduced missing declaration metadata: masked valid base5 was correct but the audit reported0 declared variables. The bounded reader repair preserves declarations using metadata-only access, keeps masked values unchanged, and requires dictionary9 only for affected SAV/ZSAV caches. Single/range/ordinary missing controls and malformed/retry engine cases pass; actual native cache/failure/retry passes: an injected storage outage leaves cache8 and researcher corrections intact with a visible error, then retry rebuilds cache9 and retains mean3/base5. The final gate includes these changes.

Additional completed checks: same-project label conflict recovery through supported deletion/corrected reupload passes; legacy0084 seed/backfill/regenerate/delete passes; actual persisted total/equality/mean-percent mismatch/base29/30/mean and mixed-stance reload controls pass. A2 controlled DOM names Analytics /Analytics1 /Analytics 1 and unrelated-prefix refusal pass. Native labelled/unlabelled1?5 and sparse0?10 means/top boxes pass with explicit researcher declarations and raw-code selection; missing-code audit and nine saved tables survive reload. The initial missing-audit disclosure mistake is repaired separately for SAV as above.

Actual retained DOCX and PPTX exports were rendered headlessly with installed LibreOffice:5 report pages and19 deck pages. All contact sheets and detailed representative pages were inspected; no outside-page text boxes were detected and qualifications remained visible. This closes that representative LibreOffice visual check only, not every Office version. Earlier PATH-only unavailability was corrected after checking installed locations.

Grant explicitly excluded the primary TaskB flipped-workbook/separate-Codebook weight/MR combination from initial release claims pending verification. The upload guidance and manual disclose it. The primary fixture is not substituted with controls; conditional inference/small-base/full real-model completion for that combination remain unverified outside the approved initial scope.

Security authentication/storage/deployed-role and deployment-runner certification remain separate external gates. Five historical definitions remain evidence gaps/deferrable. No independent review of Codex's own changes, module sign-off or release authorization is claimed.

## Next action

Final finite native checks, evidence retention and owned-resource shutdown completed. Reviewed local source checkpoint **b5a2a4dd198f384b7cd0c5ccb67fde37d892a673** now exists (184paths; staged secret scan clean, supplied lockfile matched, parked hydration excluded; no push/deployment). Subsequent bounded fixes are retained in the follow-up checkpoint. The broad dirty checkout predates takeover; a source checkpoint must explicitly distinguish retained pre-existing implementation from this milestone's reviewed/self-validated changes.


## Final milestone evidence and limits

- Final strict validation:107 files,804 passes,33 explicit skips; actual PostgreSQL/Python prerequisites ran, with no NOT RUN placeholders. Native checks use recorded frozen sources and targeted current-source regressions; self-validation is not independent certification.
- Current driver analysis now refuses unavailable saved layout before engine dispatch. Focused failure/retry and actual Python columns-as-cases driver-input controls pass.
- Actual nonowner PostgreSQL retrieval-permission failure persists degraded assessment through reload; restored grants/retry clear degradation without duplication. Native zero-progress evidence writes remain actionable and Continue survives reload, using the existing pending rule in the same repeatable-read snapshot.
- Two concurrent native exact20MB/100,000-case uploads persist all rows and survive reload in35.105s. The first v12 invocation timed out waiting for both persisted row counts; one project had a complete document and the other none. Cause is unestablished; that invocation remains failed. The bounded retry is a separate pass, not deployed capacity certification.
- Native finding edit/revert preserves human wording/note and keeps the prior-verdict qualification until re-verification; no automatic restoration claim. Representative design-change handover qualifies downstream work and both exports. Browser PPTX timeout remains recorded separately from successful HTTP continuation and the passing full replay.
- Remaining external gates: independent review of Codex changes; deployed authentication/two-user tenant mapping, real storage privacy/authorization, deployed-role equivalence and deployment-runner certification. SAS and the approved flipped/separate-Codebook weight/MR combination are excluded pending verification. Historical-definition gaps and broader Office-version/brief-extraction limits remain disclosed. No Research Quality Review feature implementation.
- Source checkpoint b5a2a4d retains pre-existing implementation plus earlier bounded repairs; the follow-up checkpoint contains the subsequent fixes and approved scope documentation. No push/deployment. Canonical43-row partition remains unchanged pending independent disposition.

Cleanup completed after retention: all referenced objects from the remaining stacks (31) retained without missing objects; earlier stacks separately retained. Disposable database dumps and password-free role evidence are local.31 verified owned stack processes stopped, labelled test container stopped/removed, and0 listeners remained on recorded app/storage/replay/gateway/database ports. Frozen source copies and generated evidence remain local, excluded from Git.

Final reviewed source checkpoint: `17833030c1647706322050f5b17cb0eed3cc9cc5` on `checkpoint/trust-hardening-20261016`.32 follow-up paths; exact staged scope/secret check clean; authoritative lockfile unchanged; no generated/runtime evidence or parked hydration bytes staged. Final production build completed successfully against migrated synthetic DB (existing unpdf/import.meta dependency warning retained). All source changes committed; unrelated pre-existing untracked evidence remains local. This status-only recording does not change tested application bytes.


## Conditional exclusion guard — 2026-10-16

Grant's exclusion is conditional on detection, not documentation alone. The engine now inspects
other workbook sheets before flipping and refuses declared weights/MR sets, including role-based
weight declarations and hyphenated MR headers. Dictionary, categories, crosstab and driver requests
share that reader, so they cannot silently substitute an unweighted or ungrouped result. The error
names the sheet and directs a row-per-respondent re-export retaining definitions, reupload and
verification of weights/MR setup. Label-only and empty-definition controls remain allowed; metadata
read failure fails closed. Flipped caches older than dictionary10 require reinspection; failed
upgrade preserves the prior cache/corrections and visibly refuses.

Focused final checks:16 passes/3 explicit skips across actual-engine orientation/refusal and
actual-PostgreSQL cache upgrade/recovery tests. Five metadata fixtures exercise all four analytical
entry points (20 refusal assertions), label-only/empty controls and corrected-layout recovery.
User-facing Limits and raw-data guidance disclose exclusion and recovery. Full support remains
backlog work. No native browser run or new paid model call was needed for this engine boundary.
Earlier full-gate attempts retained the test-regex target error and isolated cluster authentication
setup failures; neither is relabelled green. The final configured gate result is recorded below.

Final guard validation:107 files/805 passes/33 explicit skips, route type generation and full
typecheck pass. Required actual PostgreSQL/Python suites ran with no NOT RUN placeholders
(`repair7/flipped-codebook-guard-validate-pass.log`). The final focused run passes16 checks with
3 explicit skips. The owned guard-test database was retained without role passwords and stopped.
No model spend, push or deployment; Claude remains paused. These are Codex self-validation
results. Full separate-Codebook/flip support remains excluded and in the backlog.


Ownership release: Grant accepted the milestone. Codex released the checkout to Claude for
`.fnd001/staged-three-pane-20261016` on application checkpoint2330179; the authoritative current
file scope and verified absence of running milestone resources are in `docs/agent-handoff.md`.
This release supersedes earlier statements that Claude remains paused. Codex has stopped editing.

## Three-pane package (Claude, after the milestone release)

Adjustable three-pane layout (`ThreePane.tsx` plus the `e2e/ui` check) was applied on `8c2e1de`, then committed as7ec3f30 and handed back in badcd13. The independent review below supersedes the earlier ready-for-review state.
- On the exact checkpoint tree: route type generation plus typecheck pass; tests 805 passed and 33 skipped.
- On the disposable stack: pane check 2 passed; the unchanged golden-thread smoke passed.
- Details and hashes are in [agent-handoff.md](agent-handoff.md). No model spend, commit, push or deployment.
- Local checkpoint `7ec3f3062aff2f62650d7405951ee23025834f76` (three-pane package), handed back to Codex for independent review. No push or deployment.


## Independent pane review and milestone reconciliation — 2026-10-16

**Review complete; pane acceptance requires changes. Codex retains ownership.** Confirmed branch
`checkpoint/trust-hardening-20261016`, package7ec3f3062aff2f62650d7405951ee23025834f76 and
documentation handback badcd139285f8b5e15ea14df5387b1f873084baa. All three released file hashes
match the staged manifest. No implementation file was changed during this review.

Reused Claude's exact-tree type generation/typecheck,805-pass/33-skip gate, two pane browser checks
and unchanged replay smoke at their recorded scopes. Inspected the complete component, test/config
and its callers against the installed Next client-boundary guidance and coding standard. Additional
independent Chromium check bundled the exact released component with installed React: normal
collapse and reload persistence pass; blocked-storage collapse fails. Evidence:
`scripts/workflow-tenant-review/repair7/pane-independent-browser.json`. This isolated component
harness tests state/persistence, not application-route rendering or CSS geometry. It shut down its
browser and loopback server; no new persistent disposable resource or model call was created.

Required functional finding (P2): `src/app/runs/[id]/ThreePane.tsx:52` swallows localStorage writes,
while `layout` at108 derives only from the persisted snapshot or transient drag state and commit
at136 updates no in-page state. With Storage.setItem throwing SecurityError, pressing Collapse
leaves data-left-collapsed=false. Keyboard resizing is discarded for the same reason, and a drag
can snap back on release. The comment that a layout still applies for the current page is false.
Smallest correction: retain the selected layout in page memory independently of successful storage
persistence. Closing check: blocked reads and blocked writes permit collapse/expand and keyboard/
pointer resize for the current page, preserve mounted input, reload safely uses defaults when
persistence is unavailable, and ordinary storage still persists. Add this failure/recovery case to
the focused pane check. This is a pane finding, not a new canonical release row.

Accessibility finding (P3, code inspection): ResizeHandle advertises fixed aria-valuemax960 and
stored/default aria-valuenow at219–247, while actual permitted maxima use35%/50% of the grid and
CSS further clamps saved widths after resizing the window. Assistive technology therefore receives
a different range/value from the rendered pane. Closing check: report the effective permitted
maximum and rendered width for each separator, including wideRight default and viewport shrink.
No measured performance defect or unrelated structural refactor is asserted.

Overall disposition: Grant accepted the prior implementation checkpoint and its recorded self-validation; that acceptance does **not** complete the overall trust-hardening milestone. The later pane package has been independently reviewed and has
the two findings above; it is not yet accepted. Overall technical-release sign-off is **not complete**.
Remaining required work is:

1. Resolve the pane functional finding and correct separator accessibility values, with affected
   regression checks and a stable checkpoint for review. Codex has not released implementation
   back to Claude; no silent ownership transfer is implied by these findings.
2. Independently assess Codex-authored trust/metadata/persistence repairs at2330179 and reconcile
   the existing acceptance rows against the detailed self-validation evidence. A reviewer must
   identify specific unfulfilled closing assertions rather than replay completed matrices; current
   canonical43-row counts have deliberately not been promoted by self-validation or pane checks.
3. Keep the **parked layout-loading fix** explicitly pending: `.fnd001/repair7-20261016/parked-hydration-guard.tgz`,
   involving TranscriptSetup.tsx/useHydrated.ts and a check that failed once without diagnosis. It
   is not the pane persistence/hydration mechanism. TranscriptSetup bytes match accepted2330179;
   the package remains unapplied/unreleased. Diagnose the retained failing check and establish
   whether a supported-workflow failure remains before deciding its disposition; no closure or
   new supported defect is inferred from a failed check alone.
4. Separate pre-public requirements remain actual user-to-tenant authentication, deployed storage
   authorization/privacy, deployed-role equivalence and intended migration-runner certification.
   They require the corresponding environment/owner authorization, not another local pane test.

Approved SAS and flipped/separate-Codebook weight/MR exclusions remain in force. Full support is
backlog work. Five historical-definition gaps and named deferrable checks remain deferrable;
representative LibreOffice output is not certification of every Office version. Prior browser
PPTX and concurrent-limit failed invocations remain recorded separately from their successful
continuations/retries. Model spend remains US$3.817316 ofUS$10; no push/deployment or count changes.


## Canonical outstanding-register reconciliation — 2026-10-16

**Overall trust-hardening milestone: INCOMPLETE.** Pane commits7ec3f30/badcd13 were reviewed
independently; the storage-failure and separator-accessibility findings remain. Their review
does not independently review Codex's earlier repairs or close the canonical acceptance register.
The earlier wording “implementation milestone complete” described the delivered checkpoint and
self-validation only; it must not be used as the overall acceptance decision.

Reconciled all43 entries of the existing consolidated outstanding-work tables in place:10 recorded
defect findings,24 acceptance remainders,4 security/deployment entries and5 grouped deferrable/
design entries. These entries are **not** the canonical43 release rows: shared findings/tasks/gaps
use different grouping. The existing release-row partition12/18/2/5/6 and priorities34/9/0 remain
unchanged pending explicit row-level disposition. No replacement register or broad audit was added.

Retained evidence now replaces obsolete wholly-unexecuted claims for E1–E3/T1–T3/A1–A3,
scale/missing audit, correction clear/group, upload cleanup, instrument reread, document finding
identity, objective addition/legacy lifecycle, evaluator boundaries/recovery, business transitions
and native design/body handover. These are self-validation where Codex authored changes, and
individual controlled/real-provider/native/DB boundaries remain distinct. Evidence examples are
`repair7/scale-audit-reload.json`, `sav-audit-native.json`, `correction-clear-native.json`,
`upload-cleanup-native.json`, `instrument-reread-native.json`, `objective-lifecycle-native.json`,
`business-lifecycle-native.json`, `evaluator-stall-native.json`, `design-handover-native.json`,
`probe-b-download-retry.json`, plus strict gate logs and the retained source/test files. Failed
initial invocations remain failed; continuations establish only their explicit assertions.

Required next work, in bounded order:

1. Resolve the two pane findings and their focused regression criteria under explicit implementation
   ownership. Codex retains CODEX_WORKING; Claude has not been released.
2. Independent review of Codex-authored repairs and finite assertion-by-assertion disposition against
   the existing register, especially the two semantic rows and later guard/cache changes. Reuse
   unchanged independent evidence; do not treat805 tests as whole-row or module acceptance.
3. Complete specifically unestablished acceptance assertions: native OBJ-REV-004 accept/reject/
   reaccept/regenerate/exclusion agreement in both presentations; truthful durable native SAV/DTA
   status/recovery under IMP-018 (processing_status remains null); and any missing failure-to-native/
   output assertion under REV-012. Review must also resolve whether the retained exact-limit
   timeout leaves an IMP-017 stranded-work assertion unmet. This is not proof of a new product defect.
4. For other implemented remainders, check the named exact assertions in the canonical table before
   ordering further execution: native deletion-specific cleanup visibility, document-identity reload,
   evaluator uncertainty/complete finite expectation coverage, remaining decision own-delete/bulk
   callers, absent-download refusal, and shared support delete/replacement/duplicate consumers. These
   are scope/evidence questions to resolve, not claims all were missed or already closed.
5. Parked layout-loading package remains unapplied/unreleased: diagnose its retained failed check
   and determine supported-workflow impact/disposition separately from the pane component. No
   automatic reopening of prior IMP-014/Brief38 closures and no unreviewed TranscriptSetup change.
6. Before public release: the distinct authenticated tenant/storage/deployed-role/migration-runner
   gates in canonical section3, requiring their real environment and owner authorization.

Approved exclusions remain SAS and flipped/separate-Codebook weight/MR metadata, conditional on
visible refusal/recovery; full support is backlog. Deferrable IMP-010/M02/M04 and five historical
definitions retain their stated dispositions. Research Quality Review architecture-fit/design work
is separate and not a trust-repair prerequisite. Representative Office and brief/link limitations
remain explicit. Current review/reconciliation uses retained evidence only: no new application
execution, model call, resource, push, deployment or source repair.


## Continued engineering completion — 2026-10-16

Codex retained ownership and implemented the routine repairs directly; Grant did not have to
relay individual fixes. This update supersedes the prior pane/parked-fix and named native-gap
dispositions, while retaining all earlier passing and failed evidence.

Completed this continuation:

- Pane preferences now retain in-page state when storage reads or writes fail. Native blocked
  read/write tests cover collapse/expand, pointer/keyboard widths, mounted unfinished input and
  reload defaults. Normal persistence remains passing. ResizeObserver reports actual pane widths
  and effective grid-dependent separator bounds. Five native pane checks pass.
- The parked layout-loading issue was diagnosed, not assumed: held JavaScript left a visible,
  enabled layout select showing columns-as-cases while the database remained rows-as-cases. The
  inspected guard and shared useHydrated hook are now integrated. The fixed held-script native
  check passes save/reload recovery; two actual SSR checks cover raw and transcript choices.
  The old archive remains evidence, but its fix is no longer parked/unapplied. Its earlier test
  had an unsafe held-route release/unroute race; corrected handling does not explain every old
  failure or revoke earlier Brief38/IMP-014 closures.
- OBJ-REV-004 native execution reproduced overview action clicks selecting the row and replacing
  the overview/editor. Action cells now stop that propagation. Detail and overview transitions,
  edit/reaccept/reject/restore/regenerate/reload preserve wording, excluded/rejected suggestion
  and original brief. The retained portable `scripts/e2e/objective-review-acceptance.mjs` also
  passes on the same isolated source. Earlier timeout/hidden-locator attempts stay failed.
- Native delete/storage failure leaves discoverable pending cleanup after reload; a failed retry
  stays actionable; corrected storage clears the intent once and after reload. Combined with
  prior upload/DB/storage/trace/concurrency evidence, no extra native deletion execution gap is
  asserted. This remains local storage recovery evidence, not deployed authorization.
- SAV/DTA malformed-file errors are explicitly visible after reload, no partial table is published,
  and supported delete/corrected reupload recovers calculation without the error. Original valid
  SAV pass plus the final three-case continuation establish the bounded matrix. Raw-file readiness
  uses parser/UI states rather than the report-processing column; its null value is not a new
  data-loss defect or a ready/failed certification. The first count-timeout and interrupted second
  invocation remain separate. Deletion recovery now waits for reloaded UI before adapter counts.

Evidence: `scripts/workflow-tenant-review/completion/` holds pane-browser.log (5 passes),
hydration-diagnosis.json (pre-repair mismatch), hydration-browser.log (1 pass),
setup-guard-ssr-retry.log (2 passes), objective-review-native.json and
objective-retained-regression.log (3 native groups each), delete-cleanup-native.json (2 groups),
native-formats-attempt1.json plus native-formats.json, and final-runtime-sources.json. All8
changed source/check files match the tested isolated copy. The unrelated development server on
port3000 was not used or stopped.

Final strict validation:108 files/807 passes/33 explicit skips, full-project typecheck; required
actual PostgreSQL/Python suites ran with no NOT RUN placeholders. Earlier focused SSR alias
configuration failure was corrected and retained separately. Full build/cleanup/checkpoint
accounting follows below. No new model/provider calls; spend remains US$3.817316 ofUS$10.

Overall trust-hardening acceptance is still incomplete for a concrete reason: the changes authored
by Codex require independent assessment and row-level disposition. Codex can implement and
self-validate them but cannot supply independent review of its own changes. The corresponding
closing assertions are now in the existing canonical register; repeated whole matrices are not
required merely because ownership changes. Other external prerequisites remain deployed trusted
user-to-tenant identity, storage/privacy/signed-link policy, final deployed role/schema boundary
and intended migration/backup runner certification. They require the actual environment/owner
authorization, not another local browser run.

For independent disposition, reuse actual document chart/status DB reload checks, degraded
permission-failure save/reload plus actual DOCX qualification, finite evaluator/base/stance cases,
business transition/failed-refresh evidence and affected download failure/retry evidence. Only
specifically unestablished assertions should trigger further bounded execution or repair; do not
introduce new native permutations without a requirement. Retained exact-limit timeout remains
unexplained and must not be called green; separate successful bounded retries remain valid.
Deferrable preview/marker/load-error and historical-definition gaps remain explicitly deferred;
approved SAS and flipped/separate-Codebook weight/MR exclusions remain conditional and in force.


### Final source verification and cleanup

The final bounds correction shares pixel-rounded limits between interaction and ARIA, scales
minimum widths down when the container cannot fit them, and clamps both normal and wideRight
default right panes to half the container. Six exact-component/compiled-CSS geometry checks pass
for normal/wideRight at1200/700/400px. The initial floor-versus-rendered-pixel mismatch remains
retained as a failed invocation. The five native route checks preceded this final narrow-container
extension; the enhanced native test was not rerun after it. Final exact-source strict validation
again passes108 files/807 tests/33 explicit skips, with all required PostgreSQL/Python suites run;
final production build passes. Logs: completion/validate-final-bounds.log and build-final-bounds.log.

All8 changed source/check hashes match the isolated tested copy. Nine referenced storage objects
and the password-free disposable cluster dump were retained locally before shutdown. The verified
labelled trust-completion-20261016 container and its local-stack parent were stopped; reserved
ports3228/62190/62191/55512/55017 have no listeners. The unrelated development server on3000 was
left untouched. Generated builds, database/storage copies, logs and historical untracked evidence
are excluded from the checkpoint; the authoritative lockfile is unchanged.

Claude's released pane instruction was not fulfilled in every respect: the claimed current-page
fallback under blocked storage was absent, separator semantics were inaccurate, and the standing
requirement to update affected claude/*.md engineering documentation was omitted. These are
implementation/documentation omissions, distinct from the disclosed real-tablet and individual
screen testing limits. The new focused pane brief and self-validated repairs address them; they
still need independent assessment. The separately parked setup-loading fix has now been diagnosed
and integrated, as recorded above; its full failed-invocation history remains retained.


Application checkpoint: `be625c7711970516e4866c21109164c479cab767` on `checkpoint/trust-hardening-20261016`.
The subsequent documentation-only checkpoint explicitly releases ownership to Claude in
[agent-handoff.md](agent-handoff.md), with completed work, released files and remaining required
review/acceptance/environment tasks. Codex has stopped editing; no implicit transfer. Overall
trust-hardening acceptance remains incomplete pending that independent disposition.

## Claude independent acceptance and close-out — 2026-10-16 (night)

Claude owned the c07eea8 / be625c7 release and recorded every canonical row's evidence level and
disposition in [independent-acceptance-disposition-2026-10-16.md](independent-acceptance-disposition-2026-10-16.md).
The 43-row partition (12/18/2/5/6) is unchanged; promotions are proposed there for owner decision.

Independently executed on c07eea8: typecheck pass; 108 files / 807 passed / 33 skipped (real
PostgreSQL and Python); 6 UI checks, golden-thread smoke 1, adapter readiness 2 (after correcting
Claude's own A1 check), retained objective-review script 3/3 on its second invocation (first
invocation failed on a 5 s visibility wait on a cold stack; retained as failed). Production build
not re-run here (Google Fonts unreachable). After the repairs below: typecheck pass, 110 files /
817 passed / 0 failed / 34 skipped, 7 UI checks, smoke 1, adapter 2, objective script 3/3.

Reproduced and repaired (Claude-authored, need independent review):
- Regeneration re-inserted wording the researcher had rejected: objectives as a pending duplicate;
  decisions as accepted, re-entering the decision statement. Shared rule
  `src/lib/candidateSuggestionFilter.ts`; real-DB tests `objectiveDecisionClosure.db.test.ts`.
- The flipped-workbook guard refusal was repeated per variable and framed as an SPSS/Stata/SAS read
  failure. One file-level notice, format-neutral engine error prefix; native
  `e2e/ui/flipped-codebook-guard.check.mjs`.
- New closing tests without source change: `objectiveEvidenceClosure.db.test.ts` (REV-006 selector
  persistence/reload, REV-007 stale retry and transaction rollback) and SET-002 refresh-failure
  retry plus decision-statement exclusion.

Remaining concrete failures and unestablished assertions: IMP-017 first v12 concurrent invocation
(documentless upload returned 200; outcome unexplained) stays failed; Probe B browser PPTX timeout
stays failed; ANA-NPS-003 design-triggered native handover not established; Task D absent-download
and retried-content assertions missing; OBJ-REV-005 stored qualification for unsupported uncertainty
untested; OBJ-REV-006 stores the answer label, not the raw code; IMP-010 neither checked nor
documented. Exclusions (SAS; flipped workbook with separate Codebook weight/MR), deferrables,
historical-definition gaps and the public-release security/deployment gates are unchanged.
No push, deployment, live/development change or model call; spend US$3.817316 of US$10.


## Codex laptop independent review ? 2026-10-16

Laptop9ab38eb / repair5008041 reviewed read-only; all13 released paths match the isolated copy
(LF normalised, one documented Python-executable adaptation only). Full row dispositions and
limits: appended Codex review in independent-acceptance-disposition-2026-10-16.md.

Released regression suites pass13/1inactive skip on actual disposable PostgreSQL. Native guard
passes after python3-to-python isolated harness adaptation; original tooling failure retained.
Independent Net/member and ambiguous-design persisted/reloaded qualification probes pass. Stored
multiplicity qualification is absent, but the global UI already discloses unadjusted intervals;
resolve the exact durable/output contract rather than claiming no user-facing qualification.

Repair5008041 is NOT fully accepted: SQL trim versus JavaScript trim in the shared suggestion
filter still resurrects rejected tab-terminated model wording. Actual objective and decision probes
reproduce it; the new decision copy is accepted. Ordinary-space passes remain valid. Fix under
existing OBJ-REV-004/business remainder; no new row, source edit or speculative performance claim.

Fresh native current-before preconditions, actual null-to-Gender PSU save, unaffected source control,
reload and retained DOCX/PPTX establish representative design propagation. Synthetic accepted
support fixtures/replay limit the conclusion. Setup/hidden-locator failures remain failed;
same-project continuation passes. Task D now verifies no download through HTTP500 plus1.2s and
parses the actual retried workbook for expected content.

IMP-017 forensics finds retained upload_error trace27 (fetch failed) for the documentless v12 run,
correcting "logged no error". No document/pending cleanup at retention; failed-page UI/response
body/exhaustive storage listing remain unavailable. Failed invocation stays failed; separate
concurrent pass preserved. Raw-code identity, durable qualification and named saved-content/native
boundaries remain unresolved as recorded. Deferrables, exclusions and43-row partition unchanged.

Local evidence: scripts/workflow-tenant-review/laptop-review/. Six referenced synthetic storage
objects and password-free cluster dump retained before shutdown. Verified owned process tree and
labelled codex-acceptance-20261016 container stopped; ports3231/51834/51835/55513 clear. User/development
processes and existing Supabase containers untouched. No paid calls, push or deployment.
Spend unchangedUS$3.817316 ofUS$10. Claude is explicitly released in agent-handoff.md for the shared
identity repair and named bounded acceptance work. Overall acceptance remains incomplete. The
formerly parked setup-loading guard remains integrated; earlier passes are preserved.

## Claude shared-identity release: affected-file extension (2026-10-16, evening)

Before editing outside the released implementation files, Claude records this extension for the named remainders only:
- `src/lib/evidenceStance.ts` (OBJ-REV-006 raw selector identity): persist the read row's question key and raw code and each banner column's variable and raw code in the saved estimate (JSONB; no migration). Display wording unchanged. Test: `src/lib/__tests__/evidenceIdentity.test.ts` plus the existing closure test.
- `src/lib/objectiveValidator.ts` (OBJ-REV-005 durable multiplicity qualification): a conclusion for an item that carried direct data evidence keeps a fixed qualification that the intervals are not corrected for the number of questions checked, so it reaches the app and both story exports. Earlier saved conclusions are unchanged until regenerated.
No dependency, migration, broad refactor or new feature.

## Claude shared-identity repairs complete (2026-10-16, evening)

Commit `34cb123` (15 paths) over `ff4d8af`. Results and dispositions: [independent-acceptance-disposition-2026-10-16.md](independent-acceptance-disposition-2026-10-16.md) (section "Claude repairs after Codex review"). Full suite 113 files / 825 passed / 0 failed / 36 skipped; 11 UI checks, smoke 1, adapter 2 and objective script 3/3 on a fresh stack. One adapter/objective invocation failed when the cloud container killed the dev server for memory; retained. Partition unchanged; acceptance incomplete. State READY_FOR_CODEX for independent review.



## Codex review34cb123 at laptopf873608 ?2026-10-16

Confirmed source HEADf8736084f83e274741d3cdff0d120ac7c0cb8a0a and repair34cb1232e41539d237597380b7400e39b1fb5d8a.
Application source stayed read-only; all15 released paths match isolated tested bytes after LF
normalisation/two documented harness Python-executable adaptations. Full latest row dispositions:
appended Codex review34 section in independent-acceptance-disposition-2026-10-16.md.

Independent affected gate:10files/65passed/4inactive skips, actual PostgreSQL. Additional real-digest
qualification test1pass/1inactive skip. Native5/5: workbook recovery, current-source Setup/Review
identity, golden saved figures/reload, conflicting labels/counts/reload, upload failure before/after
storage and complete-inventory cleanup plus healthy retry. Prior full825/36/build limitations are
retained scopes, not rerun claims. Earlier failed invocations remain failed; cloud memory cause is
implementer-reported, not independently reconstructed here. No new paid calls/spend.

Whitespace normalization, optional raw identity persistence, new-conclusion multiplicity and
conflicting duplicate refusal are independently verified at their declared scopes. Actual DOCX/PPTX
transport preserves both the full multiplicity note and degradation warning. Legacy results require
regeneration; no retrospective backfill or new statistical adjustment is claimed.

Four smaller limits assessed separately:
- OBJ-REV-004 direct overview Accept/durable status and accepted overview/detail label/control
  comparison now pass natively; earlier state-transition evidence preserved.
- IMP-005 group-correction calculation remains unverified beyond dictionary/clear. Imported Codebook
  MR recovery is not that researcher-correction assertion. No new numerical defect claimed.
- OBJ-REV-012 PPTX qualification passes, but native Review Objectives coverage drops the persisted
  true degradation flag: normal Partly answered conclusion with no warning. Actual UI reproduction,
  source inspection and post-failure DB flag confirmation establish a required repair under this row.
  This is not introduced by34cb123. The failed badge invocation is retained separately from passing
  same-project exports; seeded flag and actual nonowner failure generation are distinct evidence.
- OBJ-REV-013 computed native retry remains unexecuted. DB mixed-write/retry and native planner-
  refusal recovery passes remain valid but do not prove a computed native recovery.

Owner release in agent-handoff.md is explicit: Claude may repair ObjectiveCoverage's missing warning
and continue only named bounded assertions. Overall acceptance is incomplete and43-row12/18/2/5/6
counts unchanged. Earlier closed/deferred rows, conditional exclusions and deployed security/process
gates remain explicit; Research Quality Review is design-only.

Evidence retained under scripts/workflow-tenant-review/review34/: logs, hashes, actual exports,
failing native badge text/JSON and confirmed durable flag, full4-object synthetic storage inventory
and password-free cluster dump. Verified owned review34 processes/labelled cluster stopped; reserved
ports clear. Existing user/development resources untouched. No push/deployment or source patch.

## Claude OBJ-REV-012 coverage release: affected-file extension (2026-10-16, evening)

Recorded before applying to this checkout: `scripts/e2e/model-replay.mjs` (disposable e2e tooling, outside the released files) gains one fixture rule, `untargeted`, so a native check can script the crosstab planner's `submit_plan` call. Without it the OBJ-REV-013 retry can only end uncomputed. Existing replay answers and the log's `scripted` field are unchanged; fixture answers are marked `fromFixture`. The change was made and tested in the isolated cloud copy first.

## Claude OBJ-REV-012 coverage release complete (2026-10-16, evening)

Commit `7a6ab5d` (7 paths) over `4ba581d`. Results: the "Claude OBJ-REV-012 coverage repair and native remainders" section of the disposition record. Full suite 114 / 827 passed / 0 failed / 36 skipped; 14 UI checks, smoke, adapter 2 and objective script 3/3 pass. Partition unchanged; acceptance incomplete. State READY_FOR_CODEX.


## Claude overnight close-out complete (2026-10-16, night)

Under Grant's 19:46 SAST instruction. Commits over `48d76bc`: `a00dc0c` (13 paths), `d72b150` (6), `110183a` (11), `d5cbc6f` (5, harness and docs only), plus the following docs-only commit. All local and unpushed; committed bytes match the tested bytes after LF normalisation.

Final-tree gate: typecheck pass; full suite 116 files, 833 passed, 0 failed, 37 skipped; production build pass; 22 app browser checks, smoke 1, adapter 2 and objective script 3/3 pass against a production server. Lint: the 6 known `set-state-in-effect` errors remain (owner decision). Results, failed invocations and the 43-row overnight disposition: section "Claude overnight close-out" of the disposition record. Partition unchanged; overall acceptance incomplete and not claimed.

Affected-file extension used tonight (recorded here because it reaches outside the coverage release): the researcher-control failure repair touches `runContextActions.ts`, `StatedObjectivesList.tsx`, `useObjectiveRowActions.ts`, `ObjectiveReviewTable.tsx`, `ObjectivesWorkspace.tsx`, `ObjectiveEvidence.tsx`, `DecisionBriefReview.tsx`, `RecommendationsReview.tsx`, `SynthesizedRecommendationsReview.tsx`, and adds `actionFailure.ts` and `runs/[id]/error.tsx`. Lint-only edits: `TranscriptSetup.tsx`, `CodingProgressBar.tsx`, `AcrossTranscripts.tsx`, `CrosstabOptions.tsx`, `knowledge/content/import.tsx`, `driverAnalysis.ts`. No dependency, migration or schema change.

Disposable resources stopped by PID; no `ie_e2e_*` database or role remains. No push, deployment, live or development change, or model call; spend unchanged at US$3.817316.

## Codex overnight independent review complete — 2026-10-16

Reviewed laptop 0b7fb30 and the released overnight commits, application source read-only. Executed targeted suites: 80 passes / 5 explicit skips; 13 native passes. Exact affected-row dispositions, controlled boundaries and remaining limits are in the latest Codex addendum of independent-acceptance-disposition-2026-10-16.md. Coverage warning, effective group calculation/clear/reload, computed persistence retry and refused-save draft preservation independently pass. Saved reference content, conflict-label Excel/reload, SAV/DTA recovery, marker/regeneration and local upload failure/retry independently pass.

Two bounded observations: the production raw-file check's stable id/created_at/count cannot prove no reparse because extraction upserts in place (dev named-action absence is separately observed); unqualified toLocaleDateString causes an actual server/browser locale hydration mismatch. No incorrect statistic or lost human work is demonstrated by that mismatch. Exact remaining proof/closure criteria are recorded. Original IMP-017 v12 and Probe B browser failures, HTTP continuations, unexecuted failed-round/guard and trimmed-wide branches, policy decisions, exclusions, deferrals and security/deployment prerequisites preserved. Counts remain12/18/2/5/6=43; overall acceptance incomplete.

Eleven full synthetic objects/checksums, password-free dump and logs retained in scripts/workflow-tenant-review/overnight-codex/. Verified owned process tree and labelled cluster stopped; reserved listeners clear. No paid model call, application edit, author/history rewrite, push or deployment. Codex releases the bounded follow-up to Claude; see authoritative handoff.

## Claude bounded follow-up complete (2026-10-16, night)

Commit `5f63038` (9 paths) over `434924b`, plus the following docs-only commit. Local and unpushed; committed bytes match the tested bytes after LF normalisation. Results, reproductions, failed invocations and proposed dispositions: the "Claude bounded follow-up" section of the disposition record.

Affected files beyond the three released ones, stated here for review. They were made and tested in the isolated cloud copy and were recorded here only at this docs commit, not before they were applied: `src/lib/displayDate.ts` (new; the authoritative date rule TranscriptSetup now uses), `src/lib/__tests__/setupHydrationGuard.test.tsx` (maps the new module), `scripts/e2e/local-stack.mjs` (disposable `/__reads` download count) and the new checks `upload-date-hydration` and `evidence-round-failures`. No dependency, migration or schema change.

Gate: tsc pass; vitest 117 files / 837 passed / 0 failed / 37 skipped; production build pass; browser checks 23 of 24 passed (intermittent `data-setup-hydration` failure, then 3 of 3 alone); smoke 1, adapter 2, objective script passed. Disposable resources stopped by PID; no `ie_e2e_*` database or role remains. No push, deployment, live or development change, model call or history rewrite. Partition unchanged; overall acceptance incomplete.


## Codex bounded follow-up review - 2026-10-17

Independently reviewed a25020f / repair 5f63038; all nine released paths match the commit after CRLF normalisation. Application source remains read-only. Focused unit checks 10/10, changed-module lint and isolated production build/TypeScript pass. Production native primary run: 6 passes/1 failed unchanged hydration harness; separate readiness-aware continuation: 1 pass. Exact results and affected-row dispositions are in the latest Codex addendum of independent-acceptance-disposition-2026-10-16.md.

Production no-reparse proof now passes with download counts/xmin and a layout-change positive control. Deterministic upload date and returned/dropped evaluation failure, exactly 60-round guard and real load-permission refusal/recovery pass. Existing computed persistence retry and refused evidence edit pass. Three concurrent exact-limit pairs complete 6/6 in 4-6 seconds per pair; a separate DB re-query retains 100,000cases each after native reload. Original v12 failure/cause remain historical and unproven; no hosted capacity claim.

The unchanged data-setup-hydration helper's isVisible returned false immediately after navigation, so it skipped the Import click and timed out waiting for the upload input before reaching hydration assertions. Failed trace/context/screenshot retained; the separately labelled continuation waits for the panel, then passes the original held-script and save/reload assertions. Permanent harness readiness is the sole bounded Claude follow-up from this review. Engineering brief corrected after independent execution; no new application fix requested.

Twelve complete synthetic objects/hashes, counters, password-free database dump and logs retained in scripts/workflow-tenant-review/followup-20261017/. Owned PID tree/labelled database stopped; reserved listeners clear; development services untouched. No paid calls, push, deployment or author/history rewrite. Handoff explicitly releases ownership to Claude. Partition 12/18/2/5/6=43 and overall acceptance remains incomplete; prior closures, failures, exclusions, deferrals, owner decisions and security/deployment gates preserved.

## Claude hydration-check readiness fix complete (2026-10-17)

Commit `40198b0` (1 path, `e2e/ui/data-setup-hydration.check.mjs`) over `3753371`, plus the following docs-only commit. Local and unpushed. Reproduced first with the previous helper, then fixed; 5 of 5 passes on the production server. Details: the "Claude readiness fix for the hydration check" section of the disposition record. No application change; partition unchanged; overall acceptance incomplete.


## All43-row independent reconciliation - 2026-10-17

Reviewed HEAD460815c and readiness repair40198b0. The old helper independently fails under delayed scripts at the original upload-input step; the new permanent check and delayed-script comparison both pass with original assertions unchanged. This closes the test defect only. No application row is promoted because of this harness fix.

Every canonical row is individually disposed in the latest independent-acceptance-disposition-2026-10-16.md and updated finite checklist. Current partition: **33 Closed /4 Implemented awaiting verification /0 Confirmed defect /0 Untested requirement /6 Blocked =43**, priorities34/9/0. The original12closures remain;21 further finite criteria close on matching independent original-regression/acceptance evidence, not suite totals. IDs, requirements, priorities and frozen criteria are unchanged. Previous canonical preserved byte-for-byte as v26; verification metadata is in scripts/workflow-tenant-review/reconcile-20261017/canonical-reconciliation-check.json.

Remaining technical rows: IMP-004 saved zero/missing-audit values and separate scale policy; IMP-017 independent native one-over boundary/reload/corrected retry; business native own-delete/bulk and broader post-commit refresh reconciliation; FND named generator and replacement/duplicate consumer assertions. Six blocked rows are deployed security plus five historical-definition gaps. Missing evidence is not a new defect. No overall, module or public-release acceptance is inferred.

Executed current targeted evidence: row regressions45 passes/9 skipped; mechanism run12 passes/1 cache runner timeout/5 skipped; separate unchanged cache continuation4 passes/1 skipped with60-second allowance. Actual Python/DB edit races and exact original two-channel selector persistence controls pass. Native old-helper control fails as expected; fixed readiness two cases pass; objective detail/overview assertions pass3/3, with usable generation supplied by its separately retained relevant native proof. All failed invocations remain failed. Application source matches the prior independently built snapshot across521 paths; no build or full837-suite rerun claimed.

Two complete synthetic objects/hashes, password-free UTF-8 cluster dump, old failing trace, reports, source comparisons and logs retained locally. Verified own PID tree and labelled codex-reconcile-20261017 cluster stopped; owned listeners clear, user/development services untouched. No application edit, paid model call, push, deployment or author/history rewrite. Handoff releases only the four named bounded verification remainders, with repair only on a concrete failure and independent verification before any subsequent bug closure.

## Claude four-remainder package complete (2026-10-17)

Commit `091663e` (18 paths) over `b5992da`, plus the following docs-only commit. Local and unpushed. Affected source boundaries were recorded in the handoff before the package was applied to this checkout. Gate: tsc pass; vitest 121 files / 860 passed / 0 failed / 39 skipped; production build pass; 28 of 28 browser checks, smoke 1, adapter 2, objective script passed. Details: "Claude work package for the four released remainders" in the disposition record. Partition unchanged until Codex's review; overall acceptance incomplete.
