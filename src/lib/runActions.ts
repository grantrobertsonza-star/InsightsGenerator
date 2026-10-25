"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { requireTenantId } from "./requestContext";
import { finishProjectStorageCleanup, PROJECT_CLEANUP_MIGRATION, projectCleanupAvailable, projectStoragePaths, queueProjectStorageCleanup } from "./projectStorageCleanup";

export type DeleteRunResult = { ok: true; cleanupPending: boolean } | { ok: false; error: string };

/**
 * Deletes a project and everything in it (Codex RR-F03, 2026-10-23). Its storage files are listed
 * in project_storage_cleanup (migration 0110) in the same transaction that deletes the project,
 * which locks the project row first, as uploads do between storing a file and recording it. The
 * files are then removed; if storage fails, the record stays with the error and the dashboard
 * offers a retry, so no file is left without a record of it. Without 0110 nothing is deleted.
 */
export async function deleteRun(runId: string): Promise<DeleteRunResult> {
  const TENANT_ID = await requireTenantId();
  let cleanupId: string | null;
  try {
    cleanupId = await withTenant(TENANT_ID, async (client) => {
      if (!(await projectCleanupAvailable(client)))
        throw new Error(`Deleting a project needs the database updates ${PROJECT_CLEANUP_MIGRATION}, so that its files can be removed from storage. Nothing was deleted.`);
      const run = await client.query<{ project_name: string | null }>("select project_name from runs where id = $1 and tenant_id = $2 for update", [runId, TENANT_ID]);
      if (!run.rowCount) throw new Error("That project was not found. Nothing was deleted.");
      const paths = await projectStoragePaths(client, TENANT_ID, runId);
      const id = await queueProjectStorageCleanup(client, TENANT_ID, runId, run.rows[0].project_name, paths);
      await client.query("delete from runs where id = $1 and tenant_id = $2", [runId, TENANT_ID]);
      return id;
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // The project is gone either way; a failed removal is on the dashboard with its retry.
  const outcome = cleanupId ? (await finishProjectStorageCleanup(TENANT_ID, cleanupId).catch(() => [{ id: cleanupId!, removed: false, error: "not tried" }]))[0] : null;
  revalidatePath("/");
  return { ok: true, cleanupPending: outcome !== null && outcome !== undefined && !outcome.removed };
}

/** The dashboard's retry: tries every pending project cleanup again. */
export async function retryProjectStorageCleanup(): Promise<{ ok: true; remaining: number } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    const outcomes = await finishProjectStorageCleanup(TENANT_ID);
    revalidatePath("/");
    return { ok: true, remaining: outcomes.filter((o) => !o.removed).length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type RenameResult = { ok: true } | { ok: false; error: string; conflict?: true; current?: string | null };

/**
 * Renames a project. Codex DI-F06: `opened` is the stored name the editor started from (null when the
 * project had none). In one transaction the run row is locked by id and tenant; the rename is refused
 * when the project is gone, or when its name changed since the editor opened (another editor renamed
 * it first), with the stored name, so a stale editor never overwrites a newer name and a rename that
 * changed nothing is never reported as done. A blank name is refused.
 */
export async function renameRun(runId: string, name: string, opened: string | null): Promise<RenameResult> {
  const TENANT_ID = await requireTenantId();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { ok: false, error: "A project needs a name." };
  const result = await withTenant(TENANT_ID, async (client): Promise<RenameResult> => {
    const r = await client.query<{ project_name: string | null }>("select project_name from runs where id = $1 and tenant_id = $2 for update", [runId, TENANT_ID]);
    if (!r.rows[0]) return { ok: false, error: "This project is no longer available, so it was not renamed. Reload the page." };
    const current = r.rows[0].project_name;
    if ((current ?? "").trim() !== (opened ?? "").trim()) {
      return {
        ok: false,
        conflict: true,
        current,
        error: "This project was renamed after you opened the editor, so your name was not saved. Use the current name, or replace it with yours.",
      };
    }
    const u = await client.query("update runs set project_name = $1 where id = $2 and tenant_id = $3", [trimmed, runId, TENANT_ID]);
    if (u.rowCount !== 1) throw new Error("The project could not be renamed. Try again.");
    return { ok: true };
  });
  if (result.ok) {
    revalidatePath("/");
    revalidatePath(`/runs/${runId}`);
  }
  return result;
}
