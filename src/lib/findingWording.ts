import type { PoolClient } from "pg";
import { findingProvenanceAvailable, recordHumanEdit } from "./findingProvenance";

/**
 * FND-001 probe B: researcher wording edits on findings read from a report.
 *
 * Contract (claude/finding-wording-edit-contract-2026-10-16.md):
 *   - Only a report finding (origin 'stated') can be edited. A finding calculated from the data
 *     ('generated') is refused: its numbers come from the data, and the remedy is to correct the
 *     variable set-up and recalculate. Coded qualitative findings are out of scope and refused.
 *   - The first edit captures the extraction-time wording, grounding and duplicate group once
 *     (findings.original_extraction, migration 0100). Later edits never overwrite it.
 *   - An edit never inherits the old verdict. In the same transaction it removes the verdicts,
 *     the claim-versus-table checks and the contradictions recorded against this finding (they
 *     judged the old wording), and clears the grounding and duplicate group (established for the
 *     old wording). Each removed verdict is kept in the trace row for the edit. The finding then
 *     reads "not yet re-checked" until verification runs again; it never reads as the old verdict.
 *   - Identity is kept: same id, review status, note, theme, kind and every link to pre-insights
 *     and insights. Editing is not reviewing: only edit provenance is recorded ('finding_text').
 *   - Downstream, the FND-001 wording fingerprint makes dependent insights "changed since drafted".
 *   - Concurrency: the finding row is locked (the lock confirms it still exists in this run) and
 *     the save carries the text it was edited from; a different stored text is a conflict and
 *     nothing is written.
 *   - Revert restores the extracted wording, grounding and duplicate group exactly, clears
 *     original_extraction and removes 'finding_text' from the edited fields; it is itself a
 *     wording change, so verdicts are removed and re-checked the same way.
 */

export type WordingEditResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "missing" | "not_editable" | "empty" | "conflict" | "not_edited" | "migration_pending"; error: string; currentText?: string };

type LockedFinding = {
  id: string;
  origin: string;
  finding_text: string;
  grounded_by_finding_id: string | null;
  duplicate_group_id: string | null;
  original_extraction: { finding_text: string; grounded_by_finding_id: string | null; duplicate_group_id: string | null } | null;
};

let originalColumnConfirmed = false;

/** Whether migration 0100 is applied on both findings and finding_history (positive answer cached). */
export async function findingOriginalAvailable(client: PoolClient): Promise<boolean> {
  if (originalColumnConfirmed) return true;
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name in ('findings', 'finding_history') and column_name = 'original_extraction'`,
  );
  originalColumnConfirmed = r.rows[0]?.n === 2;
  return originalColumnConfirmed;
}

const NOT_EDITABLE: Record<string, string> = {
  generated: "Calculated findings come from the data and their wording cannot be edited. Correct the variable set-up and recalculate instead.",
  coded: "Coded findings from transcripts cannot be reworded here. Edit the code or theme instead.",
};

async function lockFinding(client: PoolClient, runId: string, findingId: string): Promise<LockedFinding | null> {
  const r = await client.query<LockedFinding>(
    `select id, origin, finding_text, grounded_by_finding_id, duplicate_group_id, original_extraction
       from findings where id = $1 and run_id = $2 for update`,
    [findingId, runId],
  );
  return r.rows[0] ?? null;
}

/** Removes what judged the old wording; returns the removed verdicts for the trace. */
async function clearJudgements(client: PoolClient, findingId: string) {
  const removed = await client.query<{ verdict_tier: string; rationale: string; created_at: string }>(
    `delete from verdicts where finding_id = $1 returning verdict_tier, rationale, created_at::text`,
    [findingId],
  );
  await client.query("delete from claim_table_checks where finding_id = $1", [findingId]);
  await client.query("delete from finding_contradictions where original_finding_id = $1", [findingId]);
  return removed.rows;
}

async function preconditions(client: PoolClient): Promise<WordingEditResult | null> {
  if (!(await findingOriginalAvailable(client)) || !(await findingProvenanceAvailable(client))) {
    return {
      ok: false,
      reason: "migration_pending",
      error: "Editing finding wording needs database migrations 0094 and 0100. Nothing was changed.",
    };
  }
  return null;
}

/** Must run inside the caller's withTenant transaction. */
export async function editFindingWordingTx(
  client: PoolClient,
  tenantId: string,
  runId: string,
  findingId: string,
  editedFrom: string,
  newText: string,
): Promise<WordingEditResult> {
  const blocked = await preconditions(client);
  if (blocked) return blocked;
  const text = newText.trim();
  if (!text) return { ok: false, reason: "empty", error: "The wording cannot be empty. Nothing was changed." };
  const f = await lockFinding(client, runId, findingId);
  if (!f) return { ok: false, reason: "missing", error: "This finding no longer exists. Nothing was changed." };
  if (f.origin !== "stated") {
    return { ok: false, reason: "not_editable", error: NOT_EDITABLE[f.origin] ?? "This finding's wording cannot be edited." };
  }
  if (f.finding_text !== editedFrom) {
    return {
      ok: false,
      reason: "conflict",
      error: "This finding's wording changed since you started editing. Your draft was not saved; review the current wording first.",
      currentText: f.finding_text,
    };
  }
  if (text === f.finding_text) return { ok: true, changed: false };

  const original = f.original_extraction ?? {
    finding_text: f.finding_text,
    grounded_by_finding_id: f.grounded_by_finding_id,
    duplicate_group_id: f.duplicate_group_id,
  };
  const removedVerdicts = await clearJudgements(client, findingId);
  await client.query(
    `update findings
        set finding_text = $2, grounded_by_finding_id = null, duplicate_group_id = null,
            original_extraction = coalesce(original_extraction, $3::jsonb)
      where id = $1`,
    [findingId, text, JSON.stringify(original)],
  );
  await recordHumanEdit(client, [findingId], "finding_text");
  await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'finding_wording_edited', $3)`, [
    tenantId,
    runId,
    JSON.stringify({ finding_id: findingId, previous_text: f.finding_text, new_text: text, removed_verdicts: removedVerdicts }),
  ]);
  return { ok: true, changed: true };
}

