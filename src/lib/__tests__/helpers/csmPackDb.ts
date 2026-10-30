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
