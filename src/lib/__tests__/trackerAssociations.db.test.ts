// Page 03 "Brand associations" of the brand tracking dashboard (Grant's design, 29 October 2026) through the actual
// loader, loadBrandAssociations: recognition from what was imported, figures from the Cross tab engine computed
// without saving a table, each brand's cells among the respondents aware of it (selected by the raw awareness code),
// with the dashboard's weight. Real disposable PostgreSQL and the actual engine; storage is an in-memory stand-in
// and the model is stubbed (never called).
// Expected values are computed independently by src/lib/__tests__/helpers/association_reference.py (pandas over
// the same file, written from the pack's specification), never taken from the app, and BMW's own values are also
// compared with the pack's published reference table (claude/tracker-packs-role-spec-2026-10-28.md, section 4.2):
//   1. BMW wave 1 as SPSS with labels only (1,000 respondents): all 100 brand x attribute shares and their bases,
//      and every brand's aware base, weighted (the default) and unweighted, to 1e-6; opening the page saves no table.
//   2. Boundary, the pack's first 60 respondents as CSV with metadata.json as the codebook: four respondents not
//      aware of BMW are given BMW associations (outside the base, never counted); three aware respondents answer
//      don't know for Reliable (in the base, as not associating); two leave one BMW cell blank (outside that cell's
//      base only).
//   3. Unknown: awareness unmapped by the researcher is "Mapping needed" (never all respondents as the base); a file
//      without the association grid is "Not measured".
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

vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "association_reference.py");
type Shares = Record<"weighted" | "unweighted", Record<string, [number, number]>> & { aware_n: Record<string, number> };
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
const ATTRIBUTES = ["Reliable", "Affordable to run", "Good value for money", "Safe", "Comfortable", "Enjoyable to drive", "Advanced technology", "Premium quality", "Environmentally responsible", "Good dealer and aftersales support"];
// The pack's published BMW associations among the BMW-aware, wave 1, to two decimals (spec section 4.2).
const PUBLISHED_BMW_W1 = {
  unweighted: [36.22, 35.38, 36.82, 32.73, 35.86, 62.58, 66.06, 65.1, 34.18, 36.46],
  weighted: [36.79, 34.66, 36.36, 32.38, 36.0, 62.73, 66.05, 65.0, 34.43, 35.68],
};
const brandKey = (code: string) => `b${String(Number(code)).padStart(2, "0")}`;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Brand associations figures against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "associations-"));
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
  /** Every cell of the page equal to the reference, with every brand's aware base. */
  function expectReference(m: Awaited<ReturnType<typeof import("../trackerAssociations").loadBrandAssociations>>, ref: Record<string, [number, number]>, awareN: Record<string, number>) {
    if (m.profile.status !== "ok") throw new Error(m.profile.reason);
    expect(m.profile.bases.map((b) => b.code)).toEqual(m.dashboard.brands.map((b) => b.code));
    for (const b of m.profile.bases) {
      expect(b.reason, b.code).toBeUndefined();
      expect(b.n, b.code).toBe(awareN[brandKey(b.code)]);
    }
    let cells = 0;
    for (const a of m.profile.attributes) {
      expect(a.cells.map((c) => c.code)).toEqual(m.dashboard.brands.map((b) => b.code));
      for (const c of a.cells) {
        expect(c.variable).toBe(`attr_${a.group.slice(-3)}_${brandKey(c.code)}`);
        expect(c.share, c.variable).toBeCloseTo(ref[c.variable][0], 6);
        expect(c.base, c.variable).toBe(ref[c.variable][1]);
        cells += 1;
      }
    }
    return cells;
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

  it("BMW wave 1, weighted by default: all 100 cells and every aware base equal to the reference to 1e-6, BMW equal to the pack's published values; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { loadBrandAssociations } = await import("../trackerAssociations");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadBrandAssociations(tenant, savRun, sav);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar]).toEqual([true, "weight"]);
    if (m.profile.status !== "ok") throw new Error(m.profile.reason);
    expect(m.profile.attributes.map((a) => a.item)).toEqual(ATTRIBUTES);
    expect(expectReference(m, ref.weighted, ref.aware_n)).toBe(100);
    const bmw = m.profile.bases.find((b) => b.code === "8")!;
    expect(bmw.n).toBe(831);
    expect(bmw.effectiveBase).toBeGreaterThan(700);
    expect(bmw.effectiveBase).toBeLessThan(831);
    m.profile.attributes.forEach((a, i) => expect(Math.abs(a.cells.find((c) => c.code === "8")!.share! - PUBLISHED_BMW_W1.weighted[i]), a.item).toBeLessThan(0.005 + 1e-9));
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference and the pack's published values", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadBrandAssociations } = await import("../trackerAssociations");
      const m = await loadBrandAssociations(tenant, savRun, sav);
      expect(m.weighted).toBe(false);
      expect(expectReference(m, ref.unweighted, ref.aware_n)).toBe(100);
      if (m.profile.status !== "ok") throw new Error(m.profile.reason);
      expect(m.profile.bases.every((b) => b.effectiveBase === null)).toBe(true);
      m.profile.attributes.forEach((a, i) => expect(Math.abs(a.cells.find((c) => c.code === "8")!.share! - PUBLISHED_BMW_W1.unweighted[i]), a.item).toBeLessThan(0.005 + 1e-9));
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: answers from respondents not aware of the brand never count; don't know stays in the base; a blank leaves that cell's base only", async () => {
    const file = variant("boundary", dir);
    const ref = reference(file);
    // The reference's own reading of the variant: 49 aware of BMW, two of them blank for Affordable to run.
    expect(ref.aware_n.b08).toBe(49);
    expect(ref.weighted.attr_a01_b08[1]).toBe(49);
    expect(ref.weighted.attr_a02_b08[1]).toBe(47);
    const { run, data } = await csvWithCodebook(file);
    const { loadBrandAssociations } = await import("../trackerAssociations");
    const m = await loadBrandAssociations(tenant, run, data);
    expect(m.weighted).toBe(true);
    expect(expectReference(m, ref.weighted, ref.aware_n)).toBe(100);
  });

  it("unknown: awareness unmapped is Mapping needed (never all respondents); no association grid is Not measured; no figures", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    const awareGroup = v.dashboard.stages.find((s) => s.stage === "awareness")!.group;
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { stages: { [awareGroup]: null } }, "x")).saved).toBe(true);
    const { loadBrandAssociations } = await import("../trackerAssociations");
    try {
      const m = await loadBrandAssociations(tenant, savRun, sav);
      expect(m.profile).toMatchObject({ status: "mapping_needed" });
      expect(m.profile.status === "mapping_needed" && m.profile.reason).toMatch(/awareness/);
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
    const { run, data } = await csvWithCodebook(variant("no_associations", dir));
    const none = await loadBrandAssociations(tenant, run, data);
    expect(none.profile).toMatchObject({ status: "not_measured" });
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again the page returns", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadBrandAssociations } = await import("../trackerAssociations");
    await expect(loadBrandAssociations(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadBrandAssociations(tenant, run, doc)).profile.status).toBe("ok");
  });
});
