"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export async function setFindingStatus(runId: string, findingId: string, status: "accepted" | "rejected" | "pending") {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update findings set status = $1 where id = $2 and run_id = $3", [status, findingId, runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Sets the same status on a whole batch of findings in one go (e.g. an
 * "Accept all" button acting on everything currently visible under the
 * active filters), rather than firing one request per card.
 */
export async function setManyFindingStatuses(
  runId: string,
  findingIds: string[],
  status: "accepted" | "rejected" | "pending"
) {
  if (findingIds.length === 0) return;
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update findings set status = $1 where run_id = $2 and id = any($3::uuid[])", [
      status,
      runId,
      findingIds,
    ]);
  });
  revalidatePath(`/runs/${runId}`);
}

export type FindingKind =
  | "fact"
  | "own_finding"
  | "external_citation"
  | "hypothesis"
  | "methodology"
  | "recommendation"
  | "stated_insight";

export async function setFindingKind(runId: string, findingId: string, findingKind: FindingKind) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update findings set finding_kind = $1 where id = $2 and run_id = $3", [findingKind, findingId, runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

export async function setFindingTheme(runId: string, findingId: string, theme: string) {
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update findings set theme = $1 where id = $2 and run_id = $3", [theme, findingId, runId]);
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * A short, freeform note a researcher attaches to a finding, e.g. "watch this
 * against Q2 tracking". Stored alongside the finding and carried into both
 * exports, so judgement added here doesn't have to be retyped later.
 */
export async function setFindingNote(runId: string, findingId: string, note: string) {
  const trimmed = note.trim();
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update findings set researcher_note = $1 where id = $2 and run_id = $3", [
      trimmed === "" ? null : trimmed,
      findingId,
      runId,
    ]);
  });
  revalidatePath(`/runs/${runId}`);
}
