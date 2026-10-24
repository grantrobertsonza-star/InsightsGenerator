# Research quality review: verified evidence, rejected readings and absence

Codex RQ-F01, 24 October 2026. What a review may conclude from what its reading of a document
produced, and how a reading that failed verification is kept apart from a document that is silent.

## Reading a document (extraction)

Each passage of each document is sent to the model, which proposes facts with an exact quote.
`researchQualityRules.validateExtraction` keeps a fact only when its topic, phase and selection are
valid values and its quote is found in the stored text (`locateQuote`); every other proposed fact is
left out and counted (`dropped`). Only kept facts are ever cited.

| What the model answered | What the step records | What it means |
|---|---|---|
| Facts, all kept | succeeded | Read |
| Facts, some left out | succeeded, `validation.droppedUnverifiableQuotes` > 0 | Read only partly: the left-out passages may state what an absence would deny |
| Facts, all left out | failed, with the reason (`researchQualityReview.runExtraction`) | Not read. Never "nothing found" |
| No facts, `nothing_found: true` | succeeded, no facts | Read, and genuinely nothing found |
| No facts without `nothing_found`, or a malformed answer | failed (validation error) | Not read |

## What a review concludes

- `coverageComplete` is true only when every reading step succeeded, every document was read to its
  end, and no reading left out a quote.
- A document is "fully" read only then; "partly" when part of it was not read (too long, a failed
  part) or a quote was left out; "could not be read" when no part of it succeeded.
- Criteria assessment (`validateObservation`): an absence (nothing cited, "not documented") in a
  review where a document this criterion applies to (by role; any document when the criterion names
  no roles) had quotes left out is recorded as "not assessed": not rated, never Absent 0, with a
  note. Absence over a document cut short for length keeps its existing rule: rated, scope partial
  ("Not found in the assessed passages").
- Checklist (`validateChecklistAnswer`): in a document not fully read, "absent" is "not assessed"
  (unchanged rule; a left-out quote now makes the document not fully read).
- A review with a failed reading is failed (nothing published) or partial, never complete.

## Comparisons need both documents (Codex RQ-F02)

A proposal-against-brief comparison criterion (group `comparison`, RQ-CMP-*) always requires one item
of evidence from the brief and one from the proposal (`requiredEvidence` in RQC-6).
`validateObservation`, given how far each source was read (`sourceRead`, from the review's reading
steps), applies:

| Situation | Rating |
|---|---|
| The proposal or the brief could not be read | Not assessed (not rated), note naming which |
| Quotes from both documents | As validated otherwise |
| Quotes from one document only | Not assessed, note naming the one cited |
| Quotes from the brief only, the model says the proposal does not cover it, the proposal read in full | Absent (0): a stated gap |
| No quotes | The ordinary absence rules |

Other criteria marked `comparison: "brief_if_present"` compare with a brief only when there is one and
are not affected. A comparison saved before this rule that cites one document only keeps its stored
rating; `researchQualityView.oneSidedComparisons` finds it from the stored statements and
`oneSidedComparisonNote` qualifies it on screen and in Word ("treat them as not rated").

## Where it is shown

- Screen (`ReviewState`): each failed step with its reason; for each document with left-out quotes,
  `unverifiedEvidenceNote`. The banner is amber whenever a note is shown, also on a complete review.
- Word (both builders in `researchQualityExport.ts`): the same steps and notes.
- The notes are derived from the stored step rows (`unverifiedEvidenceBySource`), so a review saved
  before this repair, whose all-rejected reading was recorded as succeeded with no facts, is
  qualified too ("none of the N quoted passages ... start a new review"). Its stored Absent ratings
  are not rewritten.

## Retry

`retryableInPlace` (presentation, used by the screen) and `retryFailedTasks` apply one rule: a step
past its attempts is not retried; a reading step is retried in place only until an assessment or
checklist has published, because those cite facts by ids numbered across the review. After that the
screen says to start a new review version to include the document, and offers no retry for it.

## Tests

`researchQuality.db.test.ts`, "RQ-F01 rejected extraction..." (real database, actual actions, view and
Word): all quotes rejected (failed step, nothing Absent, Word, retry recovers), all topics invalid,
some rejected (verified facts used, absences not rated, Word note), the same in a full review's
checklist, a genuine nothing-found control, two documents with one rejected (the other assessed,
retry not offered, a new review reads both, another organisation refused), and a review saved
before the repair. `researchQualityRules.test.ts` and `researchQualityPresentation.test.ts` for the
rules. Browser: `e2e/ui/research-quality-rejected-evidence.check.mjs`.

## Limits

- A comparison's two sides are told apart by source role; whether the quoted passages are the
  relevant ones remains the model's judgement.

- A reading where most quotes are left out but one is kept counts as partly read, not failed.
- Stored ratings of reviews made before the repair are not recomputed; they carry the note.
