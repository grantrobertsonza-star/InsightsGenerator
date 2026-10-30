# Model calls: using only finished results

Codex release audit RR-F01 and RR-F02 (2026-10-23). A forced tool call (`tool_choice` naming one
tool) that finished stops with `stop_reason: "tool_use"` and carries that tool's block. A call cut
off at `max_tokens` can still carry a block whose input is only what was written before the cut
(one objective of three, half a methodology sentence), and it reads as complete. A refusal or any
other stop carries nothing to rely on.

`src/lib/modelToolResult.ts`:

- `finishedToolInput(response, toolName, what)` returns the tool's input object, or throws
  `UnfinishedModelResultError` with a reason (`max_tokens`, `refusal`, `other_stop`,
  `no_tool_use`, `malformed`) and a sentence naming the work (`what`).
- `optionalTextField(input, field, what)` reads a string-or-null field (absent is null, blank is
  null); any other type is `malformed`.
- `requiredTextOrNullField(input, field, what)` is the same for a field the tool's schema requires:
  absent is `malformed` (Codex batch10: `{}` was taken for a finished reading that found nothing).

A finished call that legitimately finds nothing is the caller's own field rule, never this
helper's: a brief with neither field returns nulls (a fill that found nothing); a methodology
reading with `found: false` keeps the saved text.

## Callers

| Caller | On an unfinished result |
|---|---|
| `briefIntake.extractBriefFields` (both fields required) | throws, including when either field is missing; `saveRunContext` records `brief_intake_error` and returns a failed fill with its retry, keeps what was typed, adds no objective and records no `brief_intake_used`, so the same document is read again on the next fill |
| `methodologyExtractor.generateMethodologySummary` | throws before writing; the saved methodology stays; the processing step records `methodology_extraction_error`. A finished reading records `methodology_extraction_done`. `methodologyStatus.latestMethodologyFailure` (the later of the two) is shown in the Insights report section, and the Word report says the methodology could not be read when nothing was read before, rather than that none was stated |

| `extractFindings` report reading, per part (Codex SEC500-F01) | a cut-off answer, an answer with no findings list (absent or not a list) and one whose returned findings are all unusable (each needs text, a quote, a theme and a recognised kind) fail the part; `extract_findings_bad_response` records the reason (`no_findings_list`, `no_usable_findings`). A single-part report then throws and is stamped failed, and every part failing throws; nothing is replaced and the previous findings stay. A part with some unusable findings left out keeps the usable ones and counts with the failed parts (`some_findings_unusable`), so the reading is partial: it cannot retire previous findings, and a first reading that publishes is marked incomplete. An explicit empty list is a genuine empty reading and still replaces unprotected findings |
| `storyNarrative.generateStoryNarrative` (Codex RR-F06) | throws before writing, on a cut-off, refused or missing result and when a required text field is not a string or `pillars` or `caveats` is not a list, when the executive summary, situation, complication or governing thought is blank (Codex batch12 RR-F06), and when the question is blank and the project has no decision statement; the saved narrative stays; the action records `story_narrative_error`. `latestNarrativeFailure` (an error newer than the saved narrative) is shown in the Insights report section even when an earlier narrative exists, saying the report shown is the previous one |

### Batch 64 (Codex EC10K-F02): every research stage

Codex found the insight, verification, synthesis (clustering and cluster synthesis) and both
recommendation stages taking the first tool block without a finished stop or the tool's name, so a
response cut off at `max_tokens` (whose block can look complete) was published. Each now reads its
result through `finishedToolInput` first and then applies its own field rules; compatible finished
payloads are still accepted (an `insights` or `clusters` list sent as JSON text).

