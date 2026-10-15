"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { recordHumanEdit, recordHumanReview, reviewActionForStatus } from "./findingProvenance";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

// REP-IN-002: every function below is an explicit researcher action, so each records its own
// provenance (findingProvenance.ts) in the same transaction as the change. A status choice is a
// review; a theme, kind or note change is an edit. Before migration 0094 the change still saves
// and the provenance write is skipped (replacement then treats the finding as provenance unknown).

export async function setFindingStatus(runId: string, findingId: string, status: "accepted" | "rejected" | "pending") {
  await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ id: string }>(
      "update findings set status = $1 where id = $2 and run_id = $3 returning id",
      [status, findingId, runId],
    );
    await recordHumanReview(client, r.rows.map((row) => row.id), reviewActionForStatus(status, false));
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * Sets the same status on a whole batch of findings in one go (e.g. an
 * "Accept all" button acting on everything currently visible under the
 * active filters), rather than firing one request per card. Bulk acceptance
 * is an explicit researcher decision and protects a finding exactly as a
 * single acceptance does; it is recorded as bulk_accept / bulk_reject so the
 * two remain distinguishable.
 */
export async function setManyFindingStatuses(
  runId: string,
  findingIds: string[],
  status: "accepted" | "rejected" | "pending"
) {
  if (findingIds.length === 0) return;
  await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ id: string }>(
      "update findings set status = $1 where run_id = $2 and id = any($3::uuid[]) returning id",
      [status, runId, findingIds],
    );
    await recordHumanReview(client, r.rows.map((row) => row.id), reviewActionForStatus(status, true));
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
    const r = await client.query<{ id: string }>(
      "update findings set finding_kind = $1 where id = $2 and run_id = $3 returning id",
      [findingKind, findingId, runId],
    );
    await recordHumanEdit(client, r.rows.map((row) => row.id), "finding_kind");
  });
  revalidatePath(`/runs/${runId}`);
}

export async function setFindingTheme(runId: string, findingId: string, theme: string) {
  await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ id: string }>(
      "update findings set theme = $1 where id = $2 and run_id = $3 returning id",
      [theme, findingId, runId],
    );
    await recordHumanEdit(client, r.rows.map((row) => row.id), "theme");
  });
  revalidatePath(`/runs/${runId}`);
}

/**
 * A short, freeform note a researcher attaches to a finding, e.g. "watch this
 * against Q2 tracking". Stored alongside the finding and carried into both
 * exports, so judgement added here doesn't have to be retyped later. Clearing
 * a note is still recorded as an edit.
 */
export async function setFindingNote(runId: string, findingId: string, note: string) {
  const trimmed = note.trim();
  await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ id: string }>(
      "update findings set researcher_note = $1 where id = $2 and run_id = $3 returning id",
      [trimmed === "" ? null : trimmed, findingId, runId],
    );
    await recordHumanEdit(client, r.rows.map((row) => row.id), "researcher_note");
  });
  revalidatePath(`/runs/${runId}`);
}
