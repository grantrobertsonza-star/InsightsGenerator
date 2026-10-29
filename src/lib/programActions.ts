"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { deleteProgram, renameProgram } from "./programs";
import { requireTenantId } from "./requestContext";
import { assertProgramOwned, assertRunOwned } from "./runOwnership";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function renameProgramAction(programId: string, name: unknown): Promise<Result> {
  const TENANT_ID = await requireTenantId();
  if (typeof programId !== "string" || typeof name !== "string") return { ok: false, error: "Give the program a name. Nothing was changed." };
  try {
    await renameProgram(TENANT_ID, programId, name);
    revalidatePath("/programs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteProgramAction(programId: string): Promise<Result<{ unlinked: number }>> {
  const TENANT_ID = await requireTenantId();
  if (typeof programId !== "string") return { ok: false, error: "That program no longer exists. Nothing was changed." };
  try {
    const r = await deleteProgram(TENANT_ID, programId);
    revalidatePath("/programs");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Links (or re-links) a project to a program as one of its waves, or creates a new program inline
 * rather than making the researcher detour to /programs first. Unlinking clears both columns;
 * nothing about the project's own data changes either way, since tracking is an attribute a
 * project can pick up or drop at any time, never a separate pipeline (migration 0026_programs.sql).
 *
 * SEC1 (moved here from src/app/runs/[id]/page.tsx so it can be tested): `runId` and the form's
 * `programId` come from the browser, so both are checked as this organisation's inside the one
 * transaction that writes, and the update itself names tenant_id. Another organisation's project or
 * program is refused with "not available" (thrown, so the form shows the error) and nothing is
 * written. A new program and the link to it are created together: a failed link leaves no
 * orphaned program behind.
 */
export async function updateProgramLinkAction(runId: string, formData: FormData): Promise<void> {
  const TENANT_ID = await requireTenantId();
  const action = String(formData.get("action") ?? "link");
  const waveLabelRaw = String(formData.get("waveLabel") ?? "").trim();
  const waveLabel = waveLabelRaw.length > 0 ? waveLabelRaw : null;
  const existingProgramId = String(formData.get("programId") ?? "").trim();
  const newProgramName = String(formData.get("newProgramName") ?? "").trim();
  if (action !== "unlink" && !existingProgramId && !newProgramName) return;

  await withTenant(TENANT_ID, async (client) => {
    await assertRunOwned(client, TENANT_ID, runId, { lock: true });
    if (action === "unlink") {
      await client.query("update runs set program_id = null, wave_label = null where id = $1 and tenant_id = $2", [runId, TENANT_ID]);
      return;
    }
    let programId = existingProgramId;
    if (programId) {
      await assertProgramOwned(client, TENANT_ID, programId);
    } else {
      const created = await client.query<{ id: string }>("insert into programs (tenant_id, name) values ($1, $2) returning id", [TENANT_ID, newProgramName]);
      programId = created.rows[0].id;
    }
    await client.query("update runs set program_id = $1, wave_label = $2 where id = $3 and tenant_id = $4", [programId, waveLabel, runId, TENANT_ID]);
  });
  revalidatePath(`/runs/${runId}`);
}
