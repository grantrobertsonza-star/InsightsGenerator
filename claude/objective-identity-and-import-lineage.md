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
successful fill was". A save that fails outright still throws.

**Edits (GT500-F03).** An edit names the wording its editor opened with. Setup
(`editStatedObjective`, via `saveStatedObjectiveEdit`) locks the run row, then finds the list line
or a researcher-authored candidate with that wording; when neither is there any more, the edit is a
conflict (`conflict: true`, an actionable message) and nothing is written. It used to append the
new wording, so a stale editor added a second accepted objective. Review (`acceptObjectiveCandidate`
with `expectedText`) locks the run row and the candidate, and refuses when the candidate's wording
differs or the candidate is gone. Both lock the run row first, so Setup and Review edits of one
objective are serialized and the second sees the first. Edits to different objectives both land.
The editors keep the draft open with the message (`attemptResult` in `actionFailure.ts` treats a
returned `{ ok: false }` like a thrown failure). Adding stays a separate action.

**Manual Add (GT500-P01).** `addOwnObjectiveCandidate` locks the run row and refuses an objective
whose key matches a pending or accepted objective of any source, naming it and nothing is added; a
repeated request after one that succeeded gets the same message. A rejected objective does not
block the add: typing it in again is a deliberate re-add, a new accepted candidate beside the
rejected one (Restore brings the original back instead). Migration 0083's index (exact trimmed text,
researcher-authored, not rejected) can never be violated by this action, since the key check is
stricter.

**Tests.** `objectiveImportLineage.db.test.ts` (real PostgreSQL; extraction and scoring mocked),
`briefFillFromImport.db.test.ts`, `candidateLifecycle.db.test.ts`, `objectiveDecisionClosure.db.test.ts`,
`actionFailure.test.ts`; browser `e2e/ui/objective-gt500.check.mjs` (edit then refill, 503 then
reload then retry, two stale editors), `objective-setup-review-identity.check.mjs`.

**Limits.** Lineage lives in trace rows; a trace row removed by hand removes its lineage. The
decision candidates keep their own, unchanged rules.
