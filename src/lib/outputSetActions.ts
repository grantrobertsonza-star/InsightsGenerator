"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { verifyAfterGenerate } from "./verifyAfterGenerate";
import { withTenant } from "./db";
import { deleteDocument } from "./documentActions";
import { checkOutputSet, compareOutputSets, generateOutputFindings, mergeOutputSets, type StoredChecks } from "./outputAnalysisRun";
import { requireRequestContext, requireTenantId } from "./requestContext";
import { removeOutputSetToBin } from "./documentBin";

type Result = { ok: true } | { ok: false; error: string };

const OUTPUT_SET_NAME_MAX = 120;
const OUTPUT_SET_WAVE_MAX = 60;

export type OutputSetLabels = { name: string; waveLabel: string };
export type OutputSetSaveResult =
  | { ok: true; stored: OutputSetLabels }
  | { ok: false; error: string }
  | { ok: false; conflict: true; error: string; current: OutputSetLabels | null };

/**
 * Saves a set's name and wave label. Codex DI-F04: `opened` is both as the editor last knew them. In
 * one transaction the set is locked by id, run and tenant; the save is refused, with what is stored,
 * when the set is gone or either value changed since (another editor saved first: the wave label is
 * written into findings made later, so a stale save would mis-attribute them). A save that changes no
 * row is never reported as saved.
 */
export async function saveOutputSetAction(
  runId: string,
  setId: string,
  name: string,
  waveLabel: string,
  opened: OutputSetLabels,
): Promise<OutputSetSaveResult> {
  const TENANT_ID = await requireTenantId();
  try {
    const clean = name.trim();
    if (!clean) return { ok: false, error: "A set needs a name." };
    if (typeof waveLabel !== "string" || !opened || typeof opened.name !== "string" || typeof opened.waveLabel !== "string") {
      return { ok: false, error: "The set could not be saved. Reload the page and try again." };
    }
    const result = await withTenant(TENANT_ID, async (client): Promise<OutputSetSaveResult> => {
      const r = await client.query<{ name: string; wave_label: string | null }>(
        "select name, wave_label from output_sets where id = $1 and run_id = $2 and tenant_id = $3 for update",
        [setId, runId, TENANT_ID],
      );
      const stored = r.rows[0];
      if (!stored) {
        return { ok: false, conflict: true, current: null, error: "This set is no longer in the project; it may have been removed, so nothing was saved. Reload the page." };
      }
      const current = { name: stored.name, waveLabel: stored.wave_label ?? "" };
      if (current.name.trim() !== opened.name.trim() || current.waveLabel.trim() !== opened.waveLabel.trim()) {
        return {
          ok: false,
          conflict: true,
          current,
          error: "This set's name or wave label was changed after you opened it, so your change was not saved. Use the current values, or replace them with yours.",
        };
      }
      // Codex B23-F01: names are kept to 120 characters and wave labels to 60. The values actually
      // stored are returned, so the card shows them and uses them as its next opened values (it used
      // to keep the longer typed text and then refuse its own next save as a conflict).
      const u = await client.query<{ name: string; wave_label: string | null }>(
        "update output_sets set name = $1, wave_label = $2 where id = $3 and run_id = $4 and tenant_id = $5 returning name, wave_label",
        [clean.slice(0, OUTPUT_SET_NAME_MAX), waveLabel.trim().slice(0, OUTPUT_SET_WAVE_MAX) || null, setId, runId, TENANT_ID],
      );
      if (u.rowCount !== 1) throw new Error("The set could not be saved. Try again.");
      return { ok: true, stored: { name: u.rows[0].name, waveLabel: u.rows[0].wave_label ?? "" } };
    });
    if (result.ok) revalidatePath(`/runs/${runId}`);
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteOutputSetAction(runId: string, setId: string): Promise<Result> {
  try {
    const context = await requireRequestContext();
    // To the bin, files and set together (documentBin.removeOutputSetToBin).
    await removeOutputSetToBin(context.tenantId, runId, setId, context.userId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteOutputFileAction(runId: string, documentId: string): Promise<Result> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  try {
    await deleteDocument(runId, documentId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `saved` is false only before migration 0062 (the checks show for this visit and are not kept);
 * `keptFrom` names files that could not be read, whose earlier findings were kept (DI-F02).
 */
type CheckResult = { ok: true; checks: StoredChecks; saved: boolean; keptFrom: string[] } | { ok: false; error: string };

/** Runs the set-level checks and stores them. Writes no findings. */
export async function checkOutputSetAction(runId: string, setId: string): Promise<CheckResult> {
  const TENANT_ID = await requireTenantId();
  try {
    const { stored, saved } = await checkOutputSet(TENANT_ID, runId, setId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, checks: stored, saved, keptFrom: [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Replaces the set's findings with a fresh set built from its evidence files, each carrying its assurance notes. */
export async function generateOutputFindingsAction(runId: string, setId: string): Promise<CheckResult> {
  const TENANT_ID = await requireTenantId();
  try {
    const { checks, saved, keptFrom } = await generateOutputFindings(TENANT_ID, runId, setId);
    after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
    return { ok: true, checks, saved, keptFrom };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /claims_pattern_type_check|pattern_type/.test(msg) ? "Findings from statistical output need migration 0062. Run npm run backup, then apply it." : msg };
  }
}

/** Compares two sets as an earlier and a later wave and writes the changes as findings. */
export async function compareWavesAction(runId: string, earlierId: string, laterId: string): Promise<{ ok: true; findings: number; notes: string[] } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    const r = await compareOutputSets(TENANT_ID, runId, earlierId, laterId);
    if (r.findings > 0) after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /pattern_type/.test(msg) ? "Wave comparison needs migration 0062. Run npm run backup, then apply it." : msg };
  }
}

export async function mergeOutputSetsAction(runId: string, fromId: string, intoId: string): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    const moved = await mergeOutputSets(TENANT_ID, runId, fromId, intoId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, moved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
