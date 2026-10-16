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
