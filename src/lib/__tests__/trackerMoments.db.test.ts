// Page 02 "Moments & needs" of the brand tracking dashboard (Grant's design, 29 October 2026) through the actual
// loader, loadBrandMoments: recognition from what was imported, figures from the Cross tab engine computed without
// saving a table, read by variable and answer code, with the dashboard's weight. Real disposable PostgreSQL and the
// actual engine; storage is an in-memory stand-in and the model is stubbed (never called).
// Expected values are computed independently by src/lib/__tests__/helpers/moment_reference.py (pandas over the same
// file, written from the pack's specification), never taken from the app:
//   1. BMW wave 1 as SPSS with labels only (1,000 respondents): every moment's relevance and every brand's recall for
//      every moment, weighted (the default) and unweighted (a researcher's choice), to 1e-6; the six rows are the six
//      most relevant moments by the reference; opening the page saves no table.
//   2. Boundary, the pack's first 60 respondents as CSV with metadata.json as the codebook: five respondents chose
//      "No relevant situation" (every moment 0) and stay in the base; three left one moment blank and leave that
//      moment's base only.
//   3. Unknown: the same CSV without the relevance question: "Not measured" and "Mapping needed", no figures.
//   4. Failure: a file that cannot be read rejects with the reason, never an empty page.
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "moment_reference.py");
type Shares = Record<"weighted" | "unweighted", Record<string, [number, number]>>;
function reference(file: string): Shares {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "shares", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function variant(kind: string, dir: string): string {
  const out = path.join(dir, `${kind}.csv`);
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "variant", packPath("wave1_first60.csv"), out, kind], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}
const MOMENTS = Array.from({ length: 12 }, (_, i) => `relevant_c${String(i + 1).padStart(2, "0")}`);

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Moments & needs figures against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "moments-"));
  let savRun = "";
  let sav = "";

  async function stored(run: string, kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  const newRun = async (name: string) => (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
  /** A CSV of the pack with metadata.json linked as its codebook, in a project of its own. */
  async function csvWithCodebook(file: string) {
    const run = await newRun("BMW car tracker");
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored(run, "instrument", "metadata.json", readFileSync(packPath("metadata.json")), "codebook");
    const data = await stored(run, "table", "Car_Brand_Tracker_Wave_1.csv", readFileSync(file));
    await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    return { run, data };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    savRun = await newRun("BMW car tracker");
    sav = await stored(savRun, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("BMW wave 1, weighted by default: every moment's relevance, the six most relevant, every brand's recall, equal to the reference to 1e-6; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav")).weighted;
    const { loadBrandMoments } = await import("../trackerMoments");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadBrandMoments(tenant, savRun, sav);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar]).toEqual([true, "weight"]);
    expect(m.effectiveBase).toBeGreaterThan(900);
    expect(m.relevance.status).toBe("ok");
    if (m.relevance.status !== "ok" || m.recall.status !== "ok") throw new Error("expected figures");
    expect(m.relevance.moments).toHaveLength(12);
    for (const x of m.relevance.moments) {
      expect(x.share, x.variable).toBeCloseTo(ref[x.variable][0], 6);
      expect(x.base).toBe(ref[x.variable][1]);
    }
    // The reference's own ranking, highest weighted share first.
    const topSix = [...MOMENTS].sort((a, b) => ref[b][0] - ref[a][0]).slice(0, 6);
    expect(m.recall.rows.map((r) => r.variable)).toEqual(topSix);
    expect(m.recall.withoutRecall).toEqual([]);
    expect(m.relevance.moments[0]).toMatchObject({ variable: "relevant_c02", item: "Reducing fuel and running costs" });
    let cells = 0;
    for (const r of m.recall.rows) {
      const c = r.variable.slice(-3); // c01..c12, the pack's moment code
      expect(r.cells.map((x) => x.code)).toEqual(m.dashboard.brands.map((b) => b.code));
      for (const cell of r.cells) {
        const b = String(Number(cell.code)).padStart(2, "0");
        expect(cell.variable).toBe(`cep_${c}_b${b}`);
        expect(cell.share, cell.variable).toBeCloseTo(ref[cell.variable][0], 6);
        expect(cell.base).toBe(1000);
        cells += 1;
      }
    }
    expect(cells).toBe(60);
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav")).unweighted;
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadBrandMoments } = await import("../trackerMoments");
      const m = await loadBrandMoments(tenant, savRun, sav);
      expect([m.weighted, m.effectiveBase]).toEqual([false, null]);
      if (m.relevance.status !== "ok" || m.recall.status !== "ok") throw new Error("expected figures");
      for (const x of m.relevance.moments) expect(x.share, x.variable).toBeCloseTo(ref[x.variable][0], 6);
      for (const r of m.recall.rows) for (const cell of r.cells) expect(cell.share, cell.variable).toBeCloseTo(ref[cell.variable][0], 6);
      expect(m.recall.rows.map((r) => r.variable)).toEqual([...MOMENTS].sort((a, b) => ref[b][0] - ref[a][0] || MOMENTS.indexOf(a) - MOMENTS.indexOf(b)).slice(0, 6));
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: \"No relevant situation\" stays in the base as not selecting; a blank answer leaves only that moment's base", async () => {
    const file = variant("none_and_blank", dir);
    const ref = reference(file).weighted;
    expect(ref.relevant_c01[1]).toBe(60);
    expect(ref.relevant_c02[1]).toBe(57);
    const { run, data } = await csvWithCodebook(file);
    const { loadBrandMoments } = await import("../trackerMoments");
    const m = await loadBrandMoments(tenant, run, data);
    expect(m.weighted).toBe(true);
    if (m.relevance.status !== "ok") throw new Error(m.relevance.reason);
    expect(m.relevance.group).toBe("category_situations");
    const byVar = new Map(m.relevance.moments.map((x) => [x.variable, x]));
    for (const v of MOMENTS) {
      expect(byVar.get(v)!.share, v).toBeCloseTo(ref[v][0], 6);
      expect(byVar.get(v)!.base, v).toBe(ref[v][1]);
    }
    expect(byVar.has("relevant_none")).toBe(false);
  });

  it("unknown: without the relevance question the page says Not measured and Mapping needed, with no figures (never zeros)", async () => {
    const { run, data } = await csvWithCodebook(variant("no_relevance", dir));
    const { loadBrandMoments } = await import("../trackerMoments");
    const m = await loadBrandMoments(tenant, run, data);
    expect(m.relevance).toMatchObject({ status: "not_measured" });
    expect(m.recall).toMatchObject({ status: "mapping_needed" });
    expect(m.recall.status === "mapping_needed" && m.recall.reason).toMatch(/category relevance/);
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again the page returns", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadBrandMoments } = await import("../trackerMoments");
    await expect(loadBrandMoments(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadBrandMoments(tenant, run, doc)).relevance.status).toBe("ok");
  });
});
