# Independent acceptance disposition, release c07eea8 / be625c7 (2026-10-16)

Latest authority: the 2026-10-17 all-43-row reconciliation at the end of this file. Earlier count/promotion notices are dated history where superseded there.

Claude accepted the explicit release at c07eea8 (application checkpoint be625c7) and owned the
close-out overnight. This file records, for each canonical row, the evidence level reached and the
disposition. It does **not** change the 43-row partition (12 Closed / 18 Implemented awaiting
verification / 2 Confirmed defect / 5 Untested / 6 Blocked). Promotions are proposed below, not
applied. Three reasons:
- Some rows now depend on repairs Claude made tonight, and Claude cannot review its own work.
- Several closing assertions are still unestablished.
- The partition is owner-controlled.

## What was executed independently (on c07eea8, then on the repaired tree)

| Check | c07eea8 | After tonight's repairs |
|---|---|---|
| `npx next typegen && npx tsc --noEmit -p .` | pass | pass |
| `TEST_DATABASE_URL=… npx vitest run src/lib/__tests__ --pool=forks` (real PostgreSQL 16 and Python) | 108 files, 807 passed, 33 skipped | 110 files, 817 passed, 0 failed, 34 skipped |
| UI checks `npx playwright test -c e2e/ui/ui-check.config.mjs` | 6 passed | 7 passed (adds the flipped-workbook guard check) |
| Golden-thread smoke, Codex's spec unchanged | 1 passed | 1 passed |
| Adapter readiness check `-c e2e/adapter/adapter-check.config.mjs` | 1 passed, 1 failed (see A1 below), then 2 passed | 2 passed |
| `node scripts/e2e/objective-review-acceptance.mjs` | 1st invocation **failed**, 2nd passed 3/3 | passed 3/3 |
| Production build | not re-run: `next/font` cannot fetch Google Fonts from this environment | not re-run |

Notes on the table:
- **Skips.** All but one are placeholders whose real-prerequisite variants ran. The remaining one is
  the unwritten "[PLANNED INTEGRATION, case 4] processing_status write failure…" in
  `reportImportCompletion.test.ts`.
- **Test expectations.** None were weakened between b5a2a4d and c07eea8; the only removed assertion
  lines are version bumps, and stricter cases were added.
- **The failed objective-script invocation.** It timed out after 5 s waiting for the saved objective
  text on a freshly started dev stack. The cause is probably first-request compilation, but this is
  not established. It stays recorded as failed.
- **Model calls and spend.** No model or provider calls were made. Spend is unchanged at
  US$3.817316 of US$10.
- **Disposable resources.** All were stopped by PID, and no `ie_e2e_*` database or role remains.

## Repairs made tonight (Claude-authored: need independent review)

1. **Regeneration undid researcher rejections (reproduced, OBJ-REV-004 and business decisions).**
   - What failed: when the model re-suggested wording the researcher had rejected, the framers
     inserted it again.
     - Objectives: a pending duplicate appeared beside the rejected row.
     - Decisions: the duplicate was inserted as accepted and re-entered `runs.decision_statement`.
   - Fix: a shared rule in `src/lib/candidateSuggestionFilter.ts`, used by both
     `objectiveFramer.ts` and `decisionFramer.ts`. Inside the regeneration transaction, after the
     undecided suggestions are removed, a suggestion is skipped if its trimmed wording is already on
     the run (identity as in 0083). Duplicates within one answer collapse to the first occurrence.
   - Recovery case: if nothing new remains, the transaction rolls back with a visible "Nothing was
     changed" error, so the undecided suggestions are kept.
   - Tests: `src/lib/__tests__/objectiveDecisionClosure.db.test.ts`, 5 real-DB tests.
     - The two regeneration tests fail on the unrepaired framers.
     - The fake client in `decisionCandidateProvenance.test.ts` was extended to answer the new read
       query. Its assertions are unchanged.
   - Limits: trimmed-text identity only, so no case or semantic matching. Concurrent regenerations of
     one run are not serialised.
2. **The flipped-workbook guard refusal was buried and misframed (reproduced, IMP-009 / Task B).**
   - What failed: the engine's refusal and its re-export guidance appeared only inside per-variable
     alerts, repeated once per variable. Each began "Retry loading this file. Couldn't read this as
     SPSS/Stata/SAS data", even on an Excel file.
   - Fix:
     - `ImportVariablesPanel.tsx` shows one file-level notice. It keeps the existing "Question
       definitions could not be checked" alert text, which Codex's harnesses rely on.
     - `parseStatsFile.ts` now prefixes engine errors with the format-neutral "Couldn't read this
       data file".
   - Check: `e2e/ui/flipped-codebook-guard.check.mjs` (native).
     - It shows exactly one notice with the guidance and without the SPSS framing.
     - The notice survives a reload.
     - Recovery through a rows-per-respondent re-export works.
     - It fails on the unrepaired panel (4 notices).
   - Remaining limits:
     - The notice sits in the selected file's Variables group, not beside Accept data.
     - Accepting the data is not blocked.
     - Cross tabs and Drivers output for the refused file is covered by engine tests only.
3. **My own adapter readiness check asked for a mean the engine deliberately does not show (A1).**
   - The check asked for the mean of golden Recommend, whose value labels are the bare codes 0–10. For
     such labels `_is_ordered_scale` deliberately shows no mean.
   - The check now reads the mean of the worded 1–5 Satisfaction scale. For Recommend it requires the
     adapter's visible refusal.
   - This is a check correction, not a product change. Whether a 0–10 scale labelled only with
     numbers should get descriptives is an open analytical question for the owner; the engine was not
     changed.
4. **New closing tests with no source change.**
   - `objectiveEvidenceClosure.db.test.ts`, 5 real-DB tests:
     - REV-006: the selector resolves Yes on Purchase by Gender (60/40); this persists with its table
       and survives reload. An ambiguous or generic case persists as inconclusive.
     - REV-007: a stale result is retried in place, leaving exactly one current row.
     - REV-007: a failing edit transaction, and separately a failing evaluate transaction, leave the
       prior result and revision unchanged.
   - `objectiveDecisionClosure.db.test.ts` also covers:
     - SET-002: a failed quality refresh is retried without a duplicate.
     - Business decisions: the statement holds exactly the accepted decisions.
   - The planner and table builder stay controlled in these tests.
5. **Documentation.**
   - `claude/trust-milestone-contract.md` now says the native "regenerate" step established nothing:
     the replay has no `record_objective_candidates` answer, so the framer refuses. It also records
     the new regeneration rule.
   - `claude/import-resource-boundary.md` records the notice behaviour.

Earlier Claude-authored items also still need independent review, carried forward:
- Repair 7: E1–E3 (unsigned flip, literal ID, cache upgrade), T1–T3 (registry, membership, backup)
  and A1–A2 (adapter mean identity, counted navigation).
- The original three-pane commits.
- The setup-loading guard design. Codex integrated and repaired it.

## Row dispositions

Evidence levels used in the tables:
- **R**: retained test re-executed tonight.
- **N**: Codex native or actual evidence, reviewed but not re-executed.
- **C**: new Claude test or check, executed tonight; still needs independent review.

### Import

| Row (partition status) | Evidence | Disposition |
|---|---|---|
| IMP-001 / IMP-016 (Blocked) | R tenant/role DB tests | Unchanged. This is a separate security gate: deployed identity, storage privacy, deployed role and migration runner. |
| IMP-002, IMP-003, IMP-006, IMP-008, IMP-011, IMP-014 (Closed) | R | Closures preserved. |
| IMP-004 (Awaiting) | R+N | Met, with recorded limitations: the first invocation failed and the pass came from a continuation; values in saved tables are not checked after reload; means depend on the declared type. New open question: a 0–10 scale with numeric-only labels gets no mean (see repair 3). |
| IMP-005 (Awaiting) | R+N | Met, with a recorded limitation: calculation under a group correction is shown at dictionary level only. |
| IMP-007 (Awaiting) | R+N | Met, with a recorded limitation: storage is a local stand-in. |
| IMP-009 (Awaiting) | R+N+C | At c07eea8 the guard refusal was buried and misframed (repair 2). Repaired; needs independent review. E1–E3 still need independent review. |
| IMP-010 (Awaiting, deferrable) | none | Not met: there is neither a bounded reopen/true-count/no-reparse check nor a documented preview limitation. Stays deferred. |
| IMP-012 (Awaiting) | R+N | Met. |
| IMP-013 (Awaiting) | R | Met, with recorded limitations: persistence is re-queried in the database rather than reloaded in the UI, and the documents share one run. |
| IMP-015 (Awaiting) | R+N | Met, with recorded limitations: the export check ran on an early runtime, and saved-table content is not checked after reload. |
| IMP-017 (Untested) | R+N | Not met. The first v12 concurrent exact-limit invocation **stays failed**. In it, one project's upload returned HTTP 200 after 18.5 s but left no document row and logged no error. What the researcher saw, and whether cleanup state or a storage object remains, is unestablished. The later 35.1 s pass does not explain it. |
| IMP-018 (Untested) | N | Met, with recorded limitations: SAS is excluded by owner decision; the valid-SAV pass comes from an invocation that failed later; `processing_status` stays null. |

### Objectives and decisions

| Row (partition status) | Evidence | Disposition |
|---|---|---|
| OBJ-SET-001 (Awaiting) | R+N | Met, with recorded limitations: the native run was on source older than c07eea8, and its harness is not retained in the repository. |
| OBJ-SET-002 (Awaiting) | R+C | At assessment, a commit/refresh failure followed by a retry was unestablished. Now established by a new real-DB test; needs review of that test. |
| OBJ-SET-003 (Awaiting) | R | Met, with a recorded limitation: delete → regenerate → reload has never run natively with a usable model answer. |
| OBJ-SET-004, OBJ-SET-005, OBJ-REV-003, OBJ-REV-010, OBJ-REV-M03 (Blocked) | none | Unchanged historical-definition gaps. |
| OBJ-SET-M02 (Awaiting, deferrable) | stale code-level checks | Not met. Stays deferred. `normalization.cjs` pins source hashes that have since changed. |
| OBJ-REV-001/002, OBJ-REV-009, OBJ-REV-011 (Closed) | R | Closures preserved. |
| OBJ-REV-004 (Awaiting) | R+N+C | The defect was reproduced and repaired (repair 1); needs independent review. The propagation repair in `ObjectiveReviewTable.tsx` was assessed as sound. The native "regenerate" step did not regenerate. Not covered: the overview's direct Accept click, and a comparison of status labels between the two presentations. |
| OBJ-REV-005 (Untested) | R | Not met. No test shows a stored qualification for unsupported uncertainty: the non-independence of Net versus member, the ambiguous-design note, and the lack of multiplicity correction (which appears only in a code comment). |
| OBJ-REV-006 (Confirmed defect) | R+N+C | Selector persistence and reload are now established by a new real-DB test; needs review. Two limitations are recorded. First, the first real-provider invocation returned inconclusive and passed only after the wording was made explicit; this failed safely but is not recorded in the register. Second, the result stores the answer label ("Yes"), not the raw code, which conflicts with standing requirement 3. |
| OBJ-REV-007 (Awaiting) | R+C | Retry after a deleted table, and rollback of the edit and evaluate transactions, are now established; needs review of those tests. |
| OBJ-REV-008 (Awaiting) | R | Met, with recorded limitations: a duplicate with full coverage is untested; in the extras case the conclusions match the earlier batch, so a preserved batch cannot be told from a rewritten one. |
| OBJ-REV-012 (Awaiting) | R+N | Met, with recorded limitations: DOCX is the only output exercised, and the degraded flag in the DOCX test is inserted by SQL; the PPTX route and the native badge are unexercised. |
| OBJ-REV-013 (Awaiting) | R+N | Met, with a recorded limitation: the native retry ends as an uncomputed planner error, so a computed retry is shown at database level only. |
| OBJ-REV-M04 (Awaiting, deferrable) | N | Met, with a recorded limitation: the guard and load-failure behaviour is undocumented. |
| DEC-001 (Closed) | R | Closure preserved. Tonight's change to `decisionFramer.ts` keeps all retained DEC-001 tests passing. |
| Business-decisions remainder (Untested) | R+N+C | Statement exclusion is now established, and the related rejected-decision resurrection was repaired (repair 1); needs review. Failed-refresh recovery is still shown for own-add only. |

### Analysis and findings handover

| Row (partition status) | Evidence | Disposition |
|---|---|---|
| ANA-NPS-003 calculation-input subcase, and findings-freshness subcase (Closed) | R | Closures preserved. |
| FND-001 / REP-OUT-001 (Confirmed defect) | R+N | Wrong-group grounding is met, with recorded limitations: persistence is scripted; rounded controls are tested at the validator only; the outcome is a qualified save, not a refusal. Handover is met for change, delete and rejection. The design-triggered lifecycle is not met (see the next row). |
| ANA-NPS-003 downstream freshness handover (Untested) | N | Not met. The native pass reused a project that was already qualified, and its harness probably re-saved an unchanged PSU. Its checks would match pre-existing text. The design-change exports were not retained, and no unaffected-support control was run. |
| Probe B lifecycle (section 2) | R+N | Met, with a recorded limitation: the browser PPTX invocation **stays failed**, so the PPTX evidence is the HTTP continuation only. |
| Task D downloads (section 2) | R+N | Not met: there is no assertion that nothing downloads on the injected HTTP 500, and the retried file's content is not checked. The earlier deck-event timeouts stay failed. |
| Office rendering (section 2) | N | Met, with a recorded limitation: LibreOffice only, so no all-Office claim. Claude made its own contact sheets from the retained PDFs because the render script was not retained. |

Unchanged:
- The SAS exclusion and the flipped-workbook plus separate-Codebook weight/MR exclusion remain in
  force.
- The deferrable rows stay deferred.
- Research Quality Review remains design-only.
- The public-release security and deployment gates (trusted user-to-tenant identity, storage privacy
  and signed links, deployed role and schema, migration and backup runner) need the real
  environment and owner authorisation.

## Proposed for owner decision tomorrow (not applied)

- **Promote if accepted.** If Grant accepts the recorded limitations, and Codex independently
  reviews the repairs where noted, these rows could move to Closed: IMP-004, IMP-005, IMP-007,
  IMP-012, IMP-013, IMP-015, IMP-018, OBJ-SET-001, OBJ-SET-003, OBJ-REV-008, OBJ-REV-012 and
  OBJ-REV-013.
- **Promote only after Codex reviews tonight's Claude work:** IMP-009, OBJ-SET-002, OBJ-REV-004,
  OBJ-REV-006, OBJ-REV-007 and the business remainder.
- **Bounded work still needed:**
  - ANA-NPS-003 design handover: a fresh native project with a real PSU change and an
    unaffected-support control.
  - Task D: the absent-download assertion and a content check of the retried file.
  - OBJ-REV-005: persisted qualification cases.
  - IMP-017: a forensic look at the failed v12 run, or a repeat that captures what each page shows.
  - OBJ-REV-006: whether the raw code should be persisted.
  - IMP-010: the check or a documented limitation.


## Codex independent review of laptop9ab38eb and repair5008041 ? 2026-10-16

This addendum supersedes earlier dispositions only where explicitly stated. Confirmed laptop HEAD
9ab38eb93fb80908b6b5c5e5dac7f409d5d5344f on checkpoint/trust-hardening-20261016; repair
5008041fc4dc16c88ae58218331665a66a82065c has the declared13 paths. Tracked tree was clean before
Codex recorded CODEX_WORKING. Application source remained read-only. No push/deployment or real
model call; spend unchangedUS$3.817316 ofUS$10. The43-row12/18/2/5/6 partition is unchanged.

### Independent execution and evidence boundaries

Local evidence directory: scripts/workflow-tenant-review/laptop-review/ (not committed runtime data).
Released objectiveDecisionClosure, objectiveEvidenceClosure and decisionCandidateProvenance suites:
**3 files,13 passed,1 inactive placeholder skipped**, actual isolated PostgreSQL. The planner,
model and table-builder boundaries remain controlled exactly as disclosed; database/loader/rollback
operations are real. Existing whole-tree817/34 gate and prior build are retained evidence, not
reported as rerun here. Installed Next client-boundary guidance was read before UI assessment.

The released native flipped-Codebook check passes after ONLY the isolated harness's python3 command
was changed to the installed Windows python executable. Original python3-not-found invocation is
failed/tooling, not a product failure. Assertions were unchanged. The recovery portion establishes
upload/default layout and absence of an additional refusal; it does not select the recovered file's
variables or compute a recovered result, so it alone is not full analytical recovery certification.
Shared-reader recovery controls remain separate. The adapter mean check correction is valid at its
mechanics scope: Number.isFinite is not an independent arithmetic expectation; retained7.1 and6.5
reference evidence must not be replaced by that assertion.

Additional actual-DB probes: Net/member qualification and ambiguous-PSU qualification persist and
survive the actual action loader (7 passes including the copied5 closing cases,1 expected failing
multiple-testing qualification assertion,1 inactive skip). The stored comparison summary says only
"Yes: Male60% vs Female40%, gap20 (95% interval6.4 to33.6), expected higher." It carries no
multiplicity qualification. **Correction to Claude's earlier statement:** the general UI disclaimer
already exists in ObjectiveEvidence.tsx:448; this is not confined to a code comment. The precise
remainder is whether that global disclaimer meets the durable/downstream qualification contract,
or whether the saved result/output must carry it. Do not claim the current UI hides this limitation.

