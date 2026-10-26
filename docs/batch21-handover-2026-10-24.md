# Handover: COD500-F01, COD500-F02, SEC500-F01, V-B19-01 (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch20 (`ed8c9c3`).
Follows `docs/independent-coding500-review-main-2026-10-24.md` (COD500-F01, COD500-F02) and
`docs/independent-secondary500-review-main-2026-10-24.md` (SEC500-F01), from
`docs/coding-secondary-findings-insights-handoff-2026-10-24.md`, and
`docs/independent-batch19-20-review-main-2026-10-24.md` (V-B19-01). No migration. Nothing pushed or
deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | COD500-F01, COD500-F02, SEC500-F01, V-B19-01 | correctness, security, test readiness |
| docs commit | This handover and the status line | |

## COD500-F01: annotations against another tenant's transcript

Codex: `saveCodeMeta` and `saveTurnNote` inserted the caller's tenant id with whatever document id was
supplied; row-level security accepted the row (its own tenant) and the foreign key checked only that
the document existed. The hidden row then held the key, and the transcript's owner could no longer
save that theme or turn note.

- New `lockOwnedTranscript(client, tenantId, runId, documentId, mode)`
  (`src/lib/codingTranscriptOwnership.ts`): the document by id, run and tenant, `for share` or `for
  update`, refusing "That transcript is not in this project." when there is no such row. Called first
  in `saveCodeMeta` and `saveTurnNote` (share), so a foreign or wrong-project transcript is refused
  before anything is written, and the transcript cannot be deleted or moved between the check and the
  write.
- Both functions now take the run; every caller passes it: `saveCodeMetaAction`, `saveTurnNoteAction`,
  the three `extractThemes.ts` callers (`groupCodesIntoThemes`, `integrateThemes`, `importCodedTranscript`) and
  `codingMemos.reuseCodebook`.
- `saveTurnNote` refuses a negative or non-integer turn index first.
- **Rows left by the old code**: the owner's save meets row-level security (42501) on the hidden row.
  That is now said plainly ("the transcript holds a stored entry under the same name that this
  account cannot see. Ask an administrator to remove it, then save again.") and the whole save rolls
  back. The query to find such rows is in `claude/coding-write-ownership.md`. Existing foreign rows
  are not deleted by the app.

## COD500-F02: a wrong-project coding change

Codex: `changeTurnCode` looked up the codebook and turn by document only, and wrote the override with
the supplied run, so a request naming project B with project A's transcript changed A's coding and
recorded B's run.

- `changeTurnCode` and `addResearcherCode` take `lockOwnedTranscript(..., "update")` first, in the
  same transaction as the codebook, code and turn checks and the writes.
- Every writer of a new codebook version takes the same lock first: `extractThemes.insertCodebook`
  (theme extraction, coded import, re-apply) and `codingOverrides.restoreCodebookVersion`. A hand
  change and a new version therefore serialise on the transcript: the change is checked against the
  version actually in force when it is written, and refused ("not in the current codebook") when a
  newer version committed first.
- Moderator turns, missing turns and obsolete codes are refused as before, now after the ownership
  check.

## SEC500-F01: a malformed reading published as an empty one

Codex: a report part whose answer had no findings list was treated as "no findings" (`[]`), and one
whose records all failed validation was silently empty, so a complete, zero-finding reading was
published and the report's previous unreviewed findings left the active pool; the screen said
"Extracted, 0 findings".

- `extractFindingsFromChunk`: an answer with no findings list (absent or not a list) is recorded
  (`extract_findings_bad_response`, reason `no_findings_list`) and fails the part with "Claude's answer
  for "<file>" had no findings list, so it could not be used and nothing was replaced. Run Extract
  findings again." Records returned but none usable (each needs text, a quote, a theme and a
  recognised kind) also fail the part (`no_usable_findings`). Failing the part uses the existing path a
  cut-off answer takes: a single-part report throws and is stamped "processing failed" with the error
  shown; every part failing throws; nothing is replaced.
