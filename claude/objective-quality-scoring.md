# Automatic objective quality scoring

Grant, 2026-10-21: objectives are scored without a button press. `refreshObjectiveQuality`
(`objectiveQualityScorer.ts`) runs after each Set objectives save and edit and after each Review
action that changes objectives, once the action's transaction has committed.

**What it scores.** Accepted objectives that have no stored score for their current wording,
matched by `objectiveIdentityKey`; an unchanged list makes no model call. At most 200 objectives
per pass (`MAX_ITEMS_SCORED`), sent in batches of 20 (`BATCH_SIZE`), so at most 10 model calls.
Answerability is judged against the variables uploaded at that time (up to 60 listed).

**Writes.** Results are written under the run row lock, which must exist, against the objective
list as it is at write time, so an objective changed while the model answered is not given a stale
score. The pass is recorded as an `objective_quality_pass` trace row in the same transaction.

**Failure.** A failed batch leaves its objectives unscored with the error; the pass fails only when
every batch fails. The safe wrapper records `objective_quality_error` and never throws, so scoring
never blocks the save the researcher made, but the save does wait for scoring. Review shows why an
objective is unscored (`unscoredReasonText` in `objectiveQualityStatus.ts`: not accepted, no score
returned, scoring failed with its message, not yet scored, or the reason could not be loaded), each
with Rescore.

**Tests.** `objectiveQualityAuto.db.test.ts` (real PostgreSQL, model mocked).

**Limits.** Objectives beyond the first 200 are not scored. Scoring calls the real model when one is
configured; the browser checks use the replay.
