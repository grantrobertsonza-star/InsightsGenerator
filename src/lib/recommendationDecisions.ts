// Which decision a recommendation serves (CE-2, evidence chain, 26 October 2026). The decisions are
// numbered in the recommendation prompt, the model names the ones each action serves by index, and
// the choice is stored in recommendation_decisions (migration 0120) with the decision's id where the
// project's decisions are accepted candidates, and its wording either way.
//
// A recommendation with no stored row is "not recorded" (written before 0120, or the model named none),
// never "serves every decision". A stored decision that is no longer accepted, or whose free-text line
// is no longer in the project's decision statement, is reported as no longer current, with its wording.
import type { PoolClient } from "pg";
import { parseNumberedItems } from "./text";

export type DecisionItem = { candidateId: string | null; text: string };

/** The decisions recommendations are written for: accepted candidates, else the numbered statement. */
export async function loadDecisionItems(client: PoolClient, runId: string): Promise<DecisionItem[]> {
  const candidates = await client.query<{ id: string; candidate_text: string }>(
    "select id, candidate_text from decision_candidates where run_id = $1 and status = 'accepted' order by created_at, id",
    [runId],
  );
  if (candidates.rows.length > 0) return candidates.rows.map((c) => ({ candidateId: c.id, text: c.candidate_text }));
  const run = await client.query<{ decision_statement: string | null }>("select decision_statement from runs where id = $1", [runId]);
  return parseNumberedItems(run.rows[0]?.decision_statement ?? null).map((text) => ({ candidateId: null, text }));
}

/** The decisions as the prompt lists them, by the index the model answers with. */
export function decisionsPromptBlock(items: DecisionItem[]): string {
  return items.map((d, i) => `${i}. ${d.text}`).join("\n");
}

/** The tool field the model fills, shared by both recommendation generators. */
export const DECISION_INDICES_FIELD = {
  type: "array",
  items: { type: "integer" },
  description:
    "The index of every decision in the numbered list that this action serves. Name only the ones it actually bears on; an empty list if it serves none of them.",
} as const;

/** Valid, distinct indices in the order given; anything else (fractions, out of range, not a list) is dropped. */
export function parseDecisionIndices(raw: unknown, count: number): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count && !out.includes(v)) out.push(v);
  return out;
}

export async function recommendationDecisionsAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>("select to_regclass('public.recommendation_decisions') is not null as ok");
  return r.rows[0]?.ok === true;
}

/**
 * Replaces the decisions stored for one recommendation, in the caller's transaction. The caller has
 * checked the recommendation belongs to the project. Nothing is written before migration 0120.
 */
export async function storeRecommendationDecisions(
  client: PoolClient,
  tenantId: string,
  recommendationId: string,
  chosen: DecisionItem[],
  origin: "model" | "researcher",
): Promise<void> {
  if (!(await recommendationDecisionsAvailable(client))) return;
  await client.query("delete from recommendation_decisions where recommendation_id = $1", [recommendationId]);
  for (const [position, d] of chosen.entries()) {
    await client.query(
      "insert into recommendation_decisions (recommendation_id, decision_candidate_id, decision_text, position, origin, tenant_id) values ($1, $2, $3, $4, $5, $6)",
      [recommendationId, d.candidateId, d.text, position, origin, tenantId],
    );
  }
}

export type ServedDecision = { text: string; candidateId: string | null; origin: "model" | "researcher"; current: boolean };
/** undefined: recording is not available (before migration 0120), so nothing can be said. */
export type RecommendationDecisionsByRec = Map<string, ServedDecision[]> | undefined;

/** The decisions each recommendation serves, marked current or not against the project's decisions now. */
export async function loadRecommendationDecisions(client: PoolClient, runId: string, recommendationIds: string[]): Promise<RecommendationDecisionsByRec> {
  if (!(await recommendationDecisionsAvailable(client))) return undefined;
  const now = await loadDecisionItems(client, runId);
  const currentIds = new Set(now.map((d) => d.candidateId).filter(Boolean));
  const currentTexts = new Set(now.filter((d) => !d.candidateId).map((d) => d.text.trim()));
  const r = await client.query<{ recommendation_id: string; decision_candidate_id: string | null; decision_text: string; origin: "model" | "researcher" }>(
    `select recommendation_id, decision_candidate_id, decision_text, origin from recommendation_decisions
     where recommendation_id = any($1::uuid[]) order by recommendation_id, position`,
    [recommendationIds],
  );
  const out = new Map<string, ServedDecision[]>();
  for (const row of r.rows) {
    const current = row.decision_candidate_id ? currentIds.has(row.decision_candidate_id) : currentTexts.has(row.decision_text.trim());
    out.set(row.recommendation_id, [...(out.get(row.recommendation_id) ?? []), { text: row.decision_text, candidateId: row.decision_candidate_id, origin: row.origin, current }]);
  }
  return out;
}

/** The decisions served as the exports and cards state them, including "not recorded" and a decision since changed. */
export function servedDecisionsText(served: ServedDecision[] | undefined, available: boolean): string {
  if (!available) return "Not recorded (a database update is missing)";
  if (!served || served.length === 0) return "Not recorded";
  return served.map((d) => (d.current ? d.text : `${d.text} (no longer a current decision)`)).join("; ");
}
