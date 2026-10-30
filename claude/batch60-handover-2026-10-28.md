# Batch 60 handover: COD5K-F01 and COD5K-F02 (Coding module)

Status: **implemented, ready for independent review**. Worktree `/home/claude/b70`, branch
`coding-fixes`, base `d2a321d`. Not pushed. Migration 0127 written, not applied to any database.

Commits (all "(not for push)"):

- `eabe399` COD5K-F01: shared sentence rule, legacy rule for stored passages, snapshot treatment.
- `0c0e3f7` COD5K-F02: turn notes bound to their turn, migration 0127, orphan recovery, Quotes tab.
- the docs commit after it: this handover, `claude/coding-text-units.md` (new contract),
  `claude/coding-write-ownership.md`, `claude/rules-registry.md` (three rows), a corrected field
  comment in `extractThemes.ts` and the dash characters in `sentences.ts` regexes written as escapes.

Contract: `claude/coding-text-units.md`. Tier A (source text, stored human annotations, migration),
with a tier B screen part (Quotes tab).

## COD5K-F01 (S2): numeric sentence endings

**Acceptance.** Met in the shared owner `src/lib/sentences.ts`: a number then a full stop is a list
marker only at a sentence position (optional bullet; not when it answers a question), after ": " /
"; " / a bullet after a sentence end, or in an ascending inline run 1., 2., ...; anything else ends
its sentence. The misleading list-marker comment is replaced. "No." is an abbreviation only before
a number (same defect class: "No. The bank refused." absorbed the next sentence). Words are never
changed: every test checks that joining the pieces gives the input back.

**Consumers** (all `splitSentences` callers found by grep):

| Consumer | Effect |
|---|---|
| `qualCoding.findRepeatedFooters` / `stripFooters` | footers after a numeric-ending sentence are now found whole; three-turn threshold unchanged |
| `qualCoding.splitIntoUnits` -> `buildApplyBatches` (apply step, `searchNegativeCases`) | non-speech no longer reaches `ApplyItem.text`/`units`; a numeric-ending sentence is its own unit |
| `qualCoding.reconstructCodedUnitText` | rebuilt passages match the new payload exactly; takes an optional rule |
| `decisionPresentation.evidenceSummaryPoints` | a numeric-ending sentence of the evidence summary is its own point (display only) |

**Existing coded-passage snapshots.** Not rewritten. `getCodedUnitPassages` now re-derives under both
the new and the legacy rule: a snapshot reproduced only by the legacy rule is shown as taken and
marked `codedUnderRule: "legacy-number-full-stop"`, not stale; stale means neither rule reproduces it.
A row without a snapshot (pre-0090) is shown as the legacy rule split it; on a database without 0090
where the rules disagree, `text` is null with `passageUncertain: true`. `coding_segments.text` is never
touched. New coding stores snapshots under the new rule. Codes already applied keep their turn
assignments; their units change only when the codebook is re-applied.

## COD5K-F02 (S2): notes for nonexistent turns

**Storage found.** `coding_turn_notes` (0055) keyed `(document_id, segment_index)`; turns in
`coding_segments`, replaced wholesale by `extractThemes.replaceSegments` (delete then insert) on every
read and re-read.

**Acceptance.** Met: the turn is read `for share` under the transcript share lock and must exist, and
must still say the text the screen showed (Quotes tab sends it), else a visible refusal and nothing
written. After 0127 the note stores the md5 of its turn's text. `replaceSegments` now takes the
transcript update lock and sets aside, in its own transaction, every note whose turn is gone or
changed (`coding_turn_note_orphans`, wording, former turn, time, reason). Reads show only bound notes;
set-aside notes appear in a separate Quotes tab list with explicit Attach (refused when the target
turn has a note) and Remove (asks first). A save on a turn whose row holds an unbound note moves that
note aside first, never overwrites it.

## Impact checklist

1. **Rule:** sentence boundaries (owner `sentences.ts`, new registry row); coded-passage display
   (`getCodedUnitPassages`, new row); turn-note identity (`codingMeta.ts`, new row). No second version.
2. **Inputs:** missing/negative/fractional/non-number index refused; missing or changed turn refused
   with a reload message; an orphan list that cannot be read is `null` and the screen says so; a
   passage whose rule cannot be known is null with `passageUncertain`, not a guess.
3. **Persistence:** one transaction per save/attach/clear/re-read; ownership re-checked on the write
   (`lockOwnedTranscript`); save share-locks the turn, re-read takes the document update lock; retry
   of a save writes one row, retry of attach/clear is refused visibly; a failed re-read rolls back
   with notes in place.
4. **Freshness:** coding exports read `verbatims[].note`, so they now carry only bound notes;
   set-aside notes are not exported (they belong to no current turn). Researcher wording is never
   deleted except by explicit Remove. Coded findings and units change only on re-apply.
