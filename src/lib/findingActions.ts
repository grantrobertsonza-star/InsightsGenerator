"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withTenant } from "./db";
import { recordHumanEdit, recordHumanReview, reviewActionForStatus } from "./findingProvenance";
import { editFindingWordingTx, revertFindingWordingTx, type WordingEditResult } from "./findingWording";
import { verifyAfterGenerate } from "./verifyAfterGenerate";

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

/**
 * FND-001 probe B: a researcher edits the wording of a finding read from a report (see
 * findingWording.ts for the full contract). `editedFrom` is the wording the editor started from,
 * so a concurrent change is a conflict, not a silent overwrite. On success the run's verification
 * chain is queued (the edited claim has no verdict until it is re-checked); a failure there leaves
 * it visibly "not yet re-checked", never with the old verdict.
 */
export async function editFindingWording(
  runId: string,
  findingId: string,
  editedFrom: string,
  newText: string,
): Promise<WordingEditResult> {
  const result = await withTenant(TENANT_ID, (client) => editFindingWordingTx(client, TENANT_ID, runId, findingId, editedFrom, newText));
  if (result.ok && result.changed) {
    after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
  }
  return result;
}

/** Restores the extracted wording (and its grounding) exactly; re-checked the same way as an edit. */
export async function revertFindingWording(runId: string, findingId: string, editedFrom: string): Promise<WordingEditResult> {
  const result = await withTenant(TENANT_ID, (client) => revertFindingWordingTx(client, TENANT_ID, runId, findingId, editedFrom));
  if (result.ok) {
    after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
  }
  return result;
}

/**
 * Runs the verification chain now for a finding still waiting for a re-check (the automatic one
 * after an edit failed or has not finished). Returns whether it now has a verdict.
 */
export async function recheckFindingWording(runId: string, findingId: string): Promise<{ ok: boolean; error?: string }> {
  await verifyAfterGenerate(TENANT_ID, runId);
  const has = await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ has: boolean }>(
      `select exists (select 1 from verdicts v join findings f on f.id = v.finding_id where f.id = $1 and f.run_id = $2) as has`,
      [findingId, runId],
    );
    return r.rows[0]?.has === true;
  });
  revalidatePath(`/runs/${runId}`);
  return has
    ? { ok: true }
    : { ok: false, error: "The re-check did not produce a verdict yet. The finding stays marked as not re-checked; try again shortly." };
}
