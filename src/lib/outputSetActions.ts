"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { deleteDocument } from "./documentActions";
import { checkOutputSet, compareOutputSets, generateOutputFindings, mergeOutputSets, type StoredChecks } from "./outputAnalysisRun";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;
type Result = { ok: true } | { ok: false; error: string };

export async function saveOutputSetAction(runId: string, setId: string, name: string, waveLabel: string): Promise<Result> {
  try {
    const clean = name.trim();
    if (!clean) return { ok: false, error: "A set needs a name." };
    await withTenant(TENANT_ID, async (client) => {
      await client.query("update output_sets set name = $1, wave_label = $2 where id = $3 and run_id = $4", [
        clean.slice(0, 120),
        waveLabel.trim().slice(0, 60) || null,
        setId,
        runId,
      ]);
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteOutputSetAction(runId: string, setId: string): Promise<Result> {
  try {
    const ids = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>("select id from documents where output_set_id = $1 and run_id = $2", [setId, runId]);
      return r.rows.map((x) => x.id);
    });
    for (const id of ids) await deleteDocument(runId, id);
    await withTenant(TENANT_ID, async (client) => {
      await client.query("delete from output_sets where id = $1 and run_id = $2", [setId, runId]);
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteOutputFileAction(runId: string, documentId: string): Promise<Result> {
  try {
    await deleteDocument(runId, documentId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type CheckResult = { ok: true; checks: StoredChecks } | { ok: false; error: string };

/** Runs the set-level checks and stores them. Writes no findings. */
export async function checkOutputSetAction(runId: string, setId: string): Promise<CheckResult> {
  try {
    const { stored } = await checkOutputSet(TENANT_ID, runId, setId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, checks: stored };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Replaces the set's findings with a fresh set built from its evidence files, each carrying its assurance notes. */
export async function generateOutputFindingsAction(runId: string, setId: string): Promise<CheckResult> {
  try {
    const { checks } = await generateOutputFindings(TENANT_ID, runId, setId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, checks };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /claims_pattern_type_check|pattern_type/.test(msg) ? "Findings from statistical output need migration 0062. Run npm run backup, then apply it." : msg };
  }
}

/** Compares two sets as an earlier and a later wave and writes the changes as findings. */
export async function compareWavesAction(runId: string, earlierId: string, laterId: string): Promise<{ ok: true; findings: number; notes: string[] } | { ok: false; error: string }> {
  try {
    const r = await compareOutputSets(TENANT_ID, runId, earlierId, laterId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /pattern_type/.test(msg) ? "Wave comparison needs migration 0062. Run npm run backup, then apply it." : msg };
  }
}

export async function mergeOutputSetsAction(runId: string, fromId: string, intoId: string): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  try {
    const moved = await mergeOutputSets(TENANT_ID, runId, fromId, intoId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, moved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