5. **Screens:** a save is sent with the shown turn text, so a page loaded before a re-read cannot
   write onto new words; drafts stay on refusal (existing `run` behaviour); the orphan list re-renders
   from the server view after each action.
6. **Proof:** below.

## Files

`src/lib/sentences.ts`, `src/lib/qualCoding.ts`, `src/lib/extractThemes.ts` (`getCodedUnitPassages`,
`replaceSegments`), `src/lib/codingMeta.ts`, `src/lib/codingAnalysisActions.ts`,
`src/lib/codingAnalysis.ts` (`orphanNotes` in the view), `src/app/runs/[id]/QuotesTab.tsx`,
`supabase/migrations/0127_turn_note_identity.sql`; tests `sentenceBoundaries.test.ts`,
`codedPassageSnapshot.db.test.ts`, `turnNoteIdentity.db.test.ts`, `turnNoteMigration.db.test.ts`,
`quotesTurnNotes.test.tsx`. Callers affected: `resegmentTranscript` and the two coding entry points
that call `replaceSegments`, `searchNegativeCases`, both coding export routes (via the view).

## Commands and counts (all run in `/home/claude/b70`)

- `npx next typegen` (ok); `npx tsc --noEmit` (0 errors); `npx eslint .` (0 errors, 44 warnings, all
  pre-existing); `python3 scripts/crosstab_selftest.py` (All checks passed).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run <file> --pool=forks`, one
  at a time, after the fix: `sentenceBoundaries.test.ts` 38/38, `qualCoding.test.ts` 49/49,
  `decisionPresentation.test.ts` 2/2, `quotesTurnNotes.test.tsx` 5/5, `codedPassageSnapshot.db.test.ts`
  3/3, `turnNoteIdentity.db.test.ts` 11/11, `turnNoteMigration.db.test.ts` 2/2,
  `codingOwnership.db.test.ts` 9/9, `tenantIsolation.db.test.ts` 5 passed 1 skipped,
  `tenantIsolationCheck.db.test.ts` 6 passed 1 skipped, `migrationHistoryCheck.db.test.ts` 2 passed
  1 skipped (skips are the suites' own no-database variants).
- **New regressions on the base sources** (base versions of the seven source files restored, 0127
  removed, same commands): `sentenceBoundaries` 20 failed / 18 passed, `quotesTurnNotes` 5 failed,
  `codedPassageSnapshot` 3 failed, `turnNoteIdentity` 11 failed (behavioural examples: a missing-turn
  note saved ok; "About the charge" shown on the new turn 3 after a re-read), `turnNoteMigration`
  2 failed (missing turn accepted; no migration file).

Mocks versus real: DB tests use a real disposable PostgreSQL and the restricted app role; the model
(`anthropic`), `next/cache`, `next/server` `after`, `supabaseAdmin` and the request context are
mocked. The re-read uses the real `resegmentTranscript`; its codebook re-apply then fails at the
mocked model, after the new turns are committed. The UI test is mounted (react-dom in linkedom) with
the server actions mocked. No browser stack was run.

## Codex replay

Codex's four retained files copied into `src/lib/__tests__/`, root read from `CODEX_REPLAY_ROOT`
(scratch copy), run one at a time, then deleted (`git status` clean of them):

| File | Before (`d2a321d`) | After |
|---|---|---|
| `independentCoding3000.test.ts` | 200 failed / 2800 (footer_strip 100, reconstruct 100) | 3000 passed |
| `independentCodingControls.test.ts` | 1 failed / 2 | 2 passed |
| `independentCodingNoteControl.db.test.ts` | 1 failed / 1 | 1 passed |
| `independentCoding2000.db.test.ts` | 200 failed / 2000 (turn_missing 100, assign_roundtrip 100) | 100 failed / 2000 (assign_roundtrip 100) |

The 300 expected failures (footer_strip, reconstruct, turn_missing) are 0 after. The remaining
`assign_roundtrip` 100 fail identically before and after, with "Failed to load url @/lib/db ... in
src/app/api/runs/[id]/coding/export/route.ts": this repository has no vitest alias for `@/`, and the
repo's own route tests mock each `@/lib/...` module explicitly. That is a harness gap in the retained
test, not a behaviour these findings touch; their test was not edited. No Codex assertion conflicts
with the orphan handling.

## Migration 0127 and compatibility

Adds `coding_turn_notes.segment_text_hash` and `coding_turn_note_orphans` (RLS `tenant_isolation`),
back-fills hashes for notes whose turn exists and moves notes on missing turns to the orphans table
(`turn_missing`); deletes nothing; idempotent (applied twice in the test). Run `npm run backup --
--local` first. Before it is applied (checked by `turnNoteIdentityAvailable`), notes read by index,
missing or changed turns are still refused, the orphan list is empty, Attach/Remove say 0127 is
needed, and a re-read cannot set a changed turn's note aside. 0126 is left for the other batch.

## Limits and open points

- Accepted limits (Grant, 28 October, for now): the three flattened-text list cases in the contract
  (bare number not after a question, "I was 1. Then 2.", a bullet after a sentence); no word is lost.
- The back-fill binds each existing note to its turn's current text; a note already misattributed by
  an earlier re-read cannot be detected.
- No screen shows `getCodedUnitPassages` yet, so `codedUnderRule` and `passageUncertain` have no UI.
- Why the tests missed F01: the footer tests used footers and last sentences without numbers; F02:
  ownership tests checked tenant and run, not the turn's existence. Both families now include them.

## Follow-up (coordinator, same day)

1. **A failed note read no longer reads as "no notes".** `codingAnalysis.ts` (`turnNotesError`,
   `codingExportBlocker`), `QuotesTab.tsx` (alert with Try again for unread turn notes and unread
   set-aside notes; note editing paused), export and extract routes (503 instead of a file without
   notes). Regressions: `quotesTurnNotes.test.tsx` 7/7 (failure state with retry, editing paused, empty
   state has no alert and allows a note), `turnNoteIdentity.db.test.ts` 12/12 (SELECT on
   `coding_turn_notes` revoked from the app role: view reports the failure, orphans null, exports
   blocked; empty transcript plainly empty; recovers after the grant). Without the fix: 2 and 1
   failed. Gates: tsc 0 errors, eslint 0 errors (44 pre-existing warnings), crosstab selftest passed,
   `codingOwnership.db` 9/9, `turnNoteMigration.db` 2/2.
2. **Codex replay of `independentCoding2000.db.test.ts` with the export route's `@/lib/...` imports
   mapped** in the temporary copy (`vi.mock("@/lib/<m>", async () => await import("../<m>"))` for db,
   codingAnalysis, qualAudit, transcriptSetup, qualCrosstab, requestContext, as the repo's export tests
   do): **2000 passed / 2000**, all 100 `assign_roundtrip` cases ran and passed (export status 200, code
   name, definition and file name in the workbook). Copy deleted.

## Follow-up 2: set-aside notes in the coding workbook (Grant, 28 October)

"Set-aside notes" sheet in the coding export (columns in `claude/coding-text-units.md`; header only
when none; turn text when written "Not kept" and author "Not recorded" because neither is stored);
export refused (503) when set-aside notes cannot be read. Files: `export/route.ts`, `codingMeta.ts`
(fingerprint and set-aside time on `OrphanTurnNote`), `codingAnalysis.ts` (`codingExportBlocker`
option), new `src/lib/setAsideNotes.ts` (reason wording shared with the Quotes tab, client-safe).
The Word extract is unchanged (no set-aside section). Regression through the real export route with
workbook cells checked, in `turnNoteIdentity.db.test.ts` (`@/lib/...` mapped as the repo's export
tests do): header-only sheet, one exact row after a re-read, 503 when the orphan table is unreadable.
15/15 after; 3 failed with the previous sources. `quotesTurnNotes.test.tsx` 7/7,
`turnNoteMigration.db` 2/2, `codingOwnership.db` 9/9; tsc 0 errors, eslint 0 errors (44 pre-existing
warnings), crosstab selftest passed.

## Follow-up 3: set-aside notes keep the words of their turn (coordinator, 28 October)

Migration 0127 (still unapplied) gains `coding_turn_note_orphans.turn_text`. `replaceSegments` reads
the noted turns' words before deleting them (`codingMeta.readNotedTurnTexts`, under its update lock)
and `setAsideNotesOfReplacedTurns` stores them with each set-aside note, only when their md5 equals the
note's fingerprint. The back-fill's moved notes have no turn, so `turn_text` is null; a row set aside
during a save or attach (its turn already changed by older code) also has none. Quotes tab shows
"That turn said: ..." or "The words of that turn were not kept"; the export's "Turn text when written"
cell carries the words, "Not kept" only when null. Regressions: re-read changes a noted turn, the
set-aside row and `loadOrphanTurnNotes` carry the exact old text, the export cell matches; a vanished
turn keeps its words; a row with no words exports "Not kept"; back-fill row has null.
`turnNoteIdentity.db` 16/16 (4 failed on the previous sources), `quotesTurnNotes` 8/8 (2 failed),
`turnNoteMigration.db` 2/2 (1 failed), `codingOwnership.db` 9/9; tsc 0 errors, eslint 0 errors
(44 pre-existing warnings), crosstab selftest passed.
