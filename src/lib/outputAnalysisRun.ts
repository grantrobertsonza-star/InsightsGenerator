// Runs the set-level checks and the finding readers for one output set:
// loads each file's table from storage, calls the pure analysis, stores the
// checks on the set and, on request, writes the findings. Every entry point
// checks that the set is the run's own first (Codex DI-F01, DI-F03).

import * as XLSX from "xlsx";
import type { PoolClient } from "pg";
import { mapWithConcurrency } from "./concurrency";
import { withTenant } from "./db";
import { archiveAndReplaceFindings } from "./findingArchive";
import { getInstrumentItems } from "./instruments";
import type { ItemLike } from "./instrumentMatch";
import { analyseSet, type SetAnalysis, type SetCheck, type SetFileData, type Table } from "./outputAnalysis";
import { parseDelimitedAll, type OutputKind, type OutputRole } from "./outputClassify";
import { compareWaves } from "./outputWaves";
import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";
const TABLE_EXT = new Set([".csv", ".tsv", ".xlsx", ".xls"]);
const NO_TABLE_KINDS = new Set<OutputKind>(["console_log", "session_info", "author_notes", "word_tables", "other_document"]);

export type StoredChecks = {
  analysedAt: string;
  checks: SetCheck[];
  unread: { fileId: string; fileName: string; reason: string }[];
  references: number;
  findings: number;
  generatedAt: string | null;
};

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
};

function sheetToTable(buf: Buffer): Table | null {
  const wb = XLSX.read(buf, { type: "buffer" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    if (nonEmpty.length < 2) continue;
    const headers = nonEmpty[0].map((c) => String(c).trim());
    return { headers, rows: nonEmpty.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? ""))) };
  }
  return null;
}

/**
 * A set's files with their tables. `unreadable` names the files that should have a table (a table
 * file of a table kind with a stored copy) but whose table could not be read: the download failed,
 * the stored file is missing, or it held no table. Codex DI-F02: their earlier findings are kept,
 * never retired by a reading that did not read them.
 */
type LoadedSet = { files: SetFileData[]; unreadable: Set<string> };

async function loadSetFiles(tenantId: string, runId: string, setId: string): Promise<LoadedSet> {
  const docs = await withTenant(tenantId, async (client) => {
    const r = await client.query<{
      id: string; name: string; path: string | null; family: string | null; role: OutputRole | null; kind: OutputKind | null;
      storage_path: string | null; text: string | null;
    }>(
      `select id, source_filename as name, output_path as path, output_family as family, output_role as role, output_kind as kind,
              storage_path, extracted_text as text
       from documents where run_id = $1 and output_set_id = $2 and kind = 'output' order by output_path`,
      [runId, setId],
    );
    return r.rows;
  });
  const unreadable = new Set<string>();
  const files = await mapWithConcurrency(docs, 4, async (d) => {
    const ext = extOf(d.name);
    const kind = d.kind ?? "other_table";
    let table: Table | null = null;
    const tableExpected = TABLE_EXT.has(ext) && !NO_TABLE_KINDS.has(kind) && Boolean(d.storage_path);
    if (tableExpected && d.storage_path) {
      try {
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path);
        if (!error && data) {
          const buf = Buffer.from(await data.arrayBuffer());
          table = ext === ".csv" || ext === ".tsv" ? parseDelimitedAll(buf.toString("utf8"), ext) : sheetToTable(buf);
        }
      } catch {
        table = null;
      }
      if (!table) unreadable.add(d.id);
    }
    return {
      id: d.id,
      name: d.name,
      path: d.path ?? d.name,
      family: d.family ?? "Other files",
      role: d.role ?? "unclassified",
      kind,
      table,
      text: d.text,
    } satisfies SetFileData;
  });
  return { files, unreadable };
}

