# Technical release acceptance baseline ? 2026-10-15

Canonical finite release baseline:43 existing rows. This is technical functionality consolidation,
not public-release authorization or an unrestricted audit. The previous document is retained byte-for-byte
as [v17](technical-release-acceptance-baseline-2026-10-15.v17.md); earlier evidence/history remains local.

## Current decision and evidence

**11 Closed /19 Implemented awaiting verification /1 Confirmed defect /6 Untested requirement /
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

## Finite checklist

| ID | Requirement | Status | Priority | Evidence and limits | Frozen acceptance test | Next action |
|---|---|---|---|---|---|---|
| IMP-001 / IMP-016 | Authorized tenant/run/document/storage access. | Blocked | Release blocker | Security gate only: secret rejection tested; deployment-role/access boundaries not certified. | Before public release, two-user/two-tenant negative access matrix passes under deployed roles. | Separate security package; excluded from technical gate/counts. |
| IMP-002 (includes IMP-SHIP-001/002) | Preview, extraction, dictionary and calculation share sheet, identifiers and missing-value contract. | Closed | Release blocker | P2a original passing subcases plus combined repair: real raw-preview lock/adoption and failure/retry, cached-preview recovery, native uploads/calculation/reload pass. Current workbook is checked against cached displayed values; no provenance inferred from dictionary. | One CSV and Sparse/Dense XLSX traverse uploadâ†’previewâ†’dictionaryâ†’saved calculation/reload with identical canonical values; missing sheet/unsupported formats fail or recover visibly. | No further repair within the agreed CSV/XLSX parser/provenance contract; retain limitations and affected-source comparisons. |
| IMP-003 | Every colliding header remains addressable by the same canonical name throughout correction and calculation. | Closed | Release blocker | Earlier actual parser/Python/canonical-target/save/calculation passes preserved. Final native Q1 (2) save/reload/reselect and mean1.5 with untouched sibling50% complete the frozen case. | q, q, q (2) retain all values; correction to q (2) affects only that variable after save/reload/calculation. | No further repair; retain canonical collision fixtures. |
| IMP-004 | Declared scale codes/categories and missing definitions survive into supported summaries. | Implemented awaiting verification | Release blocker | E12: independent retained7 pass; actual engine17 cases feed15 TS summary fixtures (45 assertions): labelled/unlabelled mean/top boxes, zero categories, sparse0-10, missing-audit metadata and count/label invariants pass. Reader boundary controlled; actual metadata decoding/save/reload still open. No defect reproduced. | Labelled/unlabelled 1â€“5 fixtures yield identical mean/top boxes; sparse 0â€“10 stays valid; declared zeros and missing audit survive reload. | Verify latest scoring repair and repair only remaining demonstrated metadata loss. |
| IMP-005 | Validated corrections have one effective meaning and visibly invalidate affected saved outputs. | Implemented awaiting verification | Release blocker | P2a picker/save/reload and effective canonical calculation subcases closed. Pending/failed edits survive stale props. Remaining broader correction-dependent invalidation/save-clear-reload qualifications are required checks, not reproduced defects. | Save/clear/reload type/group corrections; calculation obeys effective state; affected outputs show stale/unknown without changing human wording. | Verify remaining affected saved-output invalidation only; preserve P2a and findings-freshness closures. |
| IMP-006 / REP-IN-001; REP-IN-002 preservation dependency | Imports report completion truthfully; replacement preserves usable evidence, human work and distinct supported claims. | Closed | Release blocker | E17 code closure; E18 two passing14-group PostgreSQL runs/replay; E19 final12/12 authorized browser/storage/native-downstream/dashboard/theme groups passed against frozen source. Complete/partial/failed reload, actionable status-write failure, legacy confirmation and pre0094 recovery executed. Deployment-role/process and broader freshness remain separate. | Preserve complete=ready, partial=incomplete, total failure=failed and actionable status-write errors. Partial/failed rereads retain prior usable IDs and links; complete replacement preserves human acceptance/edits; distinct claims sharing a quote survive, actual duplicates do not multiply; retirement/insertion failure and retry leave a safe set. Real persistence/browser checks remain separate. | No further repair for this frozen contract. Preserve code and agreed integration closures; compare affected hashes if source changes. No full Import/public-release sign-off. |
| IMP-007 | Upload/delete failures preserve evidence or leave discoverable retryable cleanup. | Implemented awaiting verification | Release blocker | Actual mocked deletion ordering and both cleanup error forms pass; live orphan/retry behavior untested. | Inject uploadâ†’DB failure and delete/storage/trace failures; no untracked source loss; cleanup is discoverable and retryable. | Verify I5; repair only failed recovery cases. |
| IMP-008 | Retrying a partial upload batch retains each successful logical import once. | Untested requirement | Release blocker | Original good.csv/bad.csv duplicate repro recovered; current upload retry not independently executed. | Upload good+bad, retry failed batch twice; exactly one good logical import and no path collision. | Verify actual batch caller; implement per-file recovery/idempotency only if failing. |
| IMP-009 | Supported columns-as-cases layout reaches preview, dictionary and analytical requests. | Implemented awaiting verification | Release blocker | Original definition recovered; layout dispatch exists in subsequent source reviews; end-to-end orientation not closed. | variable,caseA,caseB fixture has matching q1/q2 names and two-case orientation across preview/dictionary/crosstab/driver input. | Verify I2/I3 or visibly reject this layout for release. |
| IMP-010 | A ready raw file shows a bounded preview and true case count without reparsing on reopen. | Implemented awaiting verification | Important but deferrable | 250-variable dictionary/quality fixtures pass; actual raw/wide browser workflow pending. | Reopen ready raw and wide files: bounded sample, actual row_count, visible truncation and no new parse request. | Verify I2/I4; if unavailable, document visible preview limitation and manual recovery. |
| IMP-011 | Declared MR zero options survive; eligibility/base suppression is per option. | Closed | Release blocker | Actual engine retains selected40/unselected0; base9 first option does not suppress base40 second option. Prior IMP-013 attribution corrected. | Already passed: second option remains 50%, base40, with its own interval. | No further repair; retain fixtures. |
| IMP-012 | Incomplete instrument rereads preserve confirmed links and disclose coverage. | Implemented awaiting verification | Release blocker | Actual controlled chunk/option-cap and preservation cases pass; DB cascade/reload not exercised. | Complete then partial reread preserves item/link IDs and confirmations; diagnostics survive reload; retry does not duplicate. | Verify I6; no expansion of questionnaire capability. |
| IMP-013 | Findings posted from different documents/waves retain independent identities and provenance. | Implemented awaiting verification | Release blocker | Historical repair claim exists; prior MR evidence was misattributed and does not close this issue. | Post same q1 from three documents: three traceable findings; remove/revive one without affecting the others. | Verify actual post/status/remove/revive callers and disposable persistence. |
| IMP-014 | Setup/workspace saves preserve current user intent across debounce, visits, hydration and conflicts. | Closed | Release blocker | E4: exact old/new/debounce repair passes; Aâ†’Bâ†’A with no new save and late hydration still reproduced. E8 supersedes the defect: Brief38 scoped32 + regressions55 passed; actual callback/fallback execution passed. Closed at code level for this frozen subcase; integration limitations retained. | Frozen: old/new conflictâ†’success reconciles; debounce intent protected; Aâ†’Bâ†’A old visit ignored; hydration cannot erase new edit; failure/conflict visibly agrees with persisted state. | No further code repair for frozen Brief38 subcase; retain named browser/real-SQL integration checks. |
| IMP-015 | Conflicting imported label definitions cannot silently reverse code meaning. | Implemented awaiting verification | Release blocker | Original conflicting-label overwrite reproduced; subsequent conflict metadata reported, but visible blocking/resolution and reload not independently closed. | Two sheets define q/code1 as Yes/No: explicit conflict blocks analytical use or requires visible deterministic resolution; unmatched names diagnosed. | Verify reported diagnostics if implemented; otherwise smallest explicit unsupported-conflict state. |
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
| OBJ-REV-006 | Missing/ambiguous question matches never substitute unrelated evidence. | Implemented awaiting verification | Release blocker | Fail-closed and repeated-answer-label repairs reported; complete evaluator path pending. | Missing variable and Yes80%/Yes20% across two unnamed questions stay unresolved; explicit unambiguous question resolves correctly. | Verify evaluator and saved result; no semantic-search expansion. |
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
| Business-decisions remainder (unassigned acceptance requirement; not a new defect ID) | Reject/restore/unaccept, own add/delete/bulk and decision_statement synchronization agree after reload. | Untested requirement | Release blocker | Recorded bounded boundary/hash manifest; no new unrestricted business-decisions audit conducted. | Finite transition table: intended row/run only, status-only operations preserve wording/source, statement equals accepted set; failed refresh/retry visibly reconciles; bulk reload agrees. | Verify only after active-file/dependency freeze; do not reopen DEC-001. |
| ANA-NPS-003 calculation-input subcase | NPS/Objectives/chart requests never calculate with unavailable required saved layout/design inputs. | Closed | Release blocker | E4: strict-caller tests pass, but actual lower builder captures default rows_are_cases through tolerant loadDataSetup after strict boundary. E8 supersedes the defect: Brief38 scoped32 + regressions55 passed; actual callback/fallback execution passed. Closed at code level for this frozen subcase; integration limitations retained. | Strict success followed by lower-level failure blocks engine/save for ordinary, explicit-design and explicit-no-design requests; cache-miss path likewise safe. | No further code repair for frozen Brief38 subcase; retain named browser/real-SQL integration checks. |
| ANA-NPS-003 / IMP-005 findings freshness subcase | Findings with changed/uncheckable design are visibly stale/unknown; no-source remains not applicable. | Closed | Release blocker | E4 actual getFindings + rendered JSX: current/stale/unknown/no-source pass; missing-column fallback incorrectly returns null/no badge for a real source table. E8 supersedes the defect: Brief38 scoped32 + regressions55 passed; actual callback/fallback execution passed. Closed at code level for this frozen subcase; integration limitations retained. | Actual loader returns current/stale/unknown/null correctly; missing snapshot/migration and lookup failure with a source table show unknown badge after reload. | No further code repair for frozen Brief38 subcase; retain named browser/real-SQL integration checks. |
| FND-001 / REP-OUT-001 necessary handover only | Changed/rejected/deleted/replaced support cannot remain silently valid in outputs consuming these modules. | Confirmed defect | Release blocker | Existing source-count guard catches some deletion/rejection; cannot validate in-place evidence versions or duplicate membership. Broader reporting backlog excluded. | In-place change, delete, replacement and duplicates invalidate/qualify affected dependent artifact; unchanged support stays eligible; human wording survives. | Small invalid/stale handover or explicit publication block; full report redesign excluded. |
| ANA-NPS-003 downstream freshness handover | Changing design makes affected insights/recommendations/saved narratives visibly stale or ineligible. | Untested requirement | Release blocker | Explicitly still open; fresh computation settings and findings badges do not prove deeper dependency handling. | Change design behind accepted evidence: dependent objects keep human wording and show stale/unverified or publication is blocked until rebuilt/reviewed. | Define smallest dependency flag/blocking recovery; verify one representative chain, not full reporting audit. |

## Module-level position

| Allocation | Closed | Awaiting verification | Confirmed defect | Untested | Blocked |
|---|---:|---:|---:|---:|---:|
| Import (including separate security) |5|8|0|3|1|
| Setup/Review Objectives |3|11|0|1|5 historical gaps|
| Business decisions |1|0|0|1|0|
| Cross-tabs/necessary shared handovers |2|0|1|1|0|
| **Total** |**11**|**19**|**1**|**6**|**6**|

No module yet meets all its complete technical sign-off criteria. Closed issues do not imply module
closure. Shared rows are counted once in cross-tabs/shared, not again in each consuming module.

## Remaining work, separated by evidence

**One demonstrated blocker:** FND-001/REP-OUT-001 necessary handover. Existing frozen acceptance:
in-place support changes, deletion, replacement and duplicates must invalidate/qualify/block dependent
authoritative outputs while preserving human wording. Unchanged support remains eligible. Use the
smallest visible stale/unknown state or safe publication block; no general report redesign.

**Required verification, not demonstrated defects:**19 implemented rows (16 release-priority,
3 deferrable) and6 untested release requirements. Their exact finite pass conditions remain in the
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
