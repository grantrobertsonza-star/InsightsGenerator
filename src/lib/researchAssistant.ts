import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import type { DeckPillar } from "./storyNarrative";

const MAX_FINDINGS_FOR_CONTEXT = 80;
const MAX_INSIGHTS_FOR_CONTEXT = 60;
const MAX_RECOMMENDATIONS_FOR_CONTEXT = 40;
const MAX_HISTORY_MESSAGES = 20;

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type RunFraming = {
  project_name: string | null;
  business_problem: string | null;
  research_objective: string | null;
  decision_statement: string | null;
  audience: string | null;
  entry_point: "generate" | "validate" | null;
};

type NarrativeRow = {
  executive_summary: string;
  situation: string;
  complication: string;
  question: string;
  governing_thought: string;
  pillars: DeckPillar[];
  recommendations_intro: string;
  caveats: string[];
  generated_at: string;
} | null;

/**
 * Builds the evidence block the assistant is grounded in: the run's own
 * framing, the generated Insights Report narrative if one exists, the
 * accepted synthesized insights and recommendations, and a sample of
 * verified findings. This is deliberately the same "accepted, reviewed
 * evidence" boundary every other agent in this pipeline respects (see
 * story/export/route.ts's doc comment): the assistant answers from what
 * the researcher has actually reviewed and kept, not from pending or
 * rejected material, so a chat answer never cites something the researcher
 * themselves discarded.
 */
async function loadContext(tenantId: string, runId: string) {
  return withTenant(tenantId, async (client) => {
    const runResult = await client.query<RunFraming>(
      `select project_name, business_problem, research_objective, decision_statement, audience, entry_point
       from runs where id = $1`,
      [runId]
    );
    const run = runResult.rows[0] ?? null;

    const narrativeResult = await client.query<NonNullable<NarrativeRow>>(
      `select executive_summary, situation, complication, question, governing_thought, pillars,
              recommendations_intro, caveats, generated_at
       from deck_narratives where run_id = $1`,
      [runId]
    );
    const narrative: NarrativeRow = narrativeResult.rows[0] ?? null;

    // synthesized_insights has no theme column of its own (it's a
    // cross-theme triangulation, see migration 0027's doc comment on
    // source_theme_count) -- theme only lives on the pre-insight/finding
    // layer, which is why the findings query further down still selects it
    // directly.
    const insightsResult = await client.query<{
      headline: string;
      observation: string;
      tension: string;
      implication: string;
    }>(
      `select headline, observation, tension, implication
       from synthesized_insights
       where run_id = $1 and review_status = 'accepted'
       order by created_at
       limit $2`,
      [runId, MAX_INSIGHTS_FOR_CONTEXT]
    );

    const recommendationsResult = await client.query<{
      action_text: string;
      owner_role: string;
      timeline: string;
      metric: string;
      priority: "high" | "medium" | "low";
    }>(
      `select action_text, owner_role, timeline, metric, priority
       from recommendations
       where run_id = $1 and status = 'accepted'
       order by case priority when 'high' then 0 when 'medium' then 1 else 2 end, created_at
       limit $2`,
      [runId, MAX_RECOMMENDATIONS_FOR_CONTEXT]
    );

    const objectiveValidationsResult = await client.query<{
      item_kind: "objective" | "decision";
      item_text: string;
      status: "resolved" | "partial" | "gap";
      conclusion: string;
    }>(
      `select item_kind, item_text, status, conclusion
       from objective_validations where run_id = $1 order by item_kind, item_order`,
      [runId]
    );

    // Same accepted-evidence boundary the Insights Report exports use
    // (status = 'accepted' and verdict_tier in robust/use_with_caution --
    // see story/export-docx/route.ts): a pending finding nobody's reviewed
    // yet, or one the red-team pass already flagged not_supported or
    // insufficient_information, has no business being handed to the
    // assistant labeled as accepted evidence.
    const findingsResult = await client.query<{
      finding_text: string;
      theme: string | null;
      verdict_tier: string | null;
    }>(
      `select f.finding_text, f.theme, v.verdict_tier
       from findings f
       join verdicts v on v.finding_id = f.id
       where f.run_id = $1 and f.status = 'accepted' and v.verdict_tier in ('robust', 'use_with_caution')
       order by f.theme nulls last, f.created_at
       limit $2`,
      [runId, MAX_FINDINGS_FOR_CONTEXT]
    );

    const historyResult = await client.query<AssistantMessage>(
      `select id, role, content, created_at::text
       from assistant_messages
       where run_id = $1
       order by created_at desc
       limit $2`,
      [runId, MAX_HISTORY_MESSAGES]
    );

    return {
      run,
      narrative,
      insights: insightsResult.rows,
      recommendations: recommendationsResult.rows,
      objectiveValidations: objectiveValidationsResult.rows,
      findings: findingsResult.rows,
      history: historyResult.rows.reverse(),
    };
  });
}

