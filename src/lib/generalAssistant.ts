import type Anthropic from "@anthropic-ai/sdk";
import { cachedSystemThen } from "./promptCache";
import { HELP_TOOLS, SAMPLE_SIZE_TOOL, runHelpTool, runSampleSizeTool } from "./researchAssistantTools";
import { pageLine, runAssistantLoop, sourceLines, type PageContext } from "./assistantLoop";
import { helpContents } from "./helpIndex";
import { logTenantApiUsage } from "./apiUsage";
import { withAnswerCapacity } from "./assistantCapacity";

/**
 * The Research assistant outside a project (Grant, 2026-10-22: the floating assistant on every
 * page): the dashboard, Programs, the Knowledge base and the Manual. It answers how-the-app
 * questions from the Knowledge base and Manual and gives research method advice with the sample
 * size calculator. It has no project, so no data tools and no evidence.
 *
 * The conversation is not stored (there is no project to store it under): the drawer sends the
 * earlier turns with each message, checked here. Usage is recorded in tenant_api_usage (migration
 * 0109) and shown on the dashboard; a project's API usage page counts only that project's calls.
 */

export const MAX_GENERAL_HISTORY = 20;
export const MAX_MESSAGE_CHARS = 4000;

export type GeneralTurn = { role: "user" | "assistant"; content: string };

/** The drawer's earlier turns, checked at the server boundary: roles, lengths, and at most the last 20. */
export function checkedHistory(raw: unknown): GeneralTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is GeneralTurn => !!t && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim() !== "")
    .slice(-MAX_GENERAL_HISTORY)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_CHARS) }));
}

const INSTRUCTIONS =
  "You are the Research assistant of Insights Elevator, a market-research insight tool, and a research expert. The " +
  "researcher is not inside a project, so you have no project data or evidence. What you can do:\n\n" +
  "1. Answer a question about how Insights Elevator works (a screen, a method, a statistic, a stated limit) from the " +
  "Knowledge base and Manual: search_help, then read_help, and answer from what they say. If the guides do not cover " +
  "it, say so rather than describing behaviour you have not read.\n" +
  "2. Give general research advice as an experienced market research methodologist: sample sizes, margins of error, " +
  "questionnaire design, sampling, weighting, significance testing, qualitative methods. For any sample size or margin " +
  "of error, call sample_size and quote its result and assumptions; never work one out yourself. Say when advice is " +
  "general practice, and name the assumptions it rests on. Point out when a subgroup needs its own sample size.\n" +
  "3. A question about a particular study's data or findings needs that project: say to open the project and ask " +
  "there.\n\n" +
  "Keep replies concise, this is a chat, not a report. No em dashes.";

export async function askGeneralAssistant(
  tenantId: string,
  userMessage: string,
  history: GeneralTurn[],
  page: PageContext | null,
): Promise<{ reply: string }> {
  const trimmed = userMessage.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!trimmed) throw new Error("Message is empty.");
  // Held to the same capacity as answers in a project (Codex RR-F08): nothing runs without a slot.
  return withAnswerCapacity(`assistant-general:${tenantId}`, () => answerGeneral(tenantId, trimmed, history, page));
}

async function answerGeneral(tenantId: string, trimmed: string, history: GeneralTurn[], page: PageContext | null): Promise<{ reply: string }> {
  const system = cachedSystemThen(
    `${INSTRUCTIONS}\n\n=== Knowledge base and Manual contents (read with read_help) ===\n${helpContents()}`,
    pageLine(page),
  );
  // The model needs alternating turns starting with the researcher; a stray leading reply is dropped.
  const prior: Anthropic.MessageParam[] = [];
  for (const t of history) {
    if (prior.length === 0 && t.role !== "user") continue;
    const last = prior[prior.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n\n${t.content}`;
    else prior.push({ role: t.role, content: t.content });
  }
  if (prior.length > 0 && prior[prior.length - 1].role === "user") prior.pop();
  const loop = await runAssistantLoop({
    system,
    tools: [...HELP_TOOLS, SAMPLE_SIZE_TOOL],
    userMessage: trimmed,
    priorMessages: prior,
    runTool: async (name, input) => (name === "sample_size" ? runSampleSizeTool(input) : runHelpTool(name, input)),
    logUsage: (usage) => logTenantApiUsage(tenantId, "general_assistant", usage),
  });
  return { reply: loop.replyText + sourceLines(loop.tables, loop.help) };
}
