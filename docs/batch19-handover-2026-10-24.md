# Handover: OBJ500-F01, DEC500-F01/F02, RQ-F02, CT500-F01/F02, B17-F01, M-B17-01, V-B17-01, M-DEC500-01 (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch18 (`e278adf`).
Follows `docs/independent-objectives500-review-main-2026-10-24.md` (OBJ500-F01),
`docs/independent-batch17-review-main-2026-10-24.md` (B17-F01, M-B17-01, V-B17-01),
`docs/independent-decisions500-review-main-2026-10-24.md` (DEC500-F01, DEC500-F02, M-DEC500-01) and
`docs/independent-batch18-review-main-2026-10-24.md` (RQ-F02; RQ-F01 closed there) and
`docs/independent-crosstabs500-review-main-2026-10-24.md` (CT500-F01, CT500-F02). No migration.
Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | OBJ500-F01, DEC500-F02, DEC500-F01, RQ-F02, CT500-F01, CT500-F02, B17-F01, V-B17-01, M-B17-01, M-DEC500-01 | correctness, test readiness, documentation |
| docs commit | This handover and the status line | |

## OBJ500-F01: concurrent objective transitions

Codex: unaccepting, rejecting or deleting two different objectives at once each succeeded, but
`runs.research_objective` kept one of them as accepted context (and the Word export carried it); two
deletes could leave a deleted objective in `stated_objectives_text`.

- New `runSync.lockRunForContextChange(client, runId, tenantId)`: `select id from runs where id = $1
  and tenant_id = $2 for update`, refusing ("That project is not available.") when there is no such
  row for this tenant. Called first in every transaction that changes objective or decision
  candidates and then rebuilds the run's statement or stated list: objectives accept all, delete all,
  unaccept, reject, restore, delete, delete suggested; the objective framer's regenerate transaction;
  and the same in decisions (accept, accept all, delete all, reject, restore, unaccept, delete, and
  the decision framer's regenerate). The decision half was found by inspection while repairing
  OBJ500-F01 and is Codex's DEC500-F02, reported independently in the decisions review; the native
  Excel export there reads the same `runs.decision_statement` checked below. Accept and add-own for objectives, add-own
  for decisions, and the Setup save and edit already locked the run row first; they are unchanged.
- Why first: the syncs read every accepted candidate and write one statement. With the lock first,
  the second transaction waits for the first to commit and then reads its result (READ COMMITTED).
  Locking only the final update would leave the statement computed from the old view. One order
  everywhere (run row, then candidate rows) keeps these paths from deadlocking each other. The comment
  on the helper records this.
- The Word export reads `runs.research_objective` (`story/export-docx/route.ts`), so the statement
  checked below is what reaches Word.

## DEC500-F01: stale or deleted decision editors

Codex: a decision editor opened before another editor's save replaced the winner without a conflict;
a save for a decision deleted meanwhile returned success with nothing stored, closing the editor and
losing the draft.

- `acceptDecisionCandidate(runId, candidateId, editedText?, expectedText?)` now returns
  `DecisionChangeResult | DecisionConflict`. Under the run lock and the candidate row lock it refuses
  a missing candidate (also for a plain Accept) and, when `expectedText` is given, one whose stored
  wording (trimmed) differs, with `currentText` read under the same lock (null when deleted). A
  deleted and recreated decision has a new id, so the old editor is refused. Nothing is written on a
  refusal; a committed change keeps its saved-but-not-updated refresh reporting.
- `DecisionBriefReview.tsx`: the editor records the wording it opened with when Edit is pressed (not
  from later props) and sends it. A refusal keeps the editor and draft open, shows the message and
  "Stored now: ...", and offers "Use current wording" (the draft becomes it) or "Replace with mine"
  (saves the draft over what is stored, expecting that wording); a deleted decision shows only the
  message and a reload hint.

## RQ-F02: comparisons need both documents

Codex: with the proposal unreadable, a comparison criterion was rated 3/5 Workable from a brief quote
alone, on screen and in Word.

- `researchQualityRules.validateObservation` gets each source's read state (`sourceRead`, from the
  review's reading steps) and, for comparison criteria (group `comparison`, RQ-CMP-*, whose required
  evidence is always one brief item and one proposal item): not rated when the proposal or the brief
  could not be read; not rated when the cited quotes come from one document only (the note names
  which); Absent when the quotes are the brief's only, the model says the proposal does not cover it,
  and the proposal was read in full (a stated gap). Other `brief_if_present` criteria are unaffected.
