import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { finishedToolInput } from "./modelToolResult";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { parseNumberedItems } from "./text";
import { objectiveIdentityKey } from "./objectiveLines";
import { OBJECTIVE_QUALITY_PASS_EVENT, type UnscoredRecord } from "./objectiveQualityStatus";
import {
  OBJECTIVE_MAX,
  objectiveRating,
  objectiveScoresCurrent,
  parseObjectiveScores,
  type ObjectiveScore,
} from "./qualityRubrics";

// Objectives are sent to the scorer in batches of BATCH_SIZE (Grant, 2026-10-21: score everything
// automatically). MAX_ITEMS_SCORED is the one hard bound left: at most 10 model calls in one pass.
// Anything past it is reported through `truncated` (scoreObjectivesAction says so), never dropped
// silently.
const BATCH_SIZE = 20;
const MAX_ITEMS_SCORED = 200;
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
 * Scores the accepted objectives (runs.research_objective, kept in sync with the accepted candidates)
 * on four dimensions. Scores are kept per objective, keyed by objectiveIdentityKey, so a pass scores
 * only what has no score yet: a new or reworded objective, or one a previous pass could not score.
 * An unchanged list makes no model call. `force` rescores everything (after more data arrives, for
 * "answerable"). Objectives are sent in batches of BATCH_SIZE; a batch that fails, or a reply that
 * leaves an objective out, leaves those objectives unscored with the reason recorded in an
 * OBJECTIVE_QUALITY_PASS_EVENT trace row, and the scores that did come back are kept.
 *
 * Writes happen under the run row's lock, against the objective list as it is at write time, so an
 * objective removed while the model was answering gets no row. Throws only when every batch failed,
 * after recording why, so the Rescore button can show the error.
 */
export async function scoreObjectiveQuality(
  tenantId: string,
  runId: string,
  options: { force?: boolean } = {},
): Promise<{ scored: number; kept: number; unscored: number; skipped: boolean; truncated: boolean }> {
  const context = await withTenant(tenantId, async (client) => {
    const r = await client.query<RunContext>(
      "select research_objective, decision_statement, business_problem from runs where id = $1",
      [runId],
    );
    return r.rows[0] ?? null;
  });
  const none = { scored: 0, kept: 0, unscored: 0, skipped: true, truncated: false };
  if (!context) return none;
  const allItems = parseNumberedItems(context.research_objective);
  const truncated = allItems.length > MAX_ITEMS_SCORED;
  const items = allItems.slice(0, MAX_ITEMS_SCORED);
  if (items.length === 0) return { ...none, truncated };

  const stored = await withTenant(tenantId, async (client) => {
    const r = await client.query<StoredScoreRow>(
      `select item_order, item_text, specific_score, measurable_score, answerable_score, relevant_score,
              rationale, suggestion
       from objective_quality where run_id = $1 order by item_order`,
      [runId],
    );
    return r.rows;
  });
  const storedByKey = new Map<string, StoredScoreRow>();
  for (const row of stored) {
    const key = objectiveIdentityKey(row.item_text);
    if (!storedByKey.has(key)) storedByKey.set(key, row);
  }

  // One request per distinct objective: two lines that are the same objective share a score.
  const pending = new Map<string, string>();
  for (const text of items) {
    const key = objectiveIdentityKey(text);
    if (key && !pending.has(key) && (options.force || !storedByKey.has(key))) pending.set(key, text);
  }

  if (pending.size === 0) {
    if (objectiveScoresCurrent(items, stored)) return { ...none, truncated, kept: stored.length };
    // Same objectives, new order or spelling: rewrite the rows to match, no model call.
    const kept = await writeScores(tenantId, runId, new Map());
    return { scored: 0, kept, unscored: 0, skipped: false, truncated };
  }

  const inventory = await evidenceInventory(tenantId, runId);
  const queue = [...pending.entries()];
  const batches: [string, string][][] = [];
  for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));

  const fresh = new Map<string, Omit<ObjectiveScore, "index">>();
  const unscored: UnscoredRecord[] = [];
  let failedBatches = 0;
  let firstFailure = "";
  for (const batch of batches) {
    try {
      const user =
        `Business problem: ${context.business_problem?.trim() || "(not given)"}\n` +
        `Decision statement: ${context.decision_statement?.trim() || "(not given)"}\n\n` +
        `What the project holds:\n${inventory}\n\n` +
        `Objectives:\n${batch.map(([, t], i) => `${i}. ${t}`).join("\n")}`;
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tool_choice: { type: "tool", name: "record_scores" },
        tools: TOOLS,
        messages: [{ role: "user", content: user }],
      });
      await logApiUsage(tenantId, runId, "objective_quality_scorer", response.usage);
      // EC10K-F02: only a finished record_scores call is used; an unfinished one throws into the catch below.
      const scores = parseObjectiveScores(finishedToolInput(response, "record_scores", "The objective quality scoring").scores, batch.length);
      if (scores.length === 0)
        throw new Error(`The scorer returned nothing usable (stop reason: ${response.stop_reason ?? "unknown"}).`);
      for (const sc of scores) fresh.set(batch[sc.index][0], sc);
      for (const [key] of batch) if (!fresh.has(key)) unscored.push({ key, reason: "no_score" });
    } catch (error) {
      failedBatches += 1;
      const message = error instanceof Error ? error.message : String(error);
      firstFailure ||= message;
      for (const [key] of batch) unscored.push({ key, reason: "failed", message: message.slice(0, 300) });
    }
  }

  const kept = await writeScores(tenantId, runId, fresh, { force: options.force === true, unscored });
  if (failedBatches === batches.length) throw new Error(firstFailure);
  return { scored: fresh.size, kept, unscored: unscored.length, skipped: false, truncated };
}

