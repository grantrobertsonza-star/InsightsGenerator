import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { mapWithConcurrency } from "./concurrency";
import type { PoolClient } from "pg";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import {
  assignFamilies,
  classifyOutput,
  parseDelimited,
  SAMPLE_ROWS,
  type OutputClass,
  type OutputProfile,
} from "./outputClassify";

const BUCKET = "documents";

// Limits that keep a zip from being a way to exhaust the server.
export const MAX_ENTRIES = 400;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200000;
const READABLE = new Set([".csv", ".tsv", ".xlsx", ".xls", ".txt", ".md", ".docx"]);
const STORE_CONCURRENCY = 4;

export type OutputEntry = { path: string; name: string; ext: string; bytes: Buffer };
export type Skipped = { path: string; reason: string };

const extOf = (p: string) => {
  const m = /\.[^./]+$/.exec(p.toLowerCase());
  return m ? m[0] : "";
};

/** Safe relative path: no drive, no leading slash, no parent steps. Null when the entry should be ignored. */
export function cleanPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = p.split("/").filter((s) => s && s !== ".");
  if (parts.length === 0 || parts.some((s) => s === ".." || /^[a-zA-Z]:$/.test(s))) return null;
  if (parts[0] === "__MACOSX" || parts.some((s) => s.startsWith("."))) return null;
  return parts.join("/");
}

export async function readZip(file: File): Promise<{ entries: OutputEntry[]; skipped: Skipped[] }> {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const entries: OutputEntry[] = [];
  const skipped: Skipped[] = [];
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (names.length > MAX_ENTRIES) {
    throw new Error(`This zip holds ${names.length} files. The limit is ${MAX_ENTRIES} per upload; split it and upload in parts.`);
  }
  let total = 0;
  // A zip with a single wrapper folder ("Output/...") keeps its inner structure.
  const cleaned = names.map((n) => ({ n, p: cleanPath(n) }));
  const roots = new Set(cleaned.filter((c) => c.p).map((c) => c.p!.split("/")[0]));
  const strip = roots.size === 1 && cleaned.every((c) => !c.p || c.p.includes("/"));
  for (const { n, p } of cleaned) {
    if (!p) {
      skipped.push({ path: n, reason: "hidden or unsafe path" });
      continue;
    }
    const rel = strip ? p.split("/").slice(1).join("/") : p;
    const ext = extOf(rel);
    if (!READABLE.has(ext)) {
      skipped.push({ path: rel, reason: ext === ".zip" ? "nested zip" : `${ext || "no extension"} is not read (images and other files are left out)` });
      continue;
    }
    const entry = zip.files[n] as unknown as { _data?: { uncompressedSize?: number } };
    const declared = entry._data?.uncompressedSize;
    if (declared !== undefined && declared > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "larger than 40 MB" });
      continue;
    }
    const bytes = Buffer.from(await zip.files[n].async("uint8array"));
    if (bytes.length > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "larger than 40 MB" });
      continue;
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("The unpacked zip is larger than 300 MB. Split it and upload in parts.");
    entries.push({ path: rel, name: rel.split("/").pop() ?? rel, ext, bytes });
  }
  return { entries, skipped };
}

type Read = { profile: OutputProfile; text?: string };

async function readEntry(e: OutputEntry): Promise<Read> {
  const empty: OutputProfile = { headers: [], rowCount: 0, sample: [], numericColumns: 0 };
  if (e.ext === ".csv" || e.ext === ".tsv") {
    const p = parseDelimited(e.bytes.toString("utf8"), e.ext);
    return { profile: { headers: p.headers, rowCount: p.rowCount, sample: p.sample, numericColumns: p.numericColumns } };
  }
  if (e.ext === ".xlsx" || e.ext === ".xls") {
    const wb = XLSX.read(e.bytes, { type: "buffer", cellDates: false });
    const sheets: NonNullable<OutputProfile["sheets"]> = [];
    let main: OutputProfile | null = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" }) as unknown[][];
      const nonEmpty = rows.filter((r) => r.some((c) => c !== ""));
      const cols = nonEmpty.reduce((m, r) => Math.max(m, r.length), 0);
      sheets.push({ name, rows: Math.max(0, nonEmpty.length - 1), cols });
      if (!main && nonEmpty.length > 0) {
        const headers = nonEmpty[0].map((c) => String(c).trim());
        const sample = nonEmpty.slice(1, SAMPLE_ROWS + 1).map((r) => headers.map((_, i) => String(r[i] ?? "")));
        const numericColumns = headers.filter((_, c) => sample.length > 0 && sample.every((r) => r[c] !== "" && Number.isFinite(Number(r[c])))).length;
        main = { headers, rowCount: Math.max(0, nonEmpty.length - 1), sample, numericColumns };
      }
    }
    return { profile: { ...(main ?? empty), sheets } };
  }
  if (e.ext === ".docx") {
    const r = await mammoth.extractRawText({ buffer: e.bytes });
    const text = r.value.slice(0, MAX_TEXT_CHARS);
    return { profile: { ...empty, textLength: r.value.length }, text };
  }
  const text = e.bytes.toString("utf8").slice(0, MAX_TEXT_CHARS);
  return { profile: { ...empty, textLength: text.length }, text };
}

