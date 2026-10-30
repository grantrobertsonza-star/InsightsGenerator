# Batch 64 handover: insight, synthesis and recommendation chain (28 October 2026)

**Status: implemented, ready for independent review.** Branch `evidence-chain`, worktree b74, base
`d2a321d`. Codex findings EC10K-F01, F02, F03, F04 (S2) and EC10K-P01 (measured performance). Tier A.
Commits are marked "(not for push)"; nothing pushed, no Supabase, cloud, storage or real model used, no
browser stack. No migration (0131 not needed).

## What changed

- **EC10K-F01 (coverage).** `insightGenerator.ts`: one eligibility definition (`ELIGIBLE_FINDINGS`) for
  selection and a live count. `generateInsights` returns `InsightPassResult` (written, every finding not
  written with its reason, live `remaining`, waiting for decision). A finished answer that left findings
  out or blank is asked once more for just those, in the pass. Only rows the insert created count as
  written. `refreshInsights` returns null only when nothing remains (or a validate project waits for its
  decision); otherwise it returns and traces (`insight_generator_incomplete` / `_error`) how many verified
  findings have no insight and why; passes do not re-offer a finding a pass could not write, so later
  passes reach the rest. `loadInsightCoverageGap` + `InsightCoverageNotice` state the gap on the Insights
  review (unknown when it cannot be counted); the processing "insights" stage is an error, not done, when
  the refresh returns a reason.
- **EC10K-F02 (unfinished results).** `finishedToolInput` before stage parsing in the insight generator,
  verification, clustering, cluster synthesis (an unfinished answer is retried once like a missing one,
  then dropped with the reason) and both recommendation parsers. Sweep, same gap fixed:
  `objectiveValidator`, `validateStatedInsights`, `decisionFramer` (both calls), `objectiveFramer`,
  `contradictionDetector`, `insightQualityScorer`, `synthesizedInsightQualityScorer`,
  `recommendationQualityScorer`, `objectiveQualityScorer`, `objectiveEvidence` (three calls),
  `claimTableChecks`, `regroundFindings`, `documentTables`; and `crosstabInsights`,
  `researchQualityReview`, `instruments` (already refused a cut-off; now also a refusal, other stop or
  other tool). Already using it: `briefIntake`, `methodologyExtractor`, `storyNarrative`. Follow-up after the
  rebase (see the section below): `extractFindings`, `extractThemes` (eight calls), `codingAnalysis` (two)
  and `meaningCheck`. Every forced call in `src/lib` now uses the rule; `assistantLoop` is not a forced
  call. The family guard has no exceptions.
- **EC10K-F03 (drafted-from support).** A new source link stores the pre-insight's own
  `insights.support_snapshot`, not the finding's fingerprint at synthesis (null when the pre-insight has
  none: "not checked"). `loadInsightSupport` prefers the pre-insight's snapshot, so links written before
  this batch are qualified without rewriting rows. The misleading comment is replaced.
- **EC10K-F04 (overlapping synthesis).** The synthesis write is one transaction under
  `pg_advisory_xact_lock('insight_synthesis:'||run)`, confirms the run, and rechecks every candidate's
  pre-insights (this project, finding not rejected, unclaimed, not used by an earlier candidate of the same
  write). A claimed candidate is not written (`insight_synthesizer_claimed_meanwhile`); nothing existing is
  deleted.
- **EC10K-P01.** `loadTrailContext(tenant, run, recommendationIds)` reads served decisions (the bulk
  reader) and brief passages once, in the coverage read's transaction; both story routes pass their
  recommendations. A trail uses the shared read only for a recommendation its own query confirmed is in
  the project. A failed shared read fails the context, stated on every trail; the next export recovers.

## Impact checklist

1. **Rule:** owners in `claude/rules-registry.md` (four new rows, one widened): `modelToolResult.ts`,
   `insightGenerator.ts`, `insightSynthesizer.ts` write, `supportStatus.ts`, `evidenceTrail.ts`. New
   contract `claude/insight-generation-and-synthesis.md`; updated `model-call-completion.md`,
   `support-grounding-and-dependencies.md`, `evidence-chain.md`.
2. **Inputs:** an unfinished, refused, other-tool or wrong-shape answer is a failure, never a result;
   an uncounted coverage gap is "could not be checked"; a pre-insight without a snapshot gives "not
   checked", never current; a validate project without a decision is waiting, not complete.
3. **Persistence:** insight inserts keep `on conflict (finding_id) do nothing` (unique) and count only
   inserted rows; synthesis write: one transaction, advisory lock, run check, claim recheck, full rollback
   on failure; recommendations unchanged (`insertOncePerAnchor`). Retries never duplicate.
4. **Freshness:** existing synthesized insights whose finding changed between pre-insight drafting and
   synthesis now read "Support changed since drafted" (and so do their recommendations, coverage notes and
   both exports) as soon as this is deployed; nothing is rewritten; wording and review decisions kept.
   Legacy links whose pre-insight recorded no snapshot keep what they stored (limit).
