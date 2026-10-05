import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { capWords, parseNumberedItems } from "./text";
import type { ConfidenceTier, QualityTier } from "./tiers";

type EvidenceInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  confidence_tier: ConfidenceTier;
  quality_tier: QualityTier;
};

export type ValidationStatus = "resolved" | "partial" | "gap";

export type ObjectiveValidation = {
  item_kind: "objective" | "decision";
  item_order: number;
  item_text: string;
  status: ValidationStatus;
  conclusion: string;
  synthesized_insight_ids: string[];
};

type RawItem = { kind: "objective" | "decision"; order: number; text: string };

/**
 * Standard market-research reporting practice: every research objective and
 * every confirmed decision gets carried through to an explicit conclusion in
 * the final report, resolved, partially answered, or named as a gap, rather
 * than the reader having to infer from a pile of insights whether what the
 * project set out to answer actually got answered. This is that step.
 *
 * Deliberately run once, after synthesis, against the final accepted
 * insight set, not threaded earlier into finding extraction, insight
 * generation, or clustering. Locking those earlier stages to pre-set
 * objectives would be a deductive, framework-first move that risks exactly
 * what thematic-analysis methodology warns against: cross-cutting or
 * emergent patterns get force-fit into the nearest objective bucket, or
 * never surface at all if they don't fit one. Keeping discovery
 * objective-agnostic (as insightGenerator and insightSynthesizer already
 * do -- decision-relevance there is "a tiebreaker, not a strict filter")
 * and mapping against objectives only once, deductively, at the end, is
 * what makes an honest many-to-many mapping possible: one insight can
 * legitimately bear on several objectives, one objective can need several
 * insights, and some insights will bear on none of them, which is itself a
 * finding worth naming rather than silently folding into a pillar as if it
 * always belonged there.
 *
 * research_objective and decision_statement are each free text that may
 * contain one item or several numbered ones (the same shape addTitleSlide's
 * decision-line summary already parses with parseNumberedItems); each is
 * split into its own discrete items here so each one gets its own
 * conclusion rather than one blended verdict standing in for all of them.
 */