### Required repair finding: whitespace identity still resurrects rejected suggestions (P2)

src/lib/candidateSuggestionFilter.ts:30 selects SQL trim(candidate_text), which trims ordinary spaces;
line36 normalises incoming wording using JavaScript trim(), which also trims tabs/newlines and
other whitespace. These are different identities despite the comment claiming one shared rule.
Actual caller/DB probe: generate "Suggestion to reject\t", reject it, then regenerate the same
words with ordinary surrounding spaces. The rejected original remains, but a new pending copy is
inserted. A corresponding decision-specific probe generates/rejects "Launch in region A\t" and
then regenerates its plain wording: a fresh accepted copy appears. The shared statement-sync path
can therefore reintroduce researcher-rejected wording. Ordinary-space regressions pass; the repair
is partial, not independently closed. This is under existing OBJ-REV-004/business identities,
not an added release row. The objective probe's later all-repeat failure is the same root cause,
not another defect.

Smallest fix: use the same authoritative normalisation on existing and proposed text before
comparison, without rewriting preserved human wording. Closing evidence must cover both framers,
ordinary-space/tab/newline boundaries, distinct wording preserved, answer-local duplicates, and
all-repeat rollback/retry preserving previous suggestions and the accepted decision statement.
No broad refactor or semantic matching is required. Concurrency remains a disclosed unclosed
boundary; no new concurrent failure is asserted from inspection alone.

Other coding-standard assessment: the filter is shared between the framers, receives their own
transaction client and accepts only internal table-name literals; UI notice stays in its layer,
parser prefix remains server-side. No newly introduced statistical calculation or measured
performance problem was found. The SQL/JS identity mismatch is the concrete correctness and
maintenance issue; no speculative abstraction or performance finding is added.

### Fresh native handover and download-gap investigation

A NEW synthetic project bf27399b-5707-4dd1-bac3-37c218e9c764 used native upload/calculation/posting,
then explicit synthetic accepted insight/recommendation support fixtures (current SQL fingerprints).
One source is the actual calculated finding; the unrelated control is an interview-style finding
without that calculated-table dependency. Narrative generation uses explicit model replay.
Before mutation both insight badges and narrative banner are absent/current. Saved PSU is null;
changing it to Gender via the native picker is checked against the actual saved document before
reload. No SQL design mutation and no unchanged-PSU substitution.

After reload the calculated insight becomes stale while the unrelated insight remains current;
recommendation/narrative qualify; actual retained DOCX/PPTX qualify and keep the unaffected human
action exactly. Initial attempts1-3 failed during synthetic fixture setup (wrong column, existing
pre-insight uniqueness, required recommendation field); attempt4 reached/passed current-before and
affected/control-after assertions, then failed on a hidden retained-section locator. The same-
project continuation uses a visible recommendation locator and passes the remaining assertions.
This is combined bounded evidence, NEVER a wholly green original invocation. These fixtures test
dependency propagation, not model interpretation or fresh synthesis quality.

Task D on that same project: injected HTTP500 export visibly rejects; zero download events are
observed through the response plus1.2seconds; only the affected export is retried. Its actual
workbook is saved and parsed and contains the expected control finding. This closes the previously
missing bounded absent-download and retried-content assertions; it does not prove no arbitrarily
late event can ever occur. Earlier browser PPTX/deck timeouts stay failed.

### IMP-017 retained-run forensics

The password-free native-v12 dump DOES contain trace27 for failed run
07f54a4b-ec05-4c85-b2f8-bb527ae3cd6d at2026-10-16T13:17:10.080606Z:
upload_error, at-both-limits-1.csv, "Upload of at-both-limits-1.csv failed: fetch failed".
At retention it has zero document rows and no pending-cleanup trace. Therefore "logged no error"
is superseded. HTTP200 alone is not success for this server action: documentUploadActions.ts
returns an ok:false result on caught upload failure. The original harness inspected persisted row
count, not that response payload/page error. The retained storage inventory contains referenced
objects, not an exhaustive listing: absence there cannot prove no orphan existed. Failed-page UI,
response body and complete storage outcome remain unavailable. The original invocation stays
failed and IMP-017 remains unresolved; the separate35.105second concurrent pass is preserved.

### Current row-level dispositions (no partition promotion)

Verified below means the stated finite assertion/evidence level, not whole-module sign-off.

| Existing row / scope | Current disposition |
|---|---|
| OBJ-REV-004 | **Partially repaired; unresolved defect.** Ordinary-space regeneration/rollback verified; tab boundary resurrects a rejected objective. Propagation repair and earlier native passes preserved. Direct overview Accept/status-label comparison remain specifically unestablished. |
| Business-decisions remainder | **Partially repaired; unresolved defect.** Statement/exclusion ordinary cases verified, but rejected tab-wording is inserted accepted. Failed-refresh evidence remains own-add only; broader mutation recovery is not inferred. DEC-001 unchanged. |
| OBJ-SET-002 | **Verified at new actual-DB closing-test scope.** Post-commit quality-refresh failure/retry leaves one own objective. Existing concurrency/fallback evidence retained; no REV-009 reopening. |
| OBJ-REV-006 | **Verified selector persistence; unresolved identity disposition.** Actual Yes60/40/table/loader and generic refusal pass. Estimate stores a label, not raw code/question key. That omission is confirmed, but the cited standing correctness rule3 does not explicitly require a new storage field. Resolve the canonical-identity contract explicitly, or add durable identity with affected tests; do not invent an independently reproduced misattachment from this omission alone. Preserve first provider inconclusive/refusal and later explicit-wording success as distinct invocations. |
| OBJ-REV-007 | **Verified at new actual-DB scope.** Deleted-table stale retry replaces in place; edit/evaluate write failures roll back. Earlier concurrency/no-op evidence preserved. |
| IMP-009 / Task B | **Notice repair verified with limits.** Native single neutral notice/reload passes; recovered-upload check is narrower than analytical recovery. E1-E3/shared guard evidence preserved. Full flipped/separate-Codebook combination remains approved conditional exclusion/backlog, not a substituted control pass. |
| Unassigned A1 adapter finding | **Check correction accepted at mechanics scope.** Worded-scale mean and unsupported numeric-label refusal match the implementation; independent arithmetic references remain separate. Numeric-only scale policy is an owner analytical question, not a newly measured engine defect. |
| OBJ-REV-005 | **Partially verified; unresolved durable qualification.** Net/member and ambiguous-design qualification now persist/reload; stored multiplicity note absent, global UI disclaimer present. Determine/meet the exact durable/output requirement before closure. Existing mean/percent/base/equality tests preserved. |
| ANA-NPS-003 downstream freshness | **Representative native propagation verified at fixture scope.** Fresh-current preconditions, real PSU change, unaffected control, reload, qualified outputs and retained exports pass across failed invocation plus continuation. No full generation/model-quality certification. |
| FND-001 / REP-OUT-001 handover dependency | **New design-triggered subcase verified as above.** Retained independent semantic assessment and body/reject/delete scopes preserved; no blanket repair of all consumers inferred. Canonical row status unchanged. |
| Task D | **Missing bounded assertions verified.** Zero downloads during injected failure/settlement and actual retried workbook content pass; historical timeouts unchanged. |
| IMP-017 | **Unresolved.** Forensic trace corrects the unlogged-success allegation; failed UI/complete storage outcome remains unestablished. No fresh repeat or manufactured explanation. |
| IMP-010 | **Deferred, unverified.** No new bounded reopen/true-count/no-reparse run or product-facing limitation was delivered by this review. Retain as deferrable, not silently closed. |
| IMP-004 | **Retained verification with unresolved stated reload-content limit.** Do not silently waive the declared-value-after-reload assertion merely by calling it a limitation. No new scale calculation change. |
| IMP-005 | **Retained verification, limited to actual dictionary/calculation boundaries already demonstrated.** Group-correction calculation beyond dictionary evidence is not inferred. |
| IMP-007 / IMP-012 / IMP-013 / IMP-018 | **Retained scoped verification.** Respect local storage, controlled reread, actual-DB reload and split native-format invocation boundaries; no new source change or unsupported promotion. SAS remains excluded. |
| IMP-015 | **Retained passes; stated final-source/export and saved-content-after-reload limits remain unresolved evidence.** No new conflict failure asserted. |
| OBJ-SET-001 / OBJ-SET-003 | **Retained scoped verification with native-generation/source-age limits.** New actual regenerated-candidate tests improve review evidence but do not prove every native regenerate/delete lifecycle. |
| OBJ-REV-008 / OBJ-REV-012 / OBJ-REV-013 | **Retained scoped verification with the named index/degraded-output/computed-native-retry limits.** No new parser or evaluator defect inferred. |
| OBJ-SET-M02 / OBJ-REV-M04 | **Deferred remainders.** Stale marker evidence and incomplete guard/load-failure documentation do not become new release blockers. |
| Five unavailable historical definitions | **Deferred evidence gaps unchanged.** Recover/archive explicitly; never infer fixes. |
| Existing twelve Closed rows | **Preserved.** Neither this review nor failures of unrelated harness setup reopen them. |
| IMP-001/016 and separate deployment gates | **Unresolved external prerequisites.** Local T1-T3 evidence does not certify trusted deployed identity, actual storage privacy/signed-link policy, final role/schema or migration/backup runner. No deployed action authorised. |
| Research Quality Review | **Design-only and separate.** No feature coding or fit completion inferred. |

Overall acceptance remains **incomplete**. Authorised next implementation is the reproduced shared
whitespace defect, then only specifically missing supported acceptance assertions/dispositions.
Runtime/setup failures, historical failed product invocations and passing continuations remain
separate. No new issue IDs or canonical rows were introduced.

## Claude repairs after Codex review (2026-10-16, evening; commit 34cb123)

Claude-authored; needs independent review. The 43-row partition is unchanged. Earlier passes and every failed invocation stay recorded as they were.

Executed on the repaired tree (cloud workspace, disposable PostgreSQL 16 and Python):
- `npx tsc --noEmit -p .` pass; eslint on all changed files pass.
- `TEST_DATABASE_URL=… npx vitest run src/lib/__tests__ --pool=forks`: 113 files, 825 passed, 0 failed, 36 skipped (placeholders, plus the known unwritten case-4 integration skip).
- UI checks: 11 passed. Golden-thread smoke: 1 passed. Objective-review script: 3/3, twice.
- Adapter readiness check: the first invocation of this round failed, 1 passed and 1 failed. The cloud container's memory limit killed the dev server (4.6 GB) after the long browser sequence, giving ERR_CONNECTION_REFUSED. The objective script failed in the same invocation. On a fresh stack both passed (adapter 2/2). The failed invocation is retained; it is not an app result.
- Production build not re-run (Google Fonts unreachable here). No model calls; spend unchanged.

| Row / scope | Change | Evidence | Disposition proposed |
|---|---|---|---|
| OBJ-REV-004 and business decisions (whitespace identity) | `candidateWordingKey` (JavaScript trim) applied to stored and new wording. SQL `trim()` is no longer used for this comparison. | Codex's two repro suites (10 cases) failed 3, then pass. New regressions: tab, LF, CRLF, no-break space and spaces on either side; inner spacing, case and punctuation stay distinct; answer-local duplicates; all-repeat rollback with the prior suggestions and decision statement kept, then a usable retry. Two regressions fail on the old filter. | Repaired; needs review. Own-add guards and the 0083 index still use SQL `trim()` for researcher additions (separate rule, unchanged). |
| OBJ-REV-006 raw identity | The estimate stores `answerIdentity` {question, rawCode} and `groupAIdentity`/`groupBIdentity` {variable, rawCode}. Labels are unchanged. Nothing is guessed when the table carries no identity. | Pure reader tests (3); the closure test asserts identity after reload. | Contract met by durable identity; needs review. Older saved results lack it until re-evaluated. |
| OBJ-REV-005 durable multiplicity | A conclusion for an item that carried direct data evidence ends with the fixed note that intervals are not corrected for the number of questions checked. It is added after the word cap, so it is never cut. | Real-DB validator test: present only on the evidence-backed item, once, and kept across regeneration. | Durable and output contract met for new conclusions; needs review. Older conclusions are unchanged until regenerated. |
| OBJ-REV-008 duplicate with full coverage | A conflicting repeat refuses the whole answer and keeps the prior batch; an identical repeat is kept once. | Reproduced (the conflicting answer was saved), then repaired; real-DB test; existing index suite passes. | Repaired; needs review. |
| IMP-017 failed-page and storage outcome | The stand-in gains `{"put":"drop"}`, `{"put":"drop-after-store"}` and `/__inventory` (disposable only). | Native: both modes show "Upload of storage-check.csv failed" and leave no document, no pending cleanup record and no stored object (complete inventory), including when the bytes landed; the recorded trace text is the same "fetch failed" as the v12 run; a healthy retry stores the file once. | Outcome contract established for this error class. Why the v12 concurrent exact-limit pair hit it is still unestablished; that invocation stays failed. Hosted storage not covered. |
| IMP-004 / IMP-015 saved content after reload | New native check. | Golden Satisfaction mean (ref 3.5), top-two box (ref 50.0) and Purchase "Yes" (ref 50.0) match before reload and read identically from the reopened saved tables. A conflicting-label saved table keeps both labels and counts 3/1 after reload. | Saved-content-after-reload assertion met. |
| OBJ-SET-001 source age | Codex's lifecycle harness ported to `e2e/ui/objective-setup-review-identity.check.mjs`. | Passes on the current tree. Its first run failed because the original harness reloaded before the Setup edit had saved (the new wording shows before the 0.7 s save completes; the database then held B). The check now waits for the stored row. | Met on current source; needs review. Observation for Codex, not a defect claim: Setup shows edited wording before persistence. |
| IMP-009 recovery scope | Flipped-guard check extended. | After deleting the refused file: no notice; Opt_A/Opt_B keep Multiple response from the Codebook; Gender table counts 2/2. | Analytical recovery established at this scope. |

Still deferred or external: IMP-010, OBJ-SET-M02, OBJ-REV-M04, the five historical definitions, SAS and the flipped/separate-Codebook exclusion, and the security/deployment gates. Remaining limits named earlier and not addressed here: the overview direct-Accept click and status-label comparison (OBJ-REV-004); the IMP-005 group-correction calculation beyond the dictionary; OBJ-REV-012 PPTX/native badge; OBJ-REV-013 computed native retry.



## Codex independent review of34cb123 at laptopf873608 ? 2026-10-16

Confirmed HEADf8736084f83e274741d3cdff0d120ac7c0cb8a0a, repair34cb1232e41539d237597380b7400e39b1fb5d8a,
branch checkpoint/trust-hardening-20261016. Tracked tree was clean before CODEX_WORKING was recorded.
Application source stayed read-only. All15 released paths match current and isolated tested bytes
(LF normalised; only two isolated native checks replace python3 with installed Windows python).
Comparison/evidence: scripts/workflow-tenant-review/review34/. No dependencies installed, paid model
calls, live/development mutation, push or deployment. Spend unchangedUS$3.817316 ofUS$10.
The canonical43-row12/18/2/5/6 partition remains unchanged; dispositions below are finite scopes.

### Executed checks and retained history

- Affected suites:10 files,65 passed,4 inactive placeholders skipped, actual isolated PostgreSQL.
  Includes whitespace/retry/provenance, evidence identity/stance, selector persistence/rollback,
  multiplicity storage, duplicate refusal and prior index/nonowner degradation controls.
- Additional independent test removes the implementer's mocked evidence digest and seeds actual
  linked text-identity evidence/results: the real digest maps only the intended objective, the note
  is stored after the cap exactly once and regeneration preserves it.1 pass/1 inactive skip.
- Released native checks:5 passes (3minutes): flipped-workbook recovery, Setup/Review identity,
  golden saved figures/reload, conflict-label counts/reload, both upload storage-write fault modes
  and healthy retry. Python executable adaptation changes no assertions/application bytes.
- A separate smaller-limit native check passes direct overview Accept/durable accepted state and
  overview/detail Inferred-label plus Unaccept-control comparison, then FAILS the missing native
  degradation-warning assertion. This remains a failed invocation, not a green combined run.
- Same-project output continuation passes actual DOCX/PPTX extraction: both carry the complete
  multiplicity note and Evidence check degraded qualification. Saved qualification/degraded flag
  is a synthetic fixture; actual nonowner permission-failure generation/reload remains separately
  executed DB evidence. No claim of a continuous native permission-failure trigger.

The implementer-reported cloud memory kill/connection refusal, first reload-before-save harness
failure, older v12 failure, Probe B browser PPTX and other historical failures are preserved. The
cloud memory cause is reported evidence, not independently reconstructed on this laptop. The
cloud825/36 full gate,11UI/smoke/adapter totals and unavailable-font build limitation are retained
claims at their documented scopes, not rerun totals here. The local e2e-results report originally
present on receipt described an older hydration-only run; new review34 logs/report in the isolated
runtime establish the independent current native results instead. Source archive/hash comparison
establishes identity, not historical test execution. No whole-project build claim is added.

### Review of the repaired mechanisms

The shared candidateWordingKey now normalises stored and proposed text through JavaScript trim.
Both framers retain their transaction/rollback and human wording. Tab/LF/CRLF/NBSP/ordinary-space
boundaries, distinct internal wording/case/punctuation, answer-local duplicate and all-repeat retry/
statement controls pass. The earlier reproduced resurrection defect is closed at this regression
scope; unchanged SQL-trim own-add/index semantics and un-serialised concurrent regeneration remain
explicit separate limits, not silently changed or newly reproduced defects.

