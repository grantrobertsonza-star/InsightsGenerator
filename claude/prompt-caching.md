# Prompt caching on the repeat-heavy model calls

Grant, 2026-10-22: "the caching makes sense if this was ever commercialised as we will need to keep
costs down."

## What changed

Anthropic prompt caching (`cache_control: { type: "ephemeral" }`, about five minutes) on the parts
of a request that repeat across calls. The wording sent to the model is unchanged; the cached part
is the same text, sent as its own block.

| Call | Cached part | Uncached part | File |
|---|---|---|---|
| Research quality assessment (one call per criteria group) | system; shared input (context, sources, facts, clarifications) | the group's criteria and reference passages | `researchQualityReview.ts` |
| Research quality checklist (one call per batch) | system; shared input (document, facts, brief facts) | the checklist batch and elements | `researchQualityReview.ts` |
| Qualitative negative-case batches | system; the codebook | the batch's turns | `codingAnalysis.ts` |
| Objectives decomposition | system | the request | `objectiveEvidence.ts` |
| Research assistant (each round and each message) | instructions plus project evidence | recent conversation, tool rounds | `researchAssistant.ts` |

Helpers: `src/lib/promptCache.ts` (`cachedSystem`, `cachedSystemThen`, `cachedUserThen`).

Structural note: the research quality payloads were one JSON object; they are now two labelled
parts ("Shared input (...)" and "This criteria group" / the checklist part). The keys and values
are the same. Extraction calls are not cached (each document is read once).

The negative-case `inputHash` still hashes `codebookPart + turnsPart`, so stored hashes and replay
keys are unchanged.

## Cost accounting

`apiUsage.costOfUsage({ input, output, cacheWrite, cacheRead })` prices cache writes at 1.25 and
reads at 0.1 of the input price. Recorded input tokens are input + write + read, so token totals
stay comparable with earlier runs. The API usage page shows total input with "(N from cache)".

## Limits

- Anthropic caches only a prefix above a minimum length (1,024 tokens for the Sonnet models); shorter prefixes are sent
  normally and cost the same as before. Cache writes cost 25% more than plain input, so a part
  sent once and never reused costs slightly more.
- The saving has not been measured: the replay stand-in used by the browser checks does not
  report cache tokens. The first live runs on the usage page will show cache reads against
  writes; that is the measurement to take (coding standard rule 6).

## Tests

- `src/lib/__tests__/promptCache.test.ts`: the helpers mark only the shared part, the text is
  unchanged; `costOfUsage` reference prices.
- `src/lib/__tests__/researchQuality.db.test.ts` (RQ01): every assessment and checklist call is
  cached; extraction is not. The stand-in parses the two-part content.
- `src/lib/__tests__/researchAssistantTools.db.test.ts`: the assistant's system block is cached.