export type IngestResult = { setId: string; added: number; skipped: Skipped[] };

/** The set named by `appendTo` is not an output set of this project (removed to the bin, or another project's). */
export class OutputSetGoneError extends Error {}

/**
 * Stores a zip or a batch of loose files as one output set. Each readable
 * file becomes a document of kind 'output', classified from its content.
 *
 * One selection of statistical output is one set, whatever the transport (B52-F01, Codex, 28 October 2026):
 * the Add files dialog sends a large selection in several requests that each fit through the sign-in proxy,
 * and every request after the first passes the set the first one created as `appendTo`. The set must still
 * be an output set of this project; it is held (FOR SHARE) while each file is recorded, so removing it to
 * the bin waits for the write or is seen by it, never splits a file from its set. Families (assignFamilies)
 * are a property of the whole set's file names, so they are recomputed over every file in the set after each
 * append, under a lock on the set, rather than from one request's files.
 *
 * `selectionId` (batch 65, the rest of B52-F01): the dialog's own id for the selection, sent with every request
 * that carries its output, so a request whose reply was lost still names its set for the next one. See
 * resolveOutputSet for how it, `appendTo` and migration 0129 combine.
 */
export async function ingestOutputFiles(
  tenantId: string,
  runId: string,
  files: File[],
  options: OutputSetChoice & { name?: string; waveLabel?: string } = {},
): Promise<IngestResult> {
  const entries: OutputEntry[] = [];
  const skipped: Skipped[] = [];
  let source: "zip" | "files" = "files";
  let setName = options.name?.trim() || "";
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      source = "zip";
      const z = await readZip(f);
      entries.push(...z.entries);
      skipped.push(...z.skipped);
      if (!setName) setName = f.name.replace(/\.zip$/i, "");
    } else {
      const ext = extOf(f.name);
      if (!READABLE.has(ext)) {
        skipped.push({ path: f.name, reason: `${ext || "no extension"} is not read` });
        continue;
      }
      entries.push({ path: f.name, name: f.name, ext, bytes: Buffer.from(await f.arrayBuffer()) });
    }
  }
  if (entries.length === 0) {
    throw new Error("Nothing readable was found. Statistical output can be CSV, Excel, Word or text files, or a zip of them.");
  }
  if (!setName) setName = "Statistical output";

  const families = assignFamilies(entries.map((e) => e.path));
  const read = await mapWithConcurrency(entries, STORE_CONCURRENCY, async (e) => ({ e, r: await readEntry(e).catch(() => ({ profile: { headers: [], rowCount: 0, sample: [], numericColumns: 0 } as OutputProfile }) as Read) }));

  const { setId, created } = await withTenant(tenantId, (client) =>
    resolveOutputSet(client, tenantId, runId, options, { name: setName, waveLabel: options.waveLabel?.trim() || null, source }),
  );

  let added = 0;
  await mapWithConcurrency(read, STORE_CONCURRENCY, async ({ e, r }) => {
    try {
      const cls: OutputClass = classifyOutput({ name: e.name, path: e.path, ext: e.ext, profile: r.profile, text: r.text });
      const safe = e.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const storagePath = `${tenantId}/${runId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      const up = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, e.bytes, { contentType: undefined });
      if (up.error) throw new Error(up.error.message);
      await withTenant(tenantId, async (client) => {
        // The set is held while the file is recorded, and must still be this project's: a set removed to the
        // bin meanwhile (documentBin moves it under a row lock) is not given a file outside the bin.
        const inserted = await client.query(
          `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, extracted_text,
              output_set_id, output_path, output_family, output_role, output_kind, output_profile)
           select $1,$2,'output',$3,$4,$5,s.id,$7,$8,$9,$10,$11
             from (select id from output_sets where id = $6 and run_id = $2 and tenant_id = $1 for share) s`,
          [
            tenantId, runId, e.name, storagePath, r.text ?? null,
            setId, e.path, families.get(e.path) ?? null, cls.role, cls.kind,
            JSON.stringify({ ...r.profile, confidence: cls.confidence, signals: cls.signals }),
          ],
        );
        if (inserted.rowCount !== 1) throw new OutputSetGoneError(OUTPUT_SET_GONE);
      }).catch(async (err) => {
        // The file was stored but not recorded: its stored copy is removed so nothing is left unowned.
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        throw err;
      });
      added++;
    } catch (err) {
      skipped.push({ path: e.path, reason: err instanceof Error ? err.message : String(err) });
    }
  });
  if (added === 0) {
    // Only a set this call created is removed: an appended-to set keeps the files its earlier requests stored.
    if (created) {
      await withTenant(tenantId, async (client) => {
        await client.query("delete from output_sets where id = $1 and run_id = $2 and tenant_id = $3 and not exists (select 1 from documents d where d.output_set_id = $1)", [setId, runId, tenantId]);
      });
    }
    const gone = skipped.find((s) => s.reason === OUTPUT_SET_GONE);
    if (gone) throw new OutputSetGoneError(OUTPUT_SET_GONE);
    throw new Error(`No file could be stored. ${skipped.slice(0, 3).map((s) => `${s.path}: ${s.reason}`).join(" | ")}`);
  }
  // A set this call created may still have been joined meanwhile by another request of the same selection
  // (a retry sent while the lost request was still running), so a selection's families are always recomputed.
  if (!created || options.selectionId) await refreshSetFamilies(tenantId, runId, setId);
  return { setId, added, skipped };
}

export const OUTPUT_SET_GONE =
  "The statistical output set these files belong to is no longer in this project (it may have been removed to the bin), so they were not added. Choose them again to start a new set.";

/** The set a request's statistical output goes into, and whether this request created it. */
export type OutputSetChoice = {
  /** The set an earlier request of the same selection reported (its reply arrived). */
  appendTo?: string;
  /** The dialog's id for the whole selection, generated before its first request (migration 0129). */
  selectionId?: string;
  /** An earlier request of this selection got no answer, so whether it already made a set is not known. */
  selectionUnconfirmed?: boolean;
};

/** The request names a set and a selection that do not belong together. */
export class OutputSelectionMismatchError extends Error {}
/** Before migration 0129: an earlier request of this selection may have made a set the server cannot find. */
export class OutputSelectionUnknownError extends Error {}

export const OUTPUT_SELECTION_MISMATCH =
  "These files name an output set that belongs to a different upload, so they were not added. Choose them again to start a new set.";
export const OUTPUT_SELECTION_UNKNOWN =
  "An earlier part of this statistical output upload got no answer from the server, so it may already have started an output set, and this server cannot find that set yet (database migration 0129 is not applied). Nothing was added, so no second set was started. Reload the page and check Sources, then choose the files that are missing and upload them; they will form a new set.";

/** Whether migration 0129 is applied. A catalogue query, so it never aborts the caller's transaction. */
export async function outputSelectionIdentityAvailable(client: Pick<PoolClient, "query">): Promise<boolean> {
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'output_sets' and column_name = 'client_selection_id'`,
  );
  return (r.rows[0]?.n ?? 0) === 1;
}

