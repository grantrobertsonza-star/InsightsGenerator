# Handover: RQ-F01, rejected extraction is never complete negative evidence (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-research-quality-review-main-2026-10-24.md` (0 S1, 1 S2, 0 S3), reviewed on
`3184b06`; this repair is on top of batch17 (`06aaa11`). No migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `8b3a77a` | RQ-F01 | correctness |
| docs commit | This handover and the status line | |

## RQ-F01

Codex: an extraction whose proposed quotes were all rejected by the quote check was published as a
successful, empty reading. A brief stating its decision, population and deliverables was then
reviewed as complete, 0%, ten criteria Absent, on screen, after reload and in Word, and Retry did
nothing because the step had succeeded.

The contract is now in `claude/research-quality-evidence.md` (new):

- **All proposed facts rejected** (quotes not in the document, or invalid topic, phase or selection):
  the reading step fails with the reason ("none of the N passages the model quoted from X
  (characters a to b) could be found in the document, so nothing was taken from this part. It is not
  read as having no content"; `researchQualityReview.runExtraction`). The document then counts as
  not read, so no assessment rates it absent; the review is failed or partial, never complete; Retry
  failed steps reads it again (attempts as before).
- **Some rejected:** the verified facts are used. The document counts as read only partly and
  `coverageComplete` is false. In criteria assessment (`researchQualityRules.validateObservation`) an
  absence in a review where a document the criterion applies to (by role) had quotes left out is
  "not assessed": not rated, never Absent 0, with a validation note. The checklist's existing rule
  then makes its absences "not assessed" for that document. Absence over a document cut short for
  length keeps its existing rule.
- **Genuine nothing found** (no facts, `nothing_found: true`): unchanged, a complete reading.
- **Shown:** `unverifiedEvidenceNote` (`researchQualityPresentation.ts`) per document with left-out
  quotes, on screen (amber banner, also on a complete review) and in both Word builders. Derived from
  the stored step rows (`researchQualityView.unverifiedEvidenceBySource`), so a review saved before
  this repair, whose all-rejected reading was stored as succeeded with no facts, says "none of the N
  quoted passages ... start a new review". Its stored ratings are not rewritten.
- **Word for a brief or proposal review** (`buildKindDocx`) did not list unfinished steps at all; it
  now names each ("Not completed: Reading the document: ..."), as the full review's Scope already did.
- **Retry:** `retryableInPlace` (presentation) is the rule the screen uses: a reading step can be
  retried in place only until an assessment or checklist has published (they cite facts by id), the
  same rule `retryFailedTasks` applies. The screen used to offer Retry failed steps in that case and
  then rerun nothing; it now says to start a new review version.
- **Screen after a retry** (found by the new browser check): the retry starts the run in the
  background after the action answers, so the page could reload while the review still read failed
  and then stop updating, leaving the failure on screen after a successful retry. The page now keeps
  reading the review for up to two minutes after a retry or continue, until the run shows as running,
  and then follows it as before. The "Retrying..." note clears once the review has moved on.
- Assessment step inputs now include `unverifiedSourceIds`, so their input hash reflects it.
- Tenant, lease and ownership checks are unchanged.

## Tests

- `researchQuality.db.test.ts`, new "RQ-F01 rejected extraction..." (real PostgreSQL, non-owner role,
  actual actions, runner, view and Word; the model stand-in proposes invented quotes or invalid
  topics on demand), 7 cases:
  - all quotes rejected: failed, the step's reason, nothing Absent, no overall, Word says so, Retry
    with the model healthy completes with the decision rated 3;
  - all topics invalid: the same failed step;
  - some rejected (brief review): complete, coverage not complete, the note with 2 rejected, the
    decision still rated 3, every absence not assessed and unscored, no dimension at 0, the Word note;
  - some rejected (full review): the checklist confirms no absence in that document;
  - control, a document where nothing is found: complete, coverage complete, Absent with complete scope;
  - two documents, the proposal rejected: partial, only the brief's facts, the proposal named, the
    brief's absences scoped partial, the reading not retryable in place, a retry changes nothing, a new
    review reads both, another organisation's retry refused;
  - a review stored as the old code wrote it: the "none of the 4" note on screen data and in Word.
- `researchQualityRules.test.ts` (+1): not rated for a relevant source, unchanged for an unrelated
  one, documented content still rated. `researchQualityPresentation.test.ts` (+3): the note's
  wording, the per-document sums, `retryableInPlace`.
- Mutation checks (each made, run, reverted): publishing an all-rejected reading again fails 3 of the
  7 cases; scoring the absences again fails the mixed case; reading a partly verified document as
  fully read fails the checklist case.
- Browser (new): `research-quality-rejected-evidence.check.mjs`, Codex's native repro through
  Import with `client-brief.docx` and a replay fixture inventing the quote: failed with the reason
  and Retry offered, the same after reload, the Word download names the unfinished reading and has no
  0%, and with the replay healthy Retry completes the review on screen (10 rated bars, an overall).
  Screenshots inspected. `research-quality.check.mjs` still passes.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0112, real Python engine,
production build, model replayed. Tree: `e2e22cb` (the content of the repair commit). Exit codes
and the vitest `Errors` line recorded.

| Gate | Result |
|---|---|
| Full library | exit 0; 1,619 passed, 72 skipped (213 files, 1 skipped); no `Errors` line, no unhandled errors |
| Full native browser suite | exit 0; 98 passed, 0 failed, 1 skipped (the gated real-model test); includes the new check |
| Golden-thread smoke; objective acceptance | passed; passed |
| Research quality library tests (rules, presentation, dashboard, checklist, real database) | 106 passed |
| `npx tsc --noEmit`; lint on changed files | pass; no errors or warnings |

## Limits

- A reading in which most quotes are rejected but one is kept counts as partly read, not failed.
- Reviews stored before the repair keep their Absent ratings; the note qualifies them.
- With nothing readable, the dashboard's bars read Pending (their steps never ran) while the banner
  says the review failed; unchanged from before.
- The page's top status line reads the page as loaded, so after a successful retry it can still say
  the last review failed until the page is refreshed (the documented limit of the status lines).
