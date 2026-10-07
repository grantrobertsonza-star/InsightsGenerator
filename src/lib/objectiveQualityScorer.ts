import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { parseNumberedItems } from "./text";
import {
  OBJECTIVE_MAX,
  objectiveRating,
  objectiveScoresCurrent,
  parseObjectiveScores,
} from "./qualityRubrics";

// A research objective list is a handful of lines, so one call covers a run.
const MAX_ITEMS = 20;
const MAX_VARIABLES_LISTED = 60;

type RunContext = {
  research_objective: string | null;
  decision_statement: string | null;
  business_problem: string | null;
};

/**
 * What the project actually holds, in a form a scorer can judge "can this be
 * answered with what we have" against: the documents, how many findings came
 * from each kind of source, and the variable names in any imported tables.
 * It lists what exists and nothing about what it says, so the judgement is
 * about coverage, not about results.
 */
async function evidenceInventory(
  tenantId: string,
  runId: string,
): Promise<string> {
  return withTenant(tenantId, async (client) => {
    const docs = await client.query<{ kind: string; source_filename: string }>(
      "select kind, source_filename from documents where run_id = $1 order by uploaded_at",
      [runId],
    );
    const origins = await client.query<{
      origin: string;
      data_type: string | null;
      n: number;
    }>(
      `select origin, data_type, count(*)::int as n from findings
       where run_id = $1 and status <> 'rejected' group by origin, data_type`,
      [runId],
    );
    const tables = await client.query<{ headers: string[] }>(
      "select headers from document_tables where run_id = $1",
      [runId],
    );
    const variables = [
      ...new Set(
        tables.rows
          .flatMap((t) => (Array.isArray(t.headers) ? t.headers : []))
          .filter((h) => typeof h === "string" && h.trim()),
      ),
    ].slice(0, MAX_VARIABLES_LISTED);
    const lines: string[] = [];
    lines.push(
      docs.rows.length === 0
        ? "Documents: none uploaded."
        : `Documents: ${docs.rows.map((d) => `${d.source_filename} (${d.kind})`).join("; ")}.`,
    );
    lines.push(
      origins.rows.length === 0
        ? "Findings so far: none."
        : `Findings so far: ${origins.rows
            .map(
              (o) =>
                `${o.n} ${o.origin}${o.data_type ? ` (${o.data_type})` : ""}`,
            )
            .join(", ")}.`,
    );
    lines.push(
      variables.length === 0
        ? "Survey or table variables: none imported."
        : `Survey or table variables: ${variables.join(", ")}.`,
    );
    return lines.join("\n");
  });
}

const SYSTEM =
  "You judge research objectives the way a careful research director would before fieldwork is signed " +
  "off. Score each objective on four dimensions, each worth 1, 3 or 5 points. Score strictly: a " +
  "plausible-sounding objective is not a good one.\n\n" +
  "1. Specific: 1 = a topic or a wish ('understand customers'); 3 = names a subject and a population but " +
  "leaves its scope or key terms open to interpretation; 5 = names who, which behaviour or attitude, and " +
  "in what context, so two researchers would read it the same way.\n" +
  "2. Measurable: 1 = no observation could tell you whether it had been answered; 3 = it could be " +
  "measured, but the measure or what would count as an answer is not implied; 5 = it implies a clear " +
  "measure or comparison and what result would answer it.\n" +
  "3. Answerable with the data supplied: judge only against the inventory of what the project holds. " +
  "1 = nothing listed could speak to it; 3 = the listed data covers part of it or only indirectly; " +
  "5 = the listed documents, findings or variables plainly contain what is needed. Do not assume data " +
  "that is not listed. If the inventory is empty, score 3 and say that nothing has been uploaded yet.\n" +
  "4. Relevant to the decision: judge against the decision statement, or the business problem if there " +
  "is no decision. 1 = no clear link; 3 = related, but its answer would not change the choice; " +
  "5 = its answer would directly inform or change the decision. If neither is given, score 3 and say so.\n\n" +
  "For each objective also give a one-sentence rationale naming the single biggest reason for its " +
  "weakest score, and a one-sentence suggestion for how to reword or reshape the objective to fix it " +
  "(leave the suggestion empty if every dimension scored 5). Cover every objective by its index.";