5. **Screens:** the coverage notice is read with the page (no client state); the stage shows an error
   for an incomplete generation.
6. **Proof:** below.

## Tests (all with `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run <file> --pool=forks`, one at a time)

New (real disposable PostgreSQL unless marked; only the model, usage logging and storage controlled):

| File | Base `d2a321d` | After |
|---|---|---|
| `insightGenerationCoverage.db.test.ts` (F01, F02 insight stage) | 10 failed, 1 passed (11) | 11 passed |
| `researchStageUnfinished.db.test.ts` (F02, five stages x three faults, guard) | 19 failed | 19 passed |
| `synthesisDraftedFrom.db.test.ts` (F03, incl. both story exports) | 6 failed | 6 passed |
| `synthesisOverlap.db.test.ts` (F04) | 2 failed, 3 passed (controls) | 5 passed |
| `exportTrailQueries.db.test.ts` (P01, Word and Slides routes) | 1 failed, 2 passed (controls) | 3 passed |
| `insightCoverageNotice.test.tsx` (mounted, static render) | n/a (new component) | 3 passed |

Existing tests: 113 files that import the changed modules, plus 12 others that mock tool calls, run one
at a time: 125 files (the changed-module importers, the tool-mocking tests and the six new files), 973 passed, 51 skipped (each DB file's "no database" placeholder), 0 failed. Changed fixtures (each now a finished call as the real API returns it, or the
new contract): `candidateLifecycle`, `decisionCandidateProvenance`, `decisionSourceDocuments`,
`evidenceTrail.db`, `exportQualification.db`, `insightObjectiveFraming.db`, `insightExportLifecycle.db`,
`insightIndependence` and `insightSupportSynthesis` (fake DB taught the new statements; the latter's
assertion pinned the F03 defect and now pins the fix), `instrumentReadSingleFlight.db`,
`instrumentReread.db`, `objectiveCoverageFreshness.db`, `objectiveDecisionClosure.db`,
`objectiveEvidenceClosure.db`, `objectiveEvidenceOrigin`, `objectiveQualityAuto.db`,
`objectiveResponseSelector`, `objectiveValidation{Duplicates,Indices,Qualification}.db`,
`recommendation{DecisionContext,Decisions,Integrity,RetryIdempotency,Writes}.db`, `researchQuality.db`,
`synthesisPublication.db` (pre-insights now record their snapshot), `crosstabInsights` (code kept its
"no reading was returned" wording). Why the tests missed F02: their mocks returned blocks without a stop
reason or name, so the suites encoded unfinished results as acceptable; the guard and the mocks now pin it.

Gates: `npx next typegen` (ok), `npx tsc --noEmit` (0 errors), `npx eslint .` (0 errors, 44 warnings, all
in files and lines this batch did not add), `python3 scripts/crosstab_selftest.py` (all checks passed).

## Follow-up after the rebase (HEAD 0ed7812, batches 54 to 63 and 65 underneath)

EC10K-F02 finished in the four files left to other batches. New `finishedToolResult` (the value-returning
form of `finishedToolInput`) for callers whose failure path is a value. Each site keeps its existing
failure path and message for a cut-off or missing answer, and now also refuses a refused or other-stop
answer, another tool's block and a non-object input (contract table in `model-call-completion.md`):
findings part reading fails the part, previous reading kept; open coding pass counted failed with the
reason; consolidation, theme review, leftover placement and cross-transcript grouping throw before saving;
theme grouping returns its reason; codebook application and negative-case batches are traced as failed
(the batch 61 incomplete-pass rules apply); summaries fall back to each code's definition; link proposals
throw; the meaning check reads "not checked". The guard's exception list is empty and it also fails on
any forced call that still picks the first tool block itself.

New `findingsCodingUnfinished.db.test.ts` (findings reading, codebook application through a stability
pass, negative-case search; each refused, end_turn and other-tool, previous result kept, recovery): 9
failed on 0ed7812, 9 passed after; `researchStageUnfinished` guard 1 failed on 0ed7812, all 19 pass after.
Other batches' tests rerun one at a time, none needed a fixture change (their mocks already return
finished calls): 38 files importing the changed modules (including `reportChunkBoundaries` from batch 62,
`codingStability`, `codingStabilityPre0128`, `codedPassageSnapshot`, `turnNote*`, `outputSelection*` from
batches 60 and 61) 341 passed, 16 skipped placeholders, 0 failed; `qualAnalysis`, `qualAudit`,
`qualAuditLooser`, `qualCoding`, `qualCrosstab`, `qualImportQuality`, `qualQuality`, `codingRunClaim`,
`stabilityMethod` 141 passed. Gates on the rebased tree: `npx tsc --noEmit` 0 errors, `npx eslint .` 0
errors (44 warnings, unchanged), `python3 scripts/crosstab_selftest.py` all checks passed.

## For Codex: why the 1,000 `truncated-insights` journeys cannot pass as written

