# Coding: sentence boundaries, footers, coded passages and turn notes

Codex COD5K-F01 and COD5K-F02, batch 60 (28 October 2026).

## Sentence boundaries (owner `src/lib/sentences.ts` `splitSentences`)

One rule splits plain text into sentences for every consumer:

| Consumer | Use |
|---|---|
| `qualCoding.splitIntoUnits` | the units a participant turn is coded in (apply payload `ApplyItem.units`) |
| `qualCoding.findRepeatedFooters` / `stripFooters` | a run of one to three closing sentences that ends at least three turns word for word is a footer, not speech, and is removed before coding (`buildApplyBatches`, also used by `searchNegativeCases`) |
| `qualCoding.reconstructCodedUnitText` | rebuilds a coded unit from the stored turns by retracing the two steps above |
| `decisionPresentation.evidenceSummaryPoints` | the evidence summary on Business decisions, one point per sentence (display only) |

A candidate boundary is `.`, `?` or `!` (with closing quotes or brackets), whitespace, then a capital,
digit, quote or bracket. It is not a boundary after a known abbreviation (`e.g.`, `i.e.`, `etc.`,
`vs.`, `Mr.`, `Mrs.`, `Ms.`, `Dr.`, `Prof.`, `approx.`, `St.`), after `No.` directly before a number,
or (rule `numeric-endings-v2`) when the full stop belongs to a numbered-list marker. A number of one
to three digits then a full stop is a list marker only when it:

- stands at a sentence position: nothing but an optional bullet or dash since the previous boundary or
  the start of the text, unless the sentence before it is a question (then it is the answer: "How
  many? 3. Two at banks." gives three sentences);
- directly follows ": " or "; ", or a bullet after a sentence end;
- is one of an ascending run 1., 2., 3. ... of at least two such numbers in the text (an inline list
  whose line breaks were flattened: every caller collapses whitespace before splitting).

Every other number ends its sentence: "a payment of 12.", a year "in 2019.", an amount "R1,200." or
"R12.", a decimal "2.5.", "10:30.", "COVID-19.". Words are never changed or dropped: joining the
pieces with single spaces gives the flattened input back.

**Accepted limits** (Grant, 28 October 2026, accepted for now): a bare number answering something
other than a question ("Count them. 3. Then ...") is read as a list marker; "I was 1. Then 2." is read
as an inline list; a bullet is not itself a boundary, so "Done. - 3. Item." stays one piece (as
before). In all three no word is lost or changed; only where a unit ends moves.

**The legacy rule** (`legacy-number-full-stop`) read any number then a full stop as a list marker and
`No.` always as an abbreviation. It stays selectable only so stored coded passages can be compared
with what the model was shown before batch 60; nothing new is split with it.

## Coded-passage snapshots (owner `extractThemes.getCodedUnitPassages`)

Changing the rule changes the units some turns split into, so re-deriving an old coded unit with the
new rule could quote a passage the model never saw. The stored turn text (`coding_segments.text`) is
verbatim and never rewritten. For each `coding_unit_assignments` row:

| Row | `text` shown | `codedUnderRule` | `stale` |
|---|---|---|---|
| snapshot (`unit_text`, 0090) equal to the new rule's re-derivation | snapshot | `numeric-endings-v2` | false |
| snapshot equal only to the legacy re-derivation | snapshot | `legacy-number-full-stop` | false: the turn did not change, only the rule |
| snapshot equal to neither | snapshot | null | true (the transcript changed) |
| no snapshot, database has the 0090 column | legacy re-derivation (written before 0090, so before batch 60) | legacy | false |
| no snapshot, database without 0090, rules agree | that passage | current | false |
| no snapshot, database without 0090, rules differ | null, `passageUncertain: true` | null | false |

No row is rewritten. `currentText` and `legacyRuleText` are both returned. There is no screen for
these passages yet (see the ANA-QUAL-002 comment on `getCodedUnitPassages`).

Coding runs after batch 60 store snapshots under the new rule. Codes already applied keep their
assignments; re-applying a codebook re-splits under the new rule and stores new snapshots.

## Turn notes (owner `src/lib/codingMeta.ts`; migration 0127)

A researcher's note on a turn belongs to the turn it was written on, not to an index. Re-reading a
transcript (`extractThemes.replaceSegments`) deletes every turn and inserts new ones at 0, 1, 2, ...

- **Write** (`saveTurnNote`, action `saveTurnNoteAction(runId, documentId, index, note, turnText?)`):
  index must be a non-negative integer; the transcript is locked as this run's and tenant's
  (`lockOwnedTranscript`, share); the turn row at that index is read `for share` and must exist, and,
  when `turnText` is given (the Quotes tab always sends the text it shows), must still say exactly
  that. Otherwise the save is refused with a message to reload and nothing is written. After 0127 the
  note stores `segment_text_hash = md5(turn text)`. A row at that index not bound to the current text
  is first moved to `coding_turn_note_orphans`, never overwritten. Clearing deletes only the bound
  note. A retry writes the same row once.
- **Re-read**: `replaceSegments` takes the transcript update lock (so it waits for a note save and a
  save waits for it, then reads the new turns), and in the same transaction moves every note not bound
  to a turn with its exact text to `coding_turn_note_orphans` with reason `turn_missing`,
  `turn_changed` or `turn_unverified` (no hash). A re-read producing the same turn keeps its note. A
  failed re-read rolls back with the notes where they were. Before deleting the old turns it reads the
  words of every noted turn (`readNotedTurnTexts`), and each set-aside note keeps them as `turn_text`
  (stored only when their md5 equals the note's fingerprint, so they are exactly what the note was
  written about). The Quotes tab's set-aside list shows them ("That turn said: ..."), or says "The
  words of that turn were not kept" when `turn_text` is null.
- **Read**: `loadTurnNotes` returns only notes whose hash matches their turn's current text (so the
  Quotes tab and both coding exports, which read the view's `verbatims[].note`, never show a note
  against different speech). `loadOrphanTurnNotes` lists set-aside notes (`orphan:<id>`) and any
  in-place unbound row (`turn:<index>`, left by older code), wording verbatim; the coding view carries
  them as `orphanNotes` (null when they could not be read, which the screen reports).
