import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import type { BuiltTable, HelpUsed } from "./researchAssistantTools";

/**
 * The Research assistant's tool loop, shared by the project assistant (researchAssistant.ts) and
 * the one outside a project (generalAssistant.ts), so both stop, cite and fail the same way.
 *
 * Each round the model may call tools; their results go back to it before it answers. A terminal
 * tool (revise_narrative) ends the turn with whatever its handler returns. The loop is bounded: when
 * the rounds run out the reply says so plainly rather than passing off a partial answer.
 *
 * A response that did not finish (stopped for length, or any stop other than a finished answer or a
 * tool call) is not an answer (Codex B5-F03): its text is dropped, none of its tool calls runs (a cut
 * revise_narrative would write a half-finished field), and the reply says it was cut off and to ask
 * again. An empty finished answer says so too. Tables already built stay listed under the reply.
 */

/** At most this many model rounds (each may call tools) for one message. */
export const MAX_TOOL_ROUNDS = 8;

export type ToolOutcome = { content: string; isError: boolean; table?: BuiltTable; help?: HelpUsed };

export type LoopResult = { replyText: string; tables: BuiltTable[]; help: HelpUsed[]; incomplete: boolean };

export const CUT_OFF_REPLY = "My answer was cut off before it finished, so it is not shown. Ask again, or ask something narrower.";
export const EMPTY_REPLY = "No answer came back. Ask again.";
const FINISHED = new Set(["end_turn", "tool_use", "stop_sequence"]);

export async function runAssistantLoop(options: {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  userMessage: string;
  /** Earlier turns sent as messages (the assistant outside a project); empty when they are in the system text. */
  priorMessages?: Anthropic.MessageParam[];
  runTool: (name: string, input: Record<string, unknown>, tablesSoFar: number) => Promise<ToolOutcome>;
  /** Tools that end the turn; the handler returns the reply (given the model's own text, if any). */
  terminal?: Record<string, (input: Record<string, unknown>, text: string) => Promise<string>>;
  logUsage: (usage: Anthropic.Usage) => Promise<void>;
}): Promise<LoopResult> {
  const messages: Anthropic.MessageParam[] = [...(options.priorMessages ?? []), { role: "user", content: options.userMessage }];
  const tables: BuiltTable[] = [];
  const help: HelpUsed[] = [];
  let replyText = "";
  let finished = false;
  let incomplete = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS && !finished; round++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: options.system,
      tool_choice: { type: "auto" },
      tools: options.tools,
      messages,
    });
    await options.logUsage(response.usage);
    if (!FINISHED.has(String(response.stop_reason))) {
      replyText = response.stop_reason === "max_tokens" ? CUT_OFF_REPLY : `My answer did not finish (${String(response.stop_reason)}), so it is not shown. Ask again.`;
      incomplete = true;
      finished = true;
      break;
    }
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();
    if (text) replyText = text;
    const calls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    const terminalCall = calls.find((c) => options.terminal?.[c.name]);
    if (terminalCall) {
      replyText = await options.terminal![terminalCall.name]((terminalCall.input ?? {}) as Record<string, unknown>, text);
      finished = true;
      break;
    }
    if (calls.length === 0) {
      finished = true;
      break;
    }
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const r = await options.runTool(call.name, (call.input ?? {}) as Record<string, unknown>, tables.length);
      if (r.table) tables.push(r.table);
      if (r.help && !help.some((h) => h.href === r.help!.href)) help.push(r.help);
      results.push({ type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  if (!finished) {
    replyText = `${replyText ? `${replyText}\n\n` : ""}I stopped after ${MAX_TOOL_ROUNDS} steps without a final answer. Ask again more narrowly, or open the tables listed below.`;
    incomplete = true;
  }
  if (!replyText) {
    replyText = EMPTY_REPLY;
    incomplete = true;
  }
  return { replyText, tables, help, incomplete };
}

/**
 * The lines code adds under a reply: which tables it built and which guides it read, so every figure
 * and every statement about the app can be traced. Written from the tool results, not the model.
 */
export function sourceLines(tables: BuiltTable[], help: HelpUsed[]): string {
  const lines: string[] = [];
  if (tables.length > 0) {
    lines.push(
      `Tables built for this answer (drafts under Cross tabs, All tables): ${tables
        .map((t) => `"${t.label}" from ${t.dataFile}${t.readBack ? "" : " (saved, but its figures could not be read back)"}`)
        .join("; ")}.`,
    );
  }
  if (help.length > 0) {
    lines.push(`Guides read for this answer: ${help.map((h) => `${h.title} (${h.href})`).join("; ")}.`);
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

/**
 * Where the researcher sent the message from, checked at the server boundary: a path in this app and
 * the open section's name. Anything else is dropped, never passed to the model as written.
 */
export type PageContext = { path: string; section: string | null };

export function checkedPageContext(raw: unknown): PageContext | null {
  if (!raw || typeof raw !== "object") return null;
  const { path, section } = raw as { path?: unknown; section?: unknown };
  if (typeof path !== "string" || !/^\/[A-Za-z0-9/_\-.%]{0,200}$/.test(path)) return null;
  const name = typeof section === "string" ? section.replace(/[^\p{L}\p{N} &'(),./-]/gu, "").slice(0, 80).trim() : "";
  return { path, section: name || null };
}

export function pageLine(page: PageContext | null): string {
  if (!page) return "";
  return `The researcher sent this message from ${page.section ? `the ${page.section} section (${page.path})` : page.path}. Questions such as "what does this mean?" are likely about that page.`;
}
