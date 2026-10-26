# Handover: System5000B bin findings SYS5B-F01 to F04 (main copy), 25 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch26. Follows
`docs/independent-system5000b-review-main-2026-10-25.md`. **Migration 0117** (index change) for Grant
to apply after 0115. Nothing pushed or deployed.

Contract: `claude/document-deletion-contract.md` (updated: links between files, the source marker
rule, atomic erase, two copies in the bin).

| Commit | What | Kind |
|---|---|---|
| repair commit | SYS5B-F01 to F04; migration 0117; tests | correctness |
| docs commit | This handover and the status line | |

## SYS5B-F01 (S2): links between files' findings lost on restore

`documentBin.restoreFindingsWithRelationships` restores a removal's findings and their links inside the
restore transaction. A grounding link (`findings.grounded_by_finding_id`) or a contradiction
(`finding_contradictions`) whose other finding is not in the project now is no longer skipped:

- when that finding is in another file still in the bin, the link is appended to that file's removal
  snapshot (`groundedBy` or `contradictions`), and restoring that file replays it. A restored finding
  grounded by a finding that is not back yet is restored without the link, which is handed on the same
  way, so the restore no longer fails on the foreign key in the claim-first order either. Each later
  restore replays or hands on again, so links survive any order and repeated removal and restore;
- when that finding no longer exists (its file was erased), the link cannot return and the restore
  result counts it (`linksLost`).

The restore message says how many links are waiting for another file and how many were lost. Erasing a
file reports the links to other files' findings that only its bin entry held (`linksRemoved`), which go
with it. Codex's consequence (a calculated finding turning from validated to net new) follows: the
classification is derived from the restored link.

## SYS5B-F02 (S2): restoring one source cleared the marker for an erased one

`candidateSourceDocuments.ALL_SOURCES_ACTIVE` is the one test: every recorded source exists, is in the
project and is not in the bin. A restore clears "Source document removed" only when it holds, so an
erased source (which no longer exists) or one still in the bin keeps the marker. Objectives and
decisions alike; wording, status and recorded sources are untouched.

## SYS5B-F03 (S2): erase committed before the Research quality text purge

`researchQualityRepository.purgeSourceTextInTransaction` is the purge inside a caller's transaction
(`purgeSourceText` uses it in its own). `eraseRemovedDocument` purges every Research quality source
version read from the file, with the quotes and facts copied from it, in the erase transaction, before
the document and its bin entry are deleted. A purge that fails (or updates fewer versions than it
locked) rolls the whole erase back: the file stays in the bin with its text, and Erase can be retried.
Stored bytes are still removed after the commit through the existing queued, retryable cleanup.

## SYS5B-F04 (S3): the same-file recovery was blocked by the content index

Migration `0117_document_content_identity_active_only.sql` limits the 0098 content-identity index to
files in use (`removed_at is null`): two identical copies can both wait in the bin, and a project still
cannot hold two. Codex's sequence now works: re-upload, restore refused with "Remove that copy first",
remove the copy (into the bin beside the original), restore the original with its reviewed note.
Before 0117, removing the second copy is refused naming the migration, with nothing changed.

## Files

- `src/lib/documentBin.ts`: restore links (F01), marker rule (F02), atomic erase and erase link count
  (F03, F01), pre-0117 refusal (F04).
- `src/lib/candidateSourceDocuments.ts`: `ALL_SOURCES_ACTIVE`.
- `src/lib/researchQualityRepository.ts`: `purgeSourceTextInTransaction`.
- `src/lib/documentActions.ts`: restore and erase messages.
- `supabase/migrations/0117_document_content_identity_active_only.sql` (new).
- Tests: `src/lib/__tests__/documentBinIntegrity.db.test.ts` (new, 8); `documentBin.db.test.ts`
  (restore result shape).

## Checks run

Real disposable PostgreSQL 16 (migrations through 0117) and the disposable browser stack.

- `npx tsc --noEmit`: clean.
- `documentBinIntegrity.db.test.ts`: **8 passed**: grounding in the review's failing order with the
  discovery classification checked, every other remove/restore order, a link handed on through a
  second removal, links lost to an erase (reported by erase and by restore), a contradiction in both
  restore orders, the marker with one source erased, one still binned and all restored (objectives and
  decisions), a failed purge (database trigger) then a successful Erase, the same-file recovery, and
  the pre-0117 refusal. `documentBin.db.test.ts`: 9 passed.
- Mutation checks, each undone after: no hand-off of waiting links (4 tests fail); the old marker rule
  (F02 fails); the purge left out of the erase (F03 fails); the index still covering the bin (F04 fails).
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): **1,737 passed, 72 skipped, 0 failed**
  (230 files).
- Browser: `document-bin.check.mjs` 1 passed; full browser suite **106 passed, 1 skipped**; smoke 1
  passed.

Mocks: storage only. The bin actions, Research quality purge and database are real.

## Limits

- A link whose other finding was replaced by a reread or reprocessing (not by the bin) is not handed on:
  no removal holds that finding, so it is reported as lost.
- Links are handed on only between files of the same project's bin.
- The purge runs in the erase transaction, so erasing a file with very large Research quality sources
  holds the project lock for the purge's duration.
