import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";
import type { QualityTier } from "./tiers";

// Same chunking reasoning as verifyFindings and generateInsights: a judged
// score plus a rationale per insight adds up fast, and a single oversized
// call risks getting cut off before every insight in the batch is scored.
const SCORING_CHUNK_SIZE = 15;
const MAX_INSIGHTS_FOR_SCORING = 60;
const SCORING_CONCURRENCY = 3;

type EligibleInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  finding_text: string;
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
 * Scores every not-yet-scored insight on a run against five dimensions
 * (why / actionability / novelty / synthesis / evidentiary proportionality,
 * 1, 3 or 5 points each) and writes the five scores, their sum, a tier
 * bucket, and a one-line rationale back onto the insight row.
 *
 * This is a second, independent axis next to verdicts.verdict_tier, which
 * judges whether the underlying finding is well-supported evidence.
 * quality_tier instead judges whether the insight built on top of that
 * finding is actually a real insight, a non-obvious, explanatory,
 * actionable claim, rather than a restated observation, and whether its
 * explanatory claim stays proportionate to what the finding actually
 * shows. See docs/insight-quality-scoring.md for the full method and the
 * reasoning behind these five dimensions specifically.
 *
 * Deliberately additive and non-destructive: nothing here deletes,
 * filters, or hides an insight. A low score just sorts an insight lower
 * wherever insights or recommendations are listed; it's a signal for a
 * researcher to sharpen or deprioritize something, not a gate that
 * silently drops it the way a 'not_supported' verdict keeps a finding out
 * of insight generation entirely.
 */
export async function scoreInsightQuality(tenantId: string, runId: string): Promise<void> {
  const eligible = await withTenant(tenantId, async (client) => {
    const result = await client.query<EligibleInsight>(
      `select i.id, i.headline, i.observation, i.tension, i.implication, f.finding_text
       from insights i
       join findings f on f.id = i.finding_id
       where i.run_id = $1
         and i.quality_score is null
       order by i.created_at
       limit $2`,
      [runId, MAX_INSIGHTS_FOR_SCORING]
    );
    return result.rows;
  });

  if (eligible.length === 0) return;

  const chunks: EligibleInsight[][] = [];
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
            `   Implication: ${insight.implication}\n   From finding: ${insight.finding_text}`
        )
        .join("\n");

      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        // A quality score is a rubric judgment, not creative output, and
        // the same insight should score the same way each time it's
        // checked -- this used to pin the lowest sampling temperature for
        // that reason, but models released after Claude Opus 4.6 (this one
        // included) reject any temperature besides the 1.0 default with a
        // 400, so that's no longer an option here.
        system:
          "You score a market research insight on five dimensions, each worth 1, 3, or 5 points, to judge " +
          "whether it's a genuine insight rather than a restated finding. Score strictly: most raw insight " +
          "drafts land in the 1-3 range on most dimensions; reserve 5 for a dimension the insight clearly earns.\n\n" +
          "1. The Why (motivation/mechanism): 1 = states what happened with no cause named; 3 = implies a " +
          "reason without naming it; 5 = names the root cause or psychological/behavioral driver.\n" +
          "2. Actionability (so what): 1 = nice-to-know, no next step; 3 = vague direction, no concrete " +
          "application; 5 = dictates a clear decision or action.\n" +
          "3. Novelty: 1 = obvious or already assumed; 3 = confirms an existing assumption with fresh " +
          "numbers; 5 = surprising, overturns or meaningfully sharpens an assumption.\n" +
          "4. Synthesis: 1 = based on a single data point or quote; 3 = combines a couple of similar " +
          "points; 5 = triangulates across more than one source or data type.\n" +
          "5. Evidentiary proportionality: 1 = the claimed mechanism isn't supported by the cited finding " +
          "at all; 3 = plausible but asserted more confidently than the evidence warrants; 5 = the " +
          "explanatory claim is directly traceable to, or a reasonable inference from, the finding it " +
          "cites, with no unsupported leap.\n\n" +
          "For each insight, also write a one-sentence rationale: the single biggest reason it scored where " +
          "it did, phrased so a researcher knows what to sharpen (e.g. \"names a plausible driver but the " +
          "quote doesn't actually establish causation\" rather than a generic summary).\n\n" +
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

      await logApiUsage(tenantId, runId, "insight_quality_scorer", response.usage);

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
        `update insights
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
 * refreshVerdicts: a scoring failure (an API hiccup, say) should never
 * block the extraction or processing step the researcher actually
 * clicked, so it's logged to trace and swallowed here instead of thrown.
 */
export async function refreshInsightQuality(tenantId: string, runId: string): Promise<void> {
  try {
    await scoreInsightQuality(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_quality_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}
