# Batch 37 handover: the evidence chain, steps CE-1 to CE-5 (26 October 2026)

Base: laptop 9f0017be (Batch 36). Status: implemented, ready for review. Tier A (scripts/change-tier.cjs:
60 files). Requires migrations 0119, 0120, 0121 and 0122, in order. Contract: `claude/evidence-chain.md`.

## Why

Grant: the evidence trail is the product's main selling point. An audit of the code (26 October) found
ids stored from recommendation back to finding and source, but above the insight level the link to
objectives, decisions and the brief was text or a model-filled array, coverage had no freshness, and
nothing recorded which decision a recommendation served or which brief passage an objective came from.

## What changed

1. **CE-1 Objective coverage keyed by identity and known to be current** (migration 0119).
   - `objective_validations` gains the accepted objective or decision id each row judges, the
     `objective_validation_insights` link table (foreign keys; the legacy uuid[] is still written), and
     `inputs`, the fingerprints of what it was assessed against.
   - `objectiveCoverage.ts` is the one reader: the page, both story exports, the stage status, the
     research assistant and "suggest objectives from unmatched insights" (which now refuses on coverage
     that is not current). Out of date or not known to be current is shown in the pane, the selected
     objective, the verdict chip, the report pane and every export conclusion.
   - Saving takes a per-project advisory lock and re-reads the inputs; changed inputs save nothing
     (`CoverageInputsChangedError`), so an older check can never overwrite a newer one.
   - Fixed on the way: the automatic re-check treated a project whose objectives exist only as accepted
     candidates (no free text) as having none, and cleared its coverage.
2. **CE-2 Recommendations record the decisions they serve** (migration 0120 `recommendation_decisions`).
   - Both generators number the decisions; the model names them in `decision_indices`; invalid indices
     are dropped; written in the recommendation's transaction.
   - Shown on cards ("Serves: ...") and in the recommendations export ("Decision served"); none named
     is "Not recorded"; a decision since rejected reads "no longer a current decision".
   - Insight generation and synthesis now see the accepted objectives in both modes, as context and
     not a filter (`projectObjectives.ts`). Before, a project with a decision gave them none.
3. **CE-3 The narrative records what it was written for** (migration 0121 `deck_narratives.inputs`).
   The business problem, objectives, decisions and accepted insights are fingerprinted before the model
   is asked; a later change qualifies the narrative on screen, in both story exports (joined to the
   support qualification) and for the assistant. Insights and recommendations are deliberately not
   marked stale on objective edits: objectives are context for them, and their link to objectives is
   coverage, which is.
4. **CE-4 The brief or proposal passage behind each objective** (migration 0122 `brief_passages`).
   The brief reading names, per objective and for the business problem, the document and a verbatim
   passage; each is checked against that document's full text with `quoteMatch.quoteAppearsIn` and
   stored with the result. Brief and proposal are kept apart. A passage not found is shown as possibly
   reworded, never as a quote. Shown under the objective's detail and in the evidence trail. Kept while
   the file is in the bin (the objective is marked), erased with the file.
5. **CE-5 The evidence trail** ("Trace the evidence" on each recommendation; `evidenceTrail.ts`,
   `EvidenceTrailDialog.tsx`). A tree: decisions served and objectives answered (with their brief
   passages) above the recommendation; insight, pre-insights, findings (origin, latest verdict), data
   point (quote, stated figures) and source file beneath. Stored links only; a missing, out-of-date or
   invalid link is a dashed or amber node saying why, and the breaks are counted. The Word report has
   an "Appendix: evidence trails" with the same content (`trailOutline`); an unreadable trail is stated.

## Impact checklist

1. **Rules:** new registry rows for coverage identity and freshness, decisions served, insight
   objectives, narrative freshness, the evidence trail and brief passages; IR-04 and LBL-01 unchanged.
2. **Inputs:** every new link has a stated "not recorded" form; pre-migration databases read as not
   recorded or not known, never current; invalid model output is dropped, not guessed.
3. **Persistence:** coverage save under an advisory lock with a re-read; decisions and passages in the
   same transaction as the rows they describe; retries write nothing twice (tested).
4. **Freshness:** coverage and narrative carry fingerprints; human wording (narrative revisions,
   recommendation edits) is untouched; regenerating or updating clears the qualification.
5. **Screens:** the Labels-style late-response guard on the trail dialog; stale notes beside verdicts.
6. **Proof:** each step's tests fail on the old code (coverage freshness 3 of 5 via the re-check fix and
   the reader, decisions 3 of 3, insight framing 2 of 2, narrative 1 of 1, brief passages 1 of 2).

## Bugs that got through, and why

- The full library run found consumers I had not run: two synthesis tests with scripted database
  clients (the new objectives query), two recommendation component tests (the new imports), and the
  document bin's table inventory (the new `brief_passages`). Fixed; the bin now erases passages with
  their file, with a test.

## Gates (Linux, local disposable stack)

| Gate | Result |
| --- | --- |
| Typecheck, lint | exit 0 |
| Engine self-test | all checks passed |
| Full library, real disposable PostgreSQL 16 (on 50ac3ca) | 248 files; **1,837 passed / 78 skipped** |
| Full browser suite (on 5312784, before the consumer fixes) | **119 passed / 1 skipped**, 0 failed |
| After the consumer fixes (on 50ac3ca) | document-bin, evidence-trail, recommendation-edit-and-add: 3 passed; smoke 1 passed |

Models are replayed or mocked; nothing ran against a live database, storage or model. Windows not run.

## Limitations

- The objective evidence lane's results are not in the coverage fingerprint.
- The trail is not yet in the deck; no reverse view from an objective; decisions served cannot yet be
  chosen by hand, and researcher-written recommendations read "Not recorded".
- The analysis plan (CE-6) and the qualitative items (CE-7) are planned in `claude/evidence-chain.md`.
