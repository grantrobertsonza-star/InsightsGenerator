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

export const PROJECT_CLEANUP_MIGRATION = "0110_project_storage_cleanup.sql and 0111_storage_cleanup_in_flight.sql";

/** The cleanup record table with its 0111 columns (kind, in_flight_until). */
export async function projectCleanupAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ present: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'project_storage_cleanup' and column_name = 'in_flight_until') as present`,
  );
  return r.rows[0]?.present === true;
}

/**
 * How long a converted copy may still be on its way after the parser was asked (Codex batch12
 * RR-F03): the parser function's limit (vercel.json maxDuration, 60 s) with a wide margin. Until then a retry leaves
 * the record alone, so the copy cannot be "removed" before it is written and the record lost.
 */
export const CONVERTED_COPY_IN_FLIGHT_MS = 15 * 60 * 1000;

/**
 * Records the converted copy the remote parser is about to write, before it is asked. The record
 * does not cascade from the project, so a project deleted meanwhile, or a removal that fails after
 * the project is gone, still leaves it to retry. Refuses (so the parser is not asked) when the copy
 * cannot be recorded: the path is in no project's folder, the project is gone, 0111 is missing, or
 * the database fails.
 */
export async function beginConvertedCopy(storagePath: string, convertedPath: string): Promise<{ tenantId: string; id: string }> {
  const m = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\//.exec(storagePath);
  if (!m) throw new Error("That data file is not in a project's folder, so it was not sent for conversion.");
  const [, tenantId, runId] = m;
  const id = await withTenant(tenantId, async (client) => {
    if (!(await projectCleanupAvailable(client)))
      throw new Error(`Reading this data file on the server needs the database updates ${PROJECT_CLEANUP_MIGRATION}, so that its converted copy can be cleaned up. Nothing was read.`);
    const run = await client.query<{ project_name: string | null }>("select project_name from runs where id = $1 and tenant_id = $2", [runId, tenantId]);
    if (!run.rowCount) throw new Error("Project not found, so the data file was not sent for conversion.");
    const r = await client.query<{ id: string }>(
      `insert into project_storage_cleanup (tenant_id, run_id, project_name, storage_paths, kind, in_flight_until)
       values ($1, $2, $3, $4, 'converted_copy', now() + make_interval(secs => $5)) returning id::text`,
      [tenantId, runId, run.rows[0].project_name, [convertedPath], CONVERTED_COPY_IN_FLIGHT_MS / 1000],
    );
    return r.rows[0].id;
  });
  return { tenantId, id };
}

/**
 * After the parser answered (or not): removes the converted copy and its record. `parserDone` says
 * whether the parser is known to have finished (it answered); when it is not (the request failed
 * without an answer), the record keeps its in-flight time, so a copy still being written is
 * removed by a retry after it, never lost. A failed removal is kept on the record with its error
 * for the dashboard's retry. Never throws: the read's own result or error is what the caller needs.
 */
export async function finishConvertedCopy(intent: { tenantId: string; id: string }, convertedPath: string, parserDone: boolean): Promise<void> {
  if (!parserDone) return;
  let failure: string | null = null;
  try {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([convertedPath]);
    if (error) failure = error.message || "Storage did not confirm the removal.";
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  try {
    await withTenant(intent.tenantId, (client) =>
      failure === null
        ? client.query("delete from project_storage_cleanup where id = $1 and tenant_id = $2", [intent.id, intent.tenantId])
        : client.query(
            "update project_storage_cleanup set in_flight_until = null, attempts = attempts + 1, last_error = $3, last_attempt_at = now() where id = $1 and tenant_id = $2",
            [intent.id, intent.tenantId, failure],
          ),
    );
  } catch (e) {
    // The record keeps its in-flight time and is retried after it; logged without contents.
    console.error("Converted copy cleanup record could not be updated", { id: intent.id, error: e instanceof Error ? e.message : String(e) });
  }
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
      `select id::text from project_storage_cleanup
        where tenant_id = $1 and ($2::bigint is null or id = $2::bigint) and (in_flight_until is null or in_flight_until < now())
        order by id`,
      [tenantId, onlyId ?? null],
    );
    return r.rows.map((x) => x.id);
  });
  const outcomes: CleanupOutcome[] = [];
  for (const id of ids) {
    outcomes.push(
      await withTenant(tenantId, async (client) => {
        const job = await client.query<{ storage_paths: string[]; kind: string }>(
          `select storage_paths, kind from project_storage_cleanup
            where id = $1 and tenant_id = $2 and (in_flight_until is null or in_flight_until < now()) for update skip locked`,
          [id, tenantId],
        );
        // Gone (finished by another retry) or being worked on now: nothing to do here.
        if (!job.rowCount) return { id, removed: false, error: null };
        const listed = job.rows[0].storage_paths;
        const COPY_SUFFIX = ".converted.json";
        const sourceOf = (p: string) => (p.endsWith(COPY_SUFFIX) ? p.slice(0, -COPY_SUFFIX.length) : null);
        // Listed paths and the source of each listed converted copy, for the rule below.
        const looked = [...new Set([...listed, ...listed.map(sourceOf).filter((p): p is string => p !== null)])];
        const stillNamed = new Set(
          (
            await client.query<{ p: string }>(
              `select unnest(array[storage_path, preview_storage_path]) as p from documents
                where tenant_id = $1 and (storage_path = any($2::text[]) or preview_storage_path = any($2::text[]))`,
              [tenantId, looked],
            )
          ).rows.map((x) => x.p),
        );
        // Only objects in this organisation's own folder are removed; anything else is kept on the
        // record with an error, for a person to look at, rather than removed or forgotten.
        const outside = listed.filter((p) => !p.startsWith(`${tenantId}/`));
        // On a deleted project's record, a converted copy belongs to its source file: kept while
        // another document still names that file. A converted-copy record is the copy itself, which
        // has no use once read, so it is removed whatever names its source.
        const ownCopy = job.rows[0].kind === "converted_copy";
        const named = (p: string) => {
          if (stillNamed.has(p)) return true;
          const source = sourceOf(p);
          return !ownCopy && source !== null && stillNamed.has(source);
        };
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

/**
 * One listed cleanup (Codex RR-M02): a deleted project's record, or one converted copy. Counts are
 * of storage locations, not of files known to exist, since a deleted project's record lists every
 * location its files could have (a converted copy that may never have been made among them).
 * `records` is how many cleanup records the item stands for: each read of a data file records its
 * converted copy separately, so reads of the same file whose removals failed give several records
 * for one copy, shown as one item.
 */
export type PendingProjectCleanup = {
  id: string;
  kind: "deleted_project" | "converted_copy";
  projectName: string | null;
  locations: number;
  records: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

export type PendingProjectCleanups =
  | { ok: true; available: boolean; items: PendingProjectCleanup[]; locations: number }
  | { ok: false; error: string };

/**
 * The tenant's storage locations still to be removed (deleted projects' files, and converted copies
 * whose removal failed or whose parser did not answer in time); an error when it cannot be read.
 * A converted copy still within its in-flight time is normal work and not listed. `locations` is
 * the number of distinct locations across every listed record (Codex batch13 RR-M02): records
 * overlap (two reads of one file; a deleted project's record that also names a copy's location),
 * so it is not the sum of the items' counts. The records themselves are kept apart, since each has
 * its own producer and retry; only the presentation merges them.
 */
export async function loadPendingProjectCleanups(tenantId: string): Promise<PendingProjectCleanups> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      if (!(await projectCleanupAvailable(client))) return { ok: true as const, available: false, items: [], locations: 0 };
      const r = await client.query<{ id: string; kind: "deleted_project" | "converted_copy"; project_name: string | null; storage_paths: string[]; attempts: number; last_error: string | null; created_at: Date | string }>(
        `select id::text, kind, project_name, storage_paths, attempts, last_error, created_at
           from project_storage_cleanup
          where tenant_id = $1 and (in_flight_until is null or in_flight_until < now())
          order by created_at, id`,
        [tenantId],
      );
      const distinct = new Set<string>();
      const items: PendingProjectCleanup[] = [];
      const copyItems = new Map<string, PendingProjectCleanup>();
      for (const x of r.rows) {
        for (const p of x.storage_paths) distinct.add(p);
        const createdAt = new Date(x.created_at).toISOString();
        if (x.kind === "converted_copy") {
          // One copy, however many records name it: the newest record's error is the latest attempt's.
          const key = [...x.storage_paths].sort().join("\n");
          const seen = copyItems.get(key);
          if (seen) {
            seen.records += 1;
            seen.attempts += Number(x.attempts);
            if (x.last_error !== null) seen.lastError = x.last_error;
            continue;
          }
          const item: PendingProjectCleanup = { id: x.id, kind: x.kind, projectName: x.project_name, locations: new Set(x.storage_paths).size, records: 1, attempts: Number(x.attempts), lastError: x.last_error, createdAt };
          copyItems.set(key, item);
          items.push(item);
        } else {
          items.push({ id: x.id, kind: x.kind, projectName: x.project_name, locations: new Set(x.storage_paths).size, records: 1, attempts: Number(x.attempts), lastError: x.last_error, createdAt });
        }
      }
      return { ok: true as const, available: true, items, locations: distinct.size };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
