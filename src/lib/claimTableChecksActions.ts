"use server";

import { revalidatePath } from "next/cache";
import { checkClaimsPending, listClaimChecks, resetClaimChecks, type ClaimChecked } from "./claimTableChecks";
import { requireTenantId } from "./requestContext";

type Fail = { ok: false; error: string };

function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return /claim_table_checks/.test(m) && /does not exist/.test(m) ? "This needs migration 0068 applied first (npx.cmd supabase migration up)." : m;
}

export async function loadClaimChecksAction(runId: string): Promise<{ ok: true; claims: ClaimChecked[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    return { ok: true, claims: await listClaimChecks(TENANT_ID, runId) };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** Checks three claims per call; the panel repeats until none remain. */
export async function checkClaimsAction(runId: string): Promise<{ ok: true; done: number; remaining: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const r = await checkClaimsPending(TENANT_ID, runId, 3);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function resetClaimChecksAction(runId: string): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    await resetClaimChecks(TENANT_ID, runId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}
