"use server";

import { withTenantRead } from "./db";
import { loadEvidenceTrail, type EvidenceTrail } from "./evidenceTrail";
import { requireTenantId } from "./requestContext";

/** The evidence trail of one recommendation of this project (CE-5). Read only. */
export async function loadEvidenceTrailAction(runId: string, recommendationId: string): Promise<{ ok: true; trail: EvidenceTrail } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    return { ok: true, trail: await withTenantRead(TENANT_ID, (client) => loadEvidenceTrail(client, TENANT_ID, runId, recommendationId)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The evidence trail could not be read." };
  }
}