/**
 * Finds or creates the set for one request of a selection, inside the caller's transaction; every query is
 * scoped by tenant and project, so the ownership check is on the write itself.
 *
 * - `selectionId` with migration 0129: the selection's set is created by whichever request arrives first
 *   (insert ... on conflict do nothing) and found by every later one, including a retry after a lost reply.
 *   The id is unique per tenant, so a set of that selection now in the bin or in another project is found and
 *   refused, never replaced by a new set. `appendTo`, when also given, must be that same set; a set made
 *   before the migration (no selection id yet) is claimed for the selection when no other set has it.
 * - Without the migration, or without a selection id: `appendTo` names the set as before (B52-F01), and no
 *   `appendTo` starts a new set, except that a request whose selection already had a lost reply is refused
 *   (OUTPUT_SELECTION_UNKNOWN), because it could otherwise start a second set without anyone knowing.
 */
async function resolveOutputSet(
  client: PoolClient,
  tenantId: string,
  runId: string,
  choice: OutputSetChoice,
  fresh: { name: string; waveLabel: string | null; source: "zip" | "files" },
): Promise<{ setId: string; created: boolean }> {
  const ownedSet = async (id: string) => {
    const r = await client.query<{ id: string; client_selection_id?: string | null }>(
      // to_jsonb reads the selection id without naming the column, so this also runs before migration 0129.
      `select s.id, to_jsonb(s)->>'client_selection_id' as client_selection_id
         from output_sets s where s.id = $1 and s.run_id = $2 and s.tenant_id = $3 for update`,
      [id, runId, tenantId],
    );
    if (r.rowCount !== 1) throw new OutputSetGoneError(OUTPUT_SET_GONE);
    return r.rows[0];
  };
  const bySelection = choice.selectionId && (await outputSelectionIdentityAvailable(client)) ? choice.selectionId : null;
  if (!bySelection) {
    if (choice.appendTo) return { setId: (await ownedSet(choice.appendTo)).id, created: false };
    if (choice.selectionUnconfirmed) throw new OutputSelectionUnknownError(OUTPUT_SELECTION_UNKNOWN);
    const r = await client.query<{ id: string }>(
      "insert into output_sets (tenant_id, run_id, name, wave_label, source) values ($1,$2,$3,$4,$5) returning id",
      [tenantId, runId, fresh.name, fresh.waveLabel, fresh.source],
    );
    return { setId: r.rows[0].id, created: true };
  }
  const selectionSet = async () =>
    (
      await client.query<{ id: string; run_id: string }>(
        "select id, run_id from output_sets where tenant_id = $1 and client_selection_id = $2 for update",
        [tenantId, bySelection],
      )
    ).rows[0];
  if (choice.appendTo) {
    const named = await ownedSet(choice.appendTo);
    if (named.client_selection_id === bySelection) return { setId: named.id, created: false };
    if (named.client_selection_id) throw new OutputSelectionMismatchError(OUTPUT_SELECTION_MISMATCH);
    // A set this selection made before the migration was applied: it becomes the selection's set, unless the
    // selection already has another one (the unique index refuses a concurrent second claim the same way).
    if (await selectionSet()) throw new OutputSelectionMismatchError(OUTPUT_SELECTION_MISMATCH);
    await client.query("savepoint claim_selection");
    try {
      await client.query("update output_sets set client_selection_id = $2 where id = $1 and run_id = $3 and tenant_id = $4", [named.id, bySelection, runId, tenantId]);
    } catch (error) {
      await client.query("rollback to savepoint claim_selection");
      if ((error as { code?: string }).code === "23505") throw new OutputSelectionMismatchError(OUTPUT_SELECTION_MISMATCH);
      throw error;
    }
    return { setId: named.id, created: false };
  }
  const inserted = await client.query<{ id: string }>(
    `insert into output_sets (tenant_id, run_id, name, wave_label, source, client_selection_id) values ($1,$2,$3,$4,$5,$6)
     on conflict (tenant_id, client_selection_id) where client_selection_id is not null do nothing returning id`,
    [tenantId, runId, fresh.name, fresh.waveLabel, fresh.source, bySelection],
  );
  if (inserted.rowCount === 1) return { setId: inserted.rows[0].id, created: true };
  // Another request of the selection made it (committed, since the insert waited for it). A set it made and
  // then removed again, because none of its files could be stored, leaves no row; the request is refused as
  // gone rather than guessed at, and its retry creates the set afresh.
  const existing = await selectionSet();
  if (!existing || existing.run_id !== runId) throw new OutputSetGoneError(OUTPUT_SET_GONE);
  return { setId: existing.id, created: false };
}

/** Families over every file now in the set (assignFamilies), under a lock on the set so two appends cannot interleave. */
async function refreshSetFamilies(tenantId: string, runId: string, setId: string): Promise<void> {
  // withTenant is one transaction: the set's row lock is held until every family is written.
  await withTenant(tenantId, async (client) => {
    const set = await client.query("select id from output_sets where id = $1 and run_id = $2 and tenant_id = $3 for update", [setId, runId, tenantId]);
    if (set.rowCount !== 1) return;
    const docs = await client.query<{ id: string; output_path: string }>(
      "select id, output_path from documents where output_set_id = $1 and run_id = $2 and tenant_id = $3 and output_path is not null",
      [setId, runId, tenantId],
    );
    const families = assignFamilies(docs.rows.map((d) => d.output_path));
    for (const d of docs.rows) {
      await client.query("update documents set output_family = $2 where id = $1 and output_family is distinct from $2", [d.id, families.get(d.output_path) ?? null]);
    }
  });
}
