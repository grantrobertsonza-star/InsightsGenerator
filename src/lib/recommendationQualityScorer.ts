import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { mapWithConcurrency } from "./concurrency";
import { withTenant } from "./db";
import {
  parseRecommendationScores,
  recommendationRating,
} from "./qualityRubrics";

const CHUNK_SIZE = 12;
const MAX_FOR_SCORING = 60;
const CONCURRENCY = 3;

type Eligible = {
  id: string;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  assumptions_and_risks: string;
  alternatives_considered: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
};

const SYSTEM =
  "You judge recommended actions the way a sceptical client would before committing resources. Score " +
  "each on four dimensions, each worth 1, 3 or 5 points. Score strictly.\n\n" +
  "1. Actionability: 1 = a direction rather than an action, or no owner, timeline or measure; 3 = a " +
  "concrete action, but the owner, the timing or the measure is vague; 5 = a specific action with a " +
  "named owner role, a realistic timeline and a metric that would show whether it worked.\n" +
  "2. Feasibility: 1 = the named owner is unlikely to be able to do it (authority, budget, skills or " +
  "dependencies are not addressed); 3 = doable, but with obstacles the recommendation does not deal " +
  "with; 5 = within the owner's reach, with the main risks and alternatives considered.\n" +
  "3. Evidence strength: judge against the insight it is built on. 1 = the action does not follow from " +
  "the insight, or leans on an assumption the insight does not support; 3 = it follows, but goes " +
  "further than the insight supports; 5 = it clearly follows and is proportionate to the evidence.\n" +
  "4. Expected impact, assuming it is done well: 1 = small or local effect on the outcome the decision " +
  "is about; 3 = meaningful but bounded; 5 = would materially change that outcome. Impact is reported " +
  "beside the other three and is not added to them, so score it on its own terms and do not let the " +
  "other dimensions colour it.\n\n" +
  "For each recommendation give a one-sentence rationale naming the single biggest reason for its " +
  "weakest of the first three scores, phrased so the researcher knows what to fix. Cover every " +
  "recommendation by its index.";

const TOOLS = [
  {
    name: "record_scores",
    description: "Records the scores for each recommendation by its index.",
    input_schema: {
      type: "object" as const,
      properties: {
        scores: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: {
                type: "integer",
                description: "The recommendation's index in the numbered list.",
              },
              actionability_score: { type: "integer", enum: [1, 3, 5] },
              feasibility_score: { type: "integer", enum: [1, 3, 5] },
              evidence_score: { type: "integer", enum: [1, 3, 5] },
              impact_score: { type: "integer", enum: [1, 3, 5] },
              rationale: { type: "string" },
            },
            required: [
              "index",
              "actionability_score",
              "feasibility_score",
              "evidence_score",
              "impact_score",
              "rationale",
            ],
          },
        },
      },
      required: ["scores"],
    },
  },
];

/**
 * Scores every not-yet-scored, not-rejected synthesized recommendation on a
 * run. Editing a recommendation clears its score (see recommendationActions),
 * so an edited one is scored again here. Nothing is hidden or filtered by a
 * low score: it is a signal about what to sharpen.
 */
export async function scoreRecommendationQuality(
  tenantId: string,
  runId: string,
): Promise<number> {
  const eligible = await withTenant(tenantId, async (client) => {
    const r = await client.query<Eligible>(
      `select r.id, r.action_text, r.owner_role, r.owner_feasibility_note, r.timeline, r.metric,
              r.assumptions_and_risks, r.alternatives_considered,
              si.headline, si.observation, si.tension, si.implication
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.synthesized_insight_id is not null
         and r.status <> 'rejected' and r.rec_quality_score is null
       order by r.created_at limit $2`,
      [runId, MAX_FOR_SCORING],
    );
    return r.rows;
  });
  if (eligible.length === 0) return 0;

  const decision = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ decision_statement: string | null }>(
      "select decision_statement from runs where id = $1",
      [runId],
    );
    return r.rows[0]?.decision_statement?.trim() || "(not given)";
  });

  const chunks: Eligible[][] = [];
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE)
    chunks.push(eligible.slice(i, i + CHUNK_SIZE));

  const results = await mapWithConcurrency(
    chunks,
    CONCURRENCY,
    async (batch) => {
      try {
        const block = batch
          .map(
            (r, i) =>
              `${i}. Action: ${r.action_text}\n` +
              `   Owner: ${r.owner_role}. Owner's ability to do it: ${r.owner_feasibility_note}\n` +
              `   Timeline: ${r.timeline}. Metric: ${r.metric}\n` +
              `   Risks and assumptions: ${r.assumptions_and_risks}\n` +
              `   Alternatives considered: ${r.alternatives_considered}\n` +
              `   Built on this insight: ${r.headline}. Observation: ${r.observation} Tension: ${r.tension} Implication: ${r.implication}`,
          )
          .join("\n");
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: SYSTEM,
          tool_choice: { type: "tool", name: "record_scores" },
          tools: TOOLS,
          messages: [
            {
              role: "user",
              content: `Decision the work serves: ${decision}\n\nRecommendations:\n\n${block}`,
            },
          ],
        });
        await logApiUsage(
          tenantId,
          runId,
          "recommendation_quality_scorer",
          response.usage,
        );
        const toolUse = response.content.find((b) => b.type === "tool_use");
        const scores = parseRecommendationScores(
          toolUse && toolUse.type === "tool_use"
            ? (toolUse.input as { scores?: unknown }).scores
            : undefined,
          batch.length,
        );
        return scores.map((s) => ({ id: batch[s.index].id, ...s }));
      } catch {
        return [];
      }
    },
  );

  const flat = results.flat();
  if (flat.length === 0) return 0;
  await withTenant(tenantId, async (client) => {
    for (const s of flat) {
      const total = s.actionability + s.feasibility + s.evidence;
      await client.query(
        `update recommendations
         set rec_actionability_score = $2, rec_feasibility_score = $3, rec_evidence_score = $4,
             rec_impact_score = $5, rec_quality_score = $6, rec_quality_tier = $7, rec_quality_rationale = $8
         where id = $1`,
        [
          s.id,
          s.actionability,
          s.feasibility,
          s.evidence,
          s.impact,
          total,
          recommendationRating(total),
          s.rationale,
        ],
      );
    }
  });
  return flat.length;
}

export async function refreshRecommendationQuality(
  tenantId: string,
  runId: string,
): Promise<void> {
  try {
    await scoreRecommendationQuality(tenantId, runId);
  } catch (error) {
    try {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'recommendation_quality_error', $3)`,
          [
            tenantId,
            runId,
            JSON.stringify({
              message: error instanceof Error ? error.message : String(error),
            }),
          ],
        );
      });
    } catch {
      // Nothing more to do.
    }
  }
}