Raw identity now accompanies display labels in the estimate: question key/raw answer code and
banner variable/raw code(s), with no label-derived guesses when identity is absent. Pure opposite-
group/level/missing-identity controls and actual saved selector result reload pass. Older results
remain without these fields until re-evaluation; no migration/backfill or broader provenance claim.

Multiplicity qualification is durably appended to conclusions with an actual direct-evidence digest
entry after the word cap. The real-digest control confirms the production key mapping rather than
only a mock has() override. Actual both-format export transport preserves the full stored note.
This meets the new-conclusion/output assertion; older conclusions require regeneration. It does
not modify intervals or add a multiplicity correction, nor claim the raw per-question estimate
summary contains this conclusion-level note. Existing global UI disclaimer remains valid.

Conflicting duplicate assessments (different conclusion or status) refuse before replacing the
stored batch; exact normalized repeats store once. Actual DB tests preserve the prior batch, and
prior fractional/omitted/extra tests pass. Comparison of citation arrays remains order-sensitive:
a reordered equivalent citation set can conservatively refuse; no incorrect accepted result is
inferred and no semantic deduplication is claimed.

Layering/security/comments: new identity reading is pure; filter is shared in the existing server
transactions; validation persistence and run/tenant boundary remain in their prior server layer.
Storage inventory/write-drop hooks are confined to the explicitly disposable loopback harness,
not an application storage authorization route. No new statistical calculation or measured
performance defect is identified. No unrelated abstraction/refactor is requested.

### Four smaller outstanding limits ? individual disposition

| Existing scope | Independent result | Disposition / next action |
|---|---|---|
| OBJ-REV-004 overview direct Accept and status-label comparison | Actual native direct Accept persists; overview/detail display Inferred and Unaccept for the same accepted AI candidate. Existing state transition suites remain passing. | **Verified for the named accepted-state boundary.** Preserve prior reject/edit/regeneration scopes; not a new all-status UI permutation matrix. |
| IMP-005 group-correction calculation beyond dictionary | No new numerical caller/engine check under a saved question-group correction in34cb123. Native workbook MR-definition recovery is imported Codebook metadata, not a researcher group correction. | **Unresolved acceptance assertion.** Save a supported group change, calculate using its effective membership/kind with an independent expectation, clear/reload and recalculate. Existing type/group dictionary/clear evidence remains valid; no new defect asserted. |
| OBJ-REV-012 PPTX/native degraded badge | PPTX qualification now independently verified. Primary Review Objectives coverage FAILS: stored evidence_digest_degraded=true, status partial and conclusion persist, but coverage shows Partly answered without the warning. | **PPTX projection verified; native correctness defect unresolved.** See finding below. Database nonowner failure/retry and prior DOCX closure preserved. |
| OBJ-REV-013 computed native retry | Actual durable mixed-write failure/retry and zero-progress reload/Continue evidence preserved. Latest native retry still ends in an uncomputed planner refusal; no successful computed native retry added by this repair. | **Unresolved native boundary.** Capture native durable-write failure, pending/reload, healthy computed retry and exactly one saved current result. Scripted planning is permitted as a disclosed boundary; do not call a planner refusal computed success. |

### Concrete finding under existing OBJ-REV-012: native coverage drops degradation (P2)

Not introduced by34cb123, but independently reproduced while assessing its named remainder.
ObjectiveCoverage.tsx:7 defines Validation without evidence_digest_degraded and its result card
around line115 renders conclusion/status only. page.tsx passes the full validation objects, but
the active Review Objectives coverage component ignores the true flag. The older narrative panel
has a warning; its presence does not qualify this primary review presentation.

Reproduction: synthetic current-schema objective with objective_validations.status=partial,
evidence_digest_degraded=true and a persisted conclusion; reload Review Objectives. The conclusion
and Partly answered label are visible, while Evidence check degraded is absent. Actual stored flag
was re-queried after the failed assertion and remains true (degraded-durable-state.json), excluding
a later refresh/fixture overwrite. smaller-boundaries-error.txt retains the researcher-visible text.
The native check seeds the flag, whereas the affected DB suite separately demonstrates the real
permission-failure path writes that flag; the UI projection defect itself requires no model claim.

Consequence: a researcher reviewing objectives cannot tell that the conclusion was generated while
its direct-evidence retrieval failed. Smallest fix: carry the existing degradation field into the
coverage presentation and visibly qualify that result, including selection/filter and reload.
Use the existing wording/semantics rather than a parallel reliability classification. Closing check:
true flag warns in actual Review Objectives coverage/detail as applicable; false control does not;
reload retains qualification; restored lookup/reassessment clears it. Preserve full human conclusion,
status and existing DOCX/PPTX output qualifications. No new issue ID/canonical row.

### Affected-row disposition reconciliation

| Existing row / subcase | Latest disposition (no count promotion) |
|---|---|
| OBJ-REV-004 / business whitespace | **Repaired and independently verified** for both callers' whitespace/retry/statement contract. Prior failure retained as superseded by named repair. Other business refresh/bulk limits are not inferred closed. |
| OBJ-REV-006 raw identity / selector persistence | **New durable-identity contract independently verified.** Actual question/raw answer/banner identities survive loader reload. Preserve semantic ambiguity/refusal and historical provider wording boundaries; legacy estimates unchanged until rerun. |
| OBJ-REV-005 multiplicity | **New-conclusion durable/output subcase independently verified** with actual digest and both exports. Net/member/ambiguous-design and previous means/base/uncertainty cases retained; no actual multiplicity correction or legacy backfill claimed. |
| OBJ-REV-008 conflicting repeats | **Repair independently verified** for differing conclusions/status, identical repeats and prior-batch preservation. Existing finite index cases pass; no broader model-output audit. |
| IMP-007 / IMP-017 upload failure class | **Native failure/cleanup/retry assertion verified** before and after storage landing: visible filename error, zero document/pending cleanup/object in complete stand-in inventory; healthy retry once. Old exact-limit failure stays failed and cause unresolved. This establishes that error-class outcome on supported local code, not retrospective UI evidence or hosted/concurrent capacity certification. Preserve independent limit/boundary/concurrent passes. |
| IMP-004 / IMP-015 saved tables | **Named saved-content/reload gap verified:** independent3.5 mean/50% top box/50% purchase references persist; conflicting labels and3/1 counts survive reopen. Broader sparse/missing/export/source scopes retain their separate prior evidence; one fixture is not all scale cases. |
| OBJ-SET-001 current source | **Native dual-module identity assertion verified** on released bytes: A?B?C, one candidate ID, delete, reload, original brief unchanged. Wait for durable save corrects harness timing without claiming optimistic display is a defect. |
| IMP-009 / Task B recovery | **Named analytical recovery verified:** delete refused file, recovered Codebook MR types, Gender2/2 calculation. Full excluded flipped/separate-Codebook combination remains conditional exclusion/backlog, not full support. |
| OBJ-REV-012 | **Mixed:** durable failure/recovery and both export projections retained/verified; actual primary coverage warning defect remains required repair. |
| IMP-005 / OBJ-REV-013 | **Remaining named numerical/native-retry assertions unresolved**, as individually assessed above; prior narrower passes preserved. |
| Prior closed/deferred/excluded/external rows | **Unchanged.** Preserve12closed rows; IMP-010/M02/M04 and five historical definitions remain deferred; SAS/excluded workbook combination remain excluded; public security/identity/storage/role/migration/backup runner require authorised deployed environment. Research Quality Review design-only. |

Overall acceptance is **incomplete**. Next is a bounded OBJ-REV-012 coverage warning repair and only
the named supported remaining assertions. Four synthetic stored objects/full inventory and a
password-free cluster dump were retained; the owned review34 process tree and labelled PostgreSQL
container were stopped, reserved ports clear. Existing user/development resources were untouched.
Application source is unchanged; ownership release and local documentation checkpoint are in the
existing handoff/shared status. Historical failed invocations remain immutable evidence.

## Claude OBJ-REV-012 coverage repair and native remainders (2026-10-16, evening; commit 7a6ab5d)

Claude-authored; needs independent review. The partition is unchanged, and earlier passes and failed invocations stay as recorded.

Executed on the repaired tree (cloud workspace, disposable PostgreSQL 16 and Python):
- typecheck pass; eslint on changed files pass.
- Full suite: 114 files, 827 passed, 0 failed, 36 skipped.
- UI checks: 14 passed. Golden-thread smoke: 1. Adapter readiness: 2. Objective-review script: 3/3. The stack was restarted between suites to stay under the container memory limit.
- Production build not re-run (Google Fonts unreachable). No model calls.

| Row / scope | Evidence | Disposition proposed |
|---|---|---|
| OBJ-REV-012 Review Objectives coverage | `ObjectiveCoverage.tsx` forwards and renders `evidence_digest_degraded`. Static-render test: true, false and selected cases; conclusion and status kept. Native check: real revoke of the disposable app role's read on `objective_evidence`, then "Check now" stores `degraded=true`; after reload the badge, the visible line, the unchanged conclusion and "Answered" all show; after the grant is restored, "Check again" clears it, including after reload. Both tests fail on the previous component. DOCX/PPTX untouched. | Reproduced defect repaired; needs review. |
| IMP-005 calculation under a group correction | Native: MR_Convenience corrected to Single mention (stored override, reload) computes code 1 at 60% (golden reference 60, tolerance 0.1). After the clear (override removed, reload) the restored 3-item "Reasons" set computes Convenience at 60%, and the table saved under the correction shows "may be outdated". The set table is built with explicit workspace steps because the adapter's picker toggles "Row", not the set's "Row (all)". | Calculation remainder established; needs review. |
| OBJ-REV-013 computed native retry | Native: a disposable trigger refuses the result write, so "Could not save an answer for 1 question" shows, no row exists, and Continue reading is still offered after reload. After the trigger is dropped, the retry stores exactly one result (basis computed, stance supports, table set, no error), with nothing pending after reload. Data: men 24/30 Yes vs women 9/30. **Scripted planner boundary:** `submit_plan` is supplied by the new replay fixture rule; the engine table and evaluation are real. | Computed retry established at that boundary; needs review. |

Tooling: `scripts/e2e/model-replay.mjs` gains an `untargeted` fixture rule (disposable; existing answers and the `scripted` log field unchanged). Recorded in shared status before it was applied to this checkout.


## Claude overnight close-out (2026-10-16, from 19:46 SAST; commits a00dc0c, d72b150, 110183a, d5cbc6f)

Claude-authored throughout; every item below needs Codex's independent review. Overall acceptance is **not** claimed. The 43-row partition (12 Closed / 18 Awaiting / 2 Confirmed defect / 5 Untested / 6 Blocked) is unchanged. No row is promoted here, and every earlier pass and failed invocation stays as recorded. Base `48d76bc`; `7a6ab5d` (coverage repair) is still unreviewed and is part of this package.

### Commits (local, unpushed, on `checkpoint/trust-hardening-20261016`)

| Commit | Paths | Content |
|---|---|---|
| `a00dc0c` | 13 | Failed saves on objective, decision and recommendation controls are reported and keep the draft. Adds `saveStatedObjectiveEdit` (result-returning wrapper of `editStatedObjective`) in `runContextActions.ts`; `actionFailure.ts` (`actionFailureMessage`, `attempt`); route error boundary `runs/[id]/error.tsx`; failure reporting in `StatedObjectivesList`, `useObjectiveRowActions`, `ObjectiveReviewTable`, `ObjectivesWorkspace`, `DecisionBriefReview`, `RecommendationsReview`, `SynthesizedRecommendationsReview`. Tests: `actionFailure.test.ts`; native `setup-objective-save-failure`, `review-action-failure`. |
| `d72b150` | 6 | `ObjectiveEvidence.tsx`: a refused question save keeps the editor and draft; refused include/leave-out and retry are reported; a failed evaluation round keeps Continue reading offered. Native checks `evidence-edit-failure`, `raw-file-reopen` (IMP-010), `objective-marker-variants` (OBJ-SET-M02), `objective-regeneration-native` (OBJ-SET-003 / OBJ-REV-004). Notes in `claude/trust-milestone-contract.md`. |
| `110183a` | 11 | Evidence: native `native-formats` (IMP-018), Excel-download assertion in `saved-table-reload` (IMP-015), distinct-wording extras case in `objectiveValidationDuplicates.db.test.ts` (OBJ-REV-008), real-DB `narrativeWrongGroup.db.test.ts` (FND-001). Lint errors cleared without behaviour change in `TranscriptSetup`, `CodingProgressBar`, `AcrossTranscripts`, `CrosstabOptions`, `knowledge/content/import.tsx`, `driverAnalysis.ts`, `decisionCandidateProvenance.test.ts`. |
| `d5cbc6f` | 5 | Test harness and documentation only: native `concurrent-limit-uploads` (IMP-017); `raw-file-reopen` settles by stored-table identity; `local-stack.mjs` options `E2E_NEXT_START` and `E2E_STORAGE_PORT`; `scripts/e2e/font-mock.cjs`; `docs/validation.md` section "App-owned browser checks". |

Every commit was applied with `.fnd001/overnight/apply.py`, which refuses a target that differs from HEAD and reports 0 committed-byte mismatches against the LF-normalised tested hashes.

### Defect found and repaired tonight (reproduced first)

A refused server action crashed or silently passed in several researcher controls. Next.js withholds a thrown action's message (dev and production both send only a digest), so an uncaught refusal either reached the route without a boundary (the Setup objective edit took the whole page down and lost the draft) or was ignored (review buttons, the evidence editor, decision and recommendation cards showed nothing, and some editors closed as if the save had worked). Repaired generically: one shared `attempt()` helper turns a refusal into a visible "Not saved/Not changed/Not deleted: ..." alert (the reason, or a generic sentence with a reference when Next withholds it), editors stay open with the researcher's text, and the route gains an error boundary. Each native check installs a disposable trigger that refuses the write, asserts the alert, the kept draft and the unchanged stored row, then drops the trigger and asserts a normal save. The checks fail on the previous components (setup crash; no alert in review).

