import type Anthropic from "@anthropic-ai/sdk";
import { cachedSystemThen } from "./promptCache";
import { DATA_TOOLS, HELP_TOOLS, SAMPLE_SIZE_TOOL, runAssistantTool } from "./researchAssistantTools";
import { pageLine, runAssistantLoop, sourceLines, type PageContext } from "./assistantLoop";
import { helpContents } from "./helpIndex";
import { logApiUsage } from "./apiUsage";
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { withAnswerCapacity, withRequestClaim } from "./assistantCapacity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import type { DeckNarrative, DeckPillar } from "./storyNarrative";
import { loadNarrativeEvidence, narrativeFigureCheck } from "./storyNarrative";
import { figureCheckAvailable } from "./figureChecks";
import { latestVerdictLateral } from "./latestVerdict";

const MAX_FINDINGS_FOR_CONTEXT = 80;
const MAX_INSIGHTS_FOR_CONTEXT = 60;
const MAX_RECOMMENDATIONS_FOR_CONTEXT = 40;
const MAX_HISTORY_MESSAGES = 20;

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  /** The request it was stored under (migration 0108); null for rows from before it. */
  request_id?: string | null;
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
      `select item_kind, item_text,
              case when inferred then 'inferred' else status end as status,
              conclusion
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
       join ${latestVerdictLateral("f.id", ["verdict_tier"])} v on true
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
 * the edit is live immediately. It runs in the caller's transaction, the one
 * that stores the question and its reply, so a revision is never applied
 * without its stored answer (and a retry of a failed send cannot apply it twice).
 */
/** A revision the report cannot take (no report yet, or figures the evidence does not support): nothing is written. */
class RevisionRefused extends Error {}

async function applyNarrativeRevision(
  client: PoolClient,
  runId: string,
  revision: NarrativeRevision,
  // Numerical traceability: a revision is model-written too, so it is checked with the same rule
  // as generation (storyNarrative.narrativeFigureCheck) against the evidence as it stands now.
  evidence: Awaited<ReturnType<typeof loadNarrativeEvidence>>,
): Promise<string[]> {
  const changed: string[] = [];
  {
    const current = await client.query<{ pillars: DeckPillar[] } & Pick<DeckNarrative, "executive_summary" | "situation" | "complication" | "question" | "governing_thought" | "recommendations_intro" | "caveats">>(
      `select pillars, executive_summary, situation, complication, question, governing_thought, recommendations_intro, caveats
         from deck_narratives where run_id = $1 for update`,
      [runId]
    );
    if (current.rows.length === 0) {
      throw new RevisionRefused("No Insights Report has been generated yet, there is nothing to revise.");
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

    if (setClauses.length === 0) return changed;

    // The narrative as it would read after this revision, checked as a whole. An unsupported figure
    // refuses the revision (nothing is written); figures needing review are stored with it.
    const row = current.rows[0];
    const pick = (field: keyof NarrativeRevision & keyof typeof row) => {
      const value = revision[field];
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : (row[field] as string);
    };
    const check = narrativeFigureCheck(
      {
        executive_summary: pick("executive_summary"),
        situation: pick("situation"),
        complication: pick("complication"),
        question: pick("question"),
        governing_thought: pick("governing_thought"),
        recommendations_intro: pick("recommendations_intro"),
        caveats: revision.caveats && revision.caveats.length > 0 ? revision.caveats : (row.caveats ?? []),
        pillars,
      },
      evidence,
    );
    const unsupported = check.figures.filter((f) => f.status === "unsupported");
    if (unsupported.length > 0) {
      throw new RevisionRefused(
        `The revision was not applied: it states figures the evidence does not support (${unsupported
          .map((f) => `${f.field}: ${f.text}, ${f.reason}`)
          .join("; ")}). The narrative is unchanged.`,
      );
    }
    if (await figureCheckAvailable(client)) {
      setClauses.push(`figure_check = $${paramIndex}`);
      values.push(JSON.stringify(check));
      paramIndex += 1;
    }

    values.push(runId);
    await client.query(`update deck_narratives set ${setClauses.join(", ")} where run_id = $${paramIndex}`, values);
  }

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
const REVISE_NARRATIVE_TOOL: Anthropic.Tool = {
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
};

export async function askResearchAssistant(
  tenantId: string,
  runId: string,
  userMessage: string,
  page: PageContext | null = null,
  requestId: string | null = null,
): Promise<{ reply: string; revisedFields: string[]; alreadyAnswered: boolean }> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    throw new Error("Message is empty.");
  }
  if (requestId !== null && !UUID.test(requestId)) throw new Error("The request id is not valid.");
  // A send without a request id (an older client) is still held to the assistant's capacity (Codex
  // RR-F08): it claims a slot under a key of its own, so it waits or is refused as busy like any
  // other send, and nothing runs before it has a slot. It has no stored-answer replay.
  if (!requestId) return withAnswerCapacity(`assistant-request:${runId}`, () => answerQuestion(tenantId, runId, trimmed, page, null));

  // One execution per request (Codex B6-F02, B7-F01). The request is claimed before the model or any
  // tool runs: a send of the same request that arrives while another is answering it (Send again
  // after the connection dropped, or a second tab) waits for that one, then finds its stored answer
  // and returns it, so tables are not built and the report is not revised a second time. A request
  // already answered returns its stored answer without asking the model.
  return withRequestClaim(runId, requestId, async () => {
    const earlier = await storedReply(tenantId, runId, requestId);
    if (earlier !== null) return { reply: earlier, revisedFields: [], alreadyAnswered: true };
    return answerQuestion(tenantId, runId, trimmed, page, requestId);
  });
}

export { AssistantBusyError, RequestInProgressError, requestClaimWaitMs } from "./assistantCapacity";

async function answerQuestion(
  tenantId: string,
  runId: string,
  trimmed: string,
  page: PageContext | null,
  requestId: string | null,
): Promise<{ reply: string; revisedFields: string[]; alreadyAnswered: boolean }> {
  const context = await loadContext(tenantId, runId);
  if (!context.run) {
    throw new Error("Run not found");
  }

  const contextBlock = buildContextBlock(context);
  // The question is not stored yet (it is stored with its reply, below), so the history is all earlier turns.
  const historyBlock = context.history
    .map((m) => `${m.role === "user" ? "Researcher" : "Assistant"}: ${m.content}`)
    .join("\n");

  const instructions =
    "You are the research assistant embedded in a single project inside Insights Elevator, a market-research " +
    "insight-generation tool, and the project's research expert. You can see this project's accepted evidence, its " +
    "generated Insights Report narrative (if one exists), and the recent chat history, all given below. A researcher " +
    "is asking you something directly. What you can do:\n\n" +
    "1. Answer a question about the project's evidence or report from what is given below. If it is not covered, say " +
    "so plainly rather than guessing or inventing a number.\n" +
    "2. Answer a question about the project's data by building a table: list_data_files, find_variables, then " +
    "build_table. Every figure you give about the data must come from a build_table result: quote it as shown, name " +
    "the table, and give its base and whether it was weighted. Call a difference significant only when it is marked " +
    "(higher) or (lower). If a tool returns an error, fix the request or tell the researcher what could not be done. " +
    "Build only the tables the question needs.\n" +
    "3. Give general research advice as an experienced market research methodologist: sample sizes, margins of error, " +
    "questionnaire design, sampling, weighting, significance testing, qualitative methods. For any sample size or " +
    "margin of error, call sample_size and quote its result and assumptions; never work one out yourself. Say when " +
    "advice is general practice rather than something drawn from this project, and name the assumptions it rests on " +
    "(a probability sample, a proportion, the confidence level). Point out when a subgroup the researcher wants to " +
    "report needs its own sample size.\n" +
    "4. If the researcher asks you to refine, tighten, shorten, rewrite, or otherwise change part of the generated " +
    "Insights Report (the executive summary, situation, complication, question, governing thought, a specific " +
    "pillar's headline or so-what line, the recommendations intro, or the caveats list), call the revise_narrative " +
    "tool with the new text for exactly the field(s) asked about. Never rewrite a field the researcher didn't ask " +
    "about. Write the new text in the same voice and length discipline as what's already there.\n" +
    "5. Answer a question about how Insights Elevator works (a screen, a method, a statistic, a stated limit) from the " +
    "Knowledge base and Manual: search_help, then read_help, and answer from what they say. If the guides do not cover " +
    "it, say so rather than describing behaviour you have not read.\n\n" +
    "Whatever you do, always end with a short, plain-language reply to the researcher, so they see what you did or " +
    "what you found. Keep replies concise, this is a chat, not a report. No em dashes.";
  // The instructions and the project's evidence are the same for every message until the evidence
  // changes, so they are cached (promptCache.ts); the conversation, which grows, follows uncached.
  const system = cachedSystemThen(
    `${instructions}\n\n=== Knowledge base and Manual contents (read with read_help) ===\n${helpContents()}\n\n=== This project's evidence and report ===\n${contextBlock}`,
    [historyBlock ? `=== Recent conversation ===\n${historyBlock}` : "", pageLine(page)].filter(Boolean).join("\n\n"),
  );
  const tools: Anthropic.Tool[] = [REVISE_NARRATIVE_TOOL, ...DATA_TOOLS, SAMPLE_SIZE_TOOL, ...HELP_TOOLS];
  let revisedFields: string[] = [];
  let revision: { input: NarrativeRevision; text: string } | null = null;
  const loop = await runAssistantLoop({
    system,
    tools,
    userMessage: trimmed,
    runTool: (name, input, tablesSoFar) => runAssistantTool(tenantId, runId, name, input, tablesSoFar, requestId),
    terminal: {
      // Applied below, in the transaction that stores the answer.
      revise_narrative: async (input, text) => {
        revision = { input: input as NarrativeRevision, text };
        return text || "Updating the Insights Report.";
      },
    },
    logUsage: (usage) => logApiUsage(tenantId, runId, "research_assistant", usage),
  });
  const evidence = revision ? await loadNarrativeEvidence(tenantId, runId) : null;

  // The question and its reply are stored together, in one transaction, once there is a reply: a
  // failed call stores neither (Codex B5-F05). A report revision is applied in the same
  // transaction, so it exists only with its stored answer. Under a request id the pair is stored at
  // most once (the unique index of migration 0108); with the request claim above a second store
  // should not happen, and if one does (a claim lost with its connection), this transaction is
  // rolled back, revision included, and the reply stored first wins. The run is checked in the
  // same statement, so a run id of another organisation stores nothing.
  const NOT_STORED = "assistant pair not stored";
  let replyText = "";
  try {
    await withTenant(tenantId, async (client) => {
      let answer = loop.replyText;
      if (revision) {
        try {
          revisedFields = await applyNarrativeRevision(client, runId, revision.input, evidence!);
          answer = revisedFields.length > 0 && !revision.text ? `Updated ${revisedFields.join(", ")} in the Insights Report.` : revision.text || loop.replyText;
        } catch (error) {
          // A refused revision (unsupported figures, no report yet) writes nothing; the reason is the reply.
          if (!(error instanceof RevisionRefused)) throw error;
          revisedFields = [];
          answer = revision.text ? `${revision.text}\n\n(${error.message})` : error.message;
        }
      }
      replyText = answer + sourceLines(loop.tables, loop.help);
      const r = await client.query(
        `insert into assistant_messages (tenant_id, run_id, role, content, created_at, request_id)
         select $1, r.id, m.role, m.content, now() + m.offset_ms * interval '1 millisecond', $5::uuid
         from runs r, (values ('user', $3::text, 0), ('assistant', $4::text, 1)) as m(role, content, offset_ms)
         where r.id = $2 and r.tenant_id = $1
         on conflict (run_id, request_id, role) where request_id is not null do nothing
         returning id`,
        [tenantId, runId, trimmed, replyText, requestId]
      );
      if (r.rowCount !== 2) throw new Error(NOT_STORED);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== NOT_STORED) throw error;
    if (requestId) {
      const earlier = await storedReply(tenantId, runId, requestId);
      if (earlier !== null) return { reply: earlier, revisedFields: [], alreadyAnswered: true };
    }
    throw new Error("Run not found");
  }
  return { reply: replyText, revisedFields, alreadyAnswered: false };
}

/** The stored reply to one request, or null when that request has not been answered. */
async function storedReply(tenantId: string, runId: string, requestId: string): Promise<string | null> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ content: string }>(
      `select content from assistant_messages
       where run_id = $1 and tenant_id = $2 and request_id = $3 and role = 'assistant'`,
      [runId, tenantId, requestId],
    );
    return r.rows[0]?.content ?? null;
  });
}

/**
 * A project's whole Research assistant conversation, oldest first: the Research assistant page and
 * the floating drawer show the same one. Scoped by tenant as well as run, so a run id from another
 * organisation reads nothing. `withRequestIds` adds each row's request id (migration 0108), which
 * the drawer needs to tell whether a question whose reply never arrived was answered; the page
 * reads without it, so it does not depend on that migration.
 */
export async function loadAssistantConversation(tenantId: string, runId: string, withRequestIds = false): Promise<AssistantMessage[]> {
  return withTenantRead(tenantId, async (client) => {
    const result = await client.query<AssistantMessage>(
      `select id, role, content, created_at::text${withRequestIds ? ", request_id" : ""}
       from assistant_messages
       where run_id = $1 and tenant_id = $2
       order by created_at asc`,
      [runId, tenantId],
    );
    return result.rows;
  });
}
