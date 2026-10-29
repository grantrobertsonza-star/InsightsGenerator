// Page 04 "Advertising & WOM" of the brand tracking dashboard (Grant's design, 29 October 2026) through the actual
// loader, loadBrandAdvertising: recognition from what was imported, figures from the Cross tab engine computed
// without saving a table, every answer read by its raw code, with the dashboard's weight. Real disposable PostgreSQL
// and the actual engine; storage is an in-memory stand-in and the model is stubbed (never called).
// Expected values are computed independently by src/lib/__tests__/helpers/advertising_reference.py (pandas over the
// same file, written from the pack's specification), never taken from the app:
//   1. BMW wave 1 as SPSS with labels only (1,000 respondents): every brand's prompted recall yes and not sure shares
//      and bases, and every brand's six word of mouth groups (five answers and Unaware, adding to 100), weighted (the
//      default) and unweighted, to 1e-6; the recall bars ranked by yes; opening the page saves no table.
//   2. Boundary, the pack's first 60 respondents as CSV with metadata.json as the codebook: three BMW "not sure"
//      answers stay in the base and are not yes; two blanks leave the base; a Ford word of mouth answer from a
//      respondent unaware of Ford makes Ford's groups not exclusive, so Ford is n/a with the reason (never a remainder).
//   3. Unknown: awareness unmapped is "Mapping needed" for word of mouth while recall still shows; a file without the
//      recall and word of mouth questions is "Not measured" for both.
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
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "advertising_reference.py");
type Wom = Record<string, number> & { base: number; exclusive: boolean };
type Ref = Record<"weighted" | "unweighted", { recall: Record<string, [number, number, number]>; wom: Record<string, Wom> }>;
function reference(file: string): Ref {
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
const brandKey = (code: string) => `b${String(Number(code)).padStart(2, "0")}`;
type Page = Awaited<ReturnType<typeof import("../trackerAdvertising").loadBrandAdvertising>>;

/** Every recall bar and every word of mouth group equal to the reference; returns the counts compared. */
function expectReference(m: Page, ref: Ref["weighted"], skipWom: string[] = []) {
  if (m.recall.status !== "ok") throw new Error(m.recall.reason);
  if (m.wom.status !== "ok") throw new Error(m.wom.reason);
  expect(m.recall.keepsNotSure).toBe(true);
  expect(m.recall.brands.map((b) => b.code).sort()).toEqual(m.dashboard.brands.map((b) => b.code).sort());
  for (const b of m.recall.brands) {
    const [yes, notSure, base] = ref.recall[brandKey(b.code)];
    expect(b.variable).toBe(`adprompt_${brandKey(b.code)}`);
    expect(b.yes, b.code).toBeCloseTo(yes, 6);
    expect(b.notSure, b.code).toBeCloseTo(notSure, 6);
    expect(b.base, b.code).toBe(base);
  }
  // Ranked by the unrounded yes share, highest first.
  const yes = m.recall.brands.map((b) => b.yes!);
  expect([...yes].sort((a, b) => b - a)).toEqual(yes);
  expect(m.wom.groups.map((g) => g.key)).toEqual(["1", "2", "3", "4", "5", "unaware"]);
  let groups = 0;
  for (const b of m.wom.brands) {
    if (skipWom.includes(b.code)) continue;
    const r = ref.wom[brandKey(b.code)];
    expect(r.exclusive, b.code).toBe(true);
    expect(b.reason, b.code).toBeUndefined();
    expect(b.base).toBe(r.base);
    for (const g of b.groups!) {
      expect(g.share, `${b.code} ${g.key}`).toBeCloseTo(r[g.key], 6);
      groups += 1;
    }
    expect(b.groups!.reduce((s, g) => s + g.share, 0)).toBeCloseTo(100, 9);
  }
  return { recall: m.recall.brands.length, groups };
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Advertising & WOM figures against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "advertising-"));
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

  it("BMW wave 1, weighted by default: all ten brands' recall and word of mouth groups equal to the reference to 1e-6; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { loadBrandAdvertising } = await import("../trackerAdvertising");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadBrandAdvertising(tenant, savRun, sav);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar]).toEqual([true, "weight"]);
    expect(m.effectiveBase).toBeGreaterThan(900);
    expect(expectReference(m, ref.weighted)).toEqual({ recall: 10, groups: 60 });
    if (m.recall.status !== "ok" || m.wom.status !== "ok") throw new Error("not ok");
    // BMW (code 8): 831 asked (aware), and the reference's own BMW figures.
    expect(m.recall.brands.find((b) => b.code === "8")!.base).toBe(831);
    expect(m.wom.groups.map((g) => g.label)).toEqual(["Mainly positive", "Mainly negative", "Mixed", "Neutral", "Not heard", "Unaware"]);
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadBrandAdvertising } = await import("../trackerAdvertising");
      const m = await loadBrandAdvertising(tenant, savRun, sav);
      expect([m.weighted, m.effectiveBase]).toEqual([false, null]);
      expect(expectReference(m, ref.unweighted)).toEqual({ recall: 10, groups: 60 });
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: not sure stays in the base and is not yes; blanks leave the base; groups that are not exclusive are n/a, never a remainder", async () => {
    const file = variant("boundary", dir);
    const ref = reference(file);
    // The reference's own reading of the variant: 47 BMW answers (two blanks of 49 aware), Ford not exclusive.
    expect(ref.weighted.recall.b08[2]).toBe(47);
    expect(ref.weighted.wom.b03.exclusive).toBe(false);
    const { run, data } = await csvWithCodebook(file);
    const { loadBrandAdvertising } = await import("../trackerAdvertising");
    const m = await loadBrandAdvertising(tenant, run, data);
    expect(m.weighted).toBe(true);
    expect(expectReference(m, ref.weighted, ["3"]).groups).toBe(54);
    if (m.wom.status !== "ok") throw new Error(m.wom.reason);
    const ford = m.wom.brands.find((b) => b.code === "3")!;
    expect(ford.groups).toBeNull();
    expect(ford.reason).toMatch(/0 respondents aware of the brand have no word of mouth answer and 1 not aware of it have one/);
  });

  it("unknown: awareness unmapped is Mapping needed for word of mouth, recall still shown; a file without the questions is Not measured", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    const awareGroup = v.dashboard.stages.find((s) => s.stage === "awareness")!.group;
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { stages: { [awareGroup]: null } }, "x")).saved).toBe(true);
    const { loadBrandAdvertising } = await import("../trackerAdvertising");
    try {
      const m = await loadBrandAdvertising(tenant, savRun, sav);
      expect(m.wom).toMatchObject({ status: "mapping_needed", reason: expect.stringMatching(/awareness/) });
      expect(m.recall.status).toBe("ok");
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
    const { run, data } = await csvWithCodebook(variant("no_advertising", dir));
    const none = await loadBrandAdvertising(tenant, run, data);
    expect(none.recall).toMatchObject({ status: "not_measured" });
    expect(none.wom).toMatchObject({ status: "not_measured" });
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again the page returns", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadBrandAdvertising } = await import("../trackerAdvertising");
    await expect(loadBrandAdvertising(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadBrandAdvertising(tenant, run, doc)).recall.status).toBe("ok");
  });
});
