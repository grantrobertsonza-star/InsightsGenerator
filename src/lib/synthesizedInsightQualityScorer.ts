import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";
import type { QualityTier } from "./tiers";

// Same reasoning as insightQualityScorer's constants: a judged score plus a
// rationale per insight adds up fast, and a synthesis pass rarely produces
// more than a couple dozen synthesized insights anyway (that's the whole
// point of the funnel), so one chunk size comfortably covers a run.
const SCORING_CHUNK_SIZE = 15;
const MAX_INSIGHTS_FOR_SCORING = 60;
const SCORING_CONCURRENCY = 3;

type EligibleSynthesizedInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  source_headlines: string[];
};

// tierFor always returns one of the three named tiers, never null; the
// shared QualityTier type is nullable only because other call sites use it
// to describe a quality_tier column that may not have been scored yet.
function tierFor(total: number): Exclude<QualityTier, null> {
  if (total >= 15) return "qualified";
  if (total >= 12) return "partial";
  return "finding";
}

/**
 * Scores every not-yet-scored synthesized insight on a run against the same
 * five dimensions insightQualityScorer.ts used to apply to pre-insights (why
 * / actionability / novelty / synthesis / evidentiary proportionality, 1, 3
 * or 5 points each), now moved here instead: a pre-insight is one finding's
 * worth of restated claim, so scoring it mostly measured how well a single
 * restatement was written. A synthesized insight is the thing that actually
 * claims to be a genuine, cross-source insight (DVL Smith triangulation,
 * Simoudis's insight-as-selected-relation), so that's where "is this a real
 * insight or just a restated observation" belongs.
 *
 * Evidentiary proportionality is judged here against the full chain of
 * evidence (every member pre-insight's headline), not a single finding:
 * does the synthesized insight's tension/implication stay proportionate to
 * what that whole cluster of pre-insights actually shows, or does it make a
 * bigger leap than the cluster supports.
 *
 * Same additive, non-destructive contract as the retired pre-insight
 * scorer: nothing here deletes, filters, or hides a synthesized insight. A
 * low score is a signal to sharpen or deprioritize, not a gate.
 */