- **Recovery** (explicit only): `clearOrphanTurnNoteAction` deletes one; `attachOrphanTurnNoteAction`
  moves its wording unchanged onto a chosen current turn whose shown text must match, refused when
  that turn already has a note. A retry of either after success is refused ("no longer set aside").
- **Before 0127** the app works: a missing turn is still refused and the shown-text check applies,
  notes read by index as before, set-aside actions say 0127 is needed, and a re-read cannot set a
  changed turn's note aside (the old risk remains until 0127 is applied).
- **Back-fill (0127)**: an existing note whose index exists is bound to that turn's current text (a
  note already misattributed by an earlier re-read cannot be told apart and stays where it shows
  today); a note on a missing index is moved to the orphans table as `turn_missing` with its wording
  and time, `turn_text` null (no such turn exists to take words from). Nothing is deleted.

**Set-aside notes in the coding workbook** (Grant, 28 October). The coding export
(`/api/runs/[id]/coding/export`) has a "Set-aside notes" sheet, after "Verbatim by theme": one row per
set-aside note with Transcript, Turn written on (1-based), Turn text fingerprint (md5, "Not recorded"
when none), Turn text when written (the exact words of the turn, captured by the re-read that set the note
aside; "Not kept" only when they were genuinely unavailable: notes the 0127 back-fill moved, whose
turn no longer existed, or an unbound row whose fingerprint is unknown), Researcher note
(verbatim), Written by ("Not recorded": no author is stored), Written at, Set aside at ("Found on
reading (not yet moved)" for an unbound row left by older code) and Why set aside (wording shared with
the Quotes tab, `src/lib/setAsideNotes.ts`). With none it is a header-only sheet. If set-aside notes
cannot be read the export is refused (503), not produced without them. The Word extract (quotes by
theme) carries only notes on current turns and has no such section.

**A failed read is not "no notes"** (batch 60 follow-up). `getCodingAnalysis` no longer turns a
failure of `loadTurnNotes` into an empty map: the view carries `turnNotesError` (each
`verbatims[].note` is then unknown, shown as ""), and `orphanNotes` is null when set-aside notes could
not be read. The Quotes tab shows each failure as an alert with "Try again" (a refresh of the server
view), distinct from a transcript with no notes, and pauses note editing while notes are unknown so a
note the researcher cannot see is never typed over. The coding export and extract routes refuse with
503 and a plain message (`codingAnalysis.codingExportBlocker`) rather than produce a file without the
notes. A missing 0055 table still reads as no notes (nothing was ever stored).

## Tests

`sentenceBoundaries.test.ts` (rule cases, footer threshold, one/two/three-sentence and repeated
footers, apply payload, exact reconstructed passages, evidence summary), `qualCoding.test.ts`,
`decisionPresentation.test.ts`, `codedPassageSnapshot.db.test.ts`, `turnNoteIdentity.db.test.ts`
(restricted role; re-read through the real `resegmentTranscript`), `turnNoteMigration.db.test.ts`
(pre-0127 database, then the back-fill applied twice), `quotesTurnNotes.test.tsx` (mounted),
`codingOwnership.db.test.ts`.