const TOOLS = [
  {
    name: "record_scores",
    description:
      "Records the four dimension scores for each objective by its index.",
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
                description: "The objective's index in the numbered list.",
              },
              specific_score: { type: "integer", enum: [1, 3, 5] },
              measurable_score: { type: "integer", enum: [1, 3, 5] },
              answerable_score: { type: "integer", enum: [1, 3, 5] },
              relevant_score: { type: "integer", enum: [1, 3, 5] },
              rationale: { type: "string" },
              suggestion: { type: "string" },
            },
            required: [
              "index",
              "specific_score",
              "measurable_score",
              "answerable_score",
              "relevant_score",
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
 * Scores each numbered item of the run's research objective. Scores are keyed
 * by the item's text, so an unchanged objective list is left alone (no model
 * call) unless `force` is set, and an edited one is scored again. The data
 * inventory is read at scoring time, so "answerable" reflects what had been
 * uploaded then; rescoring after more data arrives is what `force` is for.
 */
export async function scoreObjectiveQuality(
  tenantId: string,
  runId: string,
  options: { force?: boolean } = {},
): Promise<{ scored: number; skipped: boolean }> {
  const context = await withTenant(tenantId, async (client) => {
    const r = await client.query<RunContext>(
      "select research_objective, decision_statement, business_problem from runs where id = $1",
      [runId],
    );
    return r.rows[0] ?? null;
  });
  if (!context) return { scored: 0, skipped: true };
  const items = parseNumberedItems(context.research_objective).slice(
    0,
    MAX_ITEMS,
  );
  if (items.length === 0) return { scored: 0, skipped: true };

  if (!options.force) {
    const stored = await withTenant(tenantId, async (client) => {
      const r = await client.query<{ item_order: number; item_text: string }>(
        "select item_order, item_text from objective_quality where run_id = $1",
        [runId],
      );
      return r.rows;
    });
    if (objectiveScoresCurrent(items, stored))
      return { scored: 0, skipped: true };
  }

  const inventory = await evidenceInventory(tenantId, runId);
  const user =
    `Business problem: ${context.business_problem?.trim() || "(not given)"}\n` +
    `Decision statement: ${context.decision_statement?.trim() || "(not given)"}\n\n` +
    `What the project holds:\n${inventory}\n\n` +
    `Objectives:\n${items.map((t, i) => `${i}. ${t}`).join("\n")}`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tool_choice: { type: "tool", name: "record_scores" },
    tools: TOOLS,
    messages: [{ role: "user", content: user }],
  });
  await logApiUsage(
    tenantId,
    runId,
    "objective_quality_scorer",
    response.usage,
  );
  const toolUse = response.content.find((b) => b.type === "tool_use");
  const scores = parseObjectiveScores(
    toolUse && toolUse.type === "tool_use"
      ? (toolUse.input as { scores?: unknown }).scores
      : undefined,
    items.length,
  );
  if (scores.length === 0)
    throw new Error(
      `The scorer returned nothing usable (stop reason: ${response.stop_reason ?? "unknown"}).`,
    );

  await withTenant(tenantId, async (client) => {
    await client.query("delete from objective_quality where run_id = $1", [
      runId,
    ]);
    for (const s of scores) {
      const total = s.specific + s.measurable + s.answerable + s.relevant;
      await client.query(
        `insert into objective_quality
           (tenant_id, run_id, item_order, item_text, specific_score, measurable_score, answerable_score,
            relevant_score, quality_score, quality_tier, rationale, suggestion)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tenantId,
          runId,
          s.index,
          items[s.index],
          s.specific,
          s.measurable,
          s.answerable,
          s.relevant,
          total,
          objectiveRating(total),
          s.rationale,
          s.suggestion,
        ],
      );
    }
  });
  return { scored: scores.length, skipped: false };
}

export { OBJECTIVE_MAX };

/**
 * Safe wrapper for automatic trigger points: a failure is logged to trace and
 * swallowed, same pattern as refreshSynthesizedInsightQuality, so scoring
 * never blocks the step the researcher actually clicked. Also swallows the
 * "table does not exist" case before migration 0045 is applied.
 */
export async function refreshObjectiveQuality(
  tenantId: string,
  runId: string,
): Promise<void> {
  try {
    await scoreObjectiveQuality(tenantId, runId);
  } catch (error) {
    try {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_quality_error', $3)`,
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
