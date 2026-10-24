"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withTenant } from "./db";
import { recordHumanEdit, recordHumanReview, reviewActionForStatus } from "./findingProvenance";
import { editFindingWordingTx, revertFindingWordingTx, type WordingEditResult } from "./findingWording";
import { verifyAfterGenerate } from "./verifyAfterGenerate";
import { requireTenantId } from "./requestContext";

// REP-IN-002: every function below is an explicit researcher action, so each records its own
// provenance (findingProvenance.ts) in the same transaction as the change. A status choice is a
// review; a theme, kind or note change is an edit. Before migration 0094 the change still saves
// and the provenance write is skipped (replacement then treats the finding as provenance unknown).

// TR500-F03 and TR500-M01 (Codex, 2026-10-23): each setter below says whether it saved.
// - Inputs are checked at this boundary before any write: a status or kind outside its list, a
//   theme or note that is not text, or an id that is not text, is refused with a reason.
// - A finding that is not in this project any more (deleted, replaced by a reread, or never in it)
//   is refused, never acknowledged as saved: a page left open can still send it.
// - A bulk status change is all or nothing: if any requested finding is gone, none is changed
//   (the transaction rolls back) and the reply says how many were missing.
// - Clearing: a blank theme or note clears it (stored as null). A kind, once set, cannot be
//   cleared here; the Findings page offers only the kinds. Null is not accepted for any of them.
// A database failure still throws; the Findings page shows it beside the control (F02).

export type FindingEditResult = { ok: true } | { ok: false; error: string };

const STATUSES = ["accepted", "rejected", "pending"] as const;
// An id must be text; whether it names a finding in this project is the database's answer.
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const GONE =
  "This finding is no longer in this project (it may have been deleted or replaced when its file was read again). Nothing was saved. Reload the page to see the current findings.";

class MissingFindings extends Error {
  constructor(readonly missing: number, readonly requested: number) {
    super("missing findings");
  }
}

export async function setFindingStatus(runId: string, findingId: string, status: "accepted" | "rejected" | "pending"): Promise<FindingEditResult> {
  const TENANT_ID = await requireTenantId();
  if (!(STATUSES as readonly unknown[]).includes(status)) return { ok: false, error: `"${String(status)}" is not a review status. Nothing was saved.` };
  if (!isId(runId) || !isId(findingId)) return { ok: false, error: GONE };
  const saved = await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ id: string }>(
      "update findings set status = $1 where id = $2 and run_id = $3 returning id",
      [status, findingId, runId],
    );
    if (r.rowCount === 0) return false;
    await recordHumanReview(client, r.rows.map((row) => row.id), reviewActionForStatus(status, false));
    return true;
  });
  if (!saved) return { ok: false, error: GONE };
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

/**
 * Sets the same status on a whole batch of findings in one go (e.g. an
 * "Accept all" button acting on everything currently visible under the
 * active filters), rather than firing one request per card. Bulk acceptance
 * is an explicit researcher decision and protects a finding exactly as a
 * single acceptance does; it is recorded as bulk_accept / bulk_reject so the
 * two remain distinguishable. All or nothing (see above): a batch naming a
 * finding that is gone changes none of them.
 */
