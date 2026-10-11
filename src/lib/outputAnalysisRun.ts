// Runs the set-level checks and the finding readers for one output set:
// loads each file's table from storage, calls the pure analysis, stores the
// checks on the set and, on request, writes the findings.

import * as XLSX from "xlsx";
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

async function loadSetFiles(tenantId: string, runId: string, setId: string): Promise<SetFileData[]> {
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
  return mapWithConcurrency(docs, 4, async (d) => {
    const ext = extOf(d.name);
    const kind = d.kind ?? "other_table";
    let table: Table | null = null;
    if (TABLE_EXT.has(ext) && !NO_TABLE_KINDS.has(kind) && d.storage_path) {
      try {
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path);
        if (!error && data) {
          const buf = Buffer.from(await data.arrayBuffer());
          table = ext === ".csv" || ext === ".tsv" ? parseDelimitedAll(buf.toString("utf8"), ext) : sheetToTable(buf);
        }
      } catch {
        table = null;
      }
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

async function storeChecks(tenantId: string, setId: string, value: StoredChecks) {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query("update output_sets set checks = $1 where id = $2", [JSON.stringify(value), setId]);
    });
  } catch {
    // Migration 0062 not applied yet: the checks still show for this visit.
  }
}

/** Runs the checks and stores them on the set. Writes no findings. */
export async function checkOutputSet(tenantId: string, runId: string, setId: string): Promise<{ analysis: SetAnalysis; stored: StoredChecks }> {
  const files = await loadSetFiles(tenantId, runId, setId);
  const analysis = analyseSet(files, { items: await loadQuestionnaireItems(tenantId, runId) });
  const stored: StoredChecks = {
    analysedAt: new Date().toISOString(),
    checks: analysis.checks,
    unread: analysis.unread,
    references: analysis.references.length,
    findings: analysis.findings.length,
    generatedAt: null,
  };
  await storeChecks(tenantId, setId, stored);
  return { analysis, stored };
}

/** Replaces the set's generated findings with a fresh set built from its evidence files. */
export async function generateOutputFindings(tenantId: string, runId: string, setId: string): Promise<{ findings: number; checks: StoredChecks }> {
  const files = await loadSetFiles(tenantId, runId, setId);
  const analysis = analyseSet(files, { items: await loadQuestionnaireItems(tenantId, runId) });
  const wave = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ wave_label: string | null; name: string }>("select wave_label, name from output_sets where id = $1 and run_id = $2", [setId, runId]);
    return r.rows[0] ?? { wave_label: null, name: "" };
  });
  const names = new Map(files.map((f) => [f.id, f.name]));
  await withTenant(tenantId, async (client) => {
    for (const f of files) {
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
  });
  const stored: StoredChecks = {
    analysedAt: new Date().toISOString(),
    checks: analysis.checks,
    unread: analysis.unread,
    references: analysis.references.length,
    findings: analysis.findings.length,
    generatedAt: new Date().toISOString(),
  };
  await storeChecks(tenantId, setId, stored);
  return { findings: analysis.findings.length, checks: stored };
}

/**
 * Compares two sets as waves: the same model terms and segments in both, asking
 * whether each change is larger than sampling error allows. Replaces the findings
 * from an earlier comparison of the same pair, after archiving them so any
 * review the researcher did on them is kept in history.
 */
export async function compareOutputSets(
  tenantId: string,
  runId: string,
  earlierId: string,
  laterId: string,
): Promise<{ findings: number; notes: string[] }> {
  if (earlierId === laterId) throw new Error("Pick two different sets.");
  const meta = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; name: string; wave_label: string | null }>(
      "select id, name, wave_label from output_sets where run_id = $1 and id = any($2::uuid[])",
      [runId, [earlierId, laterId]],
    );
    return new Map(r.rows.map((x) => [x.id, x]));
  });
  const a = meta.get(earlierId);
  const b = meta.get(laterId);
  if (!a || !b) throw new Error("One of the sets was not found.");
  const [fa, fb] = await Promise.all([loadSetFiles(tenantId, runId, earlierId), loadSetFiles(tenantId, runId, laterId)]);
  const label = (m: { name: string; wave_label: string | null }) => m.wave_label?.trim() || m.name;
  const { findings, notes } = compareWaves({ id: earlierId, label: label(a), files: fa }, { id: laterId, label: label(b), files: fb });
  const pair = `${earlierId}:${laterId}`;
  await withTenant(tenantId, async (client) => {
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

/** Moves every file of one set into another and removes the emptied set. Refuses when two files share a path. */
export async function mergeOutputSets(tenantId: string, runId: string, fromId: string, intoId: string): Promise<number> {
  if (fromId === intoId) throw new Error("Pick two different sets.");
  return withTenant(tenantId, async (client) => {
    const clash = await client.query(
      `select a.output_path from documents a join documents b on b.output_path = a.output_path
       where a.run_id = $1 and a.output_set_id = $2 and b.run_id = $1 and b.output_set_id = $3 limit 1`,
      [runId, fromId, intoId],
    );
    if (clash.rows.length > 0) throw new Error(`Both sets hold a file at ${clash.rows[0].output_path}, so they are not parts of one output. Compare them as waves instead.`);
    const moved = await client.query("update documents set output_set_id = $3 where run_id = $1 and output_set_id = $2", [runId, fromId, intoId]);
    await client.query("delete from output_sets where id = $1 and run_id = $2", [fromId, runId]);
    return moved.rowCount ?? 0;
  });
}