/** Items of every questionnaire attached to the run, for suggesting wording behind term labels. Empty before migration 0060. */
async function loadQuestionnaireItems(tenantId: string, runId: string): Promise<ItemLike[]> {
  try {
    const ids = await withTenant(tenantId, async (client) => {
      const r = await client.query<{ id: string }>("select id from documents where run_id = $1 and kind = 'instrument' and instrument_type = 'questionnaire'", [runId]);
      return r.rows.map((x) => x.id);
    });
    const out: ItemLike[] = [];
    for (const id of ids) for (const it of await getInstrumentItems(tenantId, id)) out.push({ id: it.id, code: it.code, text: it.text });
    return out;
  } catch {
    return [];
  }
}

/**
 * Confirms that the set is this run's and this tenant's and locks it for the transaction; throws,
 * before anything is read or written, when it is not (Codex DI-F01, DI-F03).
 */
async function lockOwnedSet(client: PoolClient, tenantId: string, runId: string, setId: string): Promise<void> {
  const own = await client.query("select id from output_sets where id = $1 and run_id = $2 and tenant_id = $3 for update", [setId, runId, tenantId]);
  if (!own.rows[0]) throw new Error("That output set is not in this project; it may have been removed. Reload the page.");
}

let checksColumn: boolean | null = null;
/** Migration 0062's column. Its absence is the one case where checks are shown without being saved. */
async function checksColumnAvailable(client: PoolClient): Promise<boolean> {
  if (checksColumn) return true;
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'output_sets' and column_name = 'checks'",
  );
  checksColumn = r.rows[0]?.n === 1;
  return checksColumn;
}

/**
 * Codex DI-F03: the checks were written by set id alone and every failure was taken for a missing
 * migration, so a request naming another project's set overwrote that set's checks, and a failed
 * write was reported as stored. Now the owned set is locked and the write must change its row; any
 * failure is thrown. Only migration 0062's absence returns `saved: false` (shown for this visit,
 * and said so on screen).
 */
async function storeChecks(client: PoolClient, tenantId: string, runId: string, setId: string, value: StoredChecks): Promise<boolean> {
  if (!(await checksColumnAvailable(client))) return false;
  const r = await client.query("update output_sets set checks = $1 where id = $2 and run_id = $3 and tenant_id = $4", [JSON.stringify(value), setId, runId, tenantId]);
  if (r.rowCount !== 1) throw new Error("The checks could not be saved: the output set is no longer in this project. Reload the page.");
  return true;
}

/** Runs the checks and stores them on the set. Writes no findings. */
export async function checkOutputSet(tenantId: string, runId: string, setId: string): Promise<{ analysis: SetAnalysis; stored: StoredChecks; saved: boolean }> {
  await withTenant(tenantId, (client) => lockOwnedSet(client, tenantId, runId, setId));
  const { files } = await loadSetFiles(tenantId, runId, setId);
  const analysis = analyseSet(files, { items: await loadQuestionnaireItems(tenantId, runId) });
  const stored: StoredChecks = {
    analysedAt: new Date().toISOString(),
    checks: analysis.checks,
    unread: analysis.unread,
    references: analysis.references.length,
    findings: analysis.findings.length,
    generatedAt: null,
  };
  const saved = await withTenant(tenantId, async (client) => {
    await lockOwnedSet(client, tenantId, runId, setId);
    return storeChecks(client, tenantId, runId, setId, stored);
  });
  return { analysis, stored, saved };
}

/**
 * Replaces the set's generated findings with a fresh set built from its evidence files.
 *
 * Codex DI-F02: a file whose table could not be read used to have its findings retired all the same,
 * so an unreadable download removed reviewed findings and put nothing in their place. Now:
 * - every file that should have a table is unreadable: nothing is retired or written, and the
 *   reading fails with the files named, so it can be retried;
 * - some are unreadable: the readable files' findings are replaced and the unreadable files keep
 *   their findings (`kept`); the stored checks list them as unread, and the screen says so;
 * - all readable: every file's findings are replaced, as before.
 * The set is locked and checked as this run's first (DI-F01/F03), and the findings and the checks are
 * written in one transaction.
 */
