import type { PoolClient } from "pg";
import { withTenant } from "./db";
import { figureCheckAvailable } from "./figureChecks";

export type RecommendationFields = {
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  assumptions_and_risks: string;
  alternatives_considered: string;
};

export const RECOMMENDATION_FIELD_NAMES = [
  "action_text",
  "owner_role",
  "owner_feasibility_note",
  "timeline",
  "metric",
  "priority",
  "assumptions_and_risks",
  "alternatives_considered",
] as const satisfies readonly (keyof RecommendationFields)[];

/** A refused edit: the recommendation now stored (null when it is gone), so the editor can show it. */
export type RecommendationEditConflict = { ok: false; conflict: true; error: string; current: RecommendationFields | null };
export type RecommendationEditResult = { ok: true } | RecommendationEditConflict | { ok: false; error: string };
export type RecommendationAddResult = { ok: true; id: string; alreadySaved: boolean } | { ok: false; error: string };

export const RECOMMENDATION_EDIT_CONFLICT =
  "This recommendation was changed after you opened it, so your edit was not saved. Your wording is still in the editor: use the current wording, or replace it with yours.";
export const RECOMMENDATION_GONE =
  "This recommendation is no longer in the project; it may have been deleted, so nothing was saved. Your wording is still in the editor; reload to see the current list.";

const PRIORITIES = new Set(["high", "medium", "low"]);

/** The request's fields, checked at the server boundary (strings, a known priority, an action). */
export function parseRecommendationFields(raw: unknown): RecommendationFields | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!RECOMMENDATION_FIELD_NAMES.every((k) => typeof r[k] === "string")) return null;
  if (!PRIORITIES.has(r.priority as string)) return null;
  if (!(r.action_text as string).trim()) return null;
  return Object.fromEntries(RECOMMENDATION_FIELD_NAMES.map((k) => [k, r[k]])) as RecommendationFields;
}

const sameFields = (a: RecommendationFields, b: RecommendationFields) =>
  RECOMMENDATION_FIELD_NAMES.every((k) => a[k].trim() === b[k].trim());

let qualityColumns: boolean | null = null;
/** Migration 0045's quality columns. Only their absence is optional; a failed query is an error. */
async function qualityColumnsAvailable(client: PoolClient): Promise<boolean> {
  if (qualityColumns) return true;
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'recommendations' and column_name = 'rec_quality_score'`,
  );
  qualityColumns = r.rows[0]?.n === 1;
  return qualityColumns;
}

let requestKeyColumn: boolean | null = null;
async function requestKeyAvailable(client: PoolClient): Promise<boolean> {
  if (requestKeyColumn) return true;
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'recommendations' and column_name = 'client_request_key'`,
  );
  requestKeyColumn = r.rows[0]?.n === 1;
  return requestKeyColumn;
}

/**
 * Saves a researcher's edit and accepts the recommendation (Codex REC500-F01, REC500-F02).
 *
 * `expected` is every field as the editor opened with it. In one transaction the row is locked by id
 * and run; the edit is refused, with the stored fields, when the row is gone (deleted, or deleted and
 * recreated under a new id) or no longer matches `expected` (another editor saved first). Without
 * `expected` the edit is applied as before (no compare), for callers that have no opened state.
 *
 * In the same transaction the figure check and the quality score are cleared: they described the
 * earlier wording. The score is cleared only when migration 0045's columns exist; their absence is
 * the one tolerated case. Any other failure rolls the whole edit back and is thrown, so an edit is
 * never saved with the earlier score still standing as current.
 */
