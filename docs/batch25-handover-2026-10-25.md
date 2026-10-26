# Handover: removing a file goes to a bin (main copy), 25 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch24. Grant's decisions
(25 October): a removed file's findings are archived, not hard-deleted; removal goes to a bin for 30
days; unreviewed objective and decision suggestions drawn only from the removed file are removed; all
of it in one batch. **Migration 0115** (additive) for Grant to apply. Nothing pushed or deployed.

The contract is `claude/document-deletion-contract.md` (agreed; updated to what was built).

| Commit | What | Kind |
|---|---|---|
| repair commit | The bin, its panel, suggestion sources, migration 0115, test updates | correctness, workflow |
| docs commit | This handover and the status line | |

## What a researcher sees

- The trash button on a source is now **Remove file**. The confirmation says what leaves the
  project's results, with counts read when the page loaded: findings archived (with review decisions
  and notes), insights whose support goes, objective or decision suggestions removed, accepted ones
  kept and marked, and that the file stays in the bin for 30 days. Unknown counts are said in words.
- Import data shows **Removed files (n)** when the bin has anything. Each item gives the date removed,
  the date it will be erased, what was done, and **Restore** and **Erase now**; **Empty bin** erases
  all. Erasing asks first and says it cannot be undone.
- A kept objective or decision drawn from a removed file shows **Source document removed** until the
  file is restored.
- Removing a file from an output set, or the whole set, uses the same bin; restoring a file of a
  removed set brings the set back.

## How it works

- **The bin is a hidden run** (`runs.bin_of`, one per project). Removing moves the document and every
  row of its own material that has a run (`documentBin.MOVED_WITH_DOCUMENT`) into it, so no project
  query sees them and none needed changing. Project lists, the dashboard, the runs API and the request
  context's run check exclude bin runs (read through `to_jsonb` so they work before 0115). A coverage
  test fails if any table with a `document_id` and a `run_id` is neither moved nor listed as staying.
- **Findings** from the file (direct, through its tables, or legacy driver results) are archived
  through the shared archive with reason `source_removed`, keeping review decisions, provenance and
  notes (0114). The full rows deleted (findings, verdicts, insights, recommendations, table checks,
  contradictions, synthesized-insight source links, grounding links) are kept in
  `document_removals.snapshot`. Restore puts them back under the same ids and removes the history
  copies the removal made. Shared work (synthesized insights, narratives) is not changed; its support
  reads "no longer valid" or changed while the file is out, and current again after a restore.
- **Suggestions** (`candidateSourceDocuments.ts`): objectives filled from a brief or proposal record
  those documents; decision framer suggestions record the distinct files behind the findings or
  insights they were drawn from, or null if any of that evidence has no recorded file. Removal deletes
  a pending, unedited objective, and a framer decision suggestion never edited or rejected, when the
  removed file is the only recorded source. It marks accepted ones that name the file, and re-syncs
  the decision statement. Suggestions with unknown sources are never removed. Removed suggestions are
  not restored (reading the file again makes them).
- **Erase** deletes the document (cascading its material), its removal snapshot, the history copies of
  its findings and its Research quality source text, writes a `document_erased` trace and queues the
  stored file, preview and converted copy through the existing storage cleanup (with retry).
- **Expiry**: 30 days, applied when the project page is opened (there is no scheduler); the panel says
  how many were erased.
- **Locks**: removal, restore and erase lock the run, then the document, by id, run and tenant.
  Restore is refused if the project now has a file of the same kind and content. Without 0115 a removal
  is refused with the reason, and nothing changes.

## Migration 0115

`supabase/migrations/0115_document_bin.sql`: `runs.bin_of`; `documents.removed_at`, `removed_by`,
`removed_from_run`; table `document_removals` (RLS tenant isolation); `source_document_ids` and
`source_removed_at` on `objective_candidates` and `decision_candidates`; `source_removed` added to the
finding history reasons. Additive; existing rows are unaffected.

