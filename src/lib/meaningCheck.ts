import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { mapWithConcurrency } from "./concurrency";
import { withTenant } from "./db";
import { matchQuote } from "./qualCoding";

// Code saturation says no new labels appeared. Meaning saturation asks whether
// later respondents still added something new within a theme. The model reads
// the earlier and later turns for a theme and names any distinct dimension the
// later ones add, with a word for word excerpt that is checked against the
// turn. It is a prompt for the researcher to read, not a verdict.

export type MeaningDimension = {
  description: string;
  quote: string;
  speaker: string | null;
  turn: number;
};

export type MeaningCheck = {
  verdict: "new_meaning" | "no_new_meaning" | "too_few_turns";
  earlyTurns: number;
  lateTurns: number;
  dimensions: MeaningDimension[];
};

const MIN_RESPONDENTS = 6;
const MIN_EARLY_TURNS = 3;
const MAX_TURNS_PER_SIDE = 30;
const MAX_TURN_CHARS = 700;

const SYSTEM =
  "You are checking a qualitative theme for meaning saturation. You are given the theme, " +
  "turns from EARLIER respondents, and turns from LATER respondents. Decide whether any later turn adds " +
  "a distinct dimension to the theme that none of the earlier turns express: a new reason, condition, " +
  "consequence, group of people or context. Repeating the same point in different words is not new. " +
  "Report each new dimension with the later turn it came from and a short excerpt copied exactly, word for word, " +
  "from that turn. If the later turns only repeat what the earlier ones say, return an empty list. " +
  "Be conservative: do not invent a dimension.";

const TOOLS = [
  {
    name: "record_meaning_check",
    description: "Records new dimensions the later turns add to a theme.",
    input_schema: {
      type: "object" as const,
      properties: {
        dimensions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              turn: {
                type: "string",
                description: "The later turn label as shown, for example L3.",
              },
              description: {
                type: "string",
                description: "The new dimension in one sentence.",
              },
              quote: {
                type: "string",
                description: "An excerpt copied exactly from that later turn.",
              },
            },
            required: ["turn", "description", "quote"],
          },
        },
      },
      required: ["dimensions"],
    },
  },
];

type Turn = {
  id: string;
  index: number;
  speaker: string | null;
  text: string;
};

