"use server";

import { withTenantRead } from "./db";
import { loadEvidenceTrail, loadTrailContext, type EvidenceTrail } from "./evidenceTrail";
import { requireTenantId } from "./requestContext";

/** The evidence trail of one recommendation of this project (CE-5). Read only. */
export async function loadEvidenceTrailAction(runId: string, recommendationId: string): Promise<{ ok: true; trail: EvidenceTrail } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    // The context is read first, on its own connections (B39-F01), then the trail on one.
    const context = await loadTrailContext(TENANT_ID, runId);
    return { ok: true, trail: await withTenantRead(TENANT_ID, (client) => loadEvidenceTrail(client, TENANT_ID, runId, recommendationId, context)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The evidence trail could not be read." };
  }
}