Not covered natively: Continue reading staying offered after a failed evaluation round (the evaluate action has to fail while the panel's own load still works), and the 60-round guard. Both are by code review only.

### Final-tree gate (cloud workspace, disposable PostgreSQL 16 on :55432, Python with pyreadstat)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx next typegen && npx tsc --noEmit -p .` | pass |
| Lint, changed and touched UI files | `npx eslint e2e/ui scripts/e2e/local-stack.mjs scripts/e2e/font-mock.cjs src/app/runs src/lib/runContextActions.ts` | 6 errors, 15 warnings. All 6 errors are the pre-existing `set-state-in-effect` findings (owner decision below); none is in a line changed tonight. |
| Unit and real-DB suite | `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks` | 116 files: **833 passed, 0 failed, 37 skipped** (placeholders and the known unwritten case-4 integration skip) |
| Production build | `next build --webpack` with the font stand-in and a migrated disposable database (`docs/validation.md`) | pass |
| App browser checks, production server | `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` | **22 passed** (3.5 min) |
| Golden-thread smoke | `npm run e2e:smoke` with the smoke variables | 1 passed |
| Adapter readiness | `npx playwright test -c e2e/adapter/adapter-check.config.mjs` | 2 passed (second invocation; see failed history) |
| Objective-review script | `node scripts/e2e/objective-review-acceptance.mjs` | 3/3 passed |

The stack was stopped by PID; no `ie_e2e_*` or `ie_test_build` database or role remains. Real infrastructure: PostgreSQL, the Python engine, Chromium, the Next.js production server. Controlled boundaries: the local storage stand-in (with fault hooks), the model replay (fixture answers), synthetic inserts and disposable refusal triggers, each named in the check's header. No model calls; spend unchanged at US$3.817316.

### Failed or incomplete invocations tonight (retained, not relabelled)

- Dev-server memory kills (about 4 GB in the 8 GB container) ended several long dev-mode browser sequences with connection refused. Not app results. Production mode was adopted for the full suite.
- Check-authoring failures before each check passed: hidden list items matched; the innermost container picked the header or button row; counted section names ("Recommendations 1"); the recommendation button is "Edit and accept"; replay rules matched against the system prompt instead of the user message; set rows use "Row (all)".
- `raw-file-reopen` failed once on the production server because it waited for a dev-only log line; rewritten to settle by stored-table identity, then passed.
- Production build attempts failed on: Turbopack with the symlinked dependencies (use `--webpack`); unreachable Google Fonts (font stand-in); the server key name (`SUPABASE_SECRET_KEY`); the `/programs` pre-render needing a migrated database.
- One stack was killed at the 30-minute background limit and left `ie_e2e_76e6c3fa26` (database and role); dropped by hand. Disposable PostgreSQL stopped once and was restarted.
- IMP-017 concurrent check in dev mode: in two of two completed rounds one upload of the pair failed with "fetch failed" (EPIPE while the 20 MB body was written to storage); later dev rounds ended by memory kill.
- Final-gate adapter check, first invocation: 2 skipped, because `TASK_B_FIXTURE_DIR` named a directory not present in the review clone. Rerun with the fixture directory from the retained checkout: 2 passed.

### Row-by-row overnight disposition (all 43)

Evidence levels: **C** = Claude check executed on the final tree tonight, needs review; **R** = retained test re-executed in tonight's full suite; **P** = earlier disposition preserved, nothing new tonight.

| Row (partition status) | Tonight | Disposition proposed (no promotion) |
|---|---|---|
| IMP-001 / IMP-016 (Blocked) | R | **Environment-dependent.** Deployed identity, storage privacy and signed links, deployed role and the migration runner need the real environment and authorisation. |
| IMP-002 (Closed) | R | Closure preserved. |
| IMP-003 (Closed) | R | Closure preserved. |
| IMP-004 (Awaiting) | R+C | Saved-content-after-reload established at the golden fixture scope (34cb123), re-passed tonight. The 0-10 numeric-only label mean stays an **owner decision**. |
| IMP-005 (Awaiting) | C | Group-correction calculation and clear/reload (7a6ab5d) re-passed on the final tree; **needs review**. |
| IMP-006 / REP-IN-001 / REP-IN-002 (Closed) | R | Closure preserved. |
| IMP-007 (Awaiting) | R+C | Failure-class outcome re-passed (`upload-storage-failure`). Storage is the local stand-in; hosted storage is **environment-dependent**. |
| IMP-008 (Closed) | R | Closure preserved. |
| IMP-009 (Awaiting) | C | Notice and analytical recovery re-passed (`flipped-codebook-guard`). The flipped plus separate-Codebook combination stays an **owner-approved exclusion**. |
| IMP-010 (Awaiting, deferrable) | C | **Newly evidenced, needs review.** Reopening a ready 5,000 x 301 raw file shows a bounded preview and the true case count, and does not re-read the file (stored-table identity unchanged). Not exercised: the trimmed-wide branch for a result over 100 MB. |
| IMP-011 (Closed) | R | Closure preserved. |
| IMP-012 (Awaiting) | R | Unchanged; controlled reread scope. |
| IMP-013 (Awaiting) | R | Unchanged; real-DB re-query scope (no UI reload). |
| IMP-014 (Closed) | R+C | Closure preserved; `data-setup-hydration` re-passed. |
| IMP-015 (Awaiting) | C | **Newly evidenced, needs review.** The table's Excel download carries both conflicting labels, and the saved table keeps both labels and counts after reload. |
| IMP-017 (Untested) | C | **Unresolved check.** The original v12 invocation **stays failed**. New native check: production server, 3 rounds, 6 of 6 exact-limit uploads complete in 6 to 9 s (run twice tonight, 12 of 12 in all; peak server memory about 818 MB); dev server, one of each pair fails visibly with EPIPE and leaves nothing behind. Direct concurrent uploads to the stand-in always succeed. The v12 failure looks specific to the dev runtime, but its exact cause is not proven. Hosted capacity is **environment-dependent**. |
| IMP-018 (Untested) | C | **Newly evidenced in one invocation, needs review.** Valid SAV and DTA calculate (Yes 3 / No 1 by raw code); truncated files fail visibly, stay failed after reload, store no table, and recover by delete and replacement. SAS stays an **owner-approved exclusion**. |
| OBJ-SET-001 (Awaiting) | C | Lifecycle re-passed. New: a refused Setup edit or delete is reported and keeps the draft (repaired defect, **needs review**). |
| OBJ-SET-002 (Awaiting) | R | Unchanged at the real-DB closing-test scope. |
| OBJ-SET-003 (Awaiting) | C | **Newly evidenced, needs review.** Native regeneration with a usable (fixture-supplied) model answer: rejected wording stays rejected, the undecided suggestion is replaced, edited own wording survives, a deleted own objective is not resurrected, and the original brief is unchanged. Scripted-model boundary disclosed. |
| OBJ-SET-004 (Blocked) | none | **Deferred**: historical definition unavailable. |
| OBJ-SET-005 (Blocked) | none | **Deferred**: historical definition unavailable. |
| OBJ-SET-M02 (Awaiting, deferrable) | C | **Newly evidenced, needs review.** Numbered, hyphenated and Unicode-bulleted lines become one objective each with the marker removed and stay consistent across Setup and Review through edit, delete and reload, with stable ids. The stale source hashes in `normalization.cjs` stay **deferred** (historical harness, not edited). |
| OBJ-REV-001 / OBJ-REV-002 (Closed) | R | Closure preserved. |
| OBJ-REV-003 (Blocked) | none | **Deferred**: historical definition unavailable. |
| OBJ-REV-004 (Awaiting) | C | Native regeneration as for OBJ-SET-003. New: refused Accept, Reject, Edit and Delete in Review are reported and keep the editor text (repaired defect, **needs review**). |
| OBJ-REV-005 (Untested) | R | Unchanged at the 34cb123 scope (new conclusions carry the multiplicity note); older conclusions need regeneration. |
| OBJ-REV-006 (Confirmed defect) | R | Durable raw identity unchanged at the 34cb123 scope. The first real-provider invocation stays recorded as inconclusive. |
| OBJ-REV-007 (Awaiting) | C | New: a refused evidence-question edit keeps the editor and draft, and a refused leave-out is reported; a later edit saves and survives reload (repaired defect, **needs review**). |
| OBJ-REV-008 (Awaiting) | R+C | New extras case uses distinct wording, so a saved answer can now be told from a preserved one; passes. Needs review. |
| OBJ-REV-009 (Closed) | R | Closure preserved. |
| OBJ-REV-010 (Blocked) | none | **Deferred**: historical definition unavailable. |
| OBJ-REV-011 (Closed) | R | Closure preserved. |
| OBJ-REV-012 (Awaiting) | C | Coverage warning repair (7a6ab5d) re-passed natively on the final tree; **needs review**. |
| OBJ-REV-013 (Awaiting) | C | Computed native retry (7a6ab5d) re-passed; scripted planner boundary disclosed. Continue reading after a failed round is by code review only (see above). **Needs review.** |
| OBJ-REV-M03 (Blocked) | none | **Deferred**: historical definition unavailable. |
| OBJ-REV-M04 (Awaiting, deferrable) | none | **Deferred**: the guard and load-failure behaviour is still undocumented. |
| DEC-001 (Closed) | R | Closure preserved. |
| Business-decisions remainder (Untested) | C | New: refused card and list actions in the decision brief are reported, and a rejected decision stays open for correction when its action fails (repaired defect, **needs review**). Failed-refresh recovery for other mutations is not inferred. |
| ANA-NPS-003 calculation-input subcase (Closed) | R | Closure preserved. |
| ANA-NPS-003 / IMP-005 findings freshness subcase (Closed) | R | Closure preserved. |
| FND-001 / REP-OUT-001 (Confirmed defect) | R+C | **Newly evidenced, needs review.** Real-DB `generateStoryNarrative`: a narrative citing the wrong group is saved `needs_review`, the right group is `traced`. This removes the "persistence is scripted" limit for that path. The outcome is still a qualified save, not a refusal. |
| ANA-NPS-003 downstream freshness handover (Untested) | R | Unchanged at Codex's native fixture scope. |

Section-2 scopes outside the 43 rows: Probe B browser PPTX **stays failed** (HTTP continuation only); Task D unchanged at Codex's scope; Office rendering is LibreOffice only, so real Office is **environment-dependent**.

### For owner decision (not applied)

- The 0-10 scale with numeric-only labels gets no mean (IMP-004): a policy choice, not a measured engine defect.
- Six `react-hooks/set-state-in-effect` lint errors in `ClaimTableChecks`, the `CodingProgressBar` reset, `CrosstabFilters`, `ProcessProgress` and `RunShell` (two). Each needs a small behavioural refactor of a polling or reset effect. They were left alone tonight because the change is not lint-only.
- Script and test lint (295 `require()` calls in scripts, 48 `any` in tests): style, not behaviour.

### Reproducing tonight's results

See `docs/validation.md`, section "App-owned browser checks". In short:
1. Start disposable PostgreSQL; run the vitest command above.
2. For production mode: migrate a disposable database, add one tenant, and build a copy of the tree with `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$PWD/scripts/e2e/font-mock.cjs`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39123`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-stand-in`, `SUPABASE_SECRET_KEY=local-stand-in`, `DATABASE_URL` and `DEFAULT_TENANT_ID`, then `npx next build --webpack`.
3. `E2E_NEXT_START=<built copy> E2E_STORAGE_PORT=39123 E2E_ADMIN_DATABASE_URL=... npm run e2e:stack`.
4. `GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`, then the smoke, adapter (with `TASK_B_FIXTURE_DIR`) and objective-script commands above.
5. Stop the stack with Ctrl+C (or SIGINT to its PID) and confirm no `ie_e2e_*` database or role remains.

## Codex independent review of overnight HEAD 0b7fb30 — 2026-10-16

Accepted the clean tracked release at 0b7fb30819dea22de20583069c71adf687a514d3 and recorded CODEX_WORKING before review. Reviewed the 43-path difference from 4ba581d, including 7a6ab5d, a00dc0c, d72b150, 110183a and d5cbc6f. Application source remains read-only. No author/history rewrite, push, deployment or paid model call. This review is an active execution, not a configured recurring task.

### Independently executed checks

Local evidence: scripts/workflow-tenant-review/overnight-codex/. The isolated source copy excludes environment files, reuses installed dependencies through a junction and changes only native fixture-generator calls from python3 to the installed python command. PostgreSQL is a new labelled loopback container on 55515 (17.11, not the reported cloud PG16); browser app port 3234 uses webpack development mode, a nonowner disposable role, synthetic data, local storage stand-in and explicit model replay. No development or hosted services are targets.

- focused.log: four suites, 9 passes / 2 inactive placeholders skipped. Real narrative generator persistence stores the wrong-group draft needs_review and the correct group traced; the loader projects it. Conflicting duplicate validations refuse and preserve the prior batch; identical repeats deduplicate; distinct new wording establishes that valid indices alongside extras publish the new batch. Actual coverage component and action-failure helper pass.
- affected.log: five suites, 18 passes / 3 inactive placeholders skipped. Actual objective recovery/review persistence, human provenance and hydration guards retain their scoped passes.
- semantic.log: narrativeFigureTrace, 22 passes. The other supplied filename filters matched no suite and are not additional executed coverage.
- identity.log: three suites, 31 passes for response selection and evidence identity. Earlier independent 34cb123 raw-identity/multiplicity/output dispositions remain preserved; no legacy backfill is inferred.
- native-tests-attempt2.log: six native checks pass: coverage degradation/reload/healthy reassessment; corrected-group calculation and clearing/reload; zero-progress write refusal/reload followed by exactly one computed retry; evidence editor refusal/retry; Review refused actions/draft preservation; Setup refused edit/delete/draft preservation/retry. Scripted planner/coverage answers are disclosed and are not provider-quality results.

The first native invocation ran before the target manifest existed and executed no checks (native-tests.log). It remains a setup failure. Attempt 2's log records six passes; its PowerShell wrapper returned 1 after stderr warning formatting, so the browser report, rather than that wrapper code alone, establishes the six test outcomes. No full 833-test/build or production concurrency rerun is claimed here.

### Evidence and code review findings

1. **IMP-010 regression evidence overclaims no reparse (deferrable evidence gap).** e2e/ui/raw-file-reopen.check.mjs records id, created_at and row count and says a reread replaces the table. Actual src/lib/documentTables.ts uses ON CONFLICT DO UPDATE, deliberately preserving id and creation time; an identical reread also preserves count. Production action-name logging is expressly absent. Therefore those assertions cannot establish the production no-reparse claim. Keep bounded-preview/count assertions; correct the comment and observe parser/read calls or storage reads directly, or use another demonstrated signal that changes on every read. This is not evidence that the application reparses.
2. **Existing locale hydration mismatch, separate from the overnight repair results.** src/app/runs/[id]/TranscriptSetup.tsx:265 renders toLocaleDateString() without an explicit locale. The native app log shows server 2026/10/16 versus browser 10/16/2026, and React regenerates the client tree. The affected native assertions still pass; no lost work or incorrect statistic is established by this observation. A bounded presentation correction should render a deterministic date and verify different server/browser locales. Do not count it as a new canonical row or infer a new release blocker without a material supported-workflow consequence.

The installed Next 16.3.6 error-file guide explicitly supports retry (stable since 16.3.0); the new boundary uses that API correctly. Changed UI delegates persistence/statistics to existing lib actions. attempt handles rejecting void actions; inspected call sites do not incorrectly feed resolved failure-result actions into it. The Setup result wrapper uses the existing authoritative edit implementation. The wave state adjustment remains conditional on a changed source wave; the polled-time change compares against the successful response timestamp. No measured performance improvement or whole-codebase maintainability certification is inferred from these lint changes. Existing lint-policy decisions remain explicit.

### Four smaller limits — updated independent disposition

| Scope | Disposition |
|---|---|
| OBJ-REV-004 direct overview Accept/status comparison | Earlier independent finite accepted-state boundary preserved; new refused-edit controls pass. No all-state UI permutation claim. |
| IMP-005 group calculation | **Verified at the supplied native fixture scope:** saved single-question correction computes code 1 at 60%; clear/reload restores the imported MR set and its 60% member; prior corrected table is visibly outdated. |
| OBJ-REV-012 coverage warning | **Repaired and independently verified:** actual permission failure persists degradation; coverage renders it after reload; healthy reassessment clears it without changing conclusion/status. Prior qualified DOCX/PPTX evidence preserved. |
| OBJ-REV-013 computed native retry | **Verified at the disclosed native scripted-planner scope:** write refusal leaves zero durable answers/pending work, reload retains Continue, healthy retry computes exactly one current result and clears pending. Failed-action-round and 60-round-cap branches remain unexecuted UI limits, distinct from this passing persistence-stall case. |

No automatic canonical status/count promotion: 12 Closed / 18 Awaiting / 2 Confirmed / 5 Untested / 6 Blocked = 43, priorities 34/9/0. Overall acceptance remains incomplete. The original IMP-017 v12 failure and unproven cause, failed Probe B browser PPTX event, HTTP continuations, approved exclusions, historical definitions, numeric-only scale policy, M04, hosted storage/identity/deployed-role/runner security and real Office/model boundaries all remain explicit. A successful later run never turns a failed invocation into a pass.

### Affected-row disposition after the overnight independent review

| Existing row | Independent disposition and remaining limit |
|---|---|
| IMP-004 | Earlier saved scale/missing-audit evidence preserved. Numeric-only scale mean remains an owner policy decision, not a newly demonstrated arithmetic failure. |
| IMP-005 | New group-calculation and clear/reload assertion verified above. Prior downstream correction/human-work boundaries preserved. |
| IMP-007 | Earlier actual DB cleanup scope preserved; hosted storage authorisation remains external. New native recovery outcome is reported separately below. |
| IMP-009 | Prior identity/cache/excluded-Codebook refusal dispositions preserved; no additional support for the excluded combination. |
| IMP-010 | Bounded preview/count check assessed separately below. Production no-reparse proof remains insufficient; >100 MB trimmed-wide branch unexecuted. Deferrable. |
| IMP-015 | New Excel conflict-label and saved-content assertion assessed separately below; no automatic pre-dictionary notice or in-place replacement claim. |
| IMP-017 | Unresolved original v12 outcome/cause remains failed/unknown as previously reconciled. New production concurrency checks are inspected Claude evidence, not an independently re-executed hosted capacity certification. Safe failed-or-complete checks do not prove every exact-limit request completes. |
| IMP-018 | Valid/truncated SAV and DTA, visible reload error, no partial table, supported deletion/reupload and recovered calculation independently pass together in this review. SAS exclusion preserved. |
| OBJ-SET-001 | Refused Setup/Review editing and draft recovery independently verified; prior cross-module identity chain preserved. |
| OBJ-SET-002 | Earlier independent DB concurrency/fallback scope preserved; no reopened REV-009 matrix. |
| OBJ-SET-003 | New native regeneration independently passes with fixture-supplied usable answers, rejected wording retained, edited own wording retained, deleted own objective absent and original brief unchanged. |
| OBJ-SET-M02 | New marker-variant native dual-module edit/delete/reload independently passes with stable identities. Historical normalization harness hashes and any unexecuted variants remain explicit, not additional defects. |
| OBJ-REV-004 | New refused-save/draft preservation and regeneration assertions verified; prior whitespace rejection controls preserved. |
| OBJ-REV-005 | New-conclusion multiplicity qualification and legacy-rerun requirement preserved from the prior independent review. No multiplicity-adjusted intervals claimed. |
| OBJ-REV-006 | Previous durable raw-identity and explicit/ambiguous selector evidence preserved; 10 selector controls pass again. Historical inconclusive provider attempt remains inconclusive. |
| OBJ-REV-007 | Actual edit/source-removal protocol controls and native refused question-edit/leave-out/recovery pass. |
| OBJ-REV-008 | Real-DB duplicate conflict/preservation and distinct-wording extras publication independently pass. |
| OBJ-REV-012 | Coverage warning defect repaired and independently verified above; prior nonowner, reload and output evidence preserved. |
| OBJ-REV-013 | Native computed persistence retry independently verified. Failed-action-round and 60-round guard are still code-inspected, not executed native assertions. |
| OBJ-REV-M04 | Deferred guard/load-failure documentation and execution limits preserved. |
| Business-decisions remainder | Native refused list/card paths exercised by review-action-failure pass at their supplied scope. This does not establish every mutation's post-commit refresh-failure reconciliation. Prior finite transitions/provenance preserved. |
| FND-001 / REP-OUT-001 | Real generator plus PostgreSQL wrong-group qualification/right-group traced control independently verified; 22 figure controls pass. Qualified save is not refusal. Prior handover results remain; failed Probe B browser deck event is not replaced by its successful HTTP continuation. |
| ANA-NPS-003 downstream handover | Previous independent design-trigger/output fixture disposition preserved. No further model or all-consumer certification added. |

All twelve closed rows retain their agreed finite closures; no unaffected row is reopened. Five missing historical definitions, approved SAS/flipped-Codebook exclusions, design-only Research Quality Review, Office rendering limits and deployed security/process requirements remain as previously disposed. The above are evidence-level dispositions, not a silent rewrite of the canonical partition.

### Final native continuation and resource disposition

remainders.log records 7 passes, confirmed Playwright exit code 0: SAV/DTA valid/truncated/replacement; marker dual-UI lifecycle; native usable-answer regeneration; raw bounded preview and true count; reference mean/top-box/share saved-table content after reload; conflicting labels in Excel and saved-table reload; upload drops both before and after storage followed by healthy exactly-once retry. The raw-file check also observes absence of the named readDataFileAction in development logs; that narrows this independent no-read observation to the dev/action boundary and does not repair the production identity-only proof described above.

Across the distinct targeted suites: **80 passed / 5 explicit inactive placeholders skipped**; native **13 passed** across two invocations. The earlier standalone 6 rendering/helper passes overlap focused.log and are not added again. Full validation/build, production concurrent limits, smoke and adapter matrices were not independently rerun in this review. Their unchanged reported evidence is preserved at its original authorship/scope.

Thus IMP-004 saved reference-content, IMP-007 local failure/retry, IMP-015 conflict-label Excel/reload and IMP-018 supported format recovery gain independent native evidence at the supplied scopes. IMP-010 gains a native bounded preview/count pass and dev named-action no-read observation; the production no-reparse test limitation and trimmed-wide branch stay deferred. No required missing assertion is silently closed.

Eleven complete synthetic storage objects and inventory/checksums, a password-free database dump, logs and the final browser JSON report are retained locally. The initial source-copy attempt was denied Temp filesystem access; an explicitly scoped escalated copy succeeded (environment failure, no application result). The verified PID tree and labelled codex-overnight-review-20261016 container were stopped after retention; ports 3234/55515/63772 have no listeners. No development services were stopped. Model replay shutdown log was not produced by forced process shutdown; do not cite one as retained evidence. No paid calls; cumulative US$3.817316 unchanged.

Codex releases the bounded follow-up to Claude through the handoff: correct/strengthen the raw-file proof and address the deterministic date rendering observation with targeted evidence, then only specifically missing failed-round/guard assertions if feasible. No full audit or repeated closed matrices. Overall acceptance remains incomplete, with unchanged 43-row counts.

## Claude bounded follow-up after Codex's overnight review (2026-10-16, night; commit 5f63038)

Claude-authored; needs independent review. Base `434924b`. The partition is unchanged (12 / 18 / 2 / 5 / 6 = 43) and no row is promoted. Earlier passes and failed invocations stay as recorded. Overall acceptance is not claimed.

### Changes, each reproduced first where it is a defect

| Released item | Change | Reproduction and evidence |
|---|---|---|
| IMP-010 reopen proof (`raw-file-reopen.check.mjs`) | The comment no longer says a re-read replaces the table: `documentTables.ts` upserts with ON CONFLICT DO UPDATE, keeping id, created_at and (for the same file) the count. No-reparse is now observed by two signals that change on every read: the storage stand-in's download count for the file's stored object (new disposable `/__reads` endpoint in `scripts/e2e/local-stack.mjs`) and the table row's version (`xmin`). Positive control: a layout change makes the page read the file again, and both signals change. The dev-only action-name check is kept. | Production server: passes on the previous build and on the repaired build. Both reopens leave downloads and row version unchanged; the positive control moves both. This is check evidence, not an application change; the trimmed-wide branch over 100 MB is still not exercised. |
| Upload date hydration (`TranscriptSetup.tsx` FileCell) | New `src/lib/displayDate.ts`: the UTC calendar day in a fixed format ("16 Oct 2026"), the same in every runtime, with the exact UTC minute in the title. An invalid timestamp shows "Date unknown". Limit, stated in the module: near midnight the day shown is the UTC day, which can differ from the researcher's local day. | **Reproduced first** on the previous production build, with the browser in en-US and Pacific/Kiritimati: the row showed "10/17/2026" against the server's UTC "10/16/2026", and the console logged React error #418 (text hydration mismatch) twice. After the fix: native `upload-date-hydration.check.mjs` passes (fixed text before and after reload, no hydration error). `displayDate.test.ts` (4 tests): identical output across four time zones including just before UTC midnight; the old expression's zone dependence; invalid input. `setupHydrationGuard.test.tsx` maps the new module and still passes. No statistic or saved work was affected. |
| OBJ-REV-013 failed round and dropped connection (`ObjectiveEvidence.tsx`) | Every server-action call in the panel is settled, so a rejected request becomes the `{ok:false}` result each caller already handles. A failed round reads "Reading stopped: <reason>". | **Reproduced first** on the previous build: a dropped evaluate request left both buttons on "Reading the data..." and disabled, with no message. Native `evidence-round-failures.check.mjs` now passes. (1) A second round returning `{ok:false}` shows the reason, leaves the panel idle and keeps Continue reading, also after reload; a clean continue then finishes. (2) A dropped connection does the same. The `{ok:false}` branch itself already passed on the previous build. |
| OBJ-REV-M04 60-round guard and load failure | The `gather()` comment now names the stop conditions, including the 60-round cap. | Same native check. (3) Rounds that keep reporting 5 unread stop after exactly 60, show "Stopped after a long run with 5 question(s) still unread", and keep Continue reading. (4) With the app role's read on `objective_evidence` revoked, Review Objectives shows the load error and no question list; restored, it loads. Both branches passed on the previous build as well; this is new evidence, not a repair. |

Controlled boundaries in `evidence-round-failures`: the browser intercepts only the evaluate action, recognised by its result. In the guard step it rewrites the server's real result. For a failed or dropped round it answers without reaching the server, so the server state matches what the panel is told. The planner's plan is fixture-supplied, and the objective and questions are synthetic inserts. The load failure is a real permission revoke on the disposable app role.

### Executed on the final tree (cloud workspace, disposable PostgreSQL 16, production build)

- `npx tsc --noEmit -p .` pass. eslint on every changed file pass.
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks`: 117 files, **837 passed, 0 failed, 37 skipped**.
- Production build (`next build --webpack`, font stand-in) pass.
- App browser checks against the production server, `--workers=1`: 24 run, **23 passed, 1 failed**. The failure was `data-setup-hydration` (Codex's check from `be625c7`): its single "Import data" click right after navigation did not open the panel, so the upload input was never found (timeout). It then passed 3 of 3 alone on the same stack. Recorded as an intermittent check failure, not relabelled; the check is outside this release and was not edited. A wait for the page to be interactive before that click would remove the race.
- Golden-thread smoke 1 passed; adapter 2 passed; objective-review script passed (4 status entries passed).

### Failed or incomplete invocations this round (retained)

- First stack start: disposable PostgreSQL had stopped (ECONNREFUSED); restarted, then started.
- First `evidence-round-failures` run: my route interception broke the multipart upload ("Choose at least one file first."); interception moved after setup.
- Second run: the rewritten `{ok:false}` round had already done its work on the server, so nothing was left to continue; failed rounds are now answered without reaching the server.
- On the repaired build, one run failed 3 vs 2 stored answers: the check took "no Continue button" as finished, but that button is relabelled while a round runs. "Finished" now means the answers are stored, the panel is idle, and Continue reading is gone.
- The intermittent `data-setup-hydration` failure above.

### Affected-row disposition (proposed; no promotion)

| Row | Disposition |
|---|---|
| IMP-010 (Awaiting, deferrable) | The production no-reparse proof now rests on per-read signals with a positive control; needs review. The trimmed-wide branch stays unexercised. |
| OBJ-REV-013 (Awaiting) | Failed-round and dropped-connection branches executed natively; dropped-connection defect repaired; needs review. The computed persistence retry closure is unchanged. |
| OBJ-REV-M04 (Awaiting, deferrable) | 60-round guard and load failure executed natively; the comment now matches the stop conditions; needs review. |
| Upload-date presentation (Codex observation, no row) | Repaired; needs review. Not a statistic or saved-work defect. Other unqualified `toLocaleDateString`/`toLocaleString` uses remain in `programs/page.tsx`, `app/page.tsx` and two export routes. They are outside this release; whether any of them hydrates in the browser was not assessed. |

Everything else stays as Codex recorded it: the IMP-017 v12 original stays failed and its cause is unproven; Probe B browser PPTX stays failed; the owner decisions, exclusions, deferrals and environment gates are unchanged.


## Codex independent review of a25020f / repair 5f63038 - 2026-10-17

Accepted a25020ffd7937e9453a9c07a07f300dc78f4652b from READY_FOR_CODEX with a clean tracked tree; recorded CODEX_WORKING before the review. All nine paths in 5f6303807a478454d56cd3a0c34a5dd0a95be900 match checkout bytes after CRLF normalisation (released-comparison.json). a25020f changes documentation only over that repair. Application source remains read-only. No push, author/history rewrite, development/live mutation or model call.

Independent evidence is retained in scripts/workflow-tenant-review/followup-20261017/. The source copy excludes environment files and has a SHA256 manifest; its production build uses installed Next 16.3.6 with webpack, a compile-only font stand-in, and a migrated synthetic build database. Runtime uses a separate synthetic database and nonowner role in a labelled PostgreSQL17.11 container on 55516, production app 3235, loopback storage 39125 and explicit model replay. This differs from Claude's PG16 cloud environment and is not deployed certification.

- focused.log: 10 passes across displayDate, setupHydrationGuard and actionFailure; no skipped tests. UTC boundary/offset, invalid input and exact minute controls pass. The earlier standalone and historical suites are not added to this count.
- build.log: production compilation, TypeScript, prerender and build complete, exit0. Existing unpdf import.meta dependency warning retained; font delivery is not certified by the stand-in.
- lint.log: the changed application, test and harness modules pass their lint invocation, exit0. No new statistical rule, database mutation path or measured performance optimisation is introduced by the repair.
- concurrent-durable.json and native-checks.log: three native concurrent pairs, six of six exact 20,000,000-byte/100,000-case imports complete (4-6seconds per pair). Native reloads succeed; separate actual-DB re-query confirms100,000cases in each. This supplies independent local production evidence; the original IMP-017 v12 failure and its unproven cause remain historical failures, not retrospectively green. Hosted throughput/storage remain separate.

Code review: the new settled wrapper preserves the existing result-returning action contract while mapping rejected promises through the shared actionFailureMessage rule. Returned failures and transport rejection both reach explicit caller errors instead of leaving busy state running. All panel action call sites use it; no statistical/persistence implementation is duplicated in the UI. The fixed en-GB/UTC date rule is shared from src/lib/displayDate.ts, with an explicit near-midnight UTC-day limitation and invalid-date fallback. The storage stand-in counts actual successful direct/signed byte reads; table xmin changes on the upsert path. The revised reopen test requires both counters to move in a layout-change positive control rather than relying on stable table identity. Final native outcomes and row dispositions follow below.


### Independent native results and affected-row disposition

The primary production run (native-checks.log, report-primary.json) finishes **6 passed / 1 failed**, exit1. The six passes include all three new checks: raw reopen read counters with a layout-change positive control; upload-date hydration in en-US/Pacific-Kiritimati; and evidence returned failure, rejected connection, 60-round cap and real permission-revoked load. The retained evaluator persistence-stall/computed retry and refused evidence edit also pass. Date title formatting is covered by source review and unit controls; the native date check asserts visible day text and absence of hydration errors, not the title attribute itself.

The failed case is the unchanged data-setup-hydration.check.mjs. Its trace gives a more precise local cause than a lost click: openImport calls isVisible immediately after waitForURL, receives false, **skips the Import data click**, then setInputFiles waits five minutes for an input in the unopened panel. No file is uploaded and no held-script guard assertion is reached. Screenshot, context and trace are retained under primary-native-output/. This is a test-readiness failure; it does not establish that the application's hydration guard failed. Claude's earlier intermittent failure and subsequent passes remain separate history.

A separately labelled **readiness continuation passes**, exit0 (readiness-continuation.log, report-readiness-continuation.json). It changes only openImport in an isolated test copy to wait/retry until the input is visible, then executes the original held-script disabled/loading, enabled-after-release and saved-choice/reload assertions. The permanent repository test remains unchanged. This is one continuation pass, not a relabelled primary invocation or a repaired permanent harness. Across the two native invocations: seven passing checks and one failed check; no fully green native-suite claim.

| Existing scope | Independent disposition | Exact remaining limitation |
|---|---|---|
| IMP-010 raw/wide reopen | **Verified at the supplied production fixture scope.** Two reopens preserve bounded preview, true 5,000-case/301-column count, storage download count and table xmin; changing layout moves both read signals. The earlier production identity-only evidence gap is superseded by this passing proof. | The over-100-MB trimmed-wide branch remains unexecuted and deferrable; no all-files performance claim. |
| Upload-date observation (no canonical row) | **Repaired and verified.** Fixed UTC day survives native reload with no hydration error under a different browser locale/zone; explicit unit boundary/invalid cases pass. | UTC day may differ from local day near midnight, as documented. Unrelated date formatters are outside scope. |
| OBJ-REV-013 | **Repaired and verified at the named failure/recovery boundary.** Returned failure and a request dropped before server execution stop the spinner, show the error and retain Continue; healthy continuation finishes. Original computed durable-write retry still passes. | Intercepted evaluate responses/connection and synthetic questions/plans are controlled; this is not real-provider quality or every lost-acknowledgement scenario. |
| OBJ-REV-M04 | **Named guard/load-failure assertions verified.** Exactly60 reported rounds stop with pending wording and enabled Continue; actual initial read-permission failure is visible and restoration loads the questions. Engineering brief updated to supersede its now-stale code-review-only statement. | Guard responses are rewritten, not 60 rounds of real model/engine progress. No broader load-state/permutation audit. |
| IMP-014 preserved hydration boundary | **Earlier closure preserved; separate readiness continuation passes.** The permanent test's skipped-click failure is independently confirmed. | Permanent harness readiness remains a bounded follow-up; the failed invocation stays failed. No new application regression or reopened whole-module closure inferred. |
| IMP-017 | **New independent local production concurrency evidence verified:** three pairs, six complete imports, exactly 100,000 cases each after reload. Existing failure-class/retry controls preserved. | Original v12 outcome/cause remain historical unknowns at their recorded boundaries. No deployed capacity, real storage authorisation or retrospective passing claim. No automatic row promotion. |

No new functional correctness defect was found in the released repair. The concrete remaining maintenance finding is e2e/ui/data-setup-hydration.check.mjs:31-34, where a one-shot visibility probe can skip required navigation. Permanent fix acceptance: wait for usable panel navigation/input, retain all held-script and durable-layout assertions, and preserve failed invocation history. No performance defect is inferred from code shape or the five-minute harness timeout.

The release recorded its bounded file extensions after implementation rather than before; shared status explicitly discloses that sequence. This review does not rewrite it as prior notification. The engineering brief was stale about the new guard/failure evidence; Codex corrected that documentation only after independent execution. Application modules, stats contracts, persistence, ownership checks and migrations remain unchanged by Codex.

### Preservation, ownership and stopping point

The 43-row partition remains **12 Closed /18 Implemented awaiting verification /2 Confirmed defect /5 Untested requirement /6 Blocked**, priorities 34/9/0. These are explicit scoped evidence dispositions, not blanket status promotions. Earlier12closures and the previous row-by-row independent findings remain valid where unchanged. Overall acceptance remains incomplete: required external evidence and owner dispositions are still missing. Original IMP-017/Probe-B browser failures, separate successful HTTP continuations, historical definitions, approved SAS/flipped-Codebook exclusions, numeric-only scale and lint policy decisions, Research Quality Review design-only boundary, and deployed identity/storage/role/migration-runner/security, real Office and real-model limitations remain explicit.

Twelve complete synthetic storage objects with hashes/inventory, read counters, a password-free UTF-8 database dump, source comparisons, build/lint/unit/browser logs and failed-run artifacts are retained locally. The exact owned PID tree and labelled codex-followup-20261017 container were stopped after retention; reserved ports 3235/55516/39125 are clear. No development services were stopped. Forced shutdown does not supply a model-replay shutdown log; no such log is claimed. No paid calls; cumulative US$3.817316 of US$10 unchanged.

Codex releases ownership to Claude for the permanent test-readiness fix only, plus affected evidence documentation. No application repair or full matrix rerun is requested by this release. After that fix, return the exact local commit and relevant check result for review. Nothing has been pushed or rewritten.

## Claude readiness fix for the hydration check (2026-10-17; commit 40198b0)

Claude-authored; needs independent review. Base `3753371`. Check only; no application change. The partition is unchanged and no row is promoted.

- **Change** (`e2e/ui/data-setup-hydration.check.mjs`): `openImport(page, ready)` clicks Import data only while a named target inside the panel is absent. That target is the upload input before the upload, and the layout control after the reload. It retries until the target is attached, up to 90 s. The held-script disabled/loading assertions, the enabled-after-release assertions and the durable layout save and reload are unchanged.
- **Reproduced first** (scratch copies outside the repository, not retained in it): the run page was reopened with its script chunks held for 3 s, so the first `openImport` ran before the page was interactive. The previous helper failed with Codex's signature: `setInputFiles` timed out waiting for the upload input, and no upload or held-script assertion ran. The new helper passed under the same condition (7.0 s). A first scratch attempt, which delayed the run page's document instead, did not reproduce the race: `waitForURL` waits for load. Both old and new passed there, and that attempt is recorded as inconclusive.
- **Executed**: on the production server (`next start`, disposable stack), `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 data-setup-hydration` passed 5 of 5 (3.4 to 3.8 s). eslint passes. Disposable resources were stopped by PID; no `ie_e2e_*` database or role remains.
- **Preserved**: Claude's failed full-run invocation and Codex's failed primary run stay failed; Codex's readiness-aware continuation stays a separate pass.


## Independent readiness review and all-43-row reconciliation - 2026-10-17

This is the current row-level disposition under Grant's latest instruction to reconcile all43 rows and close bugs only on implemented repair plus independent evidence of their original failing behaviour. Earlier statements that promotions were merely proposed or counts unchanged are retained dated history, superseded only by the explicit dispositions here. The canonical checklist is updated, with the entire prior canonical retained byte-for-byte as v26. No frozen criterion, row ID, requirement or priority is changed. No application closure follows from40198b0 or a passing unrelated suite.

### Readiness repair40198b0

Confirmed clean tracked HEAD460815c1924abb12ecf80aa9626ded198fd93820; recorded CODEX_WORKING before review.40198b015c406be699326c7e0115037d2c1a1275 changes one test;460815c changes documentation. The helper now retries required navigation while its in-panel target is absent. All original held-script disabled/loading, enabled-after-release and durable layout-save/reload assertions are retained.

Independent old/new comparison in isolated test copies: the old helper fails at setInputFiles with the upload input absent after deliberately delaying initial scripts3seconds (15-second bounded reproduction deadline). The permanent new test passes unchanged; the new helper under the same delayed-script condition also passes with all original assertions. old-readiness-repro.log/report-old.json and readiness-fixed.log retain the failed control and two passing cases separately. These are a verified harness repair, not an application repair. Earlier Claude/Codex failures and passing continuations remain exactly as reported.

### Row-specific independent checks and reuse boundaries

Artifacts: scripts/workflow-tenant-review/reconcile-20261017/. The previously independently built production source remains valid:521 application/engine/migration paths match byte hashes, with no changes; the only new executable repository change is the readiness check. Production tests run against a new labelled PostgreSQL17.11 loopback instance55517, a nonowner synthetic role/database, app3236, storage stand-in39125 and explicit model replay. No paid provider, live/development or deployed configuration is used. Application source remains read-only.

- row-regressions.log:11 files,45 passes/9 inactive placeholders skipped. Actual PostgreSQL covers cleanup failures/recovery, candidate concurrent/fallback/legacy and lifecycle contracts, validation indices/conflicting duplicates/qualification, instrument reread, three-document finding identity and wrong-group generator persistence. Controlled planner/table/model boundaries are retained explicitly.
- Added independent actual-DB selector case: the exact original two-exhaustive-channel table and table-valid online pick cannot compute generic overall buying. The explicit online question computes20-point difference, retains raw answer identity, survives action-loader reload and repeats without duplicate result. Existing canonical Yes/No and missing/ambiguous controls pass. This is direct original-regression evidence, not an unrelated success case.
- mechanism-regressions.log: actual Python unsigned/signed/missing/literal-ID controls and real edit/evaluate race/mixed-write/finite statistical-contract cases pass. The first cache-upgrade case hit the runner's5000ms deadline; that invocation remains **12 passed/1 failed/5 skipped**, not green. No data assertion failure or5-second performance guarantee is inferred from the timeout.
- cache-continuation.log: only that cache file is rerun, assertions unchanged, with a disclosed60000ms allowance: **4 passed/1 inactive placeholder skipped**. It establishes original old-cache rebuild, correction preservation/reuse, unaffected orientation, dictionary10 guard refusal/failure/retry and effective group-clear contract. It does not make the initial invocation a pass.
- objective-native.log: actual detail/overview transitions/edit/human-wording and candidate identity/reload assertions pass3/3. That script's replay regeneration can refuse; the separately retained independent usable-answer objective-regeneration-native pass supplies the generation assertion. A refusal is never counted as successful generation.
- Prior independent review34, overnight-codex, laptop-review and followup-20261017 results are reused only for their exact assertions on unchanged relevant source: correction calculation, saved scale/conflict content and Excel, native format recovery, coverage degradation/reassessment and exports, marker lifecycle, production no-reparse counters/positive control, computed write retry, failed-round/guard/load recovery and exact-limit concurrency. Original12 agreed closures remain preserved; no new whole-build/full837-suite claim is made by this reconciliation.

The initial cache timeout, intentional old-helper failure, historical memory/runtime/setup failures, original v12 failure, browser deck failures and later continuations remain separate. No failure is erased or relabelled by a later pass.

### All43 current row dispositions

**33 Closed /4 Implemented awaiting verification /0 Confirmed defect /0 Untested requirement /6 Blocked =43.**21 additional finite criteria are closed individually, in addition to the preserved12. Four remaining technical requirements have implemented code and partial direct evidence, so they are accurately awaiting verification rather than labelled wholly untested. The wrong-group storage repair does not close the broader FND handover row. No current confirmed failure is invented from missing evidence; zero confirmed rows is not an overall acceptance claim. Priorities remain34/9/0; technical release-priority position is29 closed/4 awaiting, with the separate security gate blocked.

| Existing canonical row | Current disposition | Matching independent evidence and exact retained limit |
|---|---|---|
| IMP-001 / IMP-016 | Blocked (blocked) | No trusted deployed two-user/two-tenant/storage/role/runner evidence. Local role tests do not close this gate. Owner-authorised deployed boundary verification; preserve separate security gate. |
| IMP-002 (includes IMP-SHIP-001/002) | Closed (preserved) | P2a independent CSV/XLSX preview/dictionary/calculation/reload and recovery closure unchanged. Retain original finite parser/provenance limitations. |
| IMP-003 | Closed (preserved) | Independent canonical-collision calculation/picker/save/reload closure unchanged. No additional repair; retain canonical fixtures. |
| IMP-004 | Implemented awaiting verification (partial) | Engine scale/missing controls and saved reference figures pass; this is not independent coverage of every declared-zero and missing-audit value after reload. Verify the remaining labelled/unlabelled/sparse zero-category and missing-audit reload assertions; numeric-only scale mean remains an owner decision. |
| IMP-005 | Closed (verified) | Native saved single/MR group correction computes the independent60% reference; clear/reload restores the imported set, prior output becomes outdated; earlier A/C qualification preserves human wording. Closed for the frozen effective-correction contract; broader replacement/duplicate consumers remain under FND. |
| IMP-006 / REP-IN-001; REP-IN-002 preservation dependency | Closed (preserved) | Independent REP-IN-00214-group persistence/replay and12-group native/storage/downstream closure unchanged. No wholesale parser/import reopening or deployment certification. |
| IMP-007 | Closed (verified) | Actual cleanup regressions reproduce storage+trace/upload-DB failures and verify durable intent, scoped/idempotent retry and concurrent-source safety; independent native before/after-store drops and retry also pass. Local controlled-storage functionality only; real storage authorisation remains IMP-001/016. |
| IMP-008 | Closed (preserved) | Independent partial-batch/re-pick/concurrent deduplication closure preserved,0098 required. Legacy null hashes remain excluded from content deduplication. |
| IMP-009 | Closed (verified) | Original unsigned-wrap/literal-ID engine regressions pass in both orientations; real-DB old-cache failure/retry preserves corrections. Retained native supported orientation/analytical controls and current guard recovery pass. Closed for supported orientation; flipped separate-Codebook weight/MR remains an approved visible exclusion. Initial5-second cache timeout is retained; unchanged assertions pass in separate60-second continuation. |
| IMP-010 | Closed (verified) | Production5000-case/301-column reopen shows bounded preview/true count, no download or xmin change; layout-change positive control moves both counters. Finite raw/wide reopen scope closed. Over100-MB trimmed-result branch remains a disclosed deferrable limit, not certified. |
| IMP-011 | Closed (preserved) | Actual engine zero-option and per-option MR base/interval closure unchanged. Do not infer new cross-document identity requirements from MR arithmetic. |
| IMP-012 | Closed (verified) | Actual reread action+DB test preserves confirmed item/link identities and truthful reloaded complete/partial coverage through retry; retained native PDF caller chain agrees. Controlled extraction/model chunks; no broader questionnaire-interpretation claim. |
| IMP-013 | Closed (verified) | Actual post/status/remove/revive callers create three distinct q1 findings with document provenance; a change to one leaves the others intact in durable queries. Finite three-document criterion closed; no unrequired all-wave/UI-permutation claim. |
| IMP-014 | Closed (preserved) | Original Brief38 conflict/debounce/visit/hydration closure remains. Current permanent readiness helper and delayed-script regression retain original guard/save/reload assertions. 40198b0 closes the harness race only; it is not a new application repair or the basis for other closures. |
| IMP-015 | Closed (verified) | Actual conflict engine/notice cases plus independent native raw-code/all-label display, Excel and saved-table counts3/1 after reload resolve the original label-reversal risk. Visible deterministic raw-code/all-label policy and supported delete/reupload recovery; notice starts at dictionary construction. |
| IMP-017 | Implemented awaiting verification (partial) | Independent exact-limit concurrent production6/6 and error-class cleanup/retry pass. These do not themselves execute native one-over-byte/one-over-case refusal/reload/corrected retry. Finish that named independent boundary chain; original v12 remains failed/cause unproven, without requiring invented retrospective evidence. |
| IMP-018 | Closed (verified) | Independent native valid/truncated SAV and DTA import/calculation/error reload/no partial table/delete/corrected reupload pass together. SAS remains visibly excluded; raw readiness is not processing_status; no report-import or hosted authorisation claim. |
| OBJ-SET-001 | Closed (verified) | Independent current-source Setup A-to-B/Review B-to-C identity, deletion, both reloads and original brief; actual candidate action/DB checks pass. Frozen dual-module identity scope closed. |
| OBJ-SET-002 | Closed (verified) | Actual concurrent/repeated own-add, missing-index/savepoint fallback, rollback and post-commit refresh retry persist one logical objective. Existing REV-009 closure not reopened; no deployed migration certification. |
| OBJ-SET-003 | Closed (verified) | Actual A/B/C and legacy/Setup-only seed/backfill cases plus retained native usable-answer regeneration/edit/delete/reload prevent resurrection and preserve the brief. Planner/model responses controlled; no real-provider-quality claim. |
| OBJ-SET-004 | Blocked (deferred) | Original OBJ-SET-004 definition remains unavailable. No bug, fix or verification invented. Recover original assertions or explicitly archive with owner disposition. |
| OBJ-SET-005 | Blocked (deferred) | Original OBJ-SET-005 definition remains unavailable. Repair claims cannot identify the acceptance contract. Recover or explicitly retain/archive unsubstantiated history. |
| OBJ-SET-M02 | Closed (verified) | Independent native numbered/hyphenated/Unicode marker edit/delete/reload in Setup and Review keeps one objective per form and stable IDs; prior parser/roundtrip controls retained. Current finite gate closes; stale historical normalization.cjs hashes are not claimed current. |
| OBJ-REV-001 / OBJ-REV-002 recovered identity overlap | Closed (preserved) | Independent Rule B code, four PostgreSQL gates and native/recovery closure preserved. Distinct historical REV-002 definition remains unavailable; no new row inferred. |
| OBJ-REV-003 | Blocked (deferred) | Original OBJ-REV-003 assertions are unrecovered. Historical evidence recovery/archive only. |
| OBJ-REV-004 | Closed (verified) | Both actual framers pass original tab/whitespace rejection-resurrection and rollback/retry controls; independent native detail/overview edit/accept/unaccept/reject/restore and durable identity pass. Separate usable-answer regeneration proof is retained. Frozen human-review scope closes; a replay regeneration refusal is not counted as usable generation; un-serialised concurrent regeneration remains a separate disclosed limit. |
| OBJ-REV-005 / ANA-XTAB-001 dependency | Closed (verified) | Actual persisted total/mean-percent/base29-30/equality/opposite-stance/mixed-reload cases pass. Independent Net/member and ambiguous-design cases plus real-digest durable multiplicity qualification and both exports meet the named uncertainty contract. No corrected multiple-testing interval or legacy backfill claimed; older conclusions require regeneration. |
| OBJ-REV-006 | Closed (verified) | Independent exact original two-exhaustive-channel case refuses arbitrary online selection for generic buying; explicit channel and canonical Yes/No controls compute, persist raw identities, reload and repeat without duplication. Missing/ambiguous controls pass. Closes the original selector defect at actual evaluator/persistence scope with controlled planner/table/model inputs. Historical provider refusals remain refusals, not successful provider answers. |
| OBJ-REV-007 | Closed (verified) | Real two-order edit/evaluation race, no-op/revision, edit/evaluate rollback, deleted-table stale retry and exactly-one-current-result controls pass. Protocol scope only; no reopened generation/coverage atomicity matrix. |
| OBJ-REV-008 | Closed (verified) | Real persisted fractional/repeated/omitted/extra/valid index controls, conflicting-repeat refusal/prior-batch preservation and distinct new extras conclusions pass. Conservatively refusing reordered equivalent citations is retained; no semantic deduplication claim. |
| OBJ-REV-009 | Closed (preserved) | Agreed independent coherent-snapshot/atomic publication application and disposable13-group closure unchanged. Framework/deployment-role limitations preserved. |
| OBJ-REV-010 | Blocked (deferred) | Original OBJ-REV-010 assertions are unavailable. Recover/archive explicitly; do not infer resolution. |
| OBJ-REV-011 | Closed (preserved) | Independent missing-table migration/error mapping code-level closure preserved. Genuine permission/connection failures remain failures; live SQL/browser scope not silently added. |
| OBJ-REV-012 | Closed (verified) | Actual nonowner lookup failure writes durable degradation; loader/reload and prerequisite removal/recovery pass. Repaired coverage renders true flag after native reload and clears after healthy reassessment; both exports preserve qualification. Controlled coverage answer; no provider-quality or full-report audit. |
| OBJ-REV-013 | Closed (verified) | Actual mixed failed writes count durable results only; native refusal remains pending/reload then healthy retry stores one computed answer. Returned/dropped-round recovery passes separately. Controlled planning; interrupted requests are not proof of successful computation; no blanket lost-acknowledgement matrix. |
| OBJ-REV-M03 | Blocked (deferred) | Original OBJ-REV-M03 comment/test definition remains unrecovered. Evidence recovery/archive only; no invented code change. |
| OBJ-REV-M04 | Closed (verified) | Exactly60 controlled response rounds stop visibly pending, Continue operates existing questions, and real permission-revoked load fails visibly then recovers; engineering comment/brief now match. Finite guard/load contract closes; not60 rounds of real-provider computation. |
| DEC-001 | Closed (preserved) | Independent finite human-edit/reaccept/regenerate provenance closure unchanged; retained actual callers still preserve it. No whole-business-workflow closure inferred. |
| Business-decisions remainder (unassigned acceptance requirement; not a new defect ID) | Implemented awaiting verification (partial) | Actual DB finite status/own-delete/bulk/statement transitions and original whitespace-resurrection repair pass; own-add refresh retry is idempotent. Native own-delete/bulk and post-commit refresh-failure reconciliation for other mutations remain specifically unestablished; do not infer them from own-add. |
| ANA-NPS-003 calculation-input subcase | Closed (preserved) | Independent Brief38 strict setup/lower-builder/cache-miss refusal closure preserved. No new arbitrary default or public-release claim. |
| ANA-NPS-003 / IMP-005 findings freshness subcase | Closed (preserved) | Independent current/stale/unknown/no-source and missing-snapshot/migration lookup closure preserved. Shared deeper consumers remain FND scope. |
| FND-001 / REP-OUT-001 necessary handover only | Implemented awaiting verification (partial) | Original wrong-group narrative no longer stores traced in the actual generator/DB test; right-group control is traced. Independent change/reject/body/design handovers and human wording pass at their recorded scopes. Complete the named generator retry/rounded/invented-range and replacement/duplicate consumer assertions before whole-row closure; HTTP deck continuation never erases the failed browser event. |
| ANA-NPS-003 downstream freshness handover | Closed (verified) | Independent fresh-current native PSU change, actual saved design verification, unaffected control, reload, qualified insight/recommendation/narrative and actual DOCX/PPTX preserve human wording. Combined failed invocation plus same-project continuation, not an all-green initial run; synthetic accepted support/model replay explicitly bounded. |

The immutable requirement/frozen-test strings and priorities were programmatically compared before/after for all43 rows. canonical-reconciliation-check.json records counts and identical original/v26 SHA256. This is an explicit supported-scope disposition, not a count of repairs or tests. In particular, finite deferrable reopen/marker/guard criteria now have relevant independent checks; unexercised trimmed-wide or historical harness branches remain disclosed limits, not secretly certified behaviours.

### Exact stopping point

Four technical rows remain open: IMP-004 saved zero/missing-audit values across the remaining declarations; IMP-017 independent native one-over-byte/one-over-case refusal/reload/corrected retry; business native own-delete/bulk and refresh-failure reconciliation beyond own-add; FND named generator and replacement/duplicate consumer assertions. Their partial passes cannot close the missing assertions. The six blocked rows remain the deployed security prerequisite plus five unrecovered historical definitions. Numeric-only scale policy, approved SAS/flipped-separate-Codebook exclusions, legacy regeneration limits, real Office/provider scope and deployment/storage/identity/role/runner prerequisites remain explicit. Overall acceptance is **incomplete**.

No application changes, dependency installation, paid calls, author/history rewrite, push or deployment. Independent closure of the readiness test is complete; no repeated repair of it is assigned. The handoff releases the next bounded evidence work under the four named rows, preserving all closed scopes and the failed history.

Resource close-out: two complete synthetic stored objects with hashes, password-free UTF-8 cluster dump and old/new reports/trace retained. Verified owned PID tree and labelled codex-reconcile-20261017 cluster stopped; all owned listeners clear. User/development services untouched. No replay shutdown log is claimed after forced process shutdown. No paid calls; cumulative US$3.817316 unchanged.

## Claude work package for the four released remainders (2026-10-17; commit 091663e)

Claude-authored; needs independent review. Base `b5992da`. No row status is changed here: Codex decides each closure. The 33 closed scopes are not reopened. Owner decisions from Grant (2026-10-17 07:33 SAST) are in the handoff: numbered scales of 10+ points get a mean by default; the five rows whose definitions are missing are archived as unsubstantiated; deployed security comes last, in staging.

| Row | Concrete case first | Change | Evidence (all executed on the final tree) |
|---|---|---|---|
| IMP-004 | Owner policy, not a defect: a 0 to 10 scale with bare numeric labels had no mean (the golden Recommend). | `api/parse-stats-file.py` `_is_numbered_scale`: 10+ substantive points whose labels are bare numbers, at most the two end points with anchor wording. Numbered named categories, 9-point scales and declared-nominal questions keep no mean. | `engineNumberedScaleMean.test.ts` (8, real engine; 6 fail on the old engine): 0 to 10 mean 6.5, 1 to 10 53/8, anchored end points 6.5, don't know excluded 6.5, the same as the continuous route, the SPSS default measure 'scale', and three no-mean controls. The adapter check asserts Recommend 7.1 (pandas: 7.1 over 200), with Gender as the refusal case. Native `scale-missing-reload.check.mjs` (synthetic SAV): worded 1 to 5 with declared-but-empty 5 and user-missing 9 gives base 40 of 45, mean 2.5, top two 25%, code 5 count 0; unlabelled with user-missing gives base 40; sparse 0 to 10 gives mean 5.8 and code 0 count 0; all identical after reopening the saved tables; the data audit still reports 2 user-missing declarations after reload. |
| Business-decisions remainder | **Reproduced defect.** `refreshInsights` and `refreshRecommendations` log and swallow their failures, so a decision change whose refresh failed looked complete while insights and recommendations stayed built on the old decisions. When logging failed too, the action threw after the commit, and the panel said "Not changed" about a saved change (in production with the reason withheld). | New `src/lib/decisionRefresh.ts`: a `decision_refresh_pending` trace marker is written in the change's own transaction and cleared only by a refresh that succeeds (only markers older than the refresh's start, so a change committed mid-refresh stays owed). Decision actions return `{ ok, refreshError }`. The two wrappers still never throw but return their failures; the 27 automatic callers are unchanged. The panel shows "Saved. The insights and recommendations were not updated to match: ..." with "Update them now", the owed state after reload, and "could not check" when the lookup fails. | `decisionRefreshReconciliation.db.test.ts` (real DB): accept with edit, reject, restore, unaccept, accept all, delete and add own each report the saved change with the reason, commit the status and statement (statement = accepted set), mark the run owed, leave another run untouched, and reconcile on retry; a mid-refresh change stays owed; a thrown refresh is reported the same way; a pre-commit failure still throws and marks nothing. Native `decision-refresh-failure.check.mjs`: a real refused insight write shows the saved-not-updated notice, it survives reload, and "Update them now" reconciles it (marker gone, insight stored, no notice after reload); own add, own delete and accept all through the panel agree with the database and statement after each reload. Updated: `candidateLifecycle.db.test.ts` (asserted the old throw), `decisionCandidateProvenance.test.ts` (mocks the new module). |
| IMP-017 | No failing case found. | None. | Native `over-limit-refusal.check.mjs`: 20,000,001 bytes is refused with the 20 MB message, with no document, cleanup record or stored object (complete inventory), nothing listed after reload, and the 20,000,000-byte file then imports; 100,001 cases is refused with the 100,000-case message, still shown after reload, no table stored; after delete, 100,000 cases import with 100,000 rows. The original v12 failure stays failed with its cause unproven. |
| FND-001 / REP-OUT-001 | No failing case found. | None. | `narrativeWrongGroup.db.test.ts` (real generator and DB) adds: 25.4 rounded to 25 is traced; an invented range "between 20 and 30" is refused and retried with feedback naming it, and the faithful retry is saved traced (2 model calls); three invented drafts save nothing and the previous narrative is unchanged. `supportReplacementDuplicates.db.test.ts` (real re-read, real `deleteDocument`, real CSV and deck routes): a re-read that drops a supporting claim keeps that finding (same id and wording) and its insight's support current; an unprotected finding is retired and the new claim added once; removing one of two duplicate sources makes the insight "Support no longer valid", left out of the accepted deck, with its wording and decision kept; the control stays current. |

Also added: `objectiveEvidenceReference.db.test.ts` (OBJ-REV-005 reference cases through the real evaluator and persistence; the row is already closed, so this is extra regression coverage only).

### Final-tree gate (cloud workspace, disposable PostgreSQL 16)

- `npx tsc --noEmit -p .` pass; eslint on every changed file pass (`page.tsx` unchanged at 0 errors / 5 warnings).
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 121 files, **860 passed, 0 failed, 39 skipped**.
- Production build pass. Against the production server: browser checks **28 of 28**, golden-thread smoke 1, adapter 2, objective-review script passed.
- Disposable resources stopped by PID; no `ie_e2e_*` or `ie_test_*` database or role remains (two stale `ie_test_` databases from this workspace were dropped). No model calls.

### Failed invocations this round (retained)

- First stack start: disposable PostgreSQL had stopped; restarted.
- `engineNumberedScaleMean`: first run asserted an unlabelled categorical column would get a mean (outside the decision); the control now uses the continuous route.
- `objectiveEvidenceReference`: first run used the wrong estimate fields (`lo`/`hi` instead of `diffLo`/`diffHi`); the first attempt also hit a stopped database.
- `narrativeWrongGroup`: a second describe block closed the shared pool; merged into one block.
- `supportReplacementDuplicates`: a raw SQL document delete was refused by a foreign key; the test uses the app's `deleteDocument`.
- `scale-missing-reload`: the base-row locator missed the row (it starts with a hide control); a run was cut by a 590 s wrapper; one failed because the audit sits inside the collapsed "Data quality" section.


## Codex independent review of four remainders 2026-10-17

Reviewed laptop HEAD `e2739b2` / released Claude source `091663e`, base `b5992da`. Initial tracked tree was clean; handoff READY_FOR_CODEX was changed to CODEX_WORKING before review. Application source stayed read-only:423 source/engine/migration paths match the review manifest at completion. New isolated production build uses Next16.3.6, real PostgreSQL17 and actual Python/pandas/pyreadstat; Claude's PG16 evidence is separate. No live/development writes, dependency installation, paid model call, push, deployment, author/mirror rewrite or recurring schedule change.

**Disposition:36 Closed /0 Implemented awaiting verification /1 Confirmed defect /0 Untested requirement /6 Blocked =43; priorities34/9/0. Overall acceptance remains incomplete.** Prior33 closures preserved. IMP-004, IMP-017 and FND/REP-OUT close only at the evidence levels below. The business remainder is now a confirmed defect under its existing identity; detailed findings are not additional rows. Canonical prior version retained byte-for-byte as v27.

### Independent execution and original-behaviour checks

- `regressions.log`:7 focused files,35 passes/4 explicitly inactive placeholders. Real DB tests executed; actual engine executed with PYTHON_EXECUTABLE=python. Covers numbered-scale policy references/controls; candidate lifecycle/DEC-001; all supplied refresh transitions/retry; actual narrative generator persistence/rounded25.4-to25/invented-range feedback and exhausted retry; actual reread/delete and CSV/deck duplicate support consumers. OBJ-REV-005 reference tests are preservation controls, not another closure.
- `build.log`:isolated production build and TypeScript pass. Offline font mock is a compile boundary; existing unpdf import.meta warning retained. `changed-module-lint.log`:0 errors/5 existing page.tsx warnings. No measured performance problem inferred from source shape.
- `native-primary-report.json` / `native-primary.log`:4/4 pass on fresh production build. Scale test checks labelled mean2.5/base40/top-two25%/declared5 count0, unlabelled base40 and code4 count10, sparse mean5.8/declared0 count0, identical saved figures after reload and two persisted missing-value declarations. The isolated Python fixture launcher alone changed python3 to python; all assertions retained.
- Native resource test independently establishes20,000,001-byte refusal/no document/object/cleanup, corrected20,000,000-byte import;100,001-case visible refusal/reload/no table, supported deletion and100,000-case corrected import. Reuse earlier independent exact-limit concurrent and storage-error recovery. Original v12 remains failed, cause unproven and failed-page/storage outcome not retroactively established; no deployed throughput certification.
- Supplied business native tests pass:real refused insight insert reports saved-not-updated, survives reload and retries safely; native own-add/own-delete/accept-all/status/statement reload agree. These do not cover the two counterexamples below.
- FND replacement evidence retains protected finding ID/wording and live usable support when reread omits it; unprotected retired claim/new claim once; actual deletion of one duplicate source invalidates affected support in CSV/deck while preserving human wording and unaffected control. This is the implemented REP-IN protection contract, not a claim every omitted protected finding is deleted. Reuse independently verified wrong-group, change/reject/body/design and export qualifications. Model calls scripted/storage controlled; original Probe-B browser deck timeout and HTTP continuation remain distinct.

### Correctness findings within the business-decisions remainder

1. **Saved change still throws on marker lookup failure.** `src/lib/decisionRefresh.ts:29` awaits withTenantRead before its try/catch; `decisionCandidateActions.ts:17` propagates it after the transaction commits. Independent `independentDecisionLookup.db.test.ts` injects only that read outage; real PostgreSQL confirms the own decision accepted and pending marker durable, then the action throws `Synthetic marker lookup outage` instead of returning saved-with-refresh-error. Expected correct-behaviour assertion fails in `independent-lookup.log`. Candidate/list UI treats thrown action failures as Not changed/Not saved; a user can retry an already committed action. Smallest fix: contain all post-commit refresh bookkeeping failures in the saved-result protocol, retain the owed marker and actionable retry. Closing tests: replay this exact original counterexample, precommit failure still unsaved, successful retry/currentness, no duplicate own decision, and unchanged concurrent marker protection.
2. **Refresh completion falsely clears existing stale decision context.** `decisionRefresh.ts:46` clears markers after successful wrapper returns, but `insightGenerator.ts:105` excludes findings with existing insights; recommendation generation similarly excludes existing anchors (`recommendationAgent.ts:241,518`). Native researcher accept/edit/Save and accept/reload in both generate and validate workflows persists `Decision B materially revised`, while the same insight keeps `Decision A / Decision B`; marker0 and panel warning0. `native-context-final.log` and `native-context-validate.log` fail the correct-behaviour assertion; exact DB rows in `context-database-observation.json`, traces/screenshots in context-generate-output and context-validate-output. No app source or SQL mutation performs the tested decision edit. Smallest safe repair: do not equate incremental generation with reconciled existing artifacts; preserve a durable visible qualification until they are reviewed/reconciled against current decisions, preserving human wording. Closing tests: original native validate-mode existing-insight edit/reload, existing recommendation control, unaffected artifact, human wording, successful review/retry and a concurrent decision change whose marker stays owed. Do not silently overwrite human artifacts or add a general report redesign.

The supplied fresh-insert/retry passes are preserved; they do not disprove either original counterexample. No overall business closure. Both findings share the one existing business row; DEC-001 stays closed.

### Standard, failures and limits

UI/business/persistence layers remain separated; the pending rule is shared in decisionRefresh.ts. No parallel rule or measured performance concern identified. Correctness above comes first. Comments/types claiming a thrown action means uncommitted, and successful refresh means dependants match, must be corrected with those behaviours; wrapper comments saying never throw must acknowledge or contain logging failures. These are consequences of the demonstrated defects, not extra release rows.

Two additional review-only native attempts were interrupted before edit/save because the review locator lost its text anchor, then selected the button toolbar instead of the editor card. Both logs/process records retained (`context-first-interrupted.txt`, `context-second-interrupted.txt`); these are harness failures, not application results. Corrected probes reach and fail the original currentness assertion in5.5s and the separate validate invocation. A first sandbox-denied attempt to edit the Temp probe changed no source; rerun with scoped access. The first docker inspect formatting command failed; JSON inspection then verified the exact container ID/label before shutdown. None is relabelled as a passing app run. Historical Claude failures and prior independent failed runs remain unchanged.

Owner decisions: numeric-only numbered scales10+ explicitly approved; declared nominal/named categories/9-point controls stay without a mean. Five missing-definition rows explicitly archived as unsubstantiated, retained Blocked. SAS and flipped/separate-Codebook weight/MR exclusion remain visible. Staging security/identity last and unauthorised now; real storage/signed links/deployed roles/schema/runner, real-provider quality and Office limits remain separate. Research Quality Review stays design-only. No new issue IDs.

### All43 current dispositions

Each retained closure refers to the matching independent mechanisms/regressions in the preceding row-level reconciliation; no unchanged row is promoted by the harness or unrelated suite.

| Existing row | Current disposition | Basis / next action |
|---|---|---|
| IMP-001 / IMP-016 | Blocked | Separate authorised staging identity/storage/security and deployment evidence required; no deployment authorised. |
| IMP-002 (includes IMP-SHIP-001/002) | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-003 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-004 | Closed | New finite closure: actual-engine references and supported native saved scales/missing audit/reload pass; approved policy explicit. |
| IMP-005 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-006 / REP-IN-001; REP-IN-002 preservation dependency | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-007 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-008 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-009 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-010 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-011 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-012 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-013 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-014 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-015 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| IMP-017 | Closed | New finite local closure: one-over/refusal/reload/corrected retry plus prior concurrency/error recovery; v12 failure preserved. |
| IMP-018 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-SET-001 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-SET-002 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-SET-003 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-SET-004 | Blocked | Owner archived original definition as unsubstantiated; stays Blocked, not repaired or verified. |
| OBJ-SET-005 | Blocked | Owner archived original definition as unsubstantiated; stays Blocked, not repaired or verified. |
| OBJ-SET-M02 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-001 / OBJ-REV-002 recovered identity overlap | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-003 | Blocked | Owner archived original definition as unsubstantiated; stays Blocked, not repaired or verified. |
| OBJ-REV-004 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-005 / ANA-XTAB-001 dependency | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-006 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-007 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-008 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-009 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-010 | Blocked | Owner archived original definition as unsubstantiated; stays Blocked, not repaired or verified. |
| OBJ-REV-011 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-012 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-013 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| OBJ-REV-M03 | Blocked | Owner archived original definition as unsubstantiated; stays Blocked, not repaired or verified. |
| OBJ-REV-M04 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| DEC-001 | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| Business-decisions remainder (unassigned acceptance requirement; not a new defect ID) | Confirmed defect | Partially repaired/verified; two independent original counterexamples remain. Claude repair then independent verification required. |
| ANA-NPS-003 calculation-input subcase | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| ANA-NPS-003 / IMP-005 findings freshness subcase | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |
| FND-001 / REP-OUT-001 necessary handover only | Closed | New finite closure: actual-generator persistence/retry/rounding/range refusal and replacement/duplicate consumers plus prior handovers. |
| ANA-NPS-003 downstream freshness handover | Closed | Retain prior independent finite closure and limitations; no affected-source counterexample demonstrated. |

### Retention and ownership

Evidence root:`scripts/workflow-tenant-review/four-remainders-20261017/`. Three synthetic objects/full inventory/SHA256, password-free dump, focused and failed native reports/traces, portable counterexample source and source comparisons retained. Storage read counters were captured after retention downloads, not claimed pristine. Verified own process tree33520/18164 and labelled `codex-four-review-20261017` stopped; app3237/DB55518/storage39126 and owned replay listeners clear. User/development services untouched. Cumulative model spend unchangedUS$3.817316/US$10. Claude is released for the two business-row repairs only, with affected source boundaries and closing tests above; no Codex execution/resource remains active after this documentation checkpoint. Return READY_FOR_CODEX after a stable bounded repair. No automatic continuation or recurring watch is claimed.

## Claude repair (disposition record) of the two business-row findings (2026-10-17; commit `1f21f71`)

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


## Codex independent business follow-up 2026-10-17

Reviewed clean laptop HEAD `2c6417e`, released repair `1f21f71` over `6dba539`. Handoff recorded CODEX_WORKING before review. Application source stayed read-only;424 source/engine/migration paths match the frozen manifest. New isolated Next16.3.6 production build used actual PostgreSQL17; Claude's PG16 full-gate results remain separate. No live/development writes, dependency install, paid model call, push/deployment, author/mirror rewrite or scheduled-task change.

**Disposition unchanged:36 Closed /0 Implemented awaiting verification /1 Confirmed defect /0 Untested /6 Blocked=43, priorities34/9/0.** All43 finite rows reconciled: the prior36 closures and six blocked rows are preserved; only business-row evidence/remaining repair narrows. Previous canonical retained byte-for-byte as v28. IDs, requirements, priorities and frozen criteria unchanged. Five missing definitions remain explicitly archived as unsubstantiated, still Blocked; security/staging/deployment/identity/storage gates remain separate. Overall acceptance incomplete.

### Repaired and independently verified

- Original saved-change counterexample, unchanged and run individually: `independentDecisionLookup.db.test.ts` now returns `{ok:true,refreshError:'Synthetic marker lookup outage'}` after the real committed save, rather than throwing. The released full `decisionRefreshReconciliation` suite covers failed retry, idempotent re-add, precommit refusal, concurrent marker retention, all finite transitions and unknown reads; passes. Post-commit containment accepted.
- Original unchanged native recorded-context insight counterexample passes: same insight/old context retained with marker0, but now notice1 after native edit/reload. Released native validate and generate cases establish panel qualification, pre-insight tag and actual Excel cell; human wording preserved, revert/other-run/unknown controls pass in actual DB. This finite repair is accepted. Per-item synthesized/recommendation/deck/narrative limitations remain disclosed; no demand for a broad consumer audit or automatic rewriting is inferred.
- `regressions.log`:4 files,20 passes/3 inactive placeholders; actual DB executed, includes lifecycle/DEC-001 and affected support/export preservation. `native-original-report.json`:4 passes (3 released checks and unchanged independent native probe). Fresh production build/TypeScript pass; changed-module lint0 errors/6 pre-existing warnings. Claude's862/39 and29-browser full-gate claims were not silently substituted for these independently executed results.

### Remaining correctness finding under the same business row

**Recommendations do not necessarily share an insight's decision context.** `src/lib/decisionContext.ts:25` excludes null-context insights; `decisionRefresh.ts:88` counts recommendations only via those mismatching insights. Yet `recommendationAgent.ts:297` frames recommendations against the run's accepted decisions at recommendation generation time, irrespective of when or how the insight was framed. A generate-mode insight can legitimately predate any decision (null context), then acquire a recommendation generated for Decision A. Editing that accepted decision later leaves the existing recommendation outside the mismatch count. A nonnull parent snapshot from a different generation time is likewise not evidence of the recommendation's own snapshot; do not assume fixing only nulls establishes exact recommendation currentness.

Independent real-DB assertion: after changing the decisions, mismatch `{insights:0,recommendations:0}`, pending false, old researcher recommendation preserved with no qualification. Expected correct-behaviour assertion fails in `independent-db.log`; generation is controlled in this DB case.

Independent production-native proof removes that controlled-generation limit: a synthetic no-context insight is seeded (normal pre-decision generate state), the ACTUAL recommendation generator creates `Action framed for Decision A` through scripted model replay while Decision A is accepted. The researcher then uses native Edit/Save and accept to change the sole accepted decision to `Decision C replaces Decision A`. After reload the same recommendation ID/text remains, insight context null, marker0 and panel notices0. `native-unframed-reworded.log` fails the qualification assertion in3.5s; exact observation/trace/screenshot retained. A separate native added-decision case also fails in3.5s, retained independently. These are application results, not missing prerequisites or harness locator failures. Only model content is scripted; generation/persistence/actions/browser are actual. No model-quality claim.

Practical consequence: the new standing warning still silently misses decision-dependent recommendations in a supported generate workflow. Smallest repair: establish recommendation-specific currentness, or conservatively retain a visible unknown/earlier-decision qualification when it cannot be established. Do not infer a recommendation's decision snapshot from its parent's null or different-time context. Preserve researcher wording/review links and unaffected support; no automatic rewriting, dependency deletion or new product capability required. A safe action/review/retry state is sufficient.

Closing tests: replay the exact actual-generator/native Decision A-to-C/reload failure and real-DB control; existing per-finding and synthesized recommendation paths; parent insight context null and different generation-time context; revert must not falsely clear an older recommendation's qualification; unaffected current control, preserved human wording and failed/currentness lookup, successful retry/review plus concurrent change. Scope is this existing recommendation-currentness mechanism, not every report consumer. Existing original postcommit and framed-insight probes stay closed and are preservation controls only.

### Failures, standards and retention

Unchanged old DB probe run as a whole produces4 passes/1 failure/1 inactive placeholder: its successful postcommit test intentionally leaves a pending marker, then its next precommit test incorrectly assumes no marker. This is confirmed probe-state contamination (`original-probe-ordering.log`), not failure of precommit rollback. It remains retained, not relabelled green. The isolated original assertion passes, and the released regression explicitly retries before its precommit assertion and passes. Prior independent/Claude/harness failures remain untouched. Independent added-decision and materially reworded-decision failures are separate application cases, not one rerun presented as a success.

Layering/shared SQL rule is retained; no speculative efficiency or abstraction finding. The documented assumption that recommendations inherit insight context is the correctness defect above. Minor comment placement in DecisionBriefReview leaves the refresh-notice explanation above plural(); correct it with the next bounded change, not a separate release blocker. No unrelated source refactor requested.

Evidence root:`scripts/workflow-tenant-review/business-followup-20261017/`: source manifest/comparison, original/failing reports/traces/screenshots, portable DB/native counterexample files, zero-object full storage inventory, password-free synthetic dump. The stack's shutdown-only model replay log is not claimed retained after process termination; request generation boundary is established by actual persisted recommendation and source/prompt path. Verified owned process tree38156/45816 and labelled codex-business-review-20261017 stopped; app3238/DB55519/storage39127 and owned replay listeners clear. User/development services untouched. Spend unchangedUS$3.817316/US$10.

Claude is released only for the remaining recommendation-currentness repair and its focused evidence. Keep disclosures/exclusions/archived history/security/provider/Office limits,36 closures and original failing history. No deep golden-thread run or overall acceptance is authorised by this review. Return READY_FOR_CODEX after stable bounded repair; no recurring watch claim.

## Claude repair (disposition record) of recommendation currentness (2026-10-17; commit `8fa326c`)

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


## Codex independent recommendation-currentness review 2026-10-17

Reviewed initially clean HEAD `9316946`, released Claude repair `8fa326c` (8 paths) over `9225d95`. Handoff READY_FOR_CODEX changed to CODEX_WORKING before review. Application source remained read-only;425 source/engine/migration paths match the frozen review manifest at completion. Fresh Next16.3.6 production build, actual PostgreSQL17 (Claude's PG16 evidence separate), explicit offline model replay/mocks. No live/development writes, dependency installation, paid model call, push/deployment, author/mirror rewrite or watch change.

**Business-decisions remainder closes at its finite local contract. Current all43 partition:37 Closed /0 Implemented awaiting verification /0 Confirmed defect /0 Untested /6 Blocked; priorities34/9/0.** Prior36 closures unchanged; only the existing business row promoted. Prior canonical retained byte-for-byte as v29. IDs, requirements, priorities and frozen criteria unchanged. Six blocked rows and all supported exclusions remain. Overall acceptance remains incomplete.

### Implemented mechanism and independent original-regression verification

`recommendationAgent.ts` stores the run decision statement read before drafting in each newly generated per-finding and synthesized recommendation. `decisionContext.ts` compares the recommendation's own snapshot, not its parent's; null/absent legacy AI snapshot is unknown, researcher-authored and rejected rows excluded. `decisionRefresh.ts` counts earlier and unknown recommendations independently of insight mismatches; DecisionBriefReview renders those counts, including when zero insights mismatch. No reviewed wording, statuses or support links are rewritten/deleted. No regeneration feature added.

- `regressions.log`:4 focused files,23 passes/3 explicitly inactive placeholders. Real DB generator tests establish Decision A-to-C-to-A, null parent context, parent snapshot from another generation time, synthesized path, actual prompt-time snapshot during a committed mid-draft change, legacy unknown/researcher/rejected/other-run controls and preserved edited wording. Retained transition/retry/concurrent marker/precommit/DEC-001 controls pass. This is focused verification, not a rerun of Claude's full868/40 gate.
- `independent-db.log`:both original expected-correctness assertions pass unchanged, plus1 independent migration case. Total3 selected passes/19 other test assertions deliberately deselected, not reported as app passes or prerequisite skips. Saved own-change still returns saved-with-error at the original lookup outage; older recommendation on null-context insight is now qualified unknown.
- Independent actual migration case starts before0102: actual generator still writes a recommendation, counts it unknown.0102 inside a real transaction rolls back cleanly; applied twice thereafter without row/text/edit changes, legacy context stays null/unknown. A new actual generation records current decisions and counts current without a process restart. Additive/rollback/rerun/recovery verified only on the owned disposable database, not an intended deployment runner or live role.
- `native-regressions-report.json`:7/7 pass on the fresh production build. Four released checks cover real insert-failure/reload/retry, framed insight/Excel qualification in validate/generate, own-add/delete/accept-all/statement reload, actual generated null-context recommendation A-to-C-to-A. All3 retained independent native probes pass: original insight wording unchanged but warning1; original added-decision recommendation and materially reworded-decision recommendation now keep warning1 after reload, same ID/text preserved. Only `55519` guard changed to owned `55520` where present; assertions unchanged (`probe-adaptations.json`). These were the original material failures, not unrelated tests.
- Production build/TypeScript pass; changed-module lint clean. Existing unpdf import.meta build warning retained; offline font mock is compilation only. No claim that Claude's full30-browser/smoke/adapter matrices were independently repeated.

Both original business repairs from1f21f71 remain accepted; their code boundaries unchanged except the explicit recommendation-currentness extension. The old probe's embedded two-field count expectation is superseded by the intentional three-field earlier/unknown contract, not silently converted to success; the exact original independent failure assertions were selected and passed. Previous full-probe ordering failure remains documented as inherited pending state. All original application/harness/environment failures remain historical evidence, including v12 failure/cause limits and browser deck/HTTP continuation distinctions. No failed run is retrospectively called green.

### Standards, limits and all43 disposition

UI, shared currentness rule and generation/persistence remain separated. Both generators reuse one insertion path; the SQL rule is called only with internal trusted SQL identifiers. Prompt-time provenance and conservative legacy/old-schema behavior are explained in source/migration. The earlier misplaced UI comment is corrected. No new material correctness or maintainability violation found; no efficiency claim or performance problem inferred from code shape. Positive schema-availability cache assumes the process serves the configured schema; this review tested forward migration discovery, not arbitrary schema removal under a running deployment.

All43 rows were reconciled:36 prior closures retained and business row newly Closed; six Blocked unchanged. Five missing historical definitions (SET004/005, REV003/010/M03) remain explicitly archived as unsubstantiated, not fixed. IMP001/016 deployed security/identity, real storage/signed links and separate role/schema/runner/backup certification still require owner-authorised staging/deployment evidence. SAS and flipped/separate-Codebook weight/MR exclusions remain visible. Research Quality Review remains design-only; broader provider quality and Office limitations remain.

Important boundary:0102 is required to record new recommendation contexts. Existing AI recommendations, or generations on a schema before0102, remain explicitly unknown. There is no rewrite action; reviewed text remains intact. Synthesized-insight cards, recommendation lists, decks and narrative have no new per-item currentness mark; the standing panel qualification is the accepted bounded recovery. These disclosures are not blanket downstream/public-release certification. No deep golden-thread check was run by this review.

### Retention and ownership release

Evidence root:`scripts/workflow-tenant-review/recommendation-review-20261017/`: source/hash comparison, portable original/added migration probes, logs/reports, native observations, full zero-object storage inventory and password-free synthetic dump retained. Shutdown-only model replay log is not claimed retained after process termination. Verified process tree39116/39864 and labelled `codex-rec-review-20261017` stopped; app3239/DB55520/storage39128 and owned replay ports clear. No user/development service stopped; cumulative spend unchangedUS$3.817316/US$10.

Codex releases ownership to Claude for documentation/owner handoff and any separately scoped next checkpoint; there is no remaining application repair under this finite register. This review authorises no staging/live/deployment operation or paid call and creates no recurring watch. No Codex execution/resource remains active after this documentation checkpoint. Overall acceptance is not marked complete.


## Codex independent review of tidy-ups 2026-10-17

Reviewed initially clean HEAD `a345fd3`, released `19b3d54` (7 paths), parent `f263193`. Handoff CODEX_WORKING recorded before review. Application and released test source remained read-only; source manifest/comparison retained. This is the three requested changes only, not the next golden-thread run. No paid calls, live/development writes, dependency installation, push/deployment or author/mirror rewrite.

**Disposition: accept significance-note wording and same-timestamp ordering repair; permanent reference regression requires a bounded test-only follow-up. Canonical43 statuses remain37 Closed/6 Blocked, priorities34/9/0.** No new release row or application defect is inferred from the test-coverage finding below. Prior closures, approved exclusions, archived definitions and security/deployment limits preserved. Overall acceptance incomplete.

### Independently verified application changes

- Engine source at the column/complement comparison computes `sqrt(pj*(1-pj)/n_eff + pc*(1-pc)/c_eff)`, an unpooled standard error; the new note describes it accurately. Calculation code is unchanged; design-based t-test wording and no-banner path remain unchanged. Existing saved notes are not rewritten; recalculation needed for new wording.
- ID resolves equal created_at ordering deterministically in both statement synchronisers, validator and both evidence loaders. Source-priority ordering in syncResearchObjective is deliberately preserved; no position is newly used as candidate identity. Existing candidate-ID identity/reorder/origin/publish and duplicate-index cases pass.
- `focused.log`:7 files,59 passes/4 inactive placeholders, actual Python and PostgreSQL17. Includes both new tie-order cases, reference/weighted/rescaling/exclusion checks and affected objective identity/publishing/index controls.
- `counterfactual-previous.log`:same new tests against the actual previous implementation in an isolated copy:3 expected failures (both tie-order assertions and the new note),4 passes/2 placeholders. Released bytes restored afterwards and hash-checked. This confirms the new repair assertions reach the old failures; it does not establish the untested reference assertions below.
- Isolated tracked-source Next type generation and full TypeScript pass. Lint0 errors/1 existing `_hadTable` warning. The initial workspace typecheck fails on historical untracked review `.ts` captures with relative imports outside their original test directory (`typecheck.log`); this is review-artifact contamination, not an app defect. The isolated continuation excludes those captures without changing application/source config and passes (`typecheck-isolated.log`, `typegen.log`). Both runs retained separately. No fresh production/browser sweep claimed; UI code did not change, and Claude's875/42/build/30-browser reports remain separate self-validation.

### Permanent reference regression coverage finding

`src/lib/__tests__/goldenReferenceFixtures.test.ts` cannot yet substantiate its all31-reference assertion claim:

1. `pooled_two_proportion_z` branch (around95) sets expectedP=null and therefore accepts any nonnull application p-value. It never compares the expected z's significance conclusion. Isolated negative control changes Purchase-z from2.8284 to0 (opposite conclusion) and the aggregate assertion still passes, logging expected0/observed0.0039/ok=true.
2. `identifier` branch (around63) checks text/numeric metadata only, not expected endpoint values0001/0200. Driver reads the first ID but that value is unused. Isolated negative control changes id-first expected value to9999; aggregate assertion still passes. Metadata text type alone does not prove canonical identity or leading-zero preservation.
3. Default branch records an unsupported statistic as `not checked` with ok=true, while result length still equals31. Changing Purchase-z statistic to unsupported-new-statistic produces a passing aggregate assertion. This lets future fixture additions silently weaken coverage.

Evidence:`negative-controls.log` has2 passing mutated aggregate tests/10 deliberately deselected tests; `negative-identifier.log`1 passing mutated aggregate/5 deselected. These are NEGATIVE controls unexpectedly accepted by the harness, not evidence the incorrect references are valid or app arithmetic wrong. Portable mutated test sources retained with exact fixture/source hashes. Current dataset's remaining value/conclusion checks pass; no actual engine numerical defect is demonstrated.

Smallest follow-up: only goldenReferenceFixtures.test.ts plus its focused tests/docs. Check abs(expected z) against the declared two-sided alpha threshold, or derive its expected p/conclusion independently, respecting the explicitly allowed pooled/unpooled method difference; compare real first/last IDs to their expected literal values; reject unsupported statistic types rather than counting success. Add negative controls proving contradictory z conclusion, wrong endpoint ID and unsupported assertion fail; correct references still pass, weighted x7 and visible exclusion preserved. Do not change engine arithmetic or accepted identity code to satisfy a test.

Nonblocking documentation detail: new ordering-test commentary says statements and evidence order agree universally, but objective statements retain the pre-existing source-priority prefix while loaders order chronologically. Current same-source tie test establishes a tie-break, not universal mixed-source order equality. Correct that comment to its actual finite scope; do not remove source priority or invent another application repair.

### Retention and ownership

Evidence root:`scripts/workflow-tenant-review/tidy-review-20261017/`: frozen manifest, source comparisons, focused/counterfactual/type/lint/negative-control logs, portable probes and password-free disposable dump retained. Owned labelled codex-tidy-review-20261017 stopped; DB55521 clear; no browser/storage/model service started. User services untouched. Spend unchangedUS$3.817316/US$10.

Claude is released for the reference-test follow-up and comment/docs only; two application changes accepted,37 finite closures retained. No Codex execution/resource remains active after documentation checkpoint. Return READY_FOR_CODEX once the corrected reference harness is stable; next golden-thread run remains separate and was not started here. No recurring watch created or changed.