export async function checkMeaningSaturation(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
): Promise<{ checked: number; newMeaning: number; failed: number }> {
  const loaded = await withTenant(tenantId, async (client) => {
    const codes = (
      await client.query<{
        id: string;
        name: string;
        definition: string;
      }>(
        `select id, name, definition from coding_codes
         where codebook_id = $1 order by position`,
        [codebookId],
      )
    ).rows;
    const segs = (
      await client.query<{
        id: string;
        segment_index: number;
        speaker: string | null;
        role: string;
        text: string;
      }>(
        `select id, segment_index, speaker, role, text from coding_segments
         where document_id = $1 order by segment_index`,
        [documentId],
      )
    ).rows;
    const assigns = (
      await client.query<{ segment_id: string; code_id: string }>(
        `select a.segment_id, a.code_id from coding_assignments a
         join coding_codes c on c.id = a.code_id where c.codebook_id = $1`,
        [codebookId],
      )
    ).rows;
    return { codes, segs, assigns };
  });
  if (loaded.codes.length === 0)
    throw new Error("This transcript has no codebook yet.");

  const order: string[] = [];
  for (const s of loaded.segs) {
    if (s.role === "moderator" || !s.speaker) continue;
    if (!order.includes(s.speaker)) order.push(s.speaker);
  }
  if (order.length < MIN_RESPONDENTS)
    throw new Error(
      `Needs at least ${MIN_RESPONDENTS} labelled respondents to compare earlier and later ones. This transcript has ${order.length}.`,
    );
  const lateFrom = Math.floor((order.length * 2) / 3);
  const lateSpeakers = new Set(order.slice(lateFrom));
  const codedBy = new Map<string, Set<string>>();
  for (const a of loaded.assigns) {
    const set = codedBy.get(a.code_id) ?? new Set<string>();
    set.add(a.segment_id);
    codedBy.set(a.code_id, set);
  }

  type Row = {
    codeId: string;
    check: MeaningCheck;
  };
  const results = await mapWithConcurrency(
    loaded.codes,
    3,
    async (code): Promise<Row | null> => {
      const ids = codedBy.get(code.id) ?? new Set<string>();
      const turns: Turn[] = loaded.segs
        .filter((s) => ids.has(s.id) && s.role !== "moderator")
        .map((s) => ({
          id: s.id,
          index: s.segment_index,
          speaker: s.speaker,
          text: s.text,
        }));
      const early = turns.filter((t) => !lateSpeakers.has(t.speaker ?? ""));
      const late = turns.filter((t) => lateSpeakers.has(t.speaker ?? ""));
      if (early.length < MIN_EARLY_TURNS || late.length === 0) {
        return {
          codeId: code.id,
          check: {
            verdict: "too_few_turns",
            earlyTurns: early.length,
            lateTurns: late.length,
            dimensions: [],
          },
        };
      }
      const clip = (t: string) =>
        t.length > MAX_TURN_CHARS ? `${t.slice(0, MAX_TURN_CHARS)}...` : t;
      const earlyUse = early.slice(0, MAX_TURNS_PER_SIDE);
      const lateUse = late.slice(0, MAX_TURNS_PER_SIDE);
      const user =
        `Theme: ${code.name}\nDefinition: ${code.definition}\n\n` +
        `EARLIER turns:\n${earlyUse.map((t, i) => `E${i + 1}. ${clip(t.text)}`).join("\n")}\n\n` +
        `LATER turns:\n${lateUse.map((t, i) => `L${i + 1}. ${clip(t.text)}`).join("\n")}`;
      try {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2000,
          system: SYSTEM,
          tool_choice: { type: "tool", name: "record_meaning_check" },
          tools: TOOLS,
          messages: [{ role: "user", content: user }],
        });
        await logApiUsage(
          tenantId,
          runId,
          "coding_meaning_check",
          response.usage,
        );
        const toolUse = response.content.find((b) => b.type === "tool_use");
        if (
          !toolUse ||
          toolUse.type !== "tool_use" ||
          response.stop_reason === "max_tokens"
        )
          return null;
        let raw: unknown = (toolUse.input as { dimensions?: unknown })
          .dimensions;
        if (typeof raw === "string") {
          try {
            raw = JSON.parse(raw);
          } catch {
            raw = [];
          }
        }
        const dims: MeaningDimension[] = [];
        for (const d of Array.isArray(raw) ? raw : []) {
          const turnLabel = String((d as { turn?: unknown }).turn ?? "");
          const m = /^L(\d+)$/i.exec(turnLabel.trim());
          const source = m ? lateUse[Number(m[1]) - 1] : undefined;
          const quote = String((d as { quote?: unknown }).quote ?? "").trim();
          const description = String(
            (d as { description?: unknown }).description ?? "",
          ).trim();
          if (!source || !quote || !description) continue;
          // Keep a dimension only if its excerpt is word for word in that turn.
          const match = matchQuote(quote, [
            {
              index: source.index,
              speaker: source.speaker,
              role: "participant",
              text: source.text,
            },
          ]);
          if (match.match !== "exact") continue;
          dims.push({
            description,
            quote,
            speaker: source.speaker,
            turn: source.index + 1,
          });
        }
        return {
          codeId: code.id,
          check: {
            verdict: dims.length > 0 ? "new_meaning" : "no_new_meaning",
            earlyTurns: early.length,
            lateTurns: late.length,
            dimensions: dims.slice(0, 4),
          },
        };
      } catch {
        return null;
      }
    },
  );

  const ok = results.filter((r): r is Row => r !== null);
  const failed = results.length - ok.length;
  if (ok.length === 0)
    throw new Error("The check failed for every theme. Nothing was changed.");
  await withTenant(tenantId, async (client) => {
    for (const r of ok) {
      await client.query(
        `insert into coding_meaning_checks
           (code_id, tenant_id, run_id, document_id, verdict, early_turns, late_turns, dimensions)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         on conflict (code_id) do update set
           verdict = excluded.verdict, early_turns = excluded.early_turns,
           late_turns = excluded.late_turns, dimensions = excluded.dimensions,
           created_at = now()`,
        [
          r.codeId,
          tenantId,
          runId,
          documentId,
          r.check.verdict,
          r.check.earlyTurns,
          r.check.lateTurns,
          JSON.stringify(r.check.dimensions),
        ],
      );
    }
  });
  return {
    checked: ok.length,
    newMeaning: ok.filter((r) => r.check.verdict === "new_meaning").length,
    failed,
  };
}

export async function loadMeaningChecks(
  tenantId: string,
  documentId: string,
): Promise<Map<string, MeaningCheck>> {
  const out = new Map<string, MeaningCheck>();
  try {
    await withTenant(tenantId, async (client) => {
      const r = await client.query<{
        code_id: string;
        verdict: MeaningCheck["verdict"];
        early_turns: number;
        late_turns: number;
        dimensions: MeaningDimension[];
      }>(
        `select code_id, verdict, early_turns, late_turns, dimensions
         from coding_meaning_checks where document_id = $1`,
        [documentId],
      );
      for (const row of r.rows)
        out.set(row.code_id, {
          verdict: row.verdict,
          earlyTurns: row.early_turns,
          lateTurns: row.late_turns,
          dimensions: row.dimensions ?? [],
        });
    });
  } catch {
    // migration 0049 not applied
  }
  return out;
}