export async function generateOutputFindings(
  tenantId: string,
  runId: string,
  setId: string,
): Promise<{ findings: number; checks: StoredChecks; saved: boolean; keptFrom: string[] }> {
  await withTenant(tenantId, (client) => lockOwnedSet(client, tenantId, runId, setId));
  const { files, unreadable } = await loadSetFiles(tenantId, runId, setId);
  const expectingTables = files.filter((f) => unreadable.has(f.id) || f.table);
  if (expectingTables.length > 0 && expectingTables.every((f) => unreadable.has(f.id))) {
    throw new Error(
      `None of this set's table files could be read (${expectingTables.map((f) => f.name).join(", ")}), so no findings were replaced. ` +
        "Try again; if it keeps failing, upload the files again.",
    );
  }
  const analysis = analyseSet(files, { items: await loadQuestionnaireItems(tenantId, runId) });
  const names = new Map(files.map((f) => [f.id, f.name]));
  const now = new Date().toISOString();
  const stored: StoredChecks = {
    analysedAt: now,
    checks: analysis.checks,
    unread: analysis.unread,
    references: analysis.references.length,
    findings: analysis.findings.length,
    generatedAt: now,
  };
  const saved = await withTenant(tenantId, async (client) => {
    await lockOwnedSet(client, tenantId, runId, setId);
    const wave = (await client.query<{ wave_label: string | null; name: string }>("select wave_label, name from output_sets where id = $1 and run_id = $2", [setId, runId])).rows[0];
    for (const f of files) {
      if (unreadable.has(f.id)) continue;
      await archiveAndReplaceFindings(client, { documentColumn: "source_document_id", documentId: f.id, onlyRejected: false, archiveReason: "manual_reextract" });
    }
    for (const f of analysis.findings) {
      const assurance = f.caveats.map((c) => ({ severity: c.severity, text: c.text, fileName: c.fileName }));
      await client.query(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_document_id, data_type, status)
         values ($1, $2, 'generated', $3, $4, $5, $6, $7, 'quantitative', 'accepted')`,
        [
          tenantId,
          runId,
          f.text,
          f.theme,
          f.patternType,
          JSON.stringify({ ...f.stats, assurance, outputSetId: setId, outputSetName: wave.name, wave: wave.wave_label, sourceFile: names.get(f.sourceFileId) ?? null }),
          f.sourceFileId,
        ],
      );
    }
    return storeChecks(client, tenantId, runId, setId, stored);
  });
  return { findings: analysis.findings.length, checks: stored, saved, keptFrom: files.filter((f) => unreadable.has(f.id)).map((f) => f.name) };
}

/**
 * Compares two sets as waves: the same model terms and segments in both, asking
 * whether each change is larger than sampling error allows. Replaces the findings
 * from an earlier comparison of the same pair, after archiving them so any
 * review the researcher did on them is kept in history.
 *
 * Codex DI-F02 (batch21-23 review): a comparison used to go ahead when a file of either set could not
 * be read, so the earlier comparison's reviewed findings were retired and "0 change findings" was
 * reported as if there were nothing to compare. A comparison is only valid when both waves were read
 * in full, so any unreadable file (the same read outcome as `generateOutputFindings`) refuses the whole
 * comparison, naming the files, before anything is retired. Both sets are locked and checked as this
 * run's and this tenant's first, and again in the writing transaction.
 */
export async function compareOutputSets(
  tenantId: string,
  runId: string,
  earlierId: string,
  laterId: string,
): Promise<{ findings: number; notes: string[] }> {
  if (earlierId === laterId) throw new Error("Pick two different sets.");
  const lockBoth = (client: PoolClient) =>
    [earlierId, laterId].sort().reduce<Promise<void>>((p, id) => p.then(() => lockOwnedSet(client, tenantId, runId, id)), Promise.resolve());
  const meta = await withTenant(tenantId, async (client) => {
    await lockBoth(client);
    const r = await client.query<{ id: string; name: string; wave_label: string | null }>(
      "select id, name, wave_label from output_sets where run_id = $1 and tenant_id = $2 and id = any($3::uuid[])",
      [runId, tenantId, [earlierId, laterId]],
    );
    return new Map(r.rows.map((x) => [x.id, x]));
  });
  const a = meta.get(earlierId)!;
  const b = meta.get(laterId)!;
  const [la, lb] = await Promise.all([loadSetFiles(tenantId, runId, earlierId), loadSetFiles(tenantId, runId, laterId)]);
  const unread = [...la.files.filter((f) => la.unreadable.has(f.id)), ...lb.files.filter((f) => lb.unreadable.has(f.id))].map((f) => f.name);
  if (unread.length > 0) {
    throw new Error(
      `${unread.join(", ")} could not be read, so the waves were not compared and the earlier comparison's findings were kept. ` +
        "Try again; if it keeps failing, upload the files again.",
    );
  }
  const label = (m: { name: string; wave_label: string | null }) => m.wave_label?.trim() || m.name;
  const { findings, notes } = compareWaves({ id: earlierId, label: label(a), files: la.files }, { id: laterId, label: label(b), files: lb.files });
  const pair = `${earlierId}:${laterId}`;
  await withTenant(tenantId, async (client) => {
    await lockBoth(client);
    // The earlier comparison's findings are archived first (review status, notes, verdicts and what was built on them), then replaced.
    await archiveAndReplaceFindings(client, { documentColumn: "wave_pair", documentId: runId, wavePair: pair, onlyRejected: false, archiveReason: "wave_recompare" });
    for (const f of findings) {
      const assurance = f.caveats.map((c) => ({ severity: c.severity, text: c.text, fileName: c.fileName }));
      await client.query(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_document_id, data_type, status)
         values ($1, $2, 'generated', $3, $4, $5, $6, $7, 'quantitative', 'accepted')`,
        [tenantId, runId, f.text, f.theme, f.patternType, JSON.stringify({ ...f.stats, assurance, wavePair: pair }), f.sourceFileId],
      );
    }
  });
  return { findings: findings.length, notes };
}

/**
 * Moves every file of one set into another and removes the emptied set. Refuses when two files share a
 * path. Codex DI-F01: both sets are locked and checked as this run's and this tenant's before anything
 * is read or moved (a foreign or other-project destination used to be accepted, leaving this
 * project's files pointing at another project's set); a missing source is refused rather than
 * reported as nothing moved. Documents already pointing at a set outside their project are left as
 * they are; they are not loaded with either set.
 */
export async function mergeOutputSets(tenantId: string, runId: string, fromId: string, intoId: string): Promise<number> {
  if (fromId === intoId) throw new Error("Pick two different sets.");
  return withTenant(tenantId, async (client) => {
    // One lock order (by id) for both sets, so two merges of the same pair cannot deadlock.
    const owned = await client.query<{ id: string }>(
      "select id from output_sets where id = any($1::uuid[]) and run_id = $2 and tenant_id = $3 order by id for update",
      [[fromId, intoId], runId, tenantId],
    );
    if (owned.rows.length !== 2) throw new Error("One of the sets is not in this project; it may have been removed. Reload the page.");
    const clash = await client.query(
      `select a.output_path from documents a join documents b on b.output_path = a.output_path
       where a.run_id = $1 and a.output_set_id = $2 and b.run_id = $1 and b.output_set_id = $3 limit 1`,
      [runId, fromId, intoId],
    );
    if (clash.rows.length > 0) throw new Error(`Both sets hold a file at ${clash.rows[0].output_path}, so they are not parts of one output. Compare them as waves instead.`);
    const moved = await client.query("update documents set output_set_id = $3 where run_id = $1 and output_set_id = $2 and tenant_id = $4", [runId, fromId, intoId, tenantId]);
    const removed = await client.query("delete from output_sets where id = $1 and run_id = $2 and tenant_id = $3", [fromId, runId, tenantId]);
    if (removed.rowCount !== 1) throw new Error("The emptied set could not be removed, so nothing was moved. Try again.");
    return moved.rowCount ?? 0;
  });
}
