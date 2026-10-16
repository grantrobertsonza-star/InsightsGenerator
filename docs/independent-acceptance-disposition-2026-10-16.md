# Independent acceptance disposition, release c07eea8 / be625c7 (2026-10-16)

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