export async function generateObjectiveValidation(tenantId: string, runId: string): Promise<ObjectiveValidation[]> {
  const { run, insights } = await withTenant(tenantId, async (client) => {
    const runResult = await client.query<{
      research_objective: string | null;
      decision_statement: string | null;
    }>("select research_objective, decision_statement from runs where id = $1", [runId]);

    const insightsResult = await client.query<EvidenceInsight>(
      `select si.id, si.headline, si.observation, si.tension, si.implication, si.confidence_tier, si.quality_tier
       from synthesized_insights si
       where si.run_id = $1 and si.review_status = 'accepted'
       order by si.quality_score desc nulls last, si.created_at`,
      [runId]
    );

    return { run: runResult.rows[0], insights: insightsResult.rows };
  });

  if (!run) {
    throw new Error("Project not found");
  }
  if (insights.length === 0) {
    throw new Error(
      "No accepted synthesized insights yet. Run synthesis and accept at least one synthesized insight " +
        "before validating against the project's objectives and decisions."
    );
  }

  const objectiveItems = parseNumberedItems(run.research_objective);
  const decisionItems = parseNumberedItems(run.decision_statement);
  const items: RawItem[] = [
    ...objectiveItems.map((text, order): RawItem => ({ kind: "objective", order, text })),
    ...decisionItems.map((text, order): RawItem => ({ kind: "decision", order, text })),
  ];

  if (items.length === 0) {
    throw new Error(
      "This project has no research objective or confirmed decision recorded yet, there's nothing to " +
        "validate the insights against."
    );
  }

  const itemsBlock = items
    .map((item, index) => `${index}. [${item.kind}] ${item.text}`)
    .join("\n");

  const insightsBlock = insights
    .map(
      (insight, index) =>
        `${index}. (confidence: ${insight.confidence_tier ?? "not yet triangulated"}) Headline: ${insight.headline}\n` +
        `   Observation: ${insight.observation}\n   Implication: ${insight.implication}`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You check whether a market research project's accepted, synthesized insights actually answer what " +
      "the project set out to answer. Below is a numbered list of this project's research objectives and " +
      "confirmed decisions (each one a separate item to judge on its own), and a numbered list of the " +
      "accepted synthesized insights available as evidence.\n\n" +
      "For every objective/decision item, decide:\n" +
      "- resolved: the evidence gives a clear, well-supported answer.\n" +
      "- partial: some relevant evidence exists, but it doesn't fully settle the question, or rests on " +
      "weaker (moderate/exploratory) confidence.\n" +
      "- gap: no accepted insight actually bears on this item. This is a real, reportable finding, not a " +
      "failure to search harder, say so plainly rather than stretching a loosely-related insight to cover it.\n\n" +
      "For each item write a conclusion: one or two plain-English sentences stating what the evidence " +
      "actually shows about that specific objective or decision (or, for a gap, that nothing accepted " +
      "speaks to it yet). Also give the indices of every insight that genuinely bears on this item -- an " +
      "insight can support more than one item, and some items will have none. Do not stretch a tenuous " +
      "connection just to avoid a gap; an honest gap is more useful to a stakeholder than a padded answer.\n\n" +
      "Judge only against the items and insights given below; don't invent evidence or items beyond what's " +
      "listed.\n\n" +
      `Objectives and decisions:\n${itemsBlock}\n\n` +
      `Accepted synthesized insights:\n${insightsBlock}\n\n` +
      "Cover every item listed above by its index.",
    tool_choice: { type: "tool", name: "record_validations" },
    tools: [
      {
        name: "record_validations",
        description: "Records the disposition of every research objective / decision item against the accepted insights.",
        input_schema: {
          type: "object",
          properties: {
            validations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item_index: { type: "integer", description: "The item's index in the numbered objectives/decisions list." },
                  status: { type: "string", enum: ["resolved", "partial", "gap"] },
                  conclusion: { type: "string" },
                  insight_indices: { type: "array", items: { type: "integer" } },
                },
                required: ["item_index", "status", "conclusion", "insight_indices"],
              },
            },
          },
          required: ["validations"],
        },
      },
    ],
    messages: [{ role: "user", content: "Validate the insights against the objectives and decisions now." }],
  });

  await logApiUsage(tenantId, runId, "objective_validator", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  const rawValidations =
    toolUse && toolUse.type === "tool_use" && Array.isArray((toolUse.input as { validations?: unknown }).validations)
      ? ((toolUse.input as { validations: unknown[] }).validations as Record<string, unknown>[])
      : [];

  const byIndex = new Map<number, { status: ValidationStatus; conclusion: string; insightIds: string[] }>();
  for (const raw of rawValidations) {
    const itemIndex = typeof raw.item_index === "number" ? raw.item_index : null;
    const status: ValidationStatus | null =
      raw.status === "resolved" || raw.status === "partial" || raw.status === "gap" ? raw.status : null;
    const conclusion = typeof raw.conclusion === "string" ? raw.conclusion.trim() : "";
    const insightIndices = Array.isArray(raw.insight_indices)
      ? raw.insight_indices.filter(
          (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < insights.length
        )
      : [];

    if (itemIndex === null || itemIndex < 0 || itemIndex >= items.length || !status || !conclusion) continue;
    byIndex.set(itemIndex, {
      status,
      conclusion,
      insightIds: [...new Set(insightIndices)].map((i) => insights[i].id),
    });
  }

  if (byIndex.size === 0) {
    throw new Error("Claude did not return a usable validation for any objective or decision; try again.");
  }

  // item_text and conclusion are capped here, the same way storyNarrative.ts
  // caps its own framing prose, rather than left to the deck's display-time
  // card truncation alone: a researcher's own objective/decision wording can
  // run long, and the model's conclusion has no word limit in its prompt, so
  // without this cap nearly every card on the objectives/decisions slide was
  // showing a mid-sentence ellipsis cut instead of a clean, complete thought.
  const validations: ObjectiveValidation[] = items.map((item, index) => {
    const result = byIndex.get(index);
    return {
      item_kind: item.kind,
      item_order: item.order,
      item_text: capWords(item.text, 40),
      status: result?.status ?? "gap",
      conclusion: capWords(
        result?.conclusion ?? "Not yet assessed against the accepted evidence; try regenerating.",
        35
      ),
      synthesized_insight_ids: result?.insightIds ?? [],
    };
  });

  await withTenant(tenantId, async (client) => {
    await client.query("delete from objective_validations where run_id = $1", [runId]);
    for (const validation of validations) {
      await client.query(
        `insert into objective_validations
           (tenant_id, run_id, item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids, generated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [
          tenantId,
          runId,
          validation.item_kind,
          validation.item_order,
          validation.item_text,
          validation.status,
          validation.conclusion,
          validation.synthesized_insight_ids,
        ]
      );
    }
  });

  return validations;
}
