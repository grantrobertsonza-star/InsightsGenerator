# Technical release acceptance baseline ? 2026-10-15

Canonical finite release baseline:43 existing rows. This is technical functionality consolidation,
not public-release authorization or an unrestricted audit. The previous document is retained byte-for-byte
as [v24](technical-release-acceptance-baseline-2026-10-15.v24.md); earlier evidence/history remains local.

Current outstanding work is reconciled in [the consolidated register below](#consolidated-outstanding-work--2026-10-16). Older statements about pending banners, keys, tooling and repaired mechanisms are historical where superseded there.

## Current decision and evidence

- [Resumed golden-thread walkthrough](golden-thread-walkthrough-2026-10-15.md), unchanged checkpoint3c29e02: real model-backed narrative exports and independent A/C probes executed. Concrete lookup and handover/verdict failures recorded under existing identities; B remains blocked without a supported finding-body editor. Prior closures preserved.

**12 Closed /18 Implemented awaiting verification /2 Confirmed defect /5 Untested requirement /
6 Blocked =43.** Priority is independent:34 release-priority (33 technical + separate security1),
9 important but deferrable,0 optional. Verification work is not a count of repairs.

- [P2a combined repair/verification](p2a-repair-closure-2026-10-15.md): all three repairs pass;
  full-project typecheck and552 retained tests pass,1 existing skip. Three affected real PostgreSQL/
  storage cases and native cached-preview/correction/calculation/reload pass. IMP-002/003 close;
  IMP-005 picker subcase closes while broader correction invalidation remains required verification.
- [Rule B](rule-b-g5-browser-closure-2026-10-15.md): agreed recovered OBJ-REV-001/002 code,
  four PostgreSQL gates and native browser/recovery gate closed. Distinct historical REV-002
  definition remains unavailable; do not infer another issue from its ID.
- [REP-IN-002](rep-in-002-final-verification-2026-10-15.md): application closure, two14-group
  PostgreSQL passes/replay and final12 browser/storage/native/downstream/dashboard/theme groups preserved.
- OBJ-REV-009: independent48-test snapshot,13-group PostgreSQL closure and successful replay
  preserved with their recorded source hashes and deployment-role/framework/browser limitations.
  DEC-001 remains code-level closed; [OBJ-REV-011](objective-addition-error-verification-2026-10-15.md)
  error mapping, [Brief38](brief-38-verification-2026-10-15.md), IMP-004 and M02 passing subcases preserved.
- Older E1?E23 labels in row evidence refer to the retained previous baseline and linked reports.
  Historical failures remain evidence, superseded by named passing repairs; no completed gate reopened.

Evidence levels matter: Closed means the agreed finite scope/evidence level stated in that row,
not its entire module. Implementation claims differ from executed checks. Unknown historical
requirements stay evidence gaps. Only a concrete material supported-workflow failure adds a blocker
under an existing identity where possible; explain the consequence, smallest fix and closing test.
Routine repairs within the agreed contract proceed without repeated planning approvals.

## Consolidated outstanding work — 2026-10-16

**This is the current outstanding-work register within the canonical baseline.** The dated narrative updates below are history where superseded. This reconciliation reads the baseline and completed reviews only; no tests, application inspection, runtime or model calls. It introduces no new issue IDs, release rows or closure claims. The 43-row partition remains **12 Closed /18 Implemented awaiting verification /2 Confirmed defect /5 Untested requirement /6 Blocked**; priorities34/9/0. Detailed findings under shared rows are not additional counted rows.

Latest authorities: [workflow/tenant review](workflow-tenant-staged-review-2026-10-16.md) (WT), [engine review](staged-engine-identity-review-2026-10-16.md) (EI), [exportfix64](exportfix64-consolidated-review-2026-10-16.md) (EX), [stable77](repair6-consolidated-review-2026-10-16.md) (R77), [final68](trust-final68-review-2026-10-16.md) (F68). E/T/A coverage means the existing [closing checklist](../scripts/workflow-tenant-review/repair-closing-checklist.md); these are test labels, **not new defect IDs**. Owners below distinguish implementation (Claude), independent verification (Codex), and release/deployment decisions (Grant). Assignment does not authorise execution or deployment.

**Codex integration milestone:** Repair7 is integrated after matching27 released base/archive hashes. Claude remains paused; implementation ownership labels below are superseded by [the explicit handoff](agent-handoff.md). Codex follow-up fixes are **self-validation**, not independent closure. [Shared status](current-engineering-status.md) records799passed/33skipped, final build, native replay/downloads, upload cleanup fault/retry, objective/business transitions and representative body/design handovers. Approved scope is20,000,000bytes and100,000cases/file; exact/one-over/recovery and two concurrent native exact-limit imports pass. SAS is excluded pending verification. The43-row partition remains unchanged pending required independent evidence/disposition; historical failed invocations are retained.

### 1. Demonstrated defects requiring repair

| Existing ID / recorded finding | Latest evidence and current scope | Owner | Exact closure condition | E/T/A |
|---|---|---|---|---|
| FND-001 / REP-OUT-001: wrong-group numerical grounding | EX actual validator/generator saves customers' NPS25 from surveyed leaders' NPS25 as traced; WT changes no relevant safeguard. Original sign reversal and invented ±15/scales reproductions are superseded by narrower passes. | Claude repair; Codex verify | The retained wrong-group draft is refused or explicitly requires semantic review, never fully traced; preserve correct exact/rounded claims and refusal of invented ranges. Exercise actual generator persistence/retry, not prompt inspection alone. | No; preserved separate semantic case |
| OBJ-REV-006, overlapping OBJ-REV-005: arbitrary response meaning | EX coherent two-channel fixture: both groups buy100%, but online60/40 becomes computed/supports for overall buying. Original canonical Gender/Purchase reachability and original Yes60/40 case pass in R77; EX's later real clear-selector attempt safely refuses rather than completes. | Claude repair; Codex verify | Unnamed ambiguous response requires researcher resolution or visible semantic-review qualification even for two valid rows; actual unambiguous Yes/No resolves intended meaning; missing/ambiguous paths remain fail-closed. Preserve original case pass and distinguish controlled enforcement from real-model judgement. | No; preserved separate selector case |
| IMP-009; compatibility with the closed IMP-002 scope: unsigned flip regression | EI actual candidate wraps exact CSV9223372036854775808/9 negative; WT repeats identical engine bytes. This does not revoke earlier frozen P2a parser closure. | Claude repair; Codex verify | Exact identity survives both orientations, or unsupported conversion visibly refuses before publication; signed/unsigned boundary and missing-value cases pass without float precision loss or category merging. | E1 |
| IMP-009: literal flipped ID preservation | EI actual candidate trims `" 001 "`; WT candidate unchanged. | Claude repair; Codex verify | Exact literal IDs remain distinct in CSV/XLSX and both layouts, including spaced/unspaced collisions, long text and missing controls. Disclose formatting-only Excel limitations separately. | E2 |
| IMP-009 / IMP-005 cache-upgrade dependency | EI actual loader reuses pre-fix version7 numeric-ID dictionary with zero engine calls; WT repeats unchanged engine/cache versions. | Claude repair; Codex verify | Actual upgrade invalidates/recomputes old typing while retaining researcher corrections and human work; failure is actionable and preserves safe prior state; retry/reload recover. | E3 |
| IMP-001 / IMP-016: tenant-registry writes | WT actual fresh setup-created role with A context updates B's unprotected `tenants` row; rollback retained. More than the earlier disclosed name-read limitation. | Claude repair; Codex verify disposable; Grant deployment owner | Declared registry read/write boundary prevents foreign disclosure/mutation and unauthorised provisioning; own-tenant and administrative paths behave as documented; no-context and reuse tests pass. | T1 |
| IMP-001 / IMP-016: inherited ownership / role repair | WT setup rerun says ready despite inherited owner membership; A-scoped query sees both tenants. Explicit SET ROLE boundary is prepared, not yet executed. | Claude repair; Codex verify disposable; Grant deployment owner | Unsafe direct/transitive inheritance and SET ROLE paths are refused or explicitly reconciled in setup; a ready role cannot bypass filtering. Fresh safe role, harmless membership, rerun and connection recovery pass. | T2 |
| Unassigned existing backup package finding (no standalone ID; related IMP-001/016) | WT actual `resolveAdminUrl` accepts explicit restricted DATABASE_ADMIN_URL without checking privileges. Fallback refusal passes. No real backup was run. | Claude repair; Codex verify | Validate whichever connection is selected; explicit/fallback restricted roles refuse before dump/count dispatch, safe admin controls succeed, missing/unreachable privilege checks fail safely without fallback substitution. | T3 |
| Unassigned existing adapter finding: continuous mean table identity | WT app displays6.5, but adapter selects nested descriptive-statistics table and rejects its missing Measure header. This is not a numerical-engine defect. | Claude adapter repair; Codex verify | Adapter reads the canonical main mean table with nested tables present; verifies identity/schema and fails visibly if ambiguous; independent6.5 expectation unchanged. | A1 |
| Unassigned existing adapter finding: counted navigation | EX and WT require temporary whitespace correction for Analytics1. Other app behaviour is not implicated. | Claude adapter repair; Codex verify | Unmodified adapter selects intended section for bare, adjacent-count and spaced-count names, and rejects similarly prefixed unrelated names. | A2 |

### 2. Required acceptance checks not yet completed

Missing evidence below is not a demonstrated defect. Earlier passes are retained; only each stated remainder is outstanding.

| Existing ID / requirement | Latest retained evidence | Owner | Exact remaining closure condition | E/T/A |
|---|---|---|---|---|
| IMP-004: scale/missing audit | Baseline engine/TS checks; walkthrough Codebook/NPS/MR; EX/WT asymmetric favourable30/zero3 controls pass. | Codex verify; Claude only on failure | Complete declared scale/top-box and missing-audit native save/reload contract across labelled/unlabelled/sparse cases; do not rerun already closed MR base subcase. | E1/E2 affected code controls only; not full criterion |
| IMP-005: correction remainder | P2a picker/canonical calculation; native A/C qualification and WT discrete→continuous/reload pass. Original unqualified probe C is superseded. | Codex verify; Claude only on failure | Remaining save/clear/group correction cases preserve one effective meaning and human work; shared support tests count once under FND. | E3; other correction cases outside checklist |
| IMP-007: upload/delete recovery | Repair7 Codex self-validation reproduced deletion plus storage/trace failure leaving an untracked orphan. Transactional cleanup intent and Import retry implemented; real-DB combined-fault/pending/retry/wrong-run controls pass. Storage remains controlled; new retry UI and upload→DB remainder need verification. | Codex owns repair/verification | Complete upload→DB fault/recovery and native deletion retry visibility; preserve transactional pending record and evidence on intent-write failure. | No |
| IMP-009: full layout completion | WT native layout/accept/reload, type correction and weighted subgroup passes; engine defects above remain. | Claude repair/prerequisite; Codex verify | After E1–E3, preview/dictionary/calculation/driver requests share canonical orientation; establish supported separate-Codebook route or visibly qualify unsupported combination. No control-dataset substitution. | E1–E3; full workflow beyond them |
| IMP-012: instrument reread | Controlled partial-preservation cases and six durable original links pass; complete native/DB reread lifecycle not closed. | Codex verify; Claude on failure | Complete→partial reread preserves confirmed IDs/links; coverage/reload truthful; retry does not duplicate. | No |
| IMP-013: document/wave finding identity | Historical implementation claim; MR evidence explicitly does not establish this criterion; wave/CSM controls are narrower. | Codex verify; Claude on failure | Same q1 across three documents yields separate traceable findings; remove/revive one without changing others through actual caller/persistence/reload. | No; rerun affected wave controls only if normalisation changes |
| IMP-015: label-conflict native gate | Actual Python conflict/codebook/cache and controlled notice passes; native conflicting-workbook chain not completed. | Codex verify; Claude on failure | Native upload shows raw identity/all competing labels and recovery path; table/export/reload cannot silently choose a conflicting definition; unmatched names diagnosed. Corrected workbook reupload resolves visibly. | No |
| IMP-017: supported resource limits | Baseline requirement untested; no measured performance defect. | Grant declare supported limit; Codex verify; Claude on failure | At supported limit, one over-limit and bounded concurrent case: truthful recoverable result/status, no silent truncation or stranded work. Optimisation is not presumed necessary. | No |
| IMP-018: advertised native formats | Valid/malformed SAV/DTA/SAS native status/provenance matrix unexecuted. | Grant scope decision; Codex verify; Claude on failure | Each advertised format has valid+truncated/malformed import/reload pass, or unsupported paths are explicitly excluded from release claims. | No |
| OBJ-SET-001 | Shared matching implementation; cross-module identity/reload not complete. | Codex verify; Claude on failure | Edit Setup→Review, delete Review, reload both: same logical row/current text and untouched original brief. | No |
| OBJ-SET-002 | Twelve controlled addition/fallback/rollback cases pass; real DB race/fallback pending. | Codex verify; Claude on failure | Duplicate/concurrent additions leave one candidate; actual missing-index/savepoint path recovers or visibly refuses unsupported schema; retry safe. Preserve REV-009 closure. | No |
| OBJ-SET-003 | Seed/savepoint implementation inspected; legacy/Setup-only lifecycle pending. | Codex verify; Claude on failure | A→B→C→regenerate and delete→regenerate never resurrect superseded wording; original brief preserved. | No |
| OBJ-REV-004 | Predicates inspected; DEC-001 remains separately closed. | Codex verify; Claude on failure | Accept/reject/edit/reaccept/regenerate/reload agree in both presentations and preserve researcher decisions/exclusions. | No |
| OBJ-REV-005 / ANA-XTAB-001 dependency | Mean/percent/base subcases and Task B weighted values pass; full finite expectation contract not closed. | Codex verify; Claude on failure | Total-column, mean/percent, base29/30, equality and mixed stance persist correctly; unsupported uncertainty qualified. Count selector root above once. | A1 adapter mean only; not full criterion |
| OBJ-REV-007 | Revision/row-lock/had_table code and no-op subcases; not covered by REV-009 integration. | Codex verify; Claude on failure | Both edit/evaluate orders, rollback/no-op/deletion preserve current wording/result identity; deleted table visibly stale and retryable. | No |
| OBJ-REV-008 | R77 incomplete9/10 validation response visibly rejected; other index boundaries not all independently closed. | Codex verify; Claude on failure | Fractional, duplicate, omitted, extra and valid indices refuse/qualify/succeed without misattachment or false completed coverage. Retain omitted-case pass. | No |
| OBJ-REV-012 | Degraded projection exists; durable failure/reload/output remainder. | Codex verify; Claude on failure | Retrieval failure persists visibly unknown/degraded through reload/handover; prerequisite removal clears obsolete assessment, never substitutes no-evidence. | No |
| OBJ-REV-013 | Success-count/stall implementation; full real-write recovery pending. | Codex verify; Claude on failure | Count durable writes only; done0/remaining>0 actionable; mixed failure/retry completes once after reload. | No |
| Business-decisions remainder (existing unassigned acceptance requirement) | Walkthrough own-add/unaccept/accept/statement reload pass; DEC-001 code closure preserved. | Codex verify; Claude on failure | Remaining reject/restore/delete/bulk transitions preserve wording/source and accepted-set statement; failed-refresh retry reconciles after reload. | No |
| ANA-NPS-003 downstream design-change handover; shared FND-001/REP-OUT-001 | Settings/findings badges and correction-based A/C pass; a design-change chain is not established by those alone. | Codex verify; Claude only on failed supported case | One representative design change qualifies dependent insight/recommendation/saved framing/export or blocks until review; human wording and unrelated support survive. Do not count shared failures twice. | A3 export assertions only; trigger outside checklist |
| FND-001/REP-OUT-001 probe B / remaining handover lifecycle | Editor now exists in reviewed source; older “no editor” block is historical. Native body-change probe remains unexecuted; controlled fingerprints and edited-contradiction loader pass. | Codex verify; Claude on failure | Supported researcher wording/value edit→affected downstream qualification→reload/export; unchanged eligible wording survives; revert/retry safe where provided. No SQL body mutation substitute. | No; A3 observes exports but does not perform B trigger |
| Task B (existing hardening task, not release ID) | WT primary layout/type, purchase65/H80/L20/effective96, mean6.5, convenience67.5/price25/base116 and pilot8 pass. | Claude adapter/metadata prerequisites; Codex verify | Complete supported weighted-total/exact-MR-base/raw controls, declared-zero MR membership, conditional inference and small-base qualifications, then named real-model downstream chain. Explicit unsupported capability remains a limit, not invented failure. | A1; segment/metadata/model prerequisites outside checklist |
| Task D download completion (existing task; no new defect ID) | EX full replay passed; WT full invocation timed out on deck download, same-project DOCX/PPTX/reload continuation passed. Cause not established as product defect. | Claude adapter owner; Codex verify | Frozen affected replay smoke completes actual downloads/content/reload without temporary selector patch; absent/HTTP-failed download fails boundedly and retry targets only that download. Do not relabel the recorded failed invocation green. | A2/A3 |
| Office visual rendering / remaining untouched walkthrough checks (unassigned acceptance limits) | ZIP/XML contents verified, not Office rendering; brief extraction bypass and four unmatched questionnaire items remain disclosed. | Codex verify when prerequisites exist; Grant scope decision | Render actual exports in supported Office tooling for layout claims; execute only explicitly required missing brief/link cases or retain their limitations. Unmatched items alone are not demonstrated wrong links. | No; A3 checks content only |

### 3. Security and deployment requirements

| Existing ID / requirement | Latest evidence | Owner | Exact closure condition | E/T/A |
|---|---|---|---|---|
| IMP-001 / IMP-016 database isolation gate | WT actual setup-created fresh role scoped workflows/missing context/reuse pass; registry/membership defects above remain. | Claude implement; Codex disposable verify; Grant authorise deployment | Repair T1/T2; verify required grants, memberships, callable privileged functions and unprotected tables for the final schema; then validate equivalence of intended deployed role without assuming diagnostic ENFORCED proves policies. No automatic connection switch. | T1/T2, partial gate |
| IMP-001 / IMP-016 storage authorisation | WT local stand-in only; service-key path lookup and bearer signed-URL limits disclosed. | Claude application boundary; Grant deployed configuration; Codex authorised verification | Confirm bucket privacy/service-key confinement; two-tenant upload/read/sign/delete paths refuse foreign objects; explicitly accept/document signed-link policy. DB-role tests do not close storage. | No |
| IMP-001 / IMP-016 authentication/user-to-tenant boundary | Default-tenant architecture and disposable contexts do not demonstrate authenticated tenant mapping. | Grant/product identity owner; Claude implement; Codex authorised verification | Before public release, actual two-user/two-tenant action/route access matrix binds trusted identity to tenant, refuses forged IDs with no disclosure or mutation. | No |
| Deployment role/migration-process equivalence (existing separate requirement, no standalone ID) | 0096–0099 transactional rollback/retry/rerun and nonowner evidence retained; 0100/0101 used only as recorded disposable setup, not deployment-manager certification. | Grant deployment owner; Claude tooling; Codex scoped verification | Final migration chain under intended runner/role has documented preconditions, rollback/failure/retry/idempotency and grants; compare final source/schema/role identity, retain recovery/backup procedure, apply only with separate deployment authorisation. Do not rerun unchanged passing migration cases without affected changes. | T3 backup boundary only; not full deployment gate |

These are separate conclusions, not three additional security rows or whole-system certification. Explicit/fallback backup validation remains a demonstrated defect in section1; successful disposable fixes would still not authorise deployment.

### 4. Deferrable improvements and historical evidence gaps

| Existing ID | Latest evidence / classification | Owner | Exact completion condition | E/T/A |
|---|---|---|---|---|
| IMP-010 | Raw/wide preview checks partly pass; full bounded reopen/no-reparse browser gate unexecuted; baseline important but deferrable. | Codex verify; Claude only on failure | Actual row count, bounded sample/truncation and no unnecessary parse on reopen, or clearly documented preview limitation/recovery. | No |
| OBJ-SET-M02 | Thirty-six roundtrips plus seven parser controls pass; dual UI/real persistence pending. | Codex verify | Marker variants remain one editable logical objective in both presentations after native reload. Code passes remain closed. | No |
| OBJ-REV-M04 | Continuation wiring inspected; full original load-error path pending; documentation-only remainder deferrable. | Codex verify with REV-013; Claude documentation if needed | Continue processes pending existing questions without regeneration; load failure/guard visible and comments match actual behaviour. | No |
| OBJ-SET-004; OBJ-SET-005; OBJ-REV-003; OBJ-REV-010; OBJ-REV-M03 | Five distinct historical rows lack recoverable original requirements/assertions. No demonstrated defect can be invented. | Grant historical evidence owner; Codex reconcile | Recover original definition/evidence and assess it, or explicitly archive as unsubstantiated with a recorded disposition. Do not silently mark fixed. | No |
| Research Quality Review (existing design deliverable; no defect/release ID) | Consolidated engineering brief complete; source fit mapping and staged assessment design delivered, no implementation authorised. | Claude fit assessment; Grant scope authorisation | Return concise current-architecture fit assessment/recommended boundary before any separately authorised coding. Research memory remains outside v1. Not a trust-repair prerequisite. | No |

### Resolved or superseded findings — do not carry as repair work

Preserve these exact scopes; affected-source changes may require a targeted regression, not automatic reopening:

- Twelve closed canonical rows: IMP-002, IMP-003, IMP-006/REP-IN-001 (REP-IN-002 preservation), IMP-008, IMP-011, IMP-014, recovered OBJ-REV-001/002 overlap, OBJ-REV-009, OBJ-REV-011, DEC-001, ANA-NPS-003 settings/no-design guard, and ANA-NPS-003 findings-freshness subcase. Brief38, P2a and Rule B closures remain evidence, not additional rows.
- F68 closes mixed invalid/unknown banner and supported data-backed NPS25 qualification. R77 closes original synthesis INSERT42P08, same-document table counting under0099 (INS-001 bounded document identity), repeated-index recommendation retry/concurrency (REC-002), original Purchase resolution and mixed/empty pre-insights deck crash. No repeat repair list for these.
- EX preserves sign-reversal/three-channel refusal, discovery-insight filtering, source attribution and saved-framing qualification. WT closes the direct rejected-finding contradiction export reproduction **in its isolated staged snapshot**; this staged package remains unadopted, so deployment/current-checkout incorporation is not implied. Human-wording and A/C passes remain at their recorded scopes.
- Several documents that are copies of one respondent dataset are still not proof of independent respondents. The same-document fix is closed; documented copy-identity limitations are not silently converted into a new defect or a claim of independent corroboration.
- Supplemental reference validation and prepared A/C cases are complete as reference work, not application passes. Task D is no longer tooling-blocked; Task B is no longer wholly unexecuted. Their remaining limits are listed above. Earlier no-key/tooling statements are historical, not current closure requests.

**Next action:** review the frozen integrated checkpoint and only the named remaining acceptance cases. Claude remains paused. Completed matrices stay closed. Cumulative spend **US$3.817316 ofUS$10**; keys remain memory-only. See [shared status](current-engineering-status.md) for executed evidence and limits.

## Finite checklist — retained row-level scopes

| ID | Requirement | Status | Priority | Evidence and limits | Frozen acceptance test | Next action |
|---|---|---|---|---|---|---|
| IMP-001 / IMP-016 | Authorized tenant/run/document/storage access. | Blocked | Release blocker | Security gate only: secret rejection tested; deployment-role/access boundaries not certified. | Before public release, two-user/two-tenant negative access matrix passes under deployed roles. | Separate security package; excluded from technical gate/counts. |
| IMP-002 (includes IMP-SHIP-001/002) | Preview, extraction, dictionary and calculation share sheet, identifiers and missing-value contract. | Closed | Release blocker | P2a original passing subcases plus combined repair: real raw-preview lock/adoption and failure/retry, cached-preview recovery, native uploads/calculation/reload pass. Current workbook is checked against cached displayed values; no provenance inferred from dictionary. | One CSV and Sparse/Dense XLSX traverse uploadâ†’previewâ†’dictionaryâ†’saved calculation/reload with identical canonical values; missing sheet/unsupported formats fail or recover visibly. | No further repair within the agreed CSV/XLSX parser/provenance contract; retain limitations and affected-source comparisons. |
| IMP-003 | Every colliding header remains addressable by the same canonical name throughout correction and calculation. | Closed | Release blocker | Earlier actual parser/Python/canonical-target/save/calculation passes preserved. Final native Q1 (2) save/reload/reselect and mean1.5 with untouched sibling50% complete the frozen case. | q, q, q (2) retain all values; correction to q (2) affects only that variable after save/reload/calculation. | No further repair; retain canonical collision fixtures. |
| IMP-004 | Declared scale codes/categories and missing definitions survive into supported summaries. | Implemented awaiting verification | Release blocker | E12: independent retained7 pass; actual engine17 cases feed15 TS summary fixtures (45 assertions): labelled/unlabelled mean/top boxes, zero categories, sparse0-10, missing-audit metadata and count/label invariants pass. Earlier reader boundary controlled. Golden-thread native explicit Codebook, declared-zero NPS and MR metadata/calculations now pass on one synthetic XLSX; missing-audit and full scale/top-box/reload criteria remain unclosed. No defect reproduced. | Labelled/unlabelled 1â€“5 fixtures yield identical mean/top boxes; sparse 0â€“10 stays valid; declared zeros and missing audit survive reload. | Verify latest scoring repair and repair only remaining demonstrated metadata loss. |
| IMP-005 | Validated corrections have one effective meaning and visibly invalidate affected saved outputs. | Implemented awaiting verification | Release blocker | P2a canonical correction/picker and WT native type save/reload pass. Earlier unqualified correction probe C is superseded by frozen A/C downstream qualification/export passes. Remaining correction/cache and design-trigger coverage is explicit in consolidated register. | Save/clear/reload type/group corrections; calculation obeys effective state; affected outputs show stale/unknown without changing human wording. | Verify only remaining clear/group/cache and affected support cases; preserve native correction and A/C closures, count shared dependency once. |
| IMP-006 / REP-IN-001; REP-IN-002 preservation dependency | Imports report completion truthfully; replacement preserves usable evidence, human work and distinct supported claims. | Closed | Release blocker | E17 code closure; E18 two passing14-group PostgreSQL runs/replay; E19 final12/12 authorized browser/storage/native-downstream/dashboard/theme groups passed against frozen source. Complete/partial/failed reload, actionable status-write failure, legacy confirmation and pre0094 recovery executed. Deployment-role/process and broader freshness remain separate. | Preserve complete=ready, partial=incomplete, total failure=failed and actionable status-write errors. Partial/failed rereads retain prior usable IDs and links; complete replacement preserves human acceptance/edits; distinct claims sharing a quote survive, actual duplicates do not multiply; retirement/insertion failure and retry leave a safe set. Real persistence/browser checks remain separate. | No further repair for this frozen contract. Preserve code and agreed integration closures; compare affected hashes if source changes. No full Import/public-release sign-off. |
| IMP-007 | Upload/delete failures preserve evidence or leave discoverable retryable cleanup. | Implemented awaiting verification | Release blocker | Repair7 real-disposable-DB combined storage/trace failure reproduced; transactional cleanup intent and pending retry now pass focused DB checks (storage controlled). Native retry UI and upload-failure lifecycle remain unclosed. | Inject uploadâ†’DB failure and delete/storage/trace failures; no untracked source loss; cleanup is discoverable and retryable. | Verify I5; repair only failed recovery cases. |
| IMP-008 | Retrying a partial upload batch retains each successful logical import once. | Closed | Release blocker | Overnight65-file review: actual batch caller on real PostgreSQL passes partial failure/full re-pick/two retries, concurrent duplicate and separate-kind/run cases. Storage fault boundary controlled; additional native repeated CSV upload through real local storage keeps one hashed document and shows duplicate notice.0098 required; legacy null hashes are explicitly not deduplicated. | Upload good+bad, retry failed batch twice; exactly one good logical import and no path collision. | Preserve finite code/disposable/native closure. Require0098 for content deduplication; do not infer cleanup/security/module closure. |
| IMP-009 | Supported columns-as-cases layout reaches preview, dictionary and analytical requests. | Implemented awaiting verification | Release blocker | WT native columns layout/accept/reload, type correction and weighted subgroup tables pass. Identical staged engine still has EI unsigned-wrap, literal-ID trimming and cache-upgrade failures. Separate Codebook/MR retargeting remains a disclosed compatibility limit. | variable,caseA,caseB fixture has matching q1/q2 names and two-case orientation across preview/dictionary/crosstab/driver input. | Close E1?E3 on stable repaired bytes, then only remaining supported layout/metadata/analytical boundaries; no substitute dataset. |
| IMP-010 | A ready raw file shows a bounded preview and true case count without reparsing on reopen. | Implemented awaiting verification | Important but deferrable | 250-variable dictionary/quality fixtures pass; actual raw/wide browser workflow pending. | Reopen ready raw and wide files: bounded sample, actual row_count, visible truncation and no new parse request. | Verify I2/I4; if unavailable, document visible preview limitation and manual recovery. |
| IMP-011 | Declared MR zero options survive; eligibility/base suppression is per option. | Closed | Release blocker | Actual engine retains selected40/unselected0; base9 first option does not suppress base40 second option. Prior IMP-013 attribution corrected. | Already passed: second option remains 50%, base40, with its own interval. | No further repair; retain fixtures. |
| IMP-012 | Incomplete instrument rereads preserve confirmed links and disclose coverage. | Implemented awaiting verification | Release blocker | Actual controlled chunk/option-cap and preservation cases pass; DB cascade/reload not exercised. | Complete then partial reread preserves item/link IDs and confirmations; diagnostics survive reload; retry does not duplicate. | Verify I6; no expansion of questionnaire capability. |
| IMP-013 | Findings posted from different documents/waves retain independent identities and provenance. | Implemented awaiting verification | Release blocker | Historical repair claim exists; prior MR evidence was misattributed and does not close this issue. | Post same q1 from three documents: three traceable findings; remove/revive one without affecting the others. | Verify actual post/status/remove/revive callers and disposable persistence. |
| IMP-014 | Setup/workspace saves preserve current user intent across debounce, visits, hydration and conflicts. | Closed | Release blocker | E4: exact old/new/debounce repair passes; Aâ†’Bâ†’A with no new save and late hydration still reproduced. E8 supersedes the defect: Brief38 scoped32 + regressions55 passed; actual callback/fallback execution passed. Closed at code level for this frozen subcase; integration limitations retained. | Frozen: old/new conflictâ†’success reconciles; debounce intent protected; Aâ†’Bâ†’A old visit ignored; hydration cannot erase new edit; failure/conflict visibly agrees with persisted state. | No further code repair for frozen Brief38 subcase; retain named browser/real-SQL integration checks. |
| IMP-015 | Conflicting imported label definitions cannot silently reverse code meaning. | Implemented awaiting verification | Release blocker | Independent actual Python conflict/codebook/version-cache cases and notice rendering pass. Native conflicting-workbook upload/table/export/reload remains unexecuted; no fresh silent-label-choice failure is asserted after that repair. | Two sheets define q/code1 as Yes/No: explicit conflict blocks analytical use or requires visible deterministic resolution; unmatched names diagnosed. | Complete the finite native conflicting-label/recovery gate; retain actual-engine passes and visible all-labels/raw-code policy. |
| IMP-017 | Supported file sizes have enforceable, recoverable resource boundaries. | Untested requirement | Release blocker | Original controlled load/boundary investigation was never performed; no measured performance defect asserted. | At declared release limit and one over-limit fixture, bounded failure/timeout leaves truthful retryable status; run a small concurrent boundary case. | Establish conservative supported limits and verify; optimization beyond passing limits deferred. |
| IMP-018 | Advertised native-format imports and browser refresh preserve the same data contract. | Untested requirement | Release blocker | Actual malformed/truncated SAV/DTA/SAS and complete browser integration not certified. | One valid and one malformed/truncated fixture per advertised native format; reload retains correct status and provenance. | Verify I2/I4; exclude unverified formats/conversion paths visibly if necessary. |
| OBJ-SET-001 | Setup and Review edit/delete the same objective without duplicated or stranded wording. | Implemented awaiting verification | Release blocker | Shared normalization/matching repair source-verified; full cross-module reload incomplete. | Edit in Setup then Review, delete in Review, reload both: same logical row and current text, original brief preserved. | Verify frozen identity package. |
| OBJ-SET-002 | Own-objective additions are idempotent; migration fallback recovers transaction state. | Implemented awaiting verification | Release blocker | E13:12 controlled actual addition/db wrapper/runSync cases pass: trimmed duplicates/conflicts, rejected/AI scope, savepoint recovery, insertion/sync rollback and retry. Stable six-file snapshot. Real DB race/fallback still pending; pre-0083 fallback is not concurrency-safe. | Repeated/concurrent identical additions leave one candidate; expected missing-index error recovers or explicitly refuses unsupported schema. | Run separately authorized OBJ-SET-002 real index/concurrency/savepoint matrix; retained setup/protocol prepared. Code subcases closed; do not reopen REV-009. |
| OBJ-SET-003 | Regeneration never resurrects superseded upfront objectives. | Implemented awaiting verification | Release blocker | Seed marker/savepoint repairs inspected; complete legacy/Setup-only lifecycle pending. | Save Aâ†’edit Bâ†’edit Câ†’regenerate and deleteâ†’regenerate: A/B never return; original brief remains unchanged. | Verify frozen lifecycle package. |
| OBJ-SET-004 | Original definition unavailable. | Blocked | Important but deferrable | Historical record unsubstantiated; no defect invented. | Recover original finding or archive explicitly as unsubstantiated; never silently resolve. | Evidence recovery only; not a release blocker. |
| OBJ-SET-005 | Original acceptance definition unavailable; completion claim insufficient. | Blocked | Important but deferrable | A repair report exists without recoverable distinct requirement. | Recover original definition or retain unsubstantiated historical status. | Evidence recovery only; not a release blocker. |
| OBJ-SET-M02 | Numbered, hyphenated and Unicode-bulleted edits normalize consistently. | Implemented awaiting verification | Important but deferrable | E16:36 controlled actual Setup/Review/edit/delete roundtrips plus7 parser cases pass across supported markers; stable four-file hashes. Code subcases closed, real persistence/dual UI still pending. | Each marker form produces one objective, consistently editable in both presentations after reload. | Retain code subcases; verify real persistence and dual-presentation browser roundtrip when authorized/stable. |
| OBJ-REV-001 / OBJ-REV-002 recovered identity overlap | Evidence remains attached to objective identity after reorder, edit and deletion. | Closed | Release blocker | E21 code closure; E22 four targeted PostgreSQL passes; E23 G5 actual browser current/orphan/unknown, selection/reload and pre0095 notice/recovery pass using the same frozen archive. G1-G4 not rerun. Distinct historical REV-002 definition remains unavailable; deployment-role/process limits separate. | Reorder/delete candidates: evidence stays with original ID or becomes visibly orphaned/stale; never attaches to unrelated position. | No further action for agreed Rule B code/disposable/browser scope. Preserve closures; compare affected sources on later changes. |
| OBJ-REV-003 | Original definition unavailable. | Blocked | Important but deferrable | Unsubstantiated historical record. | Recover original evidence or retain explicitly unsubstantiated. | Evidence recovery only; not a release blocker. |
| OBJ-REV-004 | Objective acceptance/rejection, human wording and evidence exclusions survive regeneration consistently. | Implemented awaiting verification | Release blocker | Excluded-row predicate inspected; repairs reported; complete dual-presentation lifecycle not independently closed. | Accept/reject/edit/reaccept/regenerate/reload in both presentations gives matching states and preserved human decisions. | Verify frozen human-review package; DEC-001 remains separately closed. |
| OBJ-REV-005 / ANA-XTAB-001 dependency | Objective evidence distinguishes means/percentages and applies supported bases, thresholds and uncertainty. | Untested requirement | Release blocker | Mean1.5 classification and existing threshold/base cases pass; broad contract not closed by one case. | Independent total-column, mean/percent, base29/30, equality/mixed-stance fixtures agree through persisted assessment; unsupported uncertainty explicitly qualified. | Run finite research-contract fixtures; preserve passing subcases. |
| OBJ-REV-006 | Missing/ambiguous question matches never substitute unrelated evidence. | Confirmed defect | Release blocker | R77 original canonical Purchase Yes60/40 and reload pass. EX two-channel scripted online selection still becomes computed/supports for overall buying, despite both groups100%. EX real clear-selector attempt refused safely; it did not establish current unambiguous completion. | Unambiguous canonical question resolves correctly; ambiguous intended response requires resolution and cannot masquerade as a fully verified computed answer. | Repair two-channel intent enforcement/qualification; retain original reachability and refusal passes; verify actual intended response plus ambiguous/missing fail-closed boundaries. |
| OBJ-REV-007 | Edits/evaluation and deleted source evidence cannot strand a valid-looking stale assessment. | Implemented awaiting verification | Release blocker | Shared question-row lock/revision and had_table repair inspected; no-op edits tested; this protocol not covered by REV-009 live matrix. | Two-session edit/evaluation both orders, no-op, rollback and deletion: old wording cannot acquire current result; deleted table triggers visible stale/retry. | Separate isolated protocol verification; do not reopen REV-009. |
| OBJ-REV-008 | Model indices are integral, requested and complete, or processing is explicitly incomplete. | Implemented awaiting verification | Release blocker | Fractional-index and set-completeness repair claims; independent complete acceptance execution pending. | Fractional, duplicate, omitted, extra and valid index sets fail/qualify/succeed correctly without attaching answers to wrong objective. | Verify actual response parser/evaluator. |
| OBJ-REV-009 | Generation questions and coverage publish atomically and load from one coherent snapshot. | Closed | Release blocker | E2/E3: native11 tests and real13-group matrix; observed server lock waits; fresh setup replay passed. Minimal dependencies/deployment-role/framework limitations documented. | Agreed application/disposable-DB matrix passed; no new acceptance additions. | No further action within agreed scope; retain artifacts and limitations. |
| OBJ-REV-010 | Original definition unavailable. | Blocked | Important but deferrable | No distinct historical requirement recovered. | Recover original evidence or retain unsubstantiated. | Evidence recovery only; not a release blocker. |
| OBJ-REV-011 | Missing evidence/results tables recommend correct migration; permission errors remain genuine failures. | Closed | Important but deferrable | E14:64 controlled checks across seven actual exported actions pass; missing0066/0069/0092 maps correctly, permission/connection errors remain genuine failures. Closed at code level; live SQL/browser not claimed. | Actual action maps missing0066/0069/0092 correctly and does not relabel permission failure; schema preflight can explicitly refuse unsupported old versions. | No further code repair; retain required schema baseline and optional real SQL/browser error-injection limitation. |
| OBJ-REV-012 | Evidence lookup failures persist as degraded/unknown through assessment reload and necessary handover. | Implemented awaiting verification | Release blocker | Degraded storage/projection exists; real save/reload/output chain not fully verified. | Inject retrieval failure: saved/reloaded assessment visibly qualified; removing prerequisite clears obsolete assessment; no no-evidence substitution. | Verify durable assessment and necessary downstream qualification only. |
| OBJ-REV-013 | Failed persistence is pending/failure, not completed evaluation. | Implemented awaiting verification | Release blocker | Success-counting/stall UI inspected; full real-write recovery pending. | Mixed failed/success pairs count only durable writes; done0/remaining>0 shows actionable error; retry completes without duplicate answers. | Verify actual evaluator and reload. |
| OBJ-REV-M03 | Exact original comment/test finding unavailable. | Blocked | Important but deferrable | Report claims correction but original assertions not recovered. | Recover definition or preserve unsubstantiated record. | Evidence recovery; no invented code change. |
| OBJ-REV-M04 | Processing-limit and failure comments match continuation/error behavior. | Implemented awaiting verification | Important but deferrable | Bounded loop/continuation wiring inspected; original question-load error path not completely executed. | Guard leaves visible pending work; Continue evaluates existing questions without regeneration; load failure is surfaced. | Verify with REV-013; documentation-only remainder deferrable. |
| DEC-001 | Reaccepting human-edited decisions preserves wording/provenance through regeneration. | Closed | Release blocker | E1: native3 retained tests pass; actual actions/framer with controlled persistence; browser/DB not part of agreed code-level closure. | Agreed editâ†’reacceptâ†’regenerate cycle and untouched-AI replacement passed. | No further repair; preserve closure. |
| Business-decisions remainder (unassigned acceptance requirement; not a new defect ID) | Reject/restore/unaccept, own add/delete/bulk and decision_statement synchronization agree after reload. | Untested requirement | Release blocker | Recorded bounded boundary/hash manifest. Golden-thread native own-add, unaccept/accept and accepted-statement reload subcases pass on checkpoint 3c29e02. Reject/restore/delete/bulk and failed-refresh recovery remain unexecuted; no unrestricted audit conducted. | Finite transition table: intended row/run only, status-only operations preserve wording/source, statement equals accepted set; failed refresh/retry visibly reconciles; bulk reload agrees. | Verify only after active-file/dependency freeze; do not reopen DEC-001. |
| ANA-NPS-003 calculation-input subcase | NPS/Objectives/chart requests never calculate with unavailable required saved layout/design inputs. | Closed | Release blocker | E4: strict-caller tests pass, but actual lower builder captures default rows_are_cases through tolerant loadDataSetup after strict boundary. E8 supersedes the defect: Brief38 scoped32 + regressions55 passed; actual callback/fallback execution passed. Closed at code level for this frozen subcase; integration limitations retained. | Strict success followed by lower-level failure blocks engine/save for ordinary, explicit-design and explicit-no-design requests; cache-miss path likewise safe. | No further code repair for frozen Brief38 subcase; retain named browser/real-SQL integration checks. |
| ANA-NPS-003 / IMP-005 findings freshness subcase | Findings with changed/uncheckable design are visibly stale/unknown; no-source remains not applicable. | Closed | Release blocker | E4 actual getFindings + rendered JSX: current/stale/unknown/no-source pass; missing-column fallback incorrectly returns null/no badge for a real source table. E8 supersedes the defect: Brief38 scoped32 + regressions55 passed; actual callback/fallback execution passed. Closed at code level for this frozen subcase; integration limitations retained. | Actual loader returns current/stale/unknown/null correctly; missing snapshot/migration and lookup failure with a source table show unknown badge after reload. | No further code repair for frozen Brief38 subcase; retain named browser/real-SQL integration checks. |
| FND-001 / REP-OUT-001 necessary handover only | Changed/rejected/deleted/replaced support cannot remain silently valid in outputs consuming these modules. | Confirmed defect | Release blocker | Latest EX wrong-group NPS remains saved as traced. F68 mixed-status banner/NPS qualification and R77 original narrative fixes pass. WT direct-finding rejection exclusion passes in isolated staged exports; A/C, sources, framing and human wording retained. Unexecuted probe B/design lifecycle remain acceptance limits, not extra defects. | In-place change, delete, replacement and duplicates invalidate/qualify affected dependent artifact; unchanged support stays eligible; human wording survives. | Repair wrong-group semantic grounding; preserve superseded closures and run only changed consumers plus named unfinished lifecycle cases. See consolidated register. |
| ANA-NPS-003 downstream freshness handover | Changing design makes affected insights/recommendations/saved narratives visibly stale or ineligible. | Untested requirement | Release blocker | Explicitly still open; fresh computation settings and findings badges do not prove deeper dependency handling. | Change design behind accepted evidence: dependent objects keep human wording and show stale/unverified or publication is blocked until rebuilt/reviewed. | Define smallest dependency flag/blocking recovery; verify one representative chain, not full reporting audit. |

## Module-level position

| Allocation | Closed | Awaiting verification | Confirmed defect | Untested | Blocked |
|---|---:|---:|---:|---:|---:|
| Import (including separate security) |6|8|0|2|1|
| Setup/Review Objectives |3|10|1|1|5 historical gaps|
| Business decisions |1|0|0|1|0|
| Cross-tabs/necessary shared handovers |2|0|1|1|0|
| **Total** |**12**|**18**|**2**|**5**|**6**|

No module yet meets all its complete technical sign-off criteria. Closed issues do not imply module
closure. Shared rows are counted once in cross-tabs/shared, not again in each consuming module.

## Remaining work, separated by evidence

**Two confirmed-defect checklist rows:** FND-001/REP-OUT-001 and OBJ-REV-006. Categorical reachability and supported NPS qualification pass; primary objective assessment and grounded handover retain concrete failures. Existing INS-001, REC-002 and attribution-route repairs are explicit outside these row counts.
in-place support changes, deletion, replacement and duplicates must invalidate/qualify/block dependent
authoritative outputs while preserving human wording. Unchanged support remains eligible. Use the
smallest visible stale/unknown state or safe publication block; no general report redesign.

**Required verification, not demonstrated defects:**18 implemented rows (15 release-priority,
3 deferrable) and5 untested release requirements. Their exact finite pass conditions remain in the
checklist. They cover remaining Import metadata/corrections/lifecycle/retry, selected formats/limits,
Setup/Review lifecycle and addition persistence, evaluation/recovery, remaining business transitions,
and the necessary design-change handover. Repair only reproduced failures. Supported exclusions
must be visible and explicitly accepted where they prevent incorrect results or lost work.

**Deferred:**8 open important-but-deferrable rows (3 implemented +5 historical-definition gaps),
plus already closed OBJ-REV-011, are included in the9 deferrable priority total, never added to status
counts. Missing definitions are evidence recovery, not invented blockers. Optional naming/refactoring,
speculative optimization and expanded capability stay outside this gate.

**Separate pre-public gate:** IMP-001/016 security remains Blocked/deferred. Technical functionality
acceptance does not authorize public release. Deployment-role equivalence and deployment migration
process/ledger remain separately recorded operational limitations; completed disposable checks do
not certify them.

## Ordered bounded packages and milestone use

1. Necessary freshness handover (existing FND-001/REP-OUT-001 and representative design-change
   dependency): implement/review the minimal qualification/block only. This is the remaining confirmed
   wrong-output risk; do not start a broad reporting audit.
2. Remaining Setup/Review identity/human-review lifecycle and candidate addition persistence,
   preserving Rule B/REV009/M02 closed subcases. Then finite evaluator revision/recovery/units cases.
3. Remaining Import metadata/override invalidation, cleanup/retry, instrument/wave preservation,
   and explicit supported-format/resource limits. Do not rerun closed P2a parser pipelines wholesale.
4. Remaining business-decision transition/add/delete/bulk/accepted-statement sync, preserving DEC-001.
5. One representative supported-workflow acceptance run; reuse unchanged evidence rather than
   requiring every permutation. Necessary browser/persistence gaps on closed code subcases stay named.

Use Codex at milestones: freeze the small acceptance contract and boundary once, implement routine
fixes inside it, run the automated gate and risk-specific checks, then review the concrete result.
No repeated planning approval for each reversible adjustment. Additional live/disposable write scope
or a material supported-scope omission must be identified explicitly before dependent execution.

## Supported-scope proposal and stopping rule

Proposed scope remains CSV/XLSX case-level imports with authoritative sheet/canonical names,
visible missing/unsupported-value handling; supported objective/evidence review; candidate business
workflows and documented single/MR/scale/design-qualified calculations. Native formats,
columns-as-cases, report/questionnaire variants and maximum sizes remain conditional on their listed
finite checks or explicit visible exclusions. Do not silently claim uncertain capabilities supported.

Recommend technical sign-off when all supported release-priority gates pass or have an explicitly
approved safe exclusion/recovery state, no confirmed supported-scope blocker remains, representative
persistence/browser handovers pass, and deferrable limitations have visible workarounds. Preserve
human wording and evidence qualification. Further optional improvements do not prevent sign-off.
Security must separately pass before public release.

## Validation and local checkpoint

`npm run validate` runs installed Next type generation, full-project typecheck and retained unit
files. `npm run typecheck` and `npm run test:retained` are separate commands. The local prepared
CI workflow runs the same gate with Node24 on pull requests/manual dispatch; it has not run remotely.
No integration writes or secrets are part of that unit gate. Persistence/concurrency/identity changes
add targeted disposable checks; presentation changes use proportionate rendering checks.

Dedicated branch checkpoint/p2a-release-20261015 preserves the existing application source plus
this bounded repair and validation setup. It is a local checkpoint, not a merge/deployment or a
claim that every pre-existing change was independently audited. Credentials, client snippets,
generated builds/archives/dumps/profiles/logs and disposable runtime data are excluded. Retained
synthetic integration evidence remains local. No push/deployment authorized or performed.


## Resumed golden-thread evidence — checkpoint3c29e02

[Final report](golden-thread-walkthrough-2026-10-15.md):5 passed /4 degraded /5 broken stages.
Real model-backed questionnaire, report claims, objective evidence, omitted effect, synthesis,
recommendations and native narrative exports executed. A has mixed UI/export results; B remains
blocked without a supported finding-body edit; independent C reproduces downstream freshness failure.
Missing evidence is not a defect. Brief extraction and full Office rendering remain unexecuted.

OBJ-REV-006 moves Implemented awaiting verification -> Confirmed defect on actual exact-variable
resolution failure. Existing FND-001/REP-OUT-001 records A/C handover and wrong supported-verdict
evidence; shared IMP-005 dependency is not double-counted. Deck attribution remains unassigned for
triage, not another row. Numerical fixtures and human wording/reload pass; all earlier closures remain.

Usage209 generation calls, approximately US$1.581086 ofUS$10. Source archive unchanged; synthetic
resources and memory-only key gateway cleaned after evidence retention. Concurrent checkout repairs
were not loaded or reviewed. No application edits, push/deployment or full module sign-off.
Counts11/18/2/6/6=43; independent priority34/9/0. Security and deployment certification remain separate.
Previous baseline retained byte-for-byte as v19; earlier blocked report is retained separately.

## Bounded trust-repair review — recorded snapshot, current-source closure held

[Independent affected checks](trust-repair-verification-2026-10-15.md):55 bounded unit tests pass;
10 actual PostgreSQL tests pass (two placeholder skips); six actual Python workbook cases pass
through the installed interpreter. Typecheck and frozen production build pass. Native A now shows
rejected-support warnings on insight/recommendation and qualifies/filters exports. Independent C
shows correction-change warnings after hard reload, and both native narrative exports qualify the
changed corrections while preserving human wording. Preserve those frozen passing subcases.

FND-001 remains Confirmed defect: native narrative aggregate conflates one invalid plus five unknown
legacy references with six observed changes/removals. A truthful category-specific or general
noncurrent banner is the bounded closing test. B remains blocked without a supported finding-body
editor. Actual-SQL NPS qualification/restoration passes; fresh model-backed NPS/narrative output
checks remain unexecuted, not invented failures. No new key or paid call was used. OBJ-REV-006 has
no supplied repair and remains confirmed; previous lookup evidence is reused. Deck attribution's
latest route bytes changed during review, so no current-source closure is inferred.

INS-001 scoped SQL/backfill/RLS and native one-source/exploratory display pass. IMP-015 actual-engine,
static notice and cache subcases pass; its native conflicting-workbook workflow is unexecuted.
Neither is silently promoted to a complete new module or checklist closure.

Fifteen supplied final hashes matched at the initial comparison. Eight support/export/test files
subsequently changed in the checkout; execution used an immutable archive and does not verify those
newer bytes. The full FND handover was subsequently supplied: its document gap is resolved, but combined hashes match only18 of32 current files. Three changed focused suites pass23 tests. See the review addendum; mismatched hashes are version gaps, not defects. Next milestone is the stable final
handover/hash reconciliation and only affected closing checks, not another sweep or full golden thread.

All original walkthrough artifacts and earlier closures remain intact. New disposable synthetic
resources were retained then cleaned; no app edit, development/live data or dependency installation.
Counts remain11/18/2/6/6=43, priorities34/9/0; security and deployment limitations stay separate.

## Overnight completed-package review —2026-10-16

[Consolidated independent decision](overnight-trust-review-2026-10-16.md): all65 final-manifest hashes
matched before a frozen643-file copy was executed. `npm run validate`: typecheck0;80 files,
653 passed/13 skipped/0 failed. Skips are10 inactive DB placeholders,2 inactive Python placeholders
and1 retained report integration placeholder. Real DB/Python cases ran; the skipped report case
does not reopen prior REP integration closure. Production build passes.

Native A/C qualify affected work and preserve human wording; four native attribution exports pass.
The pre-insights deck returns500 on supported mixed verdicts. An independent real-DB same-dataset
fixture counts three tables as three independent sources and retains strong confidence (INS-001).
A repeated model index on recommendation retry persists13 rows for12 anchors (REC-002). These are
three concrete package failures under existing identities/closing cases, not missing evidence and
not new43-row additions. They remain required bounded repair work before sign-off. The old mixed
status banner also fails in the frozen page; its newer checkout replacement needs only affected
verification, not a duplicate repair request or another full audit.

Unchanged0096–0098 pass disposable transactional rollback/fault/retry/rerun checks; real nonowner
fingerprint/RLS checks pass. No development/live DDL or deployed-role changes. Deployed security,
role equivalence and migration-manager/process certification remain separate.

IMP-008 closes its finite code/disposable/native retry scope with0098 required. OBJ-REV-006 moves
Confirmed defect→Implemented awaiting verification after actual planner/category/fail-closed passes.
Its real-model gate, NPS contradiction-prompt output and fresh grounded narrative output are blocked:
no fresh hidden-input key became available. Zero new paid calls; retained total approximatelyUS$1.58
ofUS$10. Prompt inspection/request capture is not reported as real-model success.

Only live page.tsx changed after the supplied freeze; immutable application/migration bytes stayed
unchanged. Prior A/C and all completed closures are retained, not applied to unreviewed newer bytes.
All recorded disposable resources were retained then cleaned. Original golden-thread evidence stays
unchanged. No new feature, application patch, broad sweep, push/deployment or module sign-off.

Current partition12 Closed /19 Implemented awaiting verification /1 Confirmed defect /5 Untested /
6 Blocked=43; independent priorities34/9/0. Earlier totals in historical updates are superseded by
this current partition. One next package: the three reproduced repairs plus final-banner check,
then only affected closing tests and named model checks when secure key availability permits.

## Final68 review and real-model completion ? 2026-10-16

[One consolidated decision](trust-final68-review-2026-10-16.md) supersedes the earlier unavailable-key and banner-pending dispositions. All68 final hashes matched; frozen646-file source stayed unchanged. Retained653 actual validation passes plus5 new focused banner passes; final build/typecheck passes. The13 skips remain10 inactive DB placeholders,2 inactive Python placeholders and1 retained report placeholder, never passes. Unchanged0096?0098 rollback/retry evidence and completed matrices are reused.

Native A reload closes the mixed-status banner. Actual native/model verification and real contradiction detection preserve robust data-backed NPS25. Canonical Gender/Purchase reachability passes, but the primary percentage expectation has no response selector and stays inconclusive despite correct saved tables: OBJ-REV-006 returns to Confirmed defect, with its repaired subcase preserved. Actual narrative avoids invented scales and includes export sources, but introduces an unsupported?15 NPS range. Fresh synthesis fails actual PostgreSQL INSERT with42P08 (integer versus smallint parameter10), blocking fresh downstream completion. Retained same-dataset confidence inflation, duplicate recommendation retry and pre-insights deck500 remain concrete package repairs. One consolidated repair list, no new checklist rows or general sweep.

108 additional real-model calls cost approximatelyUS$0.737440; cumulativeUS$2.318526 ofUS$10. Hidden-input key never retained; gateway disabled/stopped. Only named synthetic disposable resources used; artifacts retained before cleanup, zero reserved-port listeners. Probe B and Office visual rendering remain explicit; security/deployment limitations unchanged.

Current partition **12 Closed /18 Implemented /2 Confirmed /5 Untested /6 Blocked=43**; priorities34/9/0. All prior closures, including IMP-008's finite dedup scope, remain preserved. Earlier sections are historical where superseded. Previous canonical baseline retained byte-for-byte as v23.

## Stable77 six-repair review and hardening handoff ? 2026-10-16

[One consolidated decision](repair6-consolidated-review-2026-10-16.md) supersedes preliminary key-blocked review dispositions. All77 manifest hashes match;frozen655-file source stays unchanged.20 affected real-DB and12 controlled-model cases pass,with5 inactive DB placeholders explicitly skipped.Three adversarial expectations fail:sign-reversed narrative,wrong-group narrative and arbitrary selection from ambiguous valid responses. Combined single-thread pool-reuse failures remain separate from isolated passing cases;no87-file gate claim. Final frozen production build/typecheck passes after retained generated-build failure and clean retry.

Fresh native/model chain now saves8 syntheses,8 synthesis-backed recommendations and1 narrative with actual DOCX/PPTX source references,no earlier?15 invention or different-scales explanation. Native Purchase now resolves40/60 on both fixture files and reloads correctly. Original SQL typing,0099 same-document keys/backfill,duplicate retry and mixed deck mechanisms close at their affected scopes;no repeated full matrices. These passes do not certify signed/contextual numerical meaning or ambiguous intent. Existing FND-001 and OBJ-REV-006 therefore remain confirmed for those specific gaps,not the repaired reproductions. A9of10 objective-validation response was correctly rejected;unrelated planner failures were qualified and native exclusions used to isolate Purchase. No extra taxonomy or broad audit.

118 new real-model calls cost approximatelyUS$1.091320;current cumulativeUS$3.409846 ofUS$10. Key gateway disabled/stopped;synthetic artifacts retained before verified own-resource cleanup.0099 applied only to disposable environments,no deployed-role changes. Prior closures/security/deployment limits preserved. Status totals unchanged12/18/2/5/6=43;priority34/9/0.

Hardening:Task A delivers31 independent numerical/data assertions and9 downstream requirements with original fixture/history preserved;Task C delivers24 semantic cases. [A](golden-thread-hardening-task-a-2026-10-16.md),[C](golden-thread-hardening-task-c-2026-10-16.md). These are reference results,not application passes. Supplemental ZIP separately retained;22 arithmetic keys match CSVs,five workbook-control equivalences match;remaining compatibility/semantic keys are unverified and unused. Task B awaits single interface/combined-fixture readiness. Task D smoke specification prepared,syntax only:Playwright and application adapter unavailable;no install. [B](golden-thread-hardening-task-b-2026-10-16.md),[D](golden-thread-hardening-task-d-2026-10-16.md). One milestone update;no new issue rows or sign-off. Previous canonical retained as v24.


## Exportfix64 bounded review and hardening disposition ? 2026-10-16

[Consolidated decision](exportfix64-consolidated-review-2026-10-16.md):64 manifest entries and the authoritative device lockfile match.81 affected tests pass,5 inactive placeholders skipped;actual integration cases ran. Independent counterexamples retain three mechanisms:wrong-group NPS saved as traced,two-channel arbitrary response computed as overall purchase,and directly rejected computed support exported as an unqualified contradiction. No new checklist row. Original sign/three-channel fixes,discovery-insight filtering,source attribution,saved-framing qualification and eligible human wording retain their recorded passes.

Task D now passes its strengthened native replay smoke,including exact eligible researcher wording in both narrative exports and reload;temporary adapter/environment fixes are documented separately. It is orchestration evidence,not real-model certification. Real-provider actual-generator checks retain a qualified NPS narrative;the clear Yes/No selector safely refused rather than completed,while ambiguous channels refused. Six successful calls costUS$0.049382; cumulativeUS$3.459228 ofUS$10. Gateway stopped.

Task B native upload/layout/accept/reload reaches120 cases;its transposed text-valued/codebook combination exposes no usable weight or MR set,so downstream requirements remain unexecuted. Six primary engine references match only under explicit arguments;controls are not substituted for primary completion. Selected asymmetric reversed/declared-zero supplemental checks match actual engine,saved native table and spreadsheet. Original fixtures/hash histories preserved. Tooling,fixture compatibility and unexecuted requirements remain separate from defects.

Evidence retained before exact disposable cleanup;no app repairs,live/development writes,push or deployment. Prior closures and original golden-thread evidence preserved. The Research Quality Review brief is a separate design-only deliverable. Status partition unchanged **12 Closed /18 Implemented /2 Confirmed /5 Untested /6 Blocked=43**;priorities34/9/0. Security/deployment gates unchanged. Previous canonical baseline retained byte-for-byte as v25.


## Authorised milestone follow-up — 2026-10-16

Operational completion and exact evidence remain in [current engineering status](current-engineering-status.md).
Codex integrated Repair7 and repaired bounded metadata/recovery/semantic failures; these are
self-validation results, not independent closures. Final strict validation:107 files,804 passes,
33 explicit skips, with real PostgreSQL/Python prerequisites executed. Prior closures and the
43-row partition are preserved pending independent disposition.

Grant approved20,000,000bytes and100,000cases per file, SAS exclusion pending verification, and
exclusion of columns-as-cases workbooks requiring a separate Codebook for weight/MR metadata.
The primary TaskB combination remains unverified; controls are not substitutes. User-facing
import guidance records these boundaries. Separate deployed security/process gates remain.
Cumulative model spend:US$3.817316 ofUS$10; gateway disabled/stopped and key cleared.
