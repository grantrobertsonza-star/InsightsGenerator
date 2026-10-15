import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { tableText } from "./objectiveEvidence";
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
};

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
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system:
      "You read one survey crosstab table and describe, in plain language, what it shows. This is purely descriptive: " +
      "you are not judging the table against any stated claim, hypothesis or objective, and you are not writing a " +
      "finding or an insight for a report. Someone is looking at this table right now and wants a quick, accurate read " +
      "of the pattern in front of them.\n" +
      "- Describe what the numbers show: differences between columns, the biggest or smallest figures, a clear skew, " +
      "a surprising gap. Reference actual percentages or counts from the table.\n" +
      "- Do not claim statistical significance unless the table itself already flags it (a sig letter or test result in " +
      "the data you were given). If the table carries no such flag, describe the pattern without calling it significant.\n" +
      "- No em dashes, ever. Use a comma, a period, or parentheses instead.\n" +
      "- Write one headline: the single clearest pattern, stated plainly. Then one to four short cards, each on a " +
      "distinct pattern worth noting (a notable gap, an outlier row, a base-size caveat, a consistent trend). Keep each " +
      "card to one or two sentences. Do not repeat the headline inside a card.\n" +
      "- If the table is thin, flat, or inconclusive, say so plainly rather than inventing a pattern.",
    tools: [RECORD_INSIGHTS_TOOL],
    tool_choice: { type: "tool", name: "record_insights" },
    messages: [
      {
        role: "user",
        content: `Table:\n${tableText(result)}`,
      },
    ],
  });
  await logApiUsage(tenantId, runId, "crosstab_insights", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (tu?.input ?? {}) as { headline?: string; cards?: { title?: string; stat?: string; body?: string }[] };
  const headline = String(input.headline ?? "No clear pattern emerged from this table.");
  const cards: CrosstabInsightCard[] = Array.isArray(input.cards)
    ? input.cards
        .filter((c) => c && c.title && c.body)
        .slice(0, 4)
        .map((c) => ({ title: String(c!.title), stat: c!.stat ? String(c!.stat) : undefined, body: String(c!.body) }))
    : [];
  return { headline, cards };
}