export async function scoreSynthesizedInsightQuality(tenantId: string, runId: string): Promise<void> {
  const eligible = await withTenant(tenantId, async (client) => {
    const result = await client.query<EligibleSynthesizedInsight>(
      `select si.id, si.headline, si.observation, si.tension, si.implication,
              array_agg(pi.headline order by pi.created_at) as source_headlines
       from synthesized_insights si
       join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       join insights pi on pi.id = s.pre_insight_id
       where si.run_id = $1
         and si.quality_score is null
       group by si.id
       order by si.created_at
       limit $2`,
      [runId, MAX_INSIGHTS_FOR_SCORING]
    );
    return result.rows;
  });

  if (eligible.length === 0) return;

  const chunks: EligibleSynthesizedInsight[][] = [];
  for (let start = 0; start < eligible.length; start += SCORING_CHUNK_SIZE) {
    chunks.push(eligible.slice(start, start + SCORING_CHUNK_SIZE));
  }

  type Prepared = {
    insightId: string;
    whyScore: number;
    actionabilityScore: number;
    noveltyScore: number;
    synthesisScore: number;
    evidentiaryScore: number;
    rationale: string;
  };

  type ChunkResult = { ok: true; scored: Prepared[] } | { ok: false; error: string };

  const chunkResults = await mapWithConcurrency(
    chunks,
    SCORING_CONCURRENCY,
    // mapWithConcurrency requires fn not to throw (see its own doc comment):
    // an uncaught error aborts every other chunk's Promise.all too, not just
    // this one. The try/catch below turns a rate-limited or transient API
    // error into the same {ok:false, error} shape the "no usable scores"
    // path already returns, so one chunk's hiccup degrades gracefully
    // instead of taking the whole scoring pass down with it.
    async (batch, chunkIndex): Promise<ChunkResult> => {
      try {
        return await scoreChunk(tenantId, runId, batch, chunkIndex);
      } catch (error) {
        return {
          ok: false,
          error: `${batch.length} insight(s) starting at index ${chunkIndex * SCORING_CHUNK_SIZE}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
  );

  async function scoreChunk(
    tenantId: string,
    runId: string,
    batch: typeof chunks[number],
    chunkIndex: number
  ): Promise<ChunkResult> {
      const insightsBlock = batch
        .map(
          (insight, index) =>
            `${index}. Headline: ${insight.headline}\n` +
            `   Observation: ${insight.observation}\n   Tension: ${insight.tension}\n` +
            `   Implication: ${insight.implication}\n` +
            `   Chain of evidence: ${insight.source_headlines.join("; ")}`
        )
        .join("\n");

      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        // Same reasoning as insightQualityScorer.ts: a rubric score should
        // be repeatable, not sampled, but models released after Claude Opus
        // 4.6 (this one included) reject any temperature besides the 1.0
        // default with a 400, so pinning it is no longer possible.
        system:
          "You score a market research insight on five dimensions, each worth 1, 3, or 5 points, to judge " +
          "whether it's a genuine insight rather than a restated observation. Each insight below was already " +
          "built by clustering several corroborating pre-insights and reinterpreting them around a shared " +
          "tension, so score strictly: that framing step alone doesn't earn high marks, the content itself " +
          "has to earn them.\n\n" +
          "1. The Why (motivation/mechanism): 1 = states what happened with no cause named; 3 = implies a " +
          "reason without naming it; 5 = names the root cause or psychological/behavioral driver.\n" +
          "2. Actionability (so what): 1 = nice-to-know, no next step; 3 = vague direction, no concrete " +
          "application; 5 = dictates a clear decision or action.\n" +
          "3. Novelty: 1 = obvious or already assumed; 3 = confirms an existing assumption with fresh " +
          "numbers; 5 = surprising, overturns or meaningfully sharpens an assumption.\n" +
          "4. Synthesis: 1 = reads like one source restated; 3 = combines a couple of similar points without " +
          "adding a new layer; 5 = genuinely reframes the cluster around a tension none of the individual " +
          "pre-insights stated on their own.\n" +
          "5. Evidentiary proportionality: 1 = the claimed tension or implication isn't supported by the " +
          "chain of evidence at all; 3 = plausible but asserted more confidently than that chain of evidence " +
          "warrants; 5 = the claim is directly traceable to, or a reasonable inference from, the cluster's " +
          "chain of evidence, with no unsupported leap.\n\n" +
          "For each insight, also write a one-sentence rationale: the single biggest reason it scored where " +
          "it did, phrased so a researcher knows what to sharpen.\n\n" +
          "Cover every insight listed below by its index.",
        tool_choice: { type: "tool", name: "record_scores" },
        tools: [
          {
            name: "record_scores",
            description: "Records the five dimension scores and rationale for each insight by its index.",
            input_schema: {
              type: "object",
              properties: {
                scores: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "The insight's index in the numbered list." },
                      why_score: { type: "integer", enum: [1, 3, 5] },
                      actionability_score: { type: "integer", enum: [1, 3, 5] },
                      novelty_score: { type: "integer", enum: [1, 3, 5] },
                      synthesis_score: { type: "integer", enum: [1, 3, 5] },
                      evidentiary_score: { type: "integer", enum: [1, 3, 5] },
                      rationale: { type: "string" },
                    },
                    required: [
                      "index",
                      "why_score",
                      "actionability_score",
                      "novelty_score",
                      "synthesis_score",
                      "evidentiary_score",
                      "rationale",
                    ],
                  },
                },
              },
              required: ["scores"],
            },
          },
        ],
        messages: [{ role: "user", content: `Here are the insights:\n\n${insightsBlock}` }],
      });

      await logApiUsage(tenantId, runId, "synthesized_insight_quality_scorer", response.usage);

      const toolUse = response.content.find((block) => block.type === "tool_use");
      const rawScores =
        toolUse && toolUse.type === "tool_use" && Array.isArray((toolUse.input as { scores?: unknown }).scores)
          ? ((toolUse.input as { scores: unknown[] }).scores as Record<string, unknown>[])
          : [];

      const validScore = (value: unknown): value is 1 | 3 | 5 => value === 1 || value === 3 || value === 5;

      const scored: Prepared[] = [];
      for (const raw of rawScores) {
        const index = typeof raw.index === "number" ? raw.index : null;
        const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
        if (
          index === null ||
          index < 0 ||
          index >= batch.length ||
          !validScore(raw.why_score) ||
          !validScore(raw.actionability_score) ||
          !validScore(raw.novelty_score) ||
          !validScore(raw.synthesis_score) ||
          !validScore(raw.evidentiary_score) ||
          !rationale
        ) {
          continue;
        }

        scored.push({
          insightId: batch[index].id,
          whyScore: raw.why_score,
          actionabilityScore: raw.actionability_score,
          noveltyScore: raw.novelty_score,
          synthesisScore: raw.synthesis_score,
          evidentiaryScore: raw.evidentiary_score,
          rationale,
        });
      }

      if (scored.length === 0) {
        return {
          ok: false,
          error:
            `${batch.length} insight(s) starting at index ${chunkIndex * SCORING_CHUNK_SIZE} ` +
            `(stop reason: ${response.stop_reason ?? "unknown"})`,
        };
      }

    return { ok: true, scored };
  }

  const prepared: Prepared[] = [];
  for (const result of chunkResults) {
    if (result.ok) prepared.push(...result.scored);
  }

  if (prepared.length === 0) return;

  await withTenant(tenantId, async (client) => {
    for (const score of prepared) {
      const total =
        score.whyScore + score.actionabilityScore + score.noveltyScore + score.synthesisScore + score.evidentiaryScore;
      await client.query(
        `update synthesized_insights
         set why_score = $2, actionability_score = $3, novelty_score = $4, synthesis_score = $5,
             evidentiary_score = $6, quality_score = $7, quality_tier = $8, quality_rationale = $9
         where id = $1`,
        [
          score.insightId,
          score.whyScore,
          score.actionabilityScore,
          score.noveltyScore,
          score.synthesisScore,
          score.evidentiaryScore,
          total,
          tierFor(total),
          score.rationale,
        ]
      );
    }
  });
}

/**
 * Safe wrapper for every automatic trigger point, same pattern as
 * refreshInsightQuality: a scoring failure (an API hiccup, say) should
 * never block the actual processing step the researcher clicked, so it's
 * logged to trace and swallowed here instead of thrown.
 */
export async function refreshSynthesizedInsightQuality(tenantId: string, runId: string): Promise<void> {
  try {
    await scoreSynthesizedInsightQuality(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'synthesized_insight_quality_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}
