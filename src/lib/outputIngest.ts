import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { mapWithConcurrency } from "./concurrency";
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
 */
export async function ingestOutputFiles(
  tenantId: string,
  runId: string,
  files: File[],
  options: { name?: string; waveLabel?: string; appendTo?: string } = {},
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

  const created = !options.appendTo;
  const setId = await withTenant(tenantId, async (client) => {
    if (options.appendTo) {
      const r = await client.query<{ id: string }>("select id from output_sets where id = $1 and run_id = $2 and tenant_id = $3", [options.appendTo, runId, tenantId]);
      if (r.rowCount !== 1) throw new OutputSetGoneError(OUTPUT_SET_GONE);
      return r.rows[0].id;
    }
    const r = await client.query<{ id: string }>(
      "insert into output_sets (tenant_id, run_id, name, wave_label, source) values ($1,$2,$3,$4,$5) returning id",
      [tenantId, runId, setName, options.waveLabel?.trim() || null, source],
    );
    return r.rows[0].id;
  });

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
  if (!created) await refreshSetFamilies(tenantId, runId, setId);
  return { setId, added, skipped };
}

export const OUTPUT_SET_GONE =
  "The statistical output set these files belong to is no longer in this project (it may have been removed to the bin), so they were not added. Choose them again to start a new set.";

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
