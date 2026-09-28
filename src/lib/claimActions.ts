"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export async function setClaimStatus(runId: string, claimId: string, status: "accepted" | "rejected" | "pending") {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update claims set status = $1 where id = $2 and run_id = $3", [status, claimId, runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function setClaimKind(
  runId: string,
  claimId: string,
  claimKind: "own_finding" | "external_citation" | "insight"
) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update claims set claim_kind = $1 where id = $2 and run_id = $3", [claimKind, claimId, runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function setClaimTheme(runId: string, claimId: string, theme: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update claims set theme = $1 where id = $2 and run_id = $3", [theme, claimId, runId]);
  });
  revalidatePath(`/runs/${runId}`);
}