- Saved one-sided comparison ratings keep their stored rating and are qualified on screen and in the
  Word export (`researchQualityView.oneSidedComparisons`, `oneSidedComparisonNote`).
- `scripts/e2e/model-replay.mjs`: the replay now cites one fact from each document for comparison
  criteria (it cited one fact in all), so a healthy replayed comparison is still rated.
- Contract added to `claude/research-quality-evidence.md`.

## CT500-F01: a table is deleted only from its own project

`crosstabs.deleteCrosstab` archived the table's findings by table id before the run-scoped delete,
so another project's id (same organisation) removed the findings, deleted no table and reported
success. It now locks the table (`select ... for update` by table id, run id and tenant id) before
anything is archived, refuses a missing or mismatched table ("That table is not in this project (it
may have been deleted already), so nothing was deleted.") and checks that the delete removed the
row, so the archive can never commit without it. Archive and delete stay one transaction.

## CT500-F02: simultaneous builds of one file

The same defect Grant met in CSM Analytics on 24 October (13:07, "duplicate key value violates unique
constraint document_tables_document_id_table_index_key" with Segment by set): `buildCrosstab` locks
the data file's `documents` row (id, run and tenant) before taking the next table number, so saves
for one file take turns; the lock also confirms the file. Should the constraint still refuse a
number, the message says another table was being saved at that moment and nothing was lost. The
fix was made on 24 October in the cloud and is first applied to main here.

## M-DEC500-01: regeneration comment

`DecisionBriefReview.tsx`: the comment now states the framer's actual rule (an AI suggestion is
replaced unless rejected or edited, accepted or not, because suggestions land accepted) and points to
`decisionFramer.ts` as authoritative. `decisionCandidateProvenance.test.ts` keeps both controls
(edited survives, unedited replaced).

## B17-F01: same-named technical documents in the source line

- `DocumentUsed` carries `documentId`. `runAssistantLoop` lists a document and passage once however
  often it is read, by id; `sourceLines` groups by id, never by name, in first-read order.
- New `technicalDocuments.technicalDocumentLabels`: a document's label is its file name, plus its
  upload time (UTC, to the second) when another of the project's technical documents has the same
  name, plus the id's first eight characters if even that repeats. The same label is used in the
  assistant's context list, the search results, the read result and the saved line, so the reader and
  the model see one name per document. Computed over all of the project's technical documents,
  readable or not, as the context lists them.

## V-B17-01: pane test baselines

`e2e/ui/band-preferences.check.mjs` takes each width baseline only once the pane reports a measured
width (polled above 0), and polls later widths to the expected value instead of reading them once.
All the original fold, filter, draft and storage-blocked assertions are unchanged. No fixed sleeps.

## M-B17-01: engineering contracts

- `claude/research-assistant.md`: new section on technical documents and weighting: modules, project
  and tenant scope, passages and refs, the tools, identity in the source line (B17-F01), instructions,
  `describe_weighting` and its failure boundary, limits.
- `claude/import-screen-and-download.md`: the technical document type, upload and read, the
  failed-read and processing behaviour, the exclusions from Findings, Research quality, Objectives and
  design set-up, the 0112 refusal, cleanup and recovery, tests.
- `src/lib/uploadPurposes.ts`: the superseded "server action is unchanged" comment is corrected.

## Tests

- `objectiveConcurrentTransitions.db.test.ts` (new; real PostgreSQL, actual actions): a separate
  connection holds the run row, both actions start and are seen waiting on a lock (polled from
  another connection), then the hold is released, the interleaving Codex found, every time. Six cases:
  concurrent unaccepts (with a sequential control), rejects, deletes (stated list and the immutable
  brief checked), an unaccept with a delete, concurrent decision unaccepts, and another
  organisation's run refused with nothing changed.
- `researchAssistantTools.db.test.ts` (+1; actual assistant loop and database): two "Technical
  report.txt" documents (1 and 3 passages), read in both orders with a repeated read: the reply and
  the saved message list both, labelled by upload time, each once; renamed, they are listed by name
  alone. `technicalDocuments.test.ts` (+1): the labels, including equal upload times.
