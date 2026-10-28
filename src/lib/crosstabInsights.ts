import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import type { CrosstabResult } from "./parseStatsFile";

/**
 * A plain, descriptive read of a crosstab table: what the numbers in this
 * one table show, nothing more. This is not a judgement against a claim,
 * hypothesis or objective (that is objectiveEvidence.ts's job), and it is
 * never persisted or fed into findings or insights. It exists purely so a
 * person looking at a table gets a quick interpretive pass alongside it,
 * similar in spirit to the headline-plus-cards pattern some tracker
 * dashboards use, regenerated fresh each time it is requested.
 */

export type CrosstabInsightCard = {
  title: string;
  stat?: string;
  body: string;
};

export type CrosstabInsights = {
  headline: string;
  cards: CrosstabInsightCard[];
  /** How much of the table the model was given, when not all of it fitted (insightTableText). */
  partial?: { questionsShown: number; questionsTotal: number } | null;
};

// What the reading may send: about 30,000 characters (some 8,000 tokens) of table, a few cents a read.
const MAX_TABLE_CHARS = 30_000;

/**
 * The table as the model reads it (Grant, 2026-10-22: a 40-question starter table came back as "No
 * clear pattern"): every question in full, in order, with its bases, its means, and the table's own
 * test results, until the size limit; never cut mid-question. Before, the shared tableText gave
 * percentages only (no test flags, so a reading could not tell a tested difference from noise) and
 * cut the text at 9,000 characters, which on a large table dropped most questions silently.
 * A cell the engine flagged as differing from the rest of its banner variable carries "(higher)" or
 * "(lower)"; the correction applied is stated once at the top.
 *
 * Batch 47 (Grant, 27 October 2026: "No clear pattern" on a table with a clear overall difference): each
 * question also carries its whole-table test against every banner variable (chi-square p and Cramer's V,
 * with its 95% verdict) and, for a coded single choice question, the average and spread of its answer
 * codes. Cell flags alone miss a difference spread thinly across several answers, which the whole-table
 * test still finds.
 */
export function insightTableText(result: CrosstabResult): { text: string; questionsShown: number; questionsTotal: number } {
  const cols = result.columns.map((c) => c.name);
  const correction = result.provenance?.correction;
  const header = [
    `Columns: ${cols.join(" | ")} | Total`,
    `Weight: ${result.provenance?.weightVar ?? "none"}. Tests: a cell marked (higher) or (lower) differs from the other columns of its banner variable at 95%${correction === "fdr" ? ", after a false discovery rate correction" : correction === "bonferroni" ? ", after a Bonferroni correction" : ", uncorrected"}. Unmarked cells were not found to differ. Figures are column percentages unless the row is a mean.`,
  ];
  const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "-" : String(Math.round(x * 10) / 10));
  const fmtP = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));
  const blocks: string[] = [];
  for (const q of result.questions) {
    const lines = [`Question: ${q.label}`];
    for (const r of q.rows) {
      if (r.isBase) {
        lines.push(`  ${r.label}: ${[...r.count, r.total.count].map(fmt).join(" | ")}`);
        continue;
      }
      const cells = r.pct.map((x, j) => `${fmt(x)}${r.sig?.[j] > 0 ? " (higher)" : r.sig?.[j] < 0 ? " (lower)" : ""}`);
      const spread = r.desc?.sd != null ? ` (standard deviation ${fmt(r.desc.sd)})` : "";
      lines.push(`  ${r.isMean ? `${r.label} [mean]` : r.label}: ${[...cells, fmt(r.total.pct)].join(" | ")}${spread}`);
    }
    for (const t of q.tableTests ?? []) {
      const verdict = t.p < 0.05 ? "the answers differ across these columns at 95%" : "no difference across these columns at 95%";
      lines.push(`  Whole-table test by ${t.label}: chi-square p=${fmtP(t.p)}${t.cramersV != null ? `, Cramer's V=${t.cramersV.toFixed(2)}` : ""} (${verdict})`);
    }
    if (q.desc && q.desc.mean != null) {
      lines.push(`  Average answer code, all respondents: mean ${fmt(q.desc.mean)}${q.desc.sd != null ? `, standard deviation ${fmt(q.desc.sd)}` : ""}, n=${q.desc.n}`);
    }
    blocks.push(lines.join("\n"));
  }
  let text = header.join("\n");
  let shown = 0;
  for (const b of blocks) {
    if (text.length + b.length + 1 > MAX_TABLE_CHARS) break;
    text += "\n" + b;
    shown++;
  }
  return { text, questionsShown: shown, questionsTotal: blocks.length };
}