## Files

- New: `src/lib/documentBin.ts`, `src/lib/candidateSourceDocuments.ts`,
  `src/app/runs/[id]/BinNotice.tsx`, `BinPanel.tsx`, `SourceRemovedTag.tsx`, the migration, the contract.
- Changed: `documentActions.ts` (remove, restore, erase, empty bin), `outputSetActions.ts`,
  `documentDeletionMessage.ts`, `documentDeletionImpact.ts`, `decisionFramer.ts`, `runContextActions.ts`,
  `findingArchive.ts` (reason), `requestContext.ts`, `projectList.ts`, `projectStorageCleanup.ts` (bin
  files included when a project is deleted), `src/app/page.tsx`, `src/app/api/runs/route.ts`, the
  history route and page (reason label "Its file was removed"), `page.tsx` (panel, marker),
  `DeleteDocumentButton.tsx`, `OutputSetCard.tsx`, `DecisionBriefReview.tsx`, `ObjectiveReviewTable.tsx`,
  `ObjectivesWorkspace.tsx`.
- Tests:
  - `documentBin.db.test.ts` (new, 9): coverage invariant; remove then restore (same ids, history
    copies gone, marker cleared); decisions; restore refused for a twin; erase; expiry; Empty bin
    scoped to the project; output sets; another project's or tenant's items refused.
  - `decisionSourceDocuments.db.test.ts` (new, 3, model scripted): one file, two files, unknown.
  - `candidateSourceDocuments.test.ts` (new, 2).
  - Updated for the bin: `documentDeletion.db.test.ts` (wording), `documentCleanup.db.test.ts`
    (storage cleanup now follows erase), `driverProvenance`, `supportQuoteSnapshot`,
    `supportReplacementDuplicates` (the file leaves the project rather than the table),
    `decisionCandidateProvenance.test.ts` (mock answers the 0115 column check).
  - Browser: `e2e/ui/document-bin.check.mjs` (new); `e2e/ui/helpers/sources.mjs` uses "Remove file";
    `e2e/ui/native-formats.check.mjs` asserts the file left the project.

## Checks run

Real disposable PostgreSQL 16 (migrations through 0115) and the disposable browser stack.

- `npx tsc --noEmit`: clean.
- Focused library: the bin, decision-source, wording and updated deletion tests, all passing
  (`documentBin` 9, `decisionSourceDocuments` 3, `candidateSourceDocuments` 2, plus the updated files).
- Mutation checks (each made the new tests fail, then was reverted): a decision suggestion removed
  whenever the file is one of its sources rather than its only one (2 failed); no decision-statement
  re-sync after removal (1 failed); unknown evidence files ignored instead of making the sources
  unknown (2 failed).
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): **1,716 passed, 72 skipped, 0 failed**
  (226 files).
- Full browser suite (`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`): 104 passed,
  1 skipped, 1 failed. The failure was `native-formats.check.mjs`, which asserted that a removed
  file's row no longer exists; it now asserts the file has left the project. Rerun with every check
  that removes a file (`document-bin`, `flipped-codebook-guard`, `journey-changes` C1 to C7,
  `native-formats`, `over-limit-refusal`): **11 passed**. Smoke: 1 passed.
- Screenshot of the Removed files panel taken by `document-bin.check.mjs`.

Mocks: the model (decision framer test) and storage (bin and cleanup tests) only; everything else is
the actual library and actions on a real database.

## Limits

- Removing a whole output set removes its files one transaction at a time, then moves the set. If it
  stops partway, the removed files are in the bin and removing the set again finishes it.
- A framer decision suggestion kept unchanged cannot be told apart from an untouched one (they land
  accepted), so it is removed with its only file, as a regenerate would.
- Erasing is offered from the bin only. Reports already downloaded cannot be recalled.
- Expiry runs when the project is opened, not on a clock.