export async function saveRecommendationEdit(
  tenantId: string,
  runId: string,
  recommendationId: string,
  fields: RecommendationFields,
  expected?: RecommendationFields,
): Promise<RecommendationEditResult> {
  return withTenant(tenantId, async (client): Promise<RecommendationEditResult> => {
    const stored = await client.query<RecommendationFields>(
      `select ${RECOMMENDATION_FIELD_NAMES.join(", ")} from recommendations where id = $1 and run_id = $2 for update`,
      [recommendationId, runId],
    );
    const current = stored.rows[0];
    if (!current) return { ok: false, conflict: true, error: RECOMMENDATION_GONE, current: null };
    if (expected && !sameFields(current, expected)) {
      return { ok: false, conflict: true, error: RECOMMENDATION_EDIT_CONFLICT, current };
    }
    // Numerical traceability (0101): the stored figure check described the AI's wording; a
    // researcher's own wording was never examined, so the check is cleared, not carried over.
    const clearCheck = (await figureCheckAvailable(client)) ? ", figure_check = null" : "";
    const clearQuality = (await qualityColumnsAvailable(client))
      ? `, rec_actionability_score = null, rec_feasibility_score = null, rec_evidence_score = null,
         rec_impact_score = null, rec_quality_score = null, rec_quality_tier = null, rec_quality_rationale = null`
      : "";
    const updated = await client.query(
      `update recommendations
       set action_text = $1, owner_role = $2, owner_feasibility_note = $3, timeline = $4, metric = $5,
           priority = $6, assumptions_and_risks = $7, alternatives_considered = $8, status = 'accepted',
           edited = true${clearCheck}${clearQuality}
       where id = $9 and run_id = $10`,
      [
        fields.action_text,
        fields.owner_role,
        fields.owner_feasibility_note,
        fields.timeline,
        fields.metric,
        fields.priority,
        fields.assumptions_and_risks,
        fields.alternatives_considered,
        recommendationId,
        runId,
      ],
    );
    if (updated.rowCount !== 1) throw new Error("The recommendation could not be saved. Try again.");
    return { ok: true };
  });
}

export type RecommendationAnchor = { kind: "insight" | "synthesized"; id: string };

/**
 * Adds a recommendation the researcher wrote, tied to an insight of this run (Codex REC500-F03).
 *
 * `requestKey` is made by the add form when it opens and sent with every attempt of that form. The
 * insert carries it, and a unique index on (run, key) (migration 0113) lets only one row exist per
 * key; two sends at once wait on each other and the second finds the first. A send whose key is
 * already stored is answered with that recommendation (`alreadySaved`) when it is the same request,
 * and refused when the form's contents changed since (the earlier attempt was saved as it was then).
 *
 * The anchor's ownership is checked in the inserting statement (REC-001): another project's insight,
 * a deleted one, or a synthesized insight that is no longer accepted inserts nothing and is refused.
 */
export async function addResearcherRecommendation(
  tenantId: string,
  runId: string,
  anchor: RecommendationAnchor,
  fields: RecommendationFields,
  requestKey: string,
): Promise<RecommendationAddResult> {
  return withTenant(tenantId, async (client): Promise<RecommendationAddResult> => {
    if (!(await requestKeyAvailable(client))) {
      return { ok: false, error: "Adding your own recommendation needs database migration 0113. Apply it and try again; nothing was added." };
    }
    const column = anchor.kind === "insight" ? "insight_id" : "synthesized_insight_id";
    const source =
      anchor.kind === "insight"
        ? "from insights a where a.id = $3 and a.run_id = $2"
        : "from synthesized_insights a where a.id = $3 and a.run_id = $2 and a.review_status = 'accepted'";
    const inserted = await client.query<{ id: string }>(
      `insert into recommendations
         (tenant_id, run_id, ${column}, action_text, owner_role, owner_feasibility_note, timeline, metric,
          priority, assumptions_and_risks, alternatives_considered, source, status, client_request_key)
       select $1, $2, a.id, $4, $5, $6, $7, $8, $9, $10, $11, 'researcher_authored', 'accepted', $12
       ${source}
       on conflict (run_id, client_request_key) where client_request_key is not null do nothing
       returning id`,
      [
        tenantId,
        runId,
        anchor.id,
        fields.action_text,
        fields.owner_role,
        fields.owner_feasibility_note,
        fields.timeline,
        fields.metric,
        fields.priority,
        fields.assumptions_and_risks,
        fields.alternatives_considered,
        requestKey,
      ],
    );
    if (inserted.rows[0]) return { ok: true, id: inserted.rows[0].id, alreadySaved: false };
    const earlier = await client.query<RecommendationFields & { id: string; anchor: string | null }>(
      `select id, ${column} as anchor, ${RECOMMENDATION_FIELD_NAMES.join(", ")}
       from recommendations where run_id = $1 and client_request_key = $2`,
      [runId, requestKey],
    );
    const saved = earlier.rows[0];
    if (saved) {
      if (saved.anchor === anchor.id && sameFields(saved, fields)) return { ok: true, id: saved.id, alreadySaved: true };
      return {
        ok: false,
        error:
          "An earlier attempt from this form was already saved, as it was then, so this one was not added. Reload to see it; edit it there to change it.",
      };
    }
    return {
      ok: false,
      error:
        anchor.kind === "insight"
          ? "That insight is not part of this project any more, so no recommendation was added. Reload and choose again."
          : "That insight is not an accepted insight of this project any more, so no recommendation was added. Reload and choose again.",
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRequestKey = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