const RECORD_INSIGHTS_TOOL: Anthropic.Tool = {
  name: "record_insights",
  description: "Record a plain-language reading of what a crosstab table shows.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "One bold, specific sentence naming the clearest pattern in the table. Plain language, no hedging filler.",
      },
      cards: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "A few words naming what this card is about." },
            stat: { type: "string", description: "Optional short figure that anchors the card, e.g. a percentage or gap." },
            body: { type: "string", description: "One or two plain sentences describing the pattern. Descriptive only." },
          },
          required: ["title", "body"],
        },
      },
    },
    required: ["headline", "cards"],
  },
};

export async function summarizeCrosstabTable(
  tenantId: string,
  runId: string,
  result: CrosstabResult,
): Promise<CrosstabInsights> {
  const table = insightTableText(result);
  if (table.questionsShown === 0) throw new Error("This table is too large to read in one go. Build a smaller table and read that.");
  const partial = table.questionsShown < table.questionsTotal ? { questionsShown: table.questionsShown, questionsTotal: table.questionsTotal } : null;
  const content = `Table${partial ? ` (the first ${partial.questionsShown} of its ${partial.questionsTotal} questions; the rest did not fit)` : ""}:\n${table.text}`;
  // Batch 49 (Grant, 27 October 2026: a 20-question starter table read as "came back empty" again): one
  // failed reading is retried once, with more room for the answer, before the researcher sees an error,
  // and the error says what came back, so the cause is visible instead of only "empty".
  const first = await readOnce(tenantId, runId, content, 1500);
  if (first.ok) return { ...first.reading, partial };
  const second = await readOnce(tenantId, runId, content, 3000);
  if (second.ok) return { ...second.reading, partial };
  throw new Error(
    `The AI reading failed twice: ${second.reason} (first try: ${first.reason}). It was sent ${table.questionsShown} of the table's ` +
      `${table.questionsTotal} questions, ${table.text.length.toLocaleString("en-US")} characters. Try again, or read a smaller table.`,
  );
}

const READING_SYSTEM =
      "You read one survey crosstab table and describe, in plain language, what it shows. This is purely descriptive: " +
      "you are not judging the table against any stated claim, hypothesis or objective, and you are not writing a " +
      "finding or an insight for a report. Someone is looking at this table right now and wants a quick, accurate read " +
      "of the pattern in front of them.\n" +
      "- Describe what the numbers show: differences between columns, the biggest or smallest figures, a clear skew, " +
      "a surprising gap. Reference actual percentages or counts from the table.\n" +
      "- Cells marked (higher) or (lower) passed the table's own significance test; lead with those. Call a difference " +
      "significant only when it is marked. Unmarked gaps may be noise: describe them as such, or not at all.\n" +
      "- A 'Whole-table test' line says whether a question's answers differ across a banner variable as a whole. A " +
      "question can differ overall even when no single cell is marked; say so when it does, and name where the gap is " +
      "largest without calling that one cell significant.\n" +
      "- An 'Average answer code' line gives the mean and spread of a coded question; use it to describe where answers sit.\n" +
      "- A table with many questions: name the few clearest patterns across it, not one question at a time.\n" +
      "- No em dashes, ever. Use a comma, a period, or parentheses instead.\n" +
      "- Write one headline: the single clearest pattern, stated plainly. Then one to four short cards, each on a " +
      "distinct pattern worth noting (a notable gap, an outlier row, a base-size caveat, a consistent trend). Keep each " +
      "card to one or two sentences. Do not repeat the headline inside a card.\n" +
      "- If nothing is marked and the gaps are small, say plainly that the groups answer much alike, and use the cards " +
      "for the levels worth knowing (the highest and lowest figures), rather than inventing a difference.";

