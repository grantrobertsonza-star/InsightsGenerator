# Objective identity, import lineage, edits and partial fills

Objectives are stated on Set objectives (`runContextActions.ts`: `saveRunContext`,
`editStatedObjective`) and reviewed on Review objectives (`objectiveCandidateActions.ts`). The
Setup list is `runs.stated_objectives_text`; each objective also has an `objective_candidates` row,
and `runs.research_objective` is recomputed from accepted candidates (`runSync.ts`).

**Identity.** `objectiveIdentityKey` (`objectiveLines.ts`) is the one rule for "the same
objective": leading marker stripped, NFKC, curly quotes and dashes normalised, lower case,
collapsed spaces, trailing punctuation removed. Wording is stored and shown as written. Used by the
fill (`saveRunContext`), manual Add (`addOwnObjectiveCandidate`) and the quality score lookup
(`objectiveQualityStatus.ts`, `objectiveQualityScorer.ts`). No semantic matching: a reworded
objective is a different objective. Regeneration of suggestions keeps its own narrower wording key
(`candidateWordingKey`, see `trust-milestone-contract.md`).

**Fill from a brief or proposal.** Choosing a document applies to one save and makes one
extraction call; typed text always wins, and objectives are only taken from the document when the
objective box is empty. A document line is not added when its key matches the Setup list or any
candidate of the project, of any source or status. Import lineage (GT500-F01): every successful
fill records, in its `brief_intake_used` trace row, `extractedKeys` (the keys of every objective it
read from its documents, added or not) and `addedCandidateIds`. A document line whose key any
earlier fill of the project already read is not added again, whatever happened to that objective
since (edited, rejected, deleted): those are the researcher's decisions. This holds across
documents and identical file names (lineage is per project, not per file). Lines the researcher
types are not checked against lineage, so typing an imported objective in again is a deliberate
re-add. The run row is locked for the read and the write, so concurrent fills add each objective
once; the lineage is written in the same transaction as the objectives, so a failed save leaves
none and the retry adds them. Fills recorded before lineage existed (21 October 2026, development
only) are covered by the current-wording check alone. The save returns `alreadyInProject` and
`importedBefore` counts, and the form says what was not added again.

**Source visibility.** Objectives added by a fill carry the rationale `Added from the proposal
"<file>"` (or brief, or both), kept through edits. `briefFillRecord.ts`: `loadLastBriefFill`
(the latest successful fill, with whether its documents are still imported) and
`loadObjectiveSources` (rationale by current key). A failed read is `{ error }`, never "no source".

**Partial fills (GT500-F02).** When the document read or the extraction fails, the typed fields are
saved and the save returns `fill.status = "failed"` with the documents, the reason, the document
ids and whether the failure was recorded (`brief_intake_error`, with document ids and names). The
form shows it from the response itself, so it is visible even when recording failed, and offers
Try the fill again, which resubmits the whole form with those documents chosen again (so nothing
typed is overwritten). `loadFailedBriefFill` returns the latest recorded failure while no later fill
has succeeded, so a reload still shows it; the earlier successful record is then labelled "The last
successful fill was". Every save result also carries `unresolvedFailure`, that same stored state read
after the save (R500-01): a save with no document chosen is not a successful fill, so an earlier
failure and its retry stay shown after it exactly as after a reload; another failed attempt replaces
it; only a successful fill resolves it. When it cannot be read, the form says the state is unknown,
never "no failure". A failure that could not be recorded exists only in the response that reported
it (R500-R01): the open form carries it through later ordinary saves, with its retry and the note
that it was not recorded, until a newer failed fill replaces it or a fill succeeds
(`briefFillCarry.ts`, the form's `useActionState` reducer). A reload cannot bring an unrecorded
failure back; the note says so. A save that fails outright still throws.

**Edits (GT500-F03, R500-02).** An edit is bound to the record its editor was opened on, with the
wording it opened with as that record's expected state. Setup: the page gives each Setup line its
candidate (`setupLineCandidateIds` in `objectiveLines.ts`: the researcher-authored candidate with the
line's marker-stripped wording, earliest first, each used once), and `StatedObjectivesList` sends it
with every edit or delete. `editStatedObjective` (via `saveStatedObjectiveEdit`) locks the run row
and the researcher-authored candidates; that candidate must still exist with the expected wording,
and only it is changed or removed. Deleted, or changed since, is a conflict (`conflict: true`, an
actionable message, nothing written), even when a candidate with the same or normalised-same wording
was added since: delete then add again makes a different record, and an editor opened on the first
never touches the second. Compatibility: a Setup-only line with no candidate (lists saved before
candidates were kept for Setup lines) is sent with `candidateId: null`; its edit needs the line to
be there and no researcher-authored candidate to have its wording (one added since means the line is
no longer the line the editor opened on), then edits the line in place and gives it its candidate. A
caller that sends no target takes that strict path, so nothing edits a record by wording alone. A
stale editor used to append its wording, then (after GT500-F03) to edit whichever record had the old
wording now. Review (`acceptObjectiveCandidate`
with `expectedText`) locks the run row and the candidate, and refuses when the candidate's wording
differs or the candidate is gone. Both lock the run row first, so Setup and Review edits of one
objective are serialized and the second sees the first. Edits to different objectives both land.
The editors keep the draft open with the message (`attemptResult` in `actionFailure.ts` treats a
returned `{ ok: false }` like a thrown failure). Review's expected wording is the one captured when
its editor opened (`useObjectiveRowActions`, both the table row and the detail pane, GT1000-F03): a
refresh of the rows while the editor is open (another objective unaccepted, a revalidated page)
never moves it, so the old draft is still a conflict. After a conflict the draft stays and the
researcher chooses: Use the current wording (draft and expected wording become the current text,
nothing saved) or Replace it with mine (the current text they now see becomes the expected wording
and the save runs again; it is refused again if the objective changed once more). Cancel then Edit
starts from the current wording. Adding stays a separate action.

**Manual Add (GT500-P01).** `addOwnObjectiveCandidate` locks the run row and refuses an objective
whose key matches a pending or accepted objective of any source, naming it and nothing is added; a
repeated request after one that succeeded gets the same message. A rejected objective does not
block the add: typing it in again is a deliberate re-add, a new accepted candidate beside the
rejected one (Restore brings the original back instead). Migration 0083's index (exact trimmed text,
researcher-authored, not rejected) can never be violated by this action, since the key check is
stricter.

**Tests.** `objectiveImportLineage.db.test.ts` (real PostgreSQL; extraction and scoring mocked),
`briefFillFromImport.db.test.ts`, `candidateLifecycle.db.test.ts`, `objectiveDecisionClosure.db.test.ts`,
`actionFailure.test.ts`, `runContextFormFailure.test.tsx` (the form's shown failure for each save
result); browser `e2e/ui/objective-gt500.check.mjs` (edit then refill, 503 then reload then retry,
two stale editors, delete and add again under an open Setup editor, a failed fill kept through an
ordinary save), `objective-setup-review-identity.check.mjs`. Tests edit through
`helpers/setupTarget.ts`, which gives an editor the target the page would.

**Limits.** Lineage lives in trace rows; a trace row removed by hand removes its lineage. Legacy
duplicate candidates with one wording: a Setup edit changes the one its line maps to, not every
copy. The
decision candidates keep their own, unchanged rules.