/** Must run inside the caller's withTenant transaction. */
export async function revertFindingWordingTx(
  client: PoolClient,
  tenantId: string,
  runId: string,
  findingId: string,
  editedFrom: string,
): Promise<WordingEditResult> {
  const blocked = await preconditions(client);
  if (blocked) return blocked;
  const f = await lockFinding(client, runId, findingId);
  if (!f) return { ok: false, reason: "missing", error: "This finding no longer exists. Nothing was changed." };
  if (!f.original_extraction) return { ok: false, reason: "not_edited", error: "This finding's wording has not been edited." };
  if (f.finding_text !== editedFrom) {
    return {
      ok: false,
      reason: "conflict",
      error: "This finding's wording changed since this page loaded. Nothing was reverted; review the current wording first.",
      currentText: f.finding_text,
    };
  }
  const o = f.original_extraction;
  const removedVerdicts = await clearJudgements(client, findingId);
  await client.query(
    `update findings
        set finding_text = $2, grounded_by_finding_id = $3, duplicate_group_id = $4, original_extraction = null,
            human_edited_at = now(),
            human_edited_fields = array_remove(human_edited_fields, 'finding_text')
      where id = $1`,
    [findingId, o.finding_text, o.grounded_by_finding_id, o.duplicate_group_id],
  );
  await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'finding_wording_reverted', $3)`, [
    tenantId,
    runId,
    JSON.stringify({ finding_id: findingId, previous_text: f.finding_text, restored_text: o.finding_text, removed_verdicts: removedVerdicts }),
  ]);
  return { ok: true, changed: true };
}

export type WordingEditState = { originalText: string; recheckPending: boolean };

/**
 * The wording-edit state of a run's findings for display: for each edited finding, its original
 * wording and whether it still waits for a re-check (no verdict yet). `available: false` means
 * migration 0100 is not applied (editing is unavailable, nothing is edited); a failed read throws
 * rather than reading as "nothing edited".
 */
export async function loadWordingEdits(
  client: PoolClient,
  runId: string,
): Promise<{ available: boolean; edits: Record<string, WordingEditState> }> {
  if (!(await findingOriginalAvailable(client))) return { available: false, edits: {} };
  const r = await client.query<{ id: string; original_text: string; has_verdict: boolean }>(
    `select f.id, f.original_extraction->>'finding_text' as original_text,
            exists (select 1 from verdicts v where v.finding_id = f.id) as has_verdict
       from findings f
      where f.run_id = $1 and f.original_extraction is not null`,
    [runId],
  );
  return {
    available: true,
    edits: Object.fromEntries(r.rows.map((row) => [row.id, { originalText: row.original_text, recheckPending: !row.has_verdict }])),
  };
}
