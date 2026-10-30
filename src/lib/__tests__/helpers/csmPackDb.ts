// R6 CSM extension tests: a disposable project per CSM pack sector, its nine workbooks (three waves of the
// Relationship, Channel and Noncustomer families) stored in the in-memory storage stand-in and inserted as raw data
// files labelled Wave 1 to 3, exactly as Import data labels them. The files are the pack's own XLSX (first data
// sheet, embedded Codebook, Labels and MR sets); the optional test-reference JSON is never imported.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DisposableDb } from "./disposableDb";

export const PACK = path.join(process.cwd(), "fixtures", "packs-2026-10-30", "csm");
export const SECTORS = { banking: "Banking", mobile: "Mobile" } as const;
export type Sector = keyof typeof SECTORS;
export const FAMILIES = ["Relationship", "Channel", "Noncustomer"] as const;
export type Family = (typeof FAMILIES)[number];

export type PackRef = { wave: number; dataset: Family; company: number; channel: number; variable: string; statistic: string; expected: number | null; numerator: number; weighted_base: number; raw_base: number; unit: string };
export const packReferences = (sector: Sector): PackRef[] => JSON.parse(readFileSync(path.join(PACK, sector, "test-reference", "reference_results.json"), "utf8"));
export const packFileName = (sector: Sector, family: Family, wave: number) => `${SECTORS[sector]}_CSM_${family}_Wave_${wave}.xlsx`;

export type PackDocs = Record<number, Record<Family, string>>;

/** Inserts a project with the sector's nine files; `bytesOf` may substitute a file's bytes (weight rescaling). */
export async function insertPack(
  db: DisposableDb,
  tenant: string,
  sector: Sector,
  storage: Map<string, Buffer>,
  options: { waves?: number[]; families?: readonly Family[]; bytesOf?: (family: Family, wave: number, bytes: Buffer) => Buffer; projectName?: string } = {},
): Promise<{ run: string; docs: PackDocs }> {
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const run = (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, options.projectName ?? `${SECTORS[sector]} CSM`]))[0].id as string;
  const docs: PackDocs = {};
  let minute = 0;
  for (const w of options.waves ?? [1, 2, 3]) {
    docs[w] = {} as Record<Family, string>;
    for (const family of options.families ?? FAMILIES) {
      const name = packFileName(sector, family, w);
      const raw = readFileSync(path.join(PACK, sector, name));
      const bytes = options.bytesOf ? options.bytesOf(family, w, raw) : raw;
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.set(key, bytes);
      docs[w][family] = (await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, uploaded_at)
         values ($1, $2, 'table', 'raw', $3, $4, $5, now() + ($6 || ' minutes')::interval) returning id`,
        [tenant, run, name, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: `2026-0${[2, 6, 9][w - 1]}` }), String(minute++)],
      ))[0].id as string;
    }
  }
  return { run, docs };
}

/** The combined pack (company and channel answers on one customer row; fixtures/packs-2026-10-30/csm-combined). */
export const COMBINED = path.join(process.cwd(), "fixtures", "packs-2026-10-30", "csm-combined");
export type CombinedRef = { wave: number; section: string; company: number; channel: number; variable: string; statistic: string; expected: number | null; numerator: number; weighted_base: number; raw_base: number; unit: string; record_basis: string; source_variable: string };
/** reference/Reference_Metrics.csv of a combined sector, parsed (numbers as numbers, blank expected as null). */
export function combinedReferences(sector: Sector): CombinedRef[] {
  const text = readFileSync(path.join(COMBINED, sector, "reference", "Reference_Metrics.csv"), "utf8").replace(/^\uFEFF/, "");
  const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.length > 0);
  const cols = head.split(",");
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    const r = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    const num = (k: string) => (r[k] === "" || r[k] === undefined ? null : Number(r[k]));
    return { wave: num("wave")!, section: r.section, company: num("company")!, channel: num("channel")!, variable: r.variable, statistic: r.statistic, expected: num("expected"), numerator: num("numerator")!, weighted_base: num("weighted_base")!, raw_base: num("raw_base")!, unit: r.unit, record_basis: r.record_basis, source_variable: r.source_variable };
  });
}

/** Any list of files inserted as raw data files of one new project, each with its wave label. */
export async function insertFiles(db: DisposableDb, tenant: string, storage: Map<string, Buffer>, projectName: string, files: { file: string; wave: string; bytes?: Buffer }[]): Promise<{ run: string; docs: string[] }> {
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const run = (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, projectName]))[0].id as string;
  const docs: string[] = [];
  for (const [i, f] of files.entries()) {
    const name = path.basename(f.file);
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.set(key, f.bytes ?? readFileSync(f.file));
    docs.push((await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, uploaded_at)
       values ($1, $2, 'table', 'raw', $3, $4, $5, now() + ($6 || ' minutes')::interval) returning id`,
      [tenant, run, name, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: f.wave, waveDate: null }), String(i)],
    ))[0].id as string);
  }
  return { run, docs };
}

/** A combined sector's wave file and its noncustomer supplement. */
export const combinedFile = (sector: Sector, wave: number | "all") =>
  path.join(COMBINED, sector, "data", `${SECTORS[sector]}_CSM_Combined_${wave === "all" ? "All_Waves" : `Wave_${wave}`}.xlsx`);
export const combinedNoncustomerFile = (sector: Sector, wave: number) => path.join(COMBINED, sector, "supplemental_noncustomers", `${SECTORS[sector]}_CSM_Noncustomer_Wave_${wave}.xlsx`);
