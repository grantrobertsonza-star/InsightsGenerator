import { withTenantRead } from "./db";
import { objectiveIdentityKey } from "./objectiveLines";

/**
 * Which brief or proposal last filled Set objectives, and which objectives came from one (Grant,
 * 2026-10-21). The choice in Set objectives is a one-off instruction for one save (so an ordinary
 * save never calls the model) and its selects reset afterwards; saveRunContext records each
 * successful fill as a 'brief_intake_used' trace row and gives the objectives it added a rationale
 * starting "Added from". A failed read returns { error }, never null: not knowing must not look
 * like "never filled".
 */

export type BriefFillDocument = { id: string; filename: string; stillImported: boolean };
export type BriefFill = {
  at: string;
  brief: BriefFillDocument | null;
  proposal: BriefFillDocument | null;
  objectivesAdded: number;
  filledBusinessProblem: boolean;
};

type Detail = {
  briefDocumentId?: string | null;
  briefFilename?: string | null;
  proposalDocumentId?: string | null;
  proposalFilename?: string | null;
  objectivesAdded?: number;
  filledBusinessProblem?: boolean;
};

export async function loadLastBriefFill(tenantId: string, runId: string): Promise<BriefFill | null | { error: string }> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ occurred_at: Date | string; detail: Detail }>(
        `select occurred_at, detail from trace where run_id = $1 and event = 'brief_intake_used' order by occurred_at desc, id desc limit 1`,
        [runId],
      );
      if (r.rowCount === 0) return null;
      const { occurred_at, detail } = r.rows[0];
      const ids = [detail.briefDocumentId, detail.proposalDocumentId].filter((v): v is string => !!v);
      const present = ids.length
        ? new Set((await client.query<{ id: string }>("select id::text from documents where run_id = $1 and id = any($2::uuid[])", [runId, ids])).rows.map((d) => d.id))
        : new Set<string>();
      const doc = (id: string | null | undefined, filename: string | null | undefined): BriefFillDocument | null =>
        id && filename ? { id, filename, stillImported: present.has(id) } : null;
      return {
        at: new Date(occurred_at).toISOString(),
        brief: doc(detail.briefDocumentId, detail.briefFilename),
        proposal: doc(detail.proposalDocumentId, detail.proposalFilename),
        objectivesAdded: typeof detail.objectivesAdded === "number" ? detail.objectivesAdded : 0,
        filledBusinessProblem: detail.filledBusinessProblem === true,
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Objective identity key (objectiveIdentityKey) to the "Added from ..." rationale of the candidate. */
export async function loadObjectiveSources(tenantId: string, runId: string): Promise<Map<string, string> | { error: string }> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ candidate_text: string; rationale: string }>(
        `select candidate_text, rationale from objective_candidates where run_id = $1 and rationale like 'Added from %' order by created_at`,
        [runId],
      );
      const map = new Map<string, string>();
      for (const row of r.rows) {
        const key = objectiveIdentityKey(row.candidate_text);
        if (!map.has(key)) map.set(key, row.rationale);
      }
      return map;
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** "the proposal ConnectMobile.docx" from a stored rationale; null when it is not one. */
export function sourceLabelFromRationale(rationale: string): string | null {
  const m = /^Added from (.+)$/.exec(rationale);
  return m ? m[1].replace(/"/g, "") : null;
}