function buildContextBlock(context: Awaited<ReturnType<typeof loadContext>>): string {
  const { run, narrative, insights, recommendations, objectiveValidations, findings } = context;
  const parts: string[] = [];

  parts.push(
    `Project: ${run?.project_name ?? "Untitled"}\n` +
      `Business problem: ${run?.business_problem ?? "(not recorded)"}\n` +
      `Research objective: ${run?.research_objective ?? "(not recorded)"}\n` +
      `Decision statement: ${run?.decision_statement ?? "(not yet confirmed)"}\n` +
      `Audience: ${run?.audience ?? "(not recorded)"}`
  );

  if (narrative) {
    const pillarBlock = narrative.pillars
      .map((p, i) => `  ${i}. ${p.headline} -- ${p.so_what}`)
      .join("\n");
    parts.push(
      "Generated Insights Report narrative (the live, exported report; pillar indexes below match this order):\n" +
        `Executive summary: ${narrative.executive_summary}\n` +
        `Situation: ${narrative.situation}\n` +
        `Complication: ${narrative.complication}\n` +
        `Question: ${narrative.question}\n` +
        `Governing thought: ${narrative.governing_thought}\n` +
        `Pillars:\n${pillarBlock}\n` +
        `Recommendations intro: ${narrative.recommendations_intro}\n` +
        `Caveats:\n${narrative.caveats.map((c) => `  - ${c}`).join("\n")}`
    );
  } else {
    parts.push("No Insights Report has been generated for this project yet.");
  }

  if (objectiveValidations.length > 0) {
    parts.push(
      "Objectives/decisions checked against the evidence:\n" +
        objectiveValidations
          .map((o) => `  - [${o.status}] (${o.item_kind}) ${o.item_text} -- ${o.conclusion}`)
          .join("\n")
    );
  }

  if (insights.length > 0) {
    parts.push(
      `Accepted synthesized insights (${insights.length}):\n` +
        insights
          .map((i) => `  - ${i.headline}: ${i.observation} (${i.implication})`)
          .join("\n")
    );
  }

  if (recommendations.length > 0) {
    parts.push(
      `Accepted recommendations (${recommendations.length}):\n` +
        recommendations
          .map((r) => `  - [${r.priority}] ${r.action_text} (${r.owner_role}, ${r.timeline}, metric: ${r.metric})`)
          .join("\n")
    );
  }

  if (findings.length > 0) {
    parts.push(
      `Sample of this run's accepted, verified findings (${findings.length}, not exhaustive -- status ` +
        `'accepted' and a 'robust' or 'use_with_caution' verdict, the same evidence boundary the Insights ` +
        `Report export uses):\n` +
        findings.map((f) => `  - [${f.theme ?? "Uncategorized"}/${f.verdict_tier}] ${f.finding_text}`).join("\n")
    );
  }

  return parts.join("\n\n");
}

type NarrativeRevision = {
  executive_summary?: string;
  situation?: string;
  complication?: string;
  question?: string;
  governing_thought?: string;
  recommendations_intro?: string;
  caveats?: string[];
  pillar_updates?: { index: number; headline?: string; so_what?: string }[];
};

/**
 * Applies a model-proposed revision directly to the live deck_narratives
 * row. This is the one place an AI call is allowed to edit an already
 * "accepted" artifact outright rather than going through a candidate/accept
 * flow: the researcher is asking for the edit themselves, in the same turn,
 * which is a different act from a background agent proposing new material
 * unprompted. The next deck or Word export reads straight from this row, so
 * the edit is live immediately.
 */