- `decisionEditConflict.db.test.ts` (new; real PostgreSQL, actual action), 4 cases: a stale editor
  refused with the current wording, the winner kept, the statement unchanged, then "replace"
  deliberately saved; a deleted decision refused for an edit and a plain accept with nothing stored;
  deleted and recreated, the old editor refused and the new row untouched; controls (current editor,
  plain accept, another organisation refused with nothing changed). `decisionRefreshReconciliation`
  and `decisionCandidateProvenance` updated for the new result type and the run lock.
- `researchQuality.db.test.ts`, new "RQ-F02 comparisons rest on both documents" (actual actions,
  runner, view, Word), 5 cases: unread proposal with a true brief quote (nothing rated, no overall,
  Word has no rating), unread brief, one-sided quotes either way (not rated) and the stated-gap
  Absent, the both-documents control (60%, also after reload), and a comparison stored the old way
  (kept, qualified on screen data and in Word).
- `crosstabDeleteOwnership.db.test.ts` (new; real PostgreSQL, actual `deleteCrosstabAction`), 4 cases:
  another project's id refused with the table, its finding and the archive untouched; another
  organisation's table and an already deleted or unknown table refused; healthy deletion archives the
  finding and removes the table; a delete that fails after the archive (a disposable trigger) rolls
  both back, and the retry succeeds once.
- `crosstabConcurrentSave.db.test.ts` (new; real PostgreSQL, actual `buildCrosstab`, engine replayed):
  five tables saved at once for one file all saved with five different numbers, the imported table
  untouched; a file of another project refused with nothing written.
- Browser (new): `decision-edit-conflict.check.mjs` (stale save refused with the draft kept and the
  stored wording shown, "Replace with mine", "Use current wording", deleted decision refused with the
  draft kept, reload) and `research-quality-comparison-grounding.check.mjs` (unread proposal:
  nothing rated on screen, after reload and in Word; a healthy new comparison rates).
- Mutation checks (each made, run, reverted): the run lock without `for update` fails 4 of the 6
  concurrency cases (unaccept, reject, delete, decision unaccept); labels reduced to bare names fail
  the same-name case; grouping the source line by name fails it; dropping the decision editor's
  missing and changed checks fails 3 of its 4 cases; switching the comparison rule off fails 3 of the
  5 RQ-F02 cases; removing the table ownership refusal fails the wrong-project and foreign cases; the
  table-number save without its lock failed 4 of 5 concurrent saves (CSM check, 24 October).

## Checks run

All on the repair tree (`49ee5ed`), on a fresh disposable PostgreSQL 16 (port 55432) and a fresh
disposable application stack; no development or live database, storage or provider.

- `npx tsc --noEmit`: exit 0. `eslint` on the changed files: 0 errors.
- Library suite, `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **1,640 passed,
  2 failed, 72 skipped**, 218 files (679.6s). The 2 failures were in `sheetSelectionConsistency.test.ts`,
  a mocked-client crosstab test that did not answer CT500-F02's new document-row lock ("unhandled mock
  query"). Test-only; the mock now answers it (in this batch's repair commit), and that file passes
  **22 of 22**. The full library suite is rerun with batch20 on top.
- New browser checks, first run: `band-preferences` and `research-quality-comparison-grounding`
  passed; `decision-edit-conflict` **failed once** (a 5-minute timeout typing into the editor, the
  first check run against the newly built stack). It then passed in the full browser run and **4 of 4**
  in isolation with `--repeat-each=4` (12 to 14s each). The first failure is not explained; it is
  recorded, not discounted.
- Full browser suite, `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: **100 passed,
  1 skipped** (the real-model quality check, which needs a provider), 35.2 min.
- Golden-thread smoke: **1 passed**. Objective review acceptance script: **passed**.

Mutation checks during the repair (each new test fails with its fix removed and passes with it):
the run lock (objectives and decisions), the edit conflict, the crosstab ownership and table-number
locks, and the RQ-F02 comparison rule.

## Limits

- The mixed unaccept-and-delete case passes even without the lock (its outcome does not depend on the
  interleaving); the other four cases are the regression.
- Two same-named documents uploaded in the same second are told apart by the start of their ids,
  which a researcher cannot read off the Import screen.
- Still open, not in this batch: TP500-F01/F02/F03 and IP1000-F01 to F04 (the one-reader import
  repair).