/**
 * The reading inside a tool answer. Grant, 27 October 2026: on a 40-question table the model wrote 962
 * tokens back and the app still said "came back empty", because the reading was not exactly where the
 * tool's schema puts it. Accepted, deliberately and only these: the answer itself, the answer sent as
 * JSON text, or the answer wrapped once or twice in a single field (`{"reading": {...}}`,
 * `{"input": "{...}"}`). Anything else is no reading, and its shape is reported.
 */
function readingIn(raw: unknown, depth = 0): { headline?: unknown; cards?: unknown } | null {
  if (depth > 2 || raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return readingIn(JSON.parse(raw), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.headline === "string") return o;
  const keys = Object.keys(o);
  return keys.length === 1 ? readingIn(o[keys[0]], depth + 1) : null;
}

/** The fields of an answer and their types, for an error or the trace: never their content. */
function shapeOf(raw: unknown): string {
  if (raw === null || raw === undefined) return "nothing returned";
  if (typeof raw !== "object" || Array.isArray(raw)) return `returned a ${Array.isArray(raw) ? "list" : typeof raw}`;
  const fields = Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k} (${Array.isArray(v) ? "list" : v === null ? "empty" : typeof v})`);
  return fields.length ? `fields returned: ${fields.join(", ")}` : "fields returned: none";
}

async function traceReadingFailure(tenantId: string, runId: string, reason: string): Promise<void> {
  try {
    await withTenant(tenantId, (client) =>
      client.query("insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'crosstab_insights_failed', $3)", [tenantId, runId, JSON.stringify({ reason })]),
    );
  } catch {
    // The trace is a diagnostic aid; failing to write it must not hide the reading's own error.
  }
}

type ReadingAttempt = { ok: true; reading: { headline: string; cards: CrosstabInsightCard[] } } | { ok: false; reason: string };

/**
 * One request for a reading. An empty or cut-off answer is a failed reading, never "no pattern" (that
 * used to be the fallback, so a failure looked like a finding about the table). A cut-off answer is
 * refused even when it has a headline: the model stopped for length, so the cards it meant to write may
 * be missing (Codex B4-F01). A reading with a headline and no cards gave the person nothing to check the
 * headline against (batch 47), so it is refused too. Each refusal names what came back.
 */
async function readOnce(tenantId: string, runId: string, content: string, maxTokens: number): Promise<ReadingAttempt> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: READING_SYSTEM,
    tools: [RECORD_INSIGHTS_TOOL],
    tool_choice: { type: "tool", name: "record_insights" },
    messages: [{ role: "user", content }],
  });
  await logApiUsage(tenantId, runId, "crosstab_insights", response.usage);
  if (response.stop_reason === "max_tokens") return { ok: false, reason: `the answer was cut off at ${maxTokens} tokens` };
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!tu) return { ok: false, reason: `no reading was returned (stop: ${response.stop_reason ?? "unknown"}; returned: ${response.content.map((b) => b.type).join(", ") || "nothing"})` };
  const input = readingIn(tu.input);
  const headline = input && typeof input.headline === "string" ? input.headline.trim() : "";
  if (!input || !headline) {
    const reason = `the reading had no headline (${shapeOf(tu.input)})`;
    // What came back, by field name and type only (never the text), so a failure can be diagnosed later.
    await traceReadingFailure(tenantId, runId, reason);
    return { ok: false, reason };
  }
  // A list sent as JSON text is read as the list it is (some answers arrive that way); anything else is no cards.
  let rawCards: unknown = input.cards;
  if (typeof rawCards === "string") {
    try {
      rawCards = JSON.parse(rawCards);
    } catch {
      rawCards = null;
    }
  }
  const cards: CrosstabInsightCard[] = Array.isArray(rawCards)
    ? (rawCards as { title?: unknown; stat?: unknown; body?: unknown }[])
        .filter((c) => c && typeof c.title === "string" && c.title && typeof c.body === "string" && c.body)
        .slice(0, 4)
        .map((c) => ({ title: String(c.title), stat: c.stat ? String(c.stat) : undefined, body: String(c.body) }))
    : [];
  if (cards.length === 0) return { ok: false, reason: "the reading came back without any patterns described" };
  return { ok: true, reading: { headline, cards } };
}