async function applyNarrativeRevision(
  tenantId: string,
  runId: string,
  revision: NarrativeRevision
): Promise<string[]> {
  const changed: string[] = [];

  await withTenant(tenantId, async (client) => {
    const current = await client.query<{ pillars: DeckPillar[] }>(
      "select pillars from deck_narratives where run_id = $1",
      [runId]
    );
    if (current.rows.length === 0) {
      throw new Error("No Insights Report has been generated yet, there is nothing to revise.");
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const simpleFields: (keyof NarrativeRevision)[] = [
      "executive_summary",
      "situation",
      "complication",
      "question",
      "governing_thought",
      "recommendations_intro",
    ];
    for (const field of simpleFields) {
      const value = revision[field];
      if (typeof value === "string" && value.trim().length > 0) {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(value.trim());
        paramIndex += 1;
        changed.push(field);
      }
    }

    if (revision.caveats && revision.caveats.length > 0) {
      setClauses.push(`caveats = $${paramIndex}`);
      values.push(JSON.stringify(revision.caveats));
      paramIndex += 1;
      changed.push("caveats");
    }

    let pillars = current.rows[0].pillars;
    if (revision.pillar_updates && revision.pillar_updates.length > 0) {
      pillars = pillars.map((pillar, index) => {
        const update = revision.pillar_updates!.find((u) => u.index === index);
        if (!update) return pillar;
        changed.push(`pillar ${index}`);
        return {
          ...pillar,
          headline: update.headline?.trim() || pillar.headline,
          so_what: update.so_what?.trim() || pillar.so_what,
        };
      });
      setClauses.push(`pillars = $${paramIndex}`);
      values.push(JSON.stringify(pillars));
      paramIndex += 1;
    }

    if (setClauses.length === 0) return;

    values.push(runId);
    await client.query(`update deck_narratives set ${setClauses.join(", ")} where run_id = $${paramIndex}`, values);
  });

  return changed;
}

/**
 * The research assistant's one entry point: takes the researcher's message,
 * grounds a Claude call in this run's own accepted evidence and generated
 * report, lets the model either answer directly or propose a narrative
 * revision (via the revise_narrative tool), applies any such revision
 * straight to deck_narratives, and persists both sides of the exchange.
 *
 * Deliberately not forced into always calling a tool (tool_choice stays
 * "auto"): most turns are a plain question about the data and should get a
 * plain text answer, not a tool call manufactured to satisfy a forced
 * choice.
 */
export async function askResearchAssistant(
  tenantId: string,
  runId: string,
  userMessage: string
): Promise<{ reply: string; revisedFields: string[] }> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    throw new Error("Message is empty.");
  }

  await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into assistant_messages (tenant_id, run_id, role, content) values ($1, $2, 'user', $3)`,
      [tenantId, runId, trimmed]
    );
  });

  const context = await loadContext(tenantId, runId);
  if (!context.run) {
    throw new Error("Run not found");
  }

  const contextBlock = buildContextBlock(context);
  const historyBlock = context.history
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "Researcher" : "Assistant"}: ${m.content}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system:
      "You are the research assistant embedded in a single project inside Insights Elevator, a market-research " +
      "insight-generation tool. You can see this project's accepted evidence, its generated Insights Report " +
      "narrative (if one exists), and the recent chat history, all given below. A researcher is asking you " +
      "something directly. Two things you can do:\n\n" +
      "1. Answer a question about the project's data, evidence, or report using only what's given below. If the " +
      "answer isn't covered by the material you've been given, say so plainly rather than guessing or inventing " +
      "a number.\n" +
      "2. If the researcher asks you to refine, tighten, shorten, rewrite, or otherwise change part of the " +
      "generated Insights Report (the executive summary, situation, complication, question, governing thought, " +
      "a specific pillar's headline or so-what line, the recommendations intro, or the caveats list), call the " +
      "revise_narrative tool with the new text for exactly the field(s) asked about. Never rewrite a field the " +
      "researcher didn't ask about. Write the new text in the same voice and length discipline as what's already " +
      "there.\n\n" +
      "Whatever you do, always include a short, plain-language reply to the researcher, even when you also call " +
      "the tool, so they see what you did or what you found. Keep replies concise, this is a chat, not a report.\n\n" +
      `=== This project's evidence and report ===\n${contextBlock}` +
      (historyBlock ? `\n\n=== Recent conversation ===\n${historyBlock}` : ""),
    tool_choice: { type: "auto" },
    tools: [
      {
        name: "revise_narrative",
        description:
          "Revises one or more fields of this run's generated Insights Report narrative, only when the " +
          "researcher explicitly asked for a change to the report. Omit any field not being changed.",
        input_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string", description: "New executive summary paragraph." },
            situation: { type: "string", description: "New situation paragraph." },
            complication: { type: "string", description: "New complication paragraph." },
            question: { type: "string", description: "New question sentence." },
            governing_thought: { type: "string", description: "New governing thought (the apex claim)." },
            recommendations_intro: { type: "string", description: "New one-line intro to the recommendations section." },
            caveats: {
              type: "array",
              items: { type: "string" },
              description: "The full replacement list of caveats, if the researcher asked to change the caveats.",
            },
            pillar_updates: {
              type: "array",
              description: "Edits to specific pillars, referenced by their 0-based index as listed above.",
              items: {
                type: "object",
                properties: {
                  index: { type: "number", description: "0-based pillar index, matching the list above." },
                  headline: { type: "string", description: "New pillar headline, if changed." },
                  so_what: { type: "string", description: "New pillar so-what line, if changed." },
                },
                required: ["index"],
              },
            },
          },
        },
      },
    ],
    messages: [{ role: "user", content: trimmed }],
  });

  await logApiUsage(tenantId, runId, "research_assistant", response.usage);

  let replyText = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();

  const toolUse = response.content.find((block) => block.type === "tool_use" && block.name === "revise_narrative");
  let revisedFields: string[] = [];

  if (toolUse && toolUse.type === "tool_use") {
    try {
      revisedFields = await applyNarrativeRevision(tenantId, runId, toolUse.input as NarrativeRevision);
      if (revisedFields.length > 0 && !replyText) {
        replyText = `Updated ${revisedFields.join(", ")} in the Insights Report.`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      replyText = replyText ? `${replyText}\n\n(${message})` : message;
    }
  }

  if (!replyText) {
    replyText = "I didn't have anything to add to that.";
  }

  await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into assistant_messages (tenant_id, run_id, role, content) values ($1, $2, 'assistant', $3)`,
      [tenantId, runId, replyText]
    );
  });

  return { reply: replyText, revisedFields };
}