- Some records usable and some not: the usable ones are kept, the part is recorded
  (`some_findings_unusable`) and counts with the failed parts. The reading is then partial and follows
  the existing partial policy: it cannot retire previous findings (withheld, "could not be read in
  full ... the previous N findings are unchanged"), and a first reading publishes what it has and is
  marked incomplete. The read summary now says parts "could not be read in full, so some findings may
  be missing".
- An explicit empty list is still a genuine empty reading.
- Also corrected: the withheld message's "1 finding are unchanged".

## V-B19-01: a timed-out Research quality case could change the next case's tenant

Codex: `researchQuality.db.test.ts` kept the signed-in tenant, the model stand-in's switches and the
queue of `after()` work in module-wide variables, reset in `beforeEach`. A case that ran past its
5-second timeout kept going and set tenant B after the next case had reset to A, so the next case
failed with "Unknown project".

- Each case now runs in its own async context (`AsyncLocalStorage`) with its own signed-in user, model
  switches and `after()` queue; the file's `it` wraps vitest's to start each case with a fresh copy.
  The mocked request context, the model stand-in and `after()` read the copy of the case that is
  running, so a late continuation of an earlier case writes only to its own copy. `beforeEach` resets
  are removed (nothing shared is left to reset). Every foreign-tenant, partial-reading and comparison
  assertion is unchanged.
- Regression: "isolation, part 1" leaves behind a continuation that, once released, signs in as tenant
  B and breaks the model (`failTask`, `extract: "invent"`), as a timed-out case does; "isolation,
  part 2" releases it, waits for it, then still reads tenant A and a healthy model and completes a
  review. With the shared state put back, part 2 fails.
- The slow mixed-document RQ-F01 case now has a 60-second timeout, like the file's other database
  cases; that is in addition to the isolation, not instead of it.
- `recommendationDecisionContext.db.test.ts`: Codex's full run reported a 10-second hook timeout in this
  file. Its `beforeAll` already had 120 seconds; the `afterAll` (pool end and database drop) had the
  10-second default and now has 60. This is inferred from the hook defaults, not reproduced.
- `e2e/ui/objective-setup-review-identity.check.mjs`: in this batch's full browser run the line after
  saving "Native objective B" failed once on a strict-mode match of two elements (the wording in the
  Setup list and in the review table at once). It now accepts either (`.first()`); the database poll
  that follows is the real check. Test-only; it passed 3 of 3 before and after the change.

## Files

- `src/lib/codingTranscriptOwnership.ts` (new): `lockOwnedTranscript`.
- `src/lib/codingMeta.ts`: run parameter, lock, plain message for an old foreign row, turn index check.
- `src/lib/codingOverrides.ts`: lock in `changeTurnCode`, `addResearcherCode`, `restoreCodebookVersion`.
- `src/lib/extractThemes.ts`: lock in `insertCodebook`; run passed to `saveCodeMeta`.
- `src/lib/codingAnalysisActions.ts`, `src/lib/codingMemos.ts`: run passed.
- `src/lib/extractFindings.ts`: malformed and partly usable answers; `discarded` per part; messages.
- `src/app/runs/[id]/ReportReadSummary.tsx`: wording.
- Tests: `src/lib/__tests__/codingOwnership.db.test.ts` (8), `src/lib/__tests__/reportMalformedReading.db.test.ts` (8),
  `e2e/ui/secondary-malformed-reading.check.mjs`.
- Test isolation: `src/lib/__tests__/researchQuality.db.test.ts`, `src/lib/__tests__/recommendationDecisionContext.db.test.ts`,
  `e2e/ui/objective-setup-review-identity.check.mjs`.
- Docs: `claude/coding-write-ownership.md` (new), `claude/model-call-completion.md` (report reading row),
  this handover.

## Checks run

Fresh disposable PostgreSQL 16 (port 55432) and a fresh disposable application stack (production
`next build --webpack`, `next start`); no development or live database, storage or provider.

- `npx tsc --noEmit`: exit 0. `eslint` on the changed library, test and check files: 0 errors, 1
  warning (an unused `documentId` at `extractFindings.ts:68`, present before this batch).
- **Full library suite, final tree** (`bb90c56`; only documentation follows it),
  `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **exit 0, 1,673 passed,
  0 failed, 72 skipped**, 221 files passed and 1 skipped, 424.8s. No unhandled errors. This is the
  clean full-library result V-B19-01 asks for. (An earlier full run on the repair tree `2cb5101`,
  before the V-B19-01 change: exit 0, 1,671 passed, 0 failed, 72 skipped.)
- New library tests: `codingOwnership.db.test.ts` 8 passed (connected as a NOSUPERUSER, NOBYPASSRLS
  role); `reportMalformedReading.db.test.ts` 8 passed; `researchQuality.db.test.ts` 54 passed (52
  before, plus the two isolation cases).
- New browser check `secondary-malformed-reading`: **passed** (real upload of
  `fixtures/golden-thread-1/report.docx`, replayed model answers).
- **Full browser suite** on the repair tree `2cb5101` (the application code is unchanged after it; later
  commits change only tests and documents): **101 passed, 1 failed, 1 skipped** (the real-model
  quality check), 28.6 min. The failure was `objective-setup-review-identity` (a strict-mode text match
  of two elements, described above); it then passed 3 of 3 unchanged and 3 of 3 with the corrected
  match.
- Golden-thread smoke: **1 passed**.

Mutation checks (the fix removed, the test rerun, then restored):
- Ownership check removed from `lockOwnedTranscript` (any document, no refusal): **4 of 8**
  coding-ownership tests fail (both foreign-tenant and wrong-project annotation cases, the F02
  wrong-project case, and the concurrency case).
- The coding writers' `for update` removed (no lock): the concurrency case fails (the change no longer
  waits for the new version).
- The old malformed handling restored (a missing list read as empty, no failure for all-invalid, no
  partial count): **7 of 8** malformed-reading tests fail; the genuine-empty control still passes.
- The shared tenant and model state put back in `researchQuality.db.test.ts`: "isolation, part 2"
  fails.

## Limits

- Foreign rows already stored by the old code are reported, not removed; an administrator removes
  them with the query in the brief.
- The model's answers are scripted (library) or replayed (browser); this is orchestration and
  persistence evidence, not model quality.
- The lock order for coding is the transcript's document row only; no coding writer takes the run row,
  so it does not interact with the run lock of batch19.