export async function setManyFindingStatuses(
  runId: string,
  findingIds: string[],
  status: "accepted" | "rejected" | "pending"
): Promise<FindingEditResult> {
  const TENANT_ID = await requireTenantId();
  if (!(STATUSES as readonly unknown[]).includes(status)) return { ok: false, error: `"${String(status)}" is not a review status. Nothing was saved.` };
  if (!Array.isArray(findingIds)) return { ok: false, error: "No findings were named. Nothing was saved." };
  const ids = [...new Set(findingIds)];
  if (ids.length === 0) return { ok: true };
  const malformed = ids.filter((id) => !isId(id)).length;
  const gone = (missing: number) => ({
    ok: false as const,
    error: `${missing} of the ${ids.length} findings ${missing === 1 ? "is" : "are"} no longer in this project, so none of them was changed. Reload the page to see the current findings.`,
  });
  if (!isId(runId)) return gone(ids.length);
  if (malformed > 0) return gone(malformed);
  try {
    await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        "update findings set status = $1 where run_id = $2 and id = any($3::uuid[]) returning id",
        [status, runId, ids],
      );
      // Thrown inside the transaction so the rows already updated roll back.
      if ((r.rowCount ?? 0) < ids.length) throw new MissingFindings(ids.length - (r.rowCount ?? 0), ids.length);
      await recordHumanReview(client, r.rows.map((row) => row.id), reviewActionForStatus(status, true));
    });
  } catch (e) {
    if (e instanceof MissingFindings) return gone(e.missing);
    throw e;
  }
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

export type FindingKind =
  | "fact"
  | "own_finding"
  | "external_citation"
  | "hypothesis"
  | "methodology"
  | "recommendation"
  | "stated_insight";

const KINDS: readonly FindingKind[] = ["fact", "own_finding", "external_citation", "hypothesis", "methodology", "recommendation", "stated_insight"];

/** One field of one finding, in this project, with its edit recorded; refused when the finding is gone. */
async function editField(TENANT_ID: string, runId: string, findingId: string, column: "finding_kind" | "theme" | "researcher_note", value: string | null): Promise<FindingEditResult> {
  if (!isId(runId) || !isId(findingId)) return { ok: false, error: GONE };
  const saved = await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ id: string }>(
      `update findings set ${column} = $1 where id = $2 and run_id = $3 returning id`,
      [value, findingId, runId],
    );
    if (r.rowCount === 0) return false;
    await recordHumanEdit(client, r.rows.map((row) => row.id), column);
    return true;
  });
  if (!saved) return { ok: false, error: GONE };
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

export async function setFindingKind(runId: string, findingId: string, findingKind: FindingKind): Promise<FindingEditResult> {
  const TENANT_ID = await requireTenantId();
  if (!KINDS.includes(findingKind)) return { ok: false, error: `Choose one of the finding kinds${findingKind === null ? "; a kind cannot be cleared" : `, not "${String(findingKind)}"`}. Nothing was saved.` };
  return editField(TENANT_ID, runId, findingId, "finding_kind", findingKind);
}

/** A blank theme clears it. */
export async function setFindingTheme(runId: string, findingId: string, theme: string): Promise<FindingEditResult> {
  const TENANT_ID = await requireTenantId();
  if (typeof theme !== "string") return { ok: false, error: "A theme must be text. Nothing was saved." };
  const trimmed = theme.trim();
  return editField(TENANT_ID, runId, findingId, "theme", trimmed === "" ? null : trimmed);
}

/**
 * A short, freeform note a researcher attaches to a finding, e.g. "watch this
 * against Q2 tracking". Stored alongside the finding and carried into both
 * exports, so judgement added here doesn't have to be retyped later. Clearing
 * a note (saving it blank) is still recorded as an edit.
 */
export async function setFindingNote(runId: string, findingId: string, note: string): Promise<FindingEditResult> {
  const TENANT_ID = await requireTenantId();
  if (typeof note !== "string") return { ok: false, error: "A note must be text. Nothing was saved." };
  const trimmed = note.trim();
  return editField(TENANT_ID, runId, findingId, "researcher_note", trimmed === "" ? null : trimmed);
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
  const TENANT_ID = await requireTenantId();
  const result = await withTenant(TENANT_ID, (client) => editFindingWordingTx(client, TENANT_ID, runId, findingId, editedFrom, newText));
  if (result.ok && result.changed) {
    after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
  }
  return result;
}

/** Restores the extracted wording (and its grounding) exactly; re-checked the same way as an edit. */
export async function revertFindingWording(runId: string, findingId: string, editedFrom: string): Promise<WordingEditResult> {
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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