In each `independentChain-*` and `independentFull-*` file, the `truncated-insights` workflow sets the
model to answer the first `record_insights` call with `stop_reason: "max_tokens"` (a complete-looking
block), calls `generateInsights(tenant, run)` once, reads `pre` (the run's pre-insights) once, and then
asserts on that same `pre`:

1. `check(pre.length === 0, 'unfinished insight response published as finished evidence')`, and
2. `check(pre.length === findings.length, 'pre-insight coverage differs from source findings')`, with
   `findings.length >= 2` asserted earlier in the journey.

No value of `pre.length` satisfies both, so the journey fails under any implementation. Before the fix it
failed on (1); now the cut-off answer is refused, nothing is written, and `generateInsights` throws ("No
usable insights came back this time ... cut off before it finished ... Nothing was changed"), which the
journey records as an abort (the call sits inside its try block, so (2) is never reached). The oracle
could instead: assert (1) after the refused call (and that it throws or reports `written: 0`); then call
`generateInsights` or `refreshInsights` again (the fault is single-shot) and assert (2) on a fresh read,
which is what `independentAutomaticInsightCoverage` effectively does through `refreshInsights` and passes.
The same 0-then-N pattern applies to `independentUnfinishedStages` at each stage.

## Codex replay (copies run from b74 and deleted; outputs under the scratchpad)

Script `replay.sh` in the session scratchpad: each Codex file copied into `src/lib/__tests__`, its
receipt paths pointed at a scratch folder (`CODEX_SCRATCH`), the export routes' `@/lib/...` imports mapped
as the repo's export tests do, run alone with `--pool=forks`, then deleted. Base = a scratch copy of
`d2a321d` with the same `node_modules`.

| File | Journeys | Base failed | After failed | After time |
|---|---:|---:|---:|---:|
| independentChain-quant-report | 2,000 | 600 | 200 | 976 s |
| independentChain-qual-report | 2,000 | 600 | 200 | 897 s |
| independentChain-focus-group | 2,000 | 400 | 200 | 987 s |
| independentChain-interview | 2,000 | 400 | 200 | 897 s |
| independentChain-table | 1,000 | 200 | 100 | 394 s |
| independentFull-cross-tabs | 500 | 100 | 50 | 357 s |
| independentFull-driver | 500 | 100 | 50 | 262 s |
| **Total** | **10,000** | **2,400** | **1,000** | |

Base failures match Codex: 1,000 partial-insight coverage, 1,000 unfinished insight published, 400
corrected-source freshness (report families). After: every partial and corrected-source journey passes;
the 1,000 left are all `truncated-insights`, which now abort with "No usable insights came back ... cut
off before it finished" (the unfinished answer is refused and nothing is published, which its own check
asks for). Those journeys cannot pass in any fix: the file checks `pre.length === 0` after the cut-off
pass and then `pre.length === findings.length` on the same reading (at least two findings), and calls
`generateInsights` directly, which must refuse. A different but acceptable shape: refusal, then recovery
on the next pass, shown in `insightGenerationCoverage.db.test.ts` and in Codex's automatic file below.

Supplemental files (before, after): `independentAutomaticInsightCoverage` 5 of 5 failed, 5 passed;
`independentLargeInsightCoverage` failed (first refresh null at 480 of 500), passed (first refresh returns
"20 verified finding(s) still have no insight after 8 pass(es)...", second completes 500);
`independentConcurrentSynthesis` 20 of 20 failed, 20 passed; `independentConcurrentContinuation` 20 of 20
failed (20 duplicate recommendation anchors, 10 objective-trail misses), 20 passed (the generic objective
assertion Codex called an ordering artefact did not recur here); `independentUnfinishedStages` 5 of 5
failed, 5 failed: every "unfinished ... published" violation is gone, and each journey now stops where its
stage refused (verification, insights, clustering, cluster synthesis, recommendations), the same
contradictory 0-then-N checks as above; `independentExportScaling` passed both (it measures, see below).

## Query counts (P01)

Codex's `independentExportScaling` (Word export, statements per export for 1/5/10/20/40 accepted
recommendations): before 53/97/152/262/482, after 53/73/98/148/248. With `exportTrailQueries`' richer
fixture (served decisions, coverage, a brief passage) at 1/10/40: Word 59/147/447 before, 59/102/252
after; Slides 58/148/448 before, 58/103/253 after. Project-level reads (brief passages, served
decisions) once per export at every size. Output: every trail equal to the same trail read alone,
including a reworded-decision qualification; export sizes unchanged within compression noise.

## Limits and remaining checks

- No pre-insight regeneration exists: a corrected finding's synthesized insight stays "changed since
  drafted" until the finding is back to its drafted state or the researcher reviews it.
- Legacy links whose pre-insight has no snapshot keep their stored stamp.
- Duplicate synthesized insights written before batch 64 are not cleaned up (left for the researcher).
- A finding that persistently fails a figure check is re-offered first by each new refresh (the first 60
  by theme); if 60 such findings existed, later findings would wait. Reported, not starved silently.
- The coverage notice was checked by static render, not in a browser; no screenshot taken (browser stack
  not run in this batch).
