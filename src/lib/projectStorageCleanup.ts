import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import { convertedCopyPath } from "./documentStorageCleanup";

// Storage cleanup for a deleted project (Codex RR-F03, 2026-10-23; migration 0110). A project's
// files (each document's source and its preview, and paths an earlier single-document cleanup or
// an upload's intent still listed) are recorded in project_storage_cleanup in the same transaction
// that deletes the project, then removed from storage; the record goes only when storage confirms
// the removal. A storage error keeps it, with the error and attempt count, for the dashboard's
// retry. Storage removal of an object that is already gone is not an error, so a retry is safe.

const BUCKET = "documents";

export const PROJECT_CLEANUP_MIGRATION = "0110_project_storage_cleanup.sql";

export async function projectCleanupAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ present: boolean }>("select to_regclass('public.project_storage_cleanup') is not null as present");
  return r.rows[0]?.present === true;
}

/**
 * Every storage path this project's rows name, de-duplicated: documents' source and preview paths,
 * each source's converted copy, and the paths of pending single-document cleanups (which cascade with the project). Read under
 * the caller's lock on the project row, which uploads also take between writing a file and
 * recording it, so no recorded file can be added after this read.
 */
export async function projectStoragePaths(client: PoolClient, tenantId: string, runId: string): Promise<string[]> {
  const docs = await client.query<{ storage_path: string | null; preview_storage_path: string | null }>(
    "select storage_path, preview_storage_path from documents where run_id = $1 and tenant_id = $2",
    [runId, tenantId],
  );
  const pending = await client.query<{ detail: { storagePaths?: unknown } | null }>(
    "select detail from trace where run_id = $1 and tenant_id = $2 and event = 'document_storage_cleanup_pending'",
    [runId, tenantId],
  );
  const paths = new Set<string>();
  // Each data file's converted copy too (Codex batch10 RR-F03): the remote parser writes it next to
  // the file and removes it after reading, but a failed removal must not outlive the project.
  // Removing a copy that was never made is not an error.
  for (const d of docs.rows) for (const p of [d.storage_path, d.preview_storage_path, d.storage_path ? convertedCopyPath(d.storage_path) : null]) if (p) paths.add(p);
  for (const t of pending.rows) {
    const listed = t.detail?.storagePaths;
    if (Array.isArray(listed)) for (const p of listed) if (typeof p === "string" && p) paths.add(p);
  }
  return [...paths];
}

export async function queueProjectStorageCleanup(client: PoolClient, tenantId: string, runId: string, projectName: string | null, paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const r = await client.query<{ id: string }>(
    "insert into project_storage_cleanup (tenant_id, run_id, project_name, storage_paths) values ($1, $2, $3, $4) returning id::text",
    [tenantId, runId, projectName, paths],
  );
  return r.rows[0].id;
}

export type CleanupOutcome = { id: string; removed: boolean; error: string | null };

/**
 * Tries to remove each pending project cleanup's files (one, or all of the tenant's). Each record
 * is locked while it is worked on, so two retries never run the same one at once. A path still
 * named by a document in this tenant is left in storage (it is not an orphan) and dropped from the
 * list. A storage error is recorded on the record and returned, never thrown past the others.
 */
export async function finishProjectStorageCleanup(tenantId: string, onlyId?: string): Promise<CleanupOutcome[]> {
  const ids = await withTenantRead(tenantId, async (client) => {
    if (!(await projectCleanupAvailable(client))) return [];
    const r = await client.query<{ id: string }>(
      "select id::text from project_storage_cleanup where tenant_id = $1 and ($2::bigint is null or id = $2::bigint) order by id",
      [tenantId, onlyId ?? null],
    );
    return r.rows.map((x) => x.id);
  });
  const outcomes: CleanupOutcome[] = [];
  for (const id of ids) {
    outcomes.push(
      await withTenant(tenantId, async (client) => {
        const job = await client.query<{ storage_paths: string[] }>(
          "select storage_paths from project_storage_cleanup where id = $1 and tenant_id = $2 for update skip locked",
          [id, tenantId],
        );
        // Gone (finished by another retry) or being worked on now: nothing to do here.
        if (!job.rowCount) return { id, removed: false, error: null };
        const listed = job.rows[0].storage_paths;
        const stillNamed = new Set(
          (
            await client.query<{ p: string }>(
              `select unnest(array[storage_path, preview_storage_path]) as p from documents
                where tenant_id = $1 and (storage_path = any($2::text[]) or preview_storage_path = any($2::text[]))`,
              [tenantId, listed],
            )
          ).rows.map((x) => x.p),
        );
        // Only objects in this organisation's own folder are removed; anything else is kept on the
        // record with an error, for a person to look at, rather than removed or forgotten.
        const outside = listed.filter((p) => !p.startsWith(`${tenantId}/`));
        // A converted copy belongs to its source file: kept while that file is still named.
        const named = (p: string) => stillNamed.has(p) || (p.endsWith(".converted.json") && stillNamed.has(p.slice(0, -".converted.json".length)));
        const orphans = listed.filter((p) => !named(p) && p.startsWith(`${tenantId}/`));
        let error: string | null = null;
        if (orphans.length > 0) {
          try {
            const result = await supabaseAdmin.storage.from(BUCKET).remove(orphans);
            if (result.error) error = result.error.message || "Storage did not confirm the removal.";
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
        }
        if (error) {
          await client.query(
            "update project_storage_cleanup set attempts = attempts + 1, last_error = $3, last_attempt_at = now() where id = $1 and tenant_id = $2",
            [id, tenantId, error],
          );
          return { id, removed: false, error };
        }
        if (outside.length > 0) {
          error = `${outside.length === 1 ? "1 file is" : `${outside.length} files are`} outside this organisation's storage folder and ${outside.length === 1 ? "was" : "were"} not removed.`;
          await client.query(
            "update project_storage_cleanup set storage_paths = $3, attempts = attempts + 1, last_error = $4, last_attempt_at = now() where id = $1 and tenant_id = $2",
            [id, tenantId, outside, error],
          );
          return { id, removed: false, error };
        }
        // A failed delete here rolls back with the record still in place: the next retry removes
        // the same (already removed) files again and then the record.
        await client.query("delete from project_storage_cleanup where id = $1 and tenant_id = $2", [id, tenantId]);
        return { id, removed: true, error: null };
      }),
    );
  }
  return outcomes;
}

export type PendingProjectCleanup = { id: string; projectName: string | null; files: number; attempts: number; lastError: string | null; createdAt: string };

/** The tenant's deleted projects whose files are still to be removed; an error when it cannot be read. */
export async function loadPendingProjectCleanups(tenantId: string): Promise<{ ok: true; available: boolean; items: PendingProjectCleanup[] } | { ok: false; error: string }> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      if (!(await projectCleanupAvailable(client))) return { ok: true as const, available: false, items: [] };
      const r = await client.query<{ id: string; project_name: string | null; files: number; attempts: number; last_error: string | null; created_at: Date | string }>(
        `select id::text, project_name, cardinality(storage_paths) as files, attempts, last_error, created_at
           from project_storage_cleanup where tenant_id = $1 order by created_at`,
        [tenantId],
      );
      return {
        ok: true as const,
        available: true,
        items: r.rows.map((x) => ({
          id: x.id,
          projectName: x.project_name,
          files: Number(x.files),
          attempts: Number(x.attempts),
          lastError: x.last_error,
          createdAt: new Date(x.created_at).toISOString(),
        })),
      };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
