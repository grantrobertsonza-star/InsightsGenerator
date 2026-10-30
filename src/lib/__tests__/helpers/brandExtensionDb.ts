// Shared set-up for the brand dashboard extension's database tests (r6brandext): a disposable PostgreSQL database,
// data files held by an in-memory storage stand-in (the test file mocks supabaseAdmin with it), and the pack's
// reference values. Test files keep their own vi.mock calls (vitest hoists them per file).
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { createDisposableDb, type DisposableDb } from "./disposableDb";
import { PYTHON } from "./pythonEngine";
import type { BrandExtension } from "../../brandExtension";

export const BRAND_PACKS = path.join(process.cwd(), "fixtures", "packs-2026-10-30", "brand");
export const PACK = {
  banks: { dir: path.join(BRAND_PACKS, "banks"), ref: path.join(BRAND_PACKS, "banks", "test-reference"), prefix: "Bank", columns: 550 },
  insurers: { dir: path.join(BRAND_PACKS, "insurers"), ref: path.join(BRAND_PACKS, "insurers", "test-reference"), prefix: "Insurer", columns: 550 },
  telecoms: { dir: path.join(BRAND_PACKS, "telecoms"), ref: path.join(BRAND_PACKS, "telecoms", "test-reference"), prefix: "Mobile", columns: 551 },
  // The car pack keeps its test reference files beside the data (no test-reference folder).
  cars: { dir: path.join(BRAND_PACKS, "cars"), ref: path.join(BRAND_PACKS, "cars"), prefix: "Car", columns: 543 },
} as const;
export type PackName = keyof typeof PACK;
export const HELPER = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "brand_extension_reference.py");

export function python(args: string[]): string {
  const r = spawnSync(PYTHON, ["-I", HELPER, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

export type RefRow = { wave: number; chart: string; metric: string; brand: string; item: string; expected: number | null; numerator: number; denominator: number; raw_base: number; unit: string; weighting: "weighted" | "unweighted" };
export function packReferences(pack: PackName): { json: RefRow[]; xlsx: RefRow[] } {
  const json = (JSON.parse(readFileSync(path.join(PACK[pack].ref, "reference_results.json"), "utf8")).results as RefRow[]).filter((r) => r.chart === "Measurement extension");
  const xlsx = JSON.parse(python(["xlsx-refs", path.join(PACK[pack].dir, "Reference_Metrics.xlsx")])) as RefRow[];
  return { json, xlsx };
}

export type Harness = {
  db: DisposableDb;
  tenant: string;
  q: (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
  newRun: (name: string) => Promise<string>;
  stored: (run: string, kind: "instrument" | "table", name: string, bytes: Buffer, type?: string | null) => Promise<string>;
  drop: () => Promise<void>;
};

export async function harness(storage: { objects: Map<string, Buffer> }): Promise<Harness> {
  const db = await createDisposableDb();
  const tenant = randomUUID();
  process.env.DATABASE_URL = db.url;
  process.env.DEFAULT_TENANT_ID = tenant;
  (globalThis as { pgPool?: unknown }).pgPool = undefined;
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  return {
    db,
    tenant,
    q,
    newRun: async (name) => (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string,
    stored: async (run, kind, name, bytes, type = null) => {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.objects.set(key, bytes);
      return (await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
      ))[0].id as string;
    },
    drop: async () => {
      const { pool } = await import("../../db");
      await pool.end().catch(() => {});
      await db.drop();
    },
  };
}

const STEM: Record<string, "needs_fit" | "differentiation" | "price_justification"> = { needsfit: "needs_fit", different: "differentiation", pricejustify: "price_justification" };

/** The app's figure for one reference row: [value, numerator, denominator, raw base]. */
export function appFigure(ext: BrandExtension, r: RefRow): [number | null, number | null, number | null, number | null] {
  const m = r.metric;
  const stem = m.split("_")[0];
  if (STEM[stem]) {
    const mod = ext.ratings[STEM[stem]];
    if (mod.status !== "ok") throw new Error(`${m}: ${mod.reason}`);
    const b = mod.brands.find((x) => x.label === r.brand);
    if (!b) throw new Error(`${m}: no brand ${r.brand}`);
    const kind = m.slice(m.lastIndexOf("_") + 1);
    if (kind === "top2") return [b.topTwo, b.distribution.slice(-2).reduce((a, d) => a + d.weighted, 0), b.valid.weighted, b.valid.n];
    if (kind === "mean") return [b.mean, b.distribution.reduce((a, d) => a + Number(d.code) * d.weighted, 0), b.valid.weighted, b.valid.n];
    return [b.cannotJudge.share, b.cannotJudge.weighted, b.aware.weighted, b.aware.n];
  }
  const e = ext.episode;
  if (m.startsWith("choice_barrier_")) {
    const rs = ext.reasons;
    if (rs.status !== "ok") throw new Error(`${m}: ${rs.reason}`);
    const v = m.replace(/_rate$/, "");
    const o = rs.overall;
    const row = [...o.reasons, o.none, o.cannotRecall].find((x) => x?.variable === v);
    if (!row) throw new Error(`${m}: no reason row`);
    return [row.share, row.weighted, o.completed.weighted, o.completed.n];
  }
  if (e.status !== "ok") throw new Error(`${m}: ${e.reason}`);
  if (m === "choice_gap_rate") return [e.gap.rate, e.gap.weighted, e.paired.weighted, e.paired.n];
  const side = m === "choice_actual_share" ? "actual" : "ideal";
  const row = e.shares.find((s) => s.label === r.brand);
  if (!row) throw new Error(`${m}: no brand ${r.brand}`);
  return [row[side].share, row[side].weighted, e.paired.weighted, e.paired.n];
}

/** Tolerance: 1e-6 on every value, numerator and denominator (the pack stores eight decimals); raw bases exact. */
export const TOLERANCE = 1e-6;
export function expectReference(ext: BrandExtension, rows: RefRow[]): number {
  let n = 0;
  for (const r of rows) {
    const [v, num, den, raw] = appFigure(ext, r);
    const what = `${r.metric} ${r.brand} wave ${r.wave} ${r.weighting}`;
    if (r.expected === null) expect(v, what).toBeNull();
    else expect(Math.abs((v ?? NaN) - r.expected), what).toBeLessThan(TOLERANCE);
    expect(Math.abs((num ?? NaN) - r.numerator), `${what} numerator`).toBeLessThan(TOLERANCE);
    expect(Math.abs((den ?? NaN) - r.denominator), `${what} denominator`).toBeLessThan(TOLERANCE);
    expect(raw, `${what} raw base`).toBe(r.raw_base);
    n += 1;
  }
  return n;
}