type StoredScoreRow = {
  item_order: number;
  item_text: string;
  specific_score: number;
  measurable_score: number;
  answerable_score: number;
  relevant_score: number;
  rationale: string;
  suggestion: string;
};

/**
 * Rewrites the run's objective_quality rows for the objective list as it is now: a fresh score where
 * one came back, otherwise the stored score for the same objective (by objectiveIdentityKey). With
 * `unscored`, records the pass in the same transaction. The run row is locked and must exist.
 * Returns how many rows kept an earlier score.
 */
async function writeScores(
  tenantId: string,
  runId: string,
  fresh: Map<string, Omit<ObjectiveScore, "index">>,
  pass?: { force: boolean; unscored: UnscoredRecord[] },
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const run = await client.query<{ research_objective: string | null }>(
      "select research_objective from runs where id = $1 for update",
      [runId],
    );
    if (run.rowCount !== 1) throw new Error("This project was not found.");
    const current = parseNumberedItems(run.rows[0].research_objective).slice(0, MAX_ITEMS_SCORED);
    const old = await client.query<StoredScoreRow>(
      `select item_order, item_text, specific_score, measurable_score, answerable_score, relevant_score,
              rationale, suggestion
       from objective_quality where run_id = $1`,
      [runId],
    );
    const oldByKey = new Map<string, StoredScoreRow>();
    for (const row of old.rows) {
      const key = objectiveIdentityKey(row.item_text);
      if (!oldByKey.has(key)) oldByKey.set(key, row);
    }
    await client.query("delete from objective_quality where run_id = $1", [runId]);
    let keptCount = 0;
    for (let i = 0; i < current.length; i++) {
      const key = objectiveIdentityKey(current[i]);
      const f = fresh.get(key);
      const o = oldByKey.get(key);
      const score = f
        ? { specific: f.specific, measurable: f.measurable, answerable: f.answerable, relevant: f.relevant, rationale: f.rationale, suggestion: f.suggestion }
        : o
          ? { specific: o.specific_score, measurable: o.measurable_score, answerable: o.answerable_score, relevant: o.relevant_score, rationale: o.rationale, suggestion: o.suggestion }
          : null;
      if (!score) continue;
      if (!f) keptCount += 1;
      const total = score.specific + score.measurable + score.answerable + score.relevant;
      await client.query(
        `insert into objective_quality
           (tenant_id, run_id, item_order, item_text, specific_score, measurable_score, answerable_score,
            relevant_score, quality_score, quality_tier, rationale, suggestion)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [tenantId, runId, i, current[i], score.specific, score.measurable, score.answerable, score.relevant, total, objectiveRating(total), score.rationale, score.suggestion],
      );
    }
    if (pass) {
      // An objective that kept an earlier score (a forced rescore it did not come back for) is not
      // reported as unscored.
      const stillUnscored = pass.unscored.filter((u) => !fresh.has(u.key) && !oldByKey.has(u.key));
      await client.query(
        "insert into trace (tenant_id, run_id, event, detail) values ($1, $2, $3, $4)",
        [tenantId, runId, OBJECTIVE_QUALITY_PASS_EVENT, JSON.stringify({ scored: fresh.size, force: pass.force, unscored: stillUnscored })],
      );
    }
    return keptCount;
  });
}

export { OBJECTIVE_MAX };

/**
 * Safe wrapper for automatic trigger points (the Review actions, and Set objectives saves: Grant,
 * 2026-10-21): a failure is logged to trace and swallowed, same pattern as
 * refreshSynthesizedInsightQuality, so scoring never blocks the step the researcher actually
 * clicked, and an unchanged list makes no model call. Call it after the save's transaction has
 * committed, since it reads the saved list. Also swallows the "table does not exist" case before
 * migration 0045 is applied.
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