| Caller | On an unfinished result |
|---|---|
| `insightGenerator` chunk (`record_insights`) | the chunk's findings are `call_failed`; nothing from it is written; a pass with nothing written throws ("No usable insights came back"), earlier pre-insights stay; the wrapper returns and traces the failure |
| `verifyFindings` chunk (`record_verdicts`) | the chunk fails, so the whole pass writes no verdict (its existing rule) and the previous verdicts stand |
| `insightSynthesizer` clustering (`record_clusters`) | throws before anything is written; `insight_synthesizer_error`; a stability resample counts it as failed |
| `insightSynthesizer` cluster synthesis (`record_synthesized_insight`) | treated as no answer: one retry, then the cluster is dropped with the reason in `insight_synthesizer_summary` |
| `recommendationAgent` both generators (`record_recommendations`) | the batch fails (`containChunk`); its insights count as missing in the run record; a retry drafts them |
| `objectiveValidator` (`record_validations`) | throws before saving; the previous coverage stands |
| `validateStatedInsights` (`record_chain_verdict`) | the claim stays unverified, `validate_stated_insight_claim_error` |
| `decisionFramer` (both calls), `objectiveFramer` | throws; nothing saved (the evidence synthesis is no longer saved from a cut-off answer) |
| `contradictionDetector` | "not checked", never "checked, nothing contradicts it" |
| the four quality scorers | the batch fails through each scorer's existing failure path |
| `objectiveEvidence` (plan questions, answer choice, stance) | throws: the plan is not published with an objective emptied of questions; an evaluation records its failure instead of an "inconclusive" judgement |
| `claimTableChecks` | the claim stays unchecked (retried) instead of "no table speaks to this claim" |
| `regroundFindings` | throws; links from earlier batches stay |
| `documentTables` | the read fails, naming the parts, after every part answered; no tables stored |
| `crosstabInsights`, `researchQualityReview`, `instruments` | already refused a cut-off; now also a refusal, other stop or other tool, through their existing failure paths |

Batch 64 follow-up (after the rebase onto batches 54 to 63 and 65):

| Caller | On an unfinished result |
|---|---|
| `extractFindings` part reading (`record_findings`) | a cut-off or missing answer kept its own message; a refused or other-stop answer, another tool's block or a non-object input now also fails the part ("could not be used ... Nothing was replaced"), so the previous reading stays |
| `extractThemes` open coding pass (`record_themes`) | the pass is counted as failed with the reason (`noteOpenCodingFailure`) |
| `extractThemes` consolidation (`record_codebook`) | throws before anything is replaced |
| `extractThemes` theme grouping (`record_themes`) | a failed grouping with the reason |
| `extractThemes` theme review, leftover placement, cross-transcript grouping (`record_merges`, `place_codes`, `record_themes`) | throws; the integration is refused and nothing saved |
| `extractThemes` codebook application (`record_decisions`) | the batch fails and is traced (`coding_apply_batch_failed` with the reason), so the pass is incomplete (batch 61 stability rules) |
| `extractThemes` code summaries (`record_summaries`) | falls back to each code's own definition, as for any failed summary call |
| `codingAnalysis` link proposals (`record_links`) | throws; nothing saved |
| `codingAnalysis` negative cases (`record_negative_cases`) | the batch fails and is traced (`negative_case_batch_failed`) |
| `meaningCheck` (`record_meaning_check`) | "not checked" (null), as a cut-off was |

`finishedToolResult` is the value-returning form for callers whose failure path is a value. Every forced
call in `src/lib` now uses the rule; `assistantLoop` is not a forced call and checks its stop itself. The
guard in `researchStageUnfinished.db.test.ts` has no exceptions and also fails on any forced call that
still picks the first tool block itself.

## Tests

`narrativeWrongGroup.db.test.ts` (RR-F06): cut-off, refused, missing summary and non-list pillars,
a whitespace-only summary, an empty situation, and a blank question without a decision statement
each leave the saved summary and show the failure; a blank question with a decision statement is
accepted; a finished generation replaces it and clears it.


`src/lib/__tests__/releaseAuditRepairs.db.test.ts` (real database, model client and storage
controlled): cut-off fill saves nothing and the ordinary retry fills; refusal, no tool result,
another tool, a malformed field and a non-object input are failed fills; a finished empty fill is
not a failure; cut-off, refusal, no tool, found-without-text and malformed `found` leave the
methodology; a finished reading replaces it and clears the failure; `found: false` keeps it; the
Word text for an unread methodology. The cut-off, refusal, no-tool and malformed cases fail against
the extractors as they were before the repair (checked by running them against the previous files).

`src/lib/__tests__/researchStageUnfinished.db.test.ts` (batch 64): verification, clustering, cluster
synthesis, both recommendation generators and coverage, each with a cut-off, a refused and an
other-tool answer: nothing published, earlier results unchanged, the next finished answer recovers;
plus the family guard. `insightGenerationCoverage.db.test.ts` does the same for the insight stage.
`src/lib/__tests__/findingsCodingUnfinished.db.test.ts` (batch 64 follow-up): the findings reading,
codebook application (through a stability pass) and the negative case search, each with a refused, an
end_turn and an other-tool answer: refused visibly, the previous result kept, a finished answer recovers.
