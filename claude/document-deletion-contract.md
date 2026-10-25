# Deleting a file: contract (agreed; built in batch 25)

Grant, 2026-10-25, following Codex's deletion trace on `4dbf8a1`. Decisions taken: a deleted file's
findings are **archived**, not hard-deleted; removal goes to a **bin** first; **unreviewed objective and
decision suggestions drawn only from the deleted file are removed**.

The rule: deleted evidence never silently keeps influencing current conclusions or reports, and the
researcher's own judgement is never silently destroyed.

## Two actions

| Action | Who sees it | Reversible | What it does |
|---|---|---|---|
| **Remove from project** (the delete button) | Every source card | Yes, for 30 days, from the bin | Takes the file and everything resting on it out of current research at once; keeps it restorable |
| **Erase permanently** | The bin (Import data, "Removed files": per file, or "Empty bin") | No | Removes the file and every retained copy of its content: stored bytes, preview, converted copy, extracted text, history copies of its findings, Research quality text snapshots |

An item left in the bin for 30 days is erased permanently. There is no background scheduler in the
app, so expiry is applied when the bin or the project is next opened, and by "Empty bin".

## Remove from project: what happens, in one transaction

The document row is locked by id, run and tenant. Then:

1. **File-only material** (imported tables, cross tabs, analyses, driver and scatter results, coding,
   codebooks, annotations, instrument items and links, evidence chunks, objective-evidence rows) is
   kept and hidden with the file: both move into the project's bin, a hidden run (`runs.bin_of`), so it
   appears nowhere in the project, in any count, search, assistant context, calculation or export
   (`documentBin.MOVED_WITH_DOCUMENT`; a test fails if a table with a document and a run is neither
   moved nor listed as staying).
2. **Findings** calculated from or extracted from the file are archived through the shared archive
   (`finding_history`, reason `source_removed`) with their review decisions, edit provenance and
   researcher notes (migration 0114), together with their verdicts, per-finding insights and those
   insights' recommendations (the existing history tables). They then leave the findings table, so
   nothing current can read them.
3. **Shared work** (synthesized insights, their recommendations, narratives) is not deleted. Its
   support is already derived from what is current: an insight that rested only on the removed
   findings reads "Support no longer valid", one that rested partly on them reads changed, both keep
   their wording and review state, and exports exclude or qualify them as they do today. The narrative
   inherits the worst support of the insights it cites and is qualified the same way; the Insights
   report says to regenerate or review it.
4. **Objectives and decisions** (`candidateSourceDocuments.ts`): each suggestion records the files it
   was drawn from (`source_document_ids`; null when not known):
   - an objective still pending and never edited, drawn only from the removed file, is removed;
   - a decision framer suggestion never edited or rejected, drawn only from the removed file, is
     removed. Framer suggestions land accepted, so "unreviewed" uses the framer's own test for
     "never touched by a researcher"; one kept unchanged looks the same and is removed too. The
     project's decision statement is re-synced in the same transaction;
   - an accepted objective or decision that names the file among its sources is kept and shows
     "Source document removed" until every file it was drawn from is active in the project again
     (`ALL_SOURCES_ACTIVE`, SYS5B-F02): one still in the bin, or erased, keeps the marker, since an
     erased source is lost for good;
   - suggestions with no recorded source (typed, made before migration 0115, or drawn partly from
     evidence with no recorded file) are never removed: which file they came from is not known.
5. **Storage** is untouched while the item is in the bin.
6. The removal is recorded: who, when, the file name, and the counts actually affected.

## Restore from the bin (within 30 days)

In one transaction: the document is unhidden with its file-only material as it was; its archived
findings are restored from history under their original ids, with review decisions, provenance and
notes, followed by their verdicts, per-finding insights and recommendations. Synthesized insights that
cited them read current again once their support matches. Removed objective and decision suggestions
are not restored (they are made again by reading the file). Restore is refused, with the reason, when
the project is gone, or when a file of the same kind and content has been added since (the researcher
chooses which to keep: removing the new copy puts it in the bin beside the original, migration 0117,
and the original can then be restored; SYS5B-F04).

**Links between files (SYS5B-F01).** A grounding link (a report claim grounded by a calculated finding)
or a contradiction between a finding of this file and one of another file is restored when both
findings are in the project. When the other finding is in a file still in the bin, the link is added to
that file's removal record and comes back when that file is restored, in either order and through any
number of removals and restores; the restore message says how many links are waiting. When the other
finding no longer exists (its file was erased), the link cannot come back and the restore says so. The
discovery classification derived from grounding (validated or net new) follows the restored links.

## Erase permanently

Removes, with the file, in one transaction (SYS5B-F03): its document row (cascading the file-only
material), its archived history rows (`finding_history` and the dependent history rows of those
findings), its Research quality source text and the quotes and facts copied from it (the purge, now part
of the same transaction), and the links between its findings and other files' findings that only its
bin entry held (the message says how many). If any of it fails, nothing is erased: the file stays in the
bin and Erase can be tried again. The stored bytes, preview and converted copy are removed after the
commit through the queued storage cleanup, which keeps a visible retry. Synthesized insights and
narratives keep the researcher's wording and stay "Support no longer valid". Reports already downloaded
cannot be recalled; the project history records that a file was erased and when.

## The confirmation

Before removal the dialog states, from a count read when the page loaded: the findings archived (with
how many carry review decisions or notes), the insights resting on them whose support goes, the
objective and decision suggestions removed, the accepted objectives and decisions that will be marked,
and that it can be restored for 30 days. Before erasure (one file or the whole bin) it states in words
what goes (findings, their history and notes, the stored file) and that it cannot be undone.
An unreadable count is said in words, never shown as zero. The removal counts again under its lock,
stores those counts with the removal (shown in the bin), and reports what it actually did.

## Schema changes (migration 0115)

- `runs.bin_of uuid` (the project a bin belongs to; one bin per project; cascades with it).
- `documents.removed_at`, `removed_by`, `removed_from_run`.
- `document_removals`: one row per removal, with the full rows the removal deleted (`snapshot`, restored
  under the same ids) and the counts actually affected; `restored_at`.
- `objective_candidates.source_document_ids uuid[]`, `source_removed_at`; the same two on
  `decision_candidates`.
- `finding_history.archived_reason` gains `source_removed`.
- Without 0115 a file cannot be removed (refused with the reason; nothing changes), and pages read the
  new columns through `to_jsonb` so they still load.
- Migration 0117: the content-identity index (0098) covers files in use only (`removed_at is null`), so
  two identical copies can both be in the bin. Before 0117, removing a second identical copy is refused
  naming the migration, with nothing changed.

## Known costs and limits

- Hiding a removed file by moving it to the bin run means no document query needed changing; the places
  that list projects (dashboard, project list, API, request context) exclude bin runs.
- Removing an output set removes its files one by one, then moves the set. If that stops partway, the
  files already removed are in the bin (each restorable) and removing the set again finishes it.
- Erasing is offered in the bin only, not from the Research quality source list.
- Suggestions without a recorded source document are never attributed to a file by their wording.
- Downloaded reports cannot be recalled.
