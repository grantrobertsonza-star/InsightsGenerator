# Insight generation coverage and the synthesis write (batch 64)

Codex EC10K-F01 and EC10K-F04, 28 October 2026. Owner: `src/lib/insightGenerator.ts` (coverage) and
`src/lib/insightSynthesizer.ts` (the synthesis write).

## Every eligible verified finding is accounted for (EC10K-F01)

Eligible: the finding is not rejected, its LATEST verdict is robust or use with caution, and it has no
pre-insight yet. One definition (`ELIGIBLE_FINDINGS`) serves the selection and the live count.

- `generateInsights` (one pass, at most 60 findings) returns `InsightPassResult`: `attempted`, `written`
  (rows this pass inserted), `notWritten` (finding id and reason: `omitted` from the answer,
  `malformed` with a blank part, `unsupported_figures`, `call_failed` for a failed or unfinished call),
  `remaining` (eligible findings still without a pre-insight after the pass, counted live, including the
  ones beyond the pass limit) and `waitingForDecision` (a validate project with no decision: not a gap).
- A finished answer that left findings out or blank is asked once more, for just those, in the same pass.
  A failed or unfinished call (EC10K-F02) is not repeated in the pass; an unsupported figure is not either.
- A pass with nothing written while findings were attempted throws ("No usable insights came back"),
  writing nothing. A partial pass records `insight_generator_partial` with every finding left out and why.
- `refreshInsights` (every automatic trigger) returns null only when `remaining` is 0 or the project is
  waiting for its decision. It makes up to `MAX_AUTOMATIC_INSIGHT_PASSES` (8) passes while each writes
  something, not offering again in this refresh a finding a pass could not write (so later passes reach
  the rest). Otherwise it returns, and records as `insight_generator_incomplete` or
  `insight_generator_error`, how many verified findings still have no insight and why. Before, 500
  findings ended at 480 with success.
- A retry or the next trigger drafts only what is left; `insights.finding_id` is unique and only a row the
  statement inserted counts as written, so nothing is drafted twice.
- Screens: `loadInsightCoverageGap` counts the gap when the page is read (null when it cannot be read,
  shown as not known); `InsightCoverageNotice` on the Insights review states it with the last attempt's
  reason, also when some insights exist. The processing "insights" stage is an error, not done, when the
  refresh returns a reason.

## One synthesized insight per set of pre-insights (EC10K-F04)

Two overlapping passes (an automatic refresh and Run synthesis, or a retry after a lost reply) read the
same unclaimed pre-insights and each inserted an insight from them. The write is now one transaction:

- `pg_advisory_xact_lock` on `insight_synthesis:<run>`, then the run is confirmed to exist.
- Each candidate's pre-insights are read again under the lock: in this project, finding not rejected,
  not yet the source of any synthesized insight, and not claimed by an earlier candidate of the same
  write. A candidate failing that is not written (`insight_synthesizer_claimed_meanwhile`, with the
  count); its unclaimed pre-insights stay eligible.
- Nothing already written is removed, whoever wrote it, and its review decision and recommendations
  stand. A failure anywhere rolls the whole write back, so the retry finds the same pre-insights free.
- No durable identity or unique index was added: the lock and recheck are at the only writer of
  `synthesized_insight_sources`. Duplicates written before batch 64 are left for the researcher.

## Tests

`insightGenerationCoverage.db.test.ts` (healthy, skipped and malformed among valid, persistent omission
with recovery, total failure, four unfinished shapes, one unfinished chunk, 500 findings over the pass
limit, validate waiting), `insightCoverageNotice.test.tsx` (the notice),
`synthesisOverlap.db.test.ts` (overlap, lost reply and sequential retries with the researcher's
decision and recommendation kept, a genuinely different later synthesis, rollback, a finding rejected
while the model answered).
