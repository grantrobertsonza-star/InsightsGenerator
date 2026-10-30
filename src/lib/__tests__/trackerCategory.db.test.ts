// The brand tracking dashboard's "Category overview" page (Grant's design, page 08, 29 October 2026) through the actual
// loader, loadCategoryOverview: recognition from what was imported, figures from the Cross tab engine computed without
// saving a table, by raw code, with the dashboard's weight. Real disposable PostgreSQL and the actual engine; storage
// is an in-memory stand-in and the model is stubbed (never called).
// Expected values are computed independently by src/lib/__tests__/helpers/category_reference.py (pandas over the same
// file, written from the pack's specification), never taken from the app:
//   1. BMW wave 1 as SPSS with labels only (1,000 respondents): the mean number of brands recognised, considered and
//      acquired in the past 12 months per respondent (each also equal to the weighted mean of the pack's own derived
//      n_aware, n_consider, n_bought12, which exclude Other), every decision style share and every acquisition channel
//      share with their bases, weighted (the default) and unweighted, to 1e-6; opening the page saves no table.
//   2. Boundary, the pack's first 60 respondents as CSV with metadata.json as the codebook: one blank consideration
//      answer makes the considered repertoire n/a (never counted as 0); blank decision styles leave its base; a channel
//      answered Other is kept as an answer; listed channels nobody chose are 0 of the known base.
//   3. Unknown: a second question claiming consideration is "Mapping needed" for that figure only; a file without
//      the decision style and channel questions is "Not measured" for both.
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
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "category_reference.py");
type One = { repertoire: Record<"aware" | "consider" | "bought12", [number | null, number | null]>; decision_style: Record<string, number>; decision_style_base: number; acquisition_channel: Record<string, number>; acquisition_channel_base: number };
type Ref = { respondents: number } & Record<"weighted" | "unweighted", One>;
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
type Page = Awaited<ReturnType<typeof import("../trackerCategory").loadCategoryOverview>>;
const STAGE_KEY = { awareness: "aware", consideration: "consider", acquisition: "bought12" } as const;

/** Every repertoire mean and every answer share equal to the reference; returns the number of figures compared. */
function expectReference(m: Page, ref: One, skip: string[] = []) {
  let figures = 0;
  for (const r of m.repertoire) {
    if (skip.includes(r.stage)) continue;
    if (r.status !== "ok") throw new Error(r.reason);
    const [mean, derived] = ref.repertoire[STAGE_KEY[r.stage]];
    expect(r.brands).toBe(10);
    expect(r.mean, r.stage).toBeCloseTo(mean!, 6);
    if (derived !== null) expect(r.mean, `${r.stage} against the pack's derived count`).toBeCloseTo(derived, 6);
    figures += 1;
  }
  for (const [key, d] of [["decision_style", m.decisionStyle], ["acquisition_channel", m.acquisitionChannel]] as const) {
    if (d.status !== "ok") throw new Error(d.reason);
    expect(d.variable).toBe(key);
    expect(d.base, key).toBe(ref[`${key}_base`]);
    for (const a of d.answers) {
      expect(a.share, `${key} ${a.code}`).toBeCloseTo(ref[key][a.code] ?? 0, 6);
      figures += 1;
    }
    expect(d.answers.reduce((s, a) => s + (a.share ?? 0), 0)).toBeCloseTo(100, 9);
  }
  return figures;
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Category overview figures against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "category-"));
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

  it("BMW wave 1, weighted by default: repertoires, decision style and acquisition channel equal to the reference to 1e-6; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { loadCategoryOverview } = await import("../trackerCategory");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadCategoryOverview(tenant, savRun, sav);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar]).toEqual([true, "weight"]);
    expect(m.repertoire.map((r) => r.stage)).toEqual(["awareness", "consideration", "acquisition"]);
    expect(m.repertoire.every((r) => r.status === "ok" && r.base === 1000)).toBe(true);
    // 3 repertoires, 3 decision styles, 7 channels.
    expect(expectReference(m, ref.weighted)).toBe(13);
    if (m.decisionStyle.status !== "ok" || m.acquisitionChannel.status !== "ok") throw new Error("not ok");
    expect(m.decisionStyle.answers.map((a) => a.label)).toEqual(["Preferred brand first", "Brief comparison", "Extensive comparison"]);
    expect(m.acquisitionChannel.base).toBe(234);
    expect(m.acquisitionChannel.answers.at(-1)).toMatchObject({ code: "7", label: "Other" });
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadCategoryOverview } = await import("../trackerCategory");
      const m = await loadCategoryOverview(tenant, savRun, sav);
      expect([m.weighted, m.effectiveBase]).toEqual([false, null]);
      expect(expectReference(m, ref.unweighted)).toBe(13);
      // Unweighted, the means are plain averages: 8.15 brands recognised per respondent.
      expect(m.repertoire[0]).toMatchObject({ mean: expect.closeTo(8.15, 9) });
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: a blank brand answer makes that repertoire n/a; blank decision styles leave the base; Other is kept; listed channels nobody chose are 0", async () => {
    const file = variant("boundary", dir);
    const ref = reference(file);
    expect(ref.weighted.repertoire.consider[0]).toBeNull();
    expect(ref.weighted.decision_style_base).toBe(58);
    const { run, data } = await csvWithCodebook(file);
    const { loadCategoryOverview } = await import("../trackerCategory");
    const m = await loadCategoryOverview(tenant, run, data);
    expect(m.weighted).toBe(true);
    const considered = m.repertoire.find((r) => r.stage === "consideration")!;
    expect(considered).toMatchObject({ status: "ok", mean: null, reason: expect.stringMatching(/Not every respondent has an answer for every brand \(consider_b05 has 59 of 60\)/) });
    expect(expectReference(m, ref.weighted, ["consideration"])).toBe(2 + 3 + 7);
    if (m.acquisitionChannel.status !== "ok") throw new Error(m.acquisitionChannel.reason);
    expect(m.acquisitionChannel.answers.find((a) => a.code === "7")!.share).toBeGreaterThan(0);
    expect(m.acquisitionChannel.answers.filter((a) => a.share === 0).map((a) => a.code)).toEqual(["3", "5", "6"]);
  });

  it("unknown: two questions claiming consideration are Mapping needed for that figure only; no decision style or channel question is Not measured", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    const shortlist = v.dashboard.stages.find((s) => s.stage === "shortlist")!.group;
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { stages: { [shortlist]: "consideration" } }, "x")).saved).toBe(true);
    const { loadCategoryOverview } = await import("../trackerCategory");
    try {
      const m = await loadCategoryOverview(tenant, savRun, sav);
      expect(m.repertoire.map((r) => r.status)).toEqual(["ok", "mapping_needed", "ok"]);
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
    const { run, data } = await csvWithCodebook(variant("no_category", dir));
    const none = await loadCategoryOverview(tenant, run, data);
    expect(none.decisionStyle).toMatchObject({ status: "not_measured" });
    expect(none.acquisitionChannel).toMatchObject({ status: "not_measured" });
    expect(none.repertoire.every((r) => r.status === "ok")).toBe(true);
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again the page returns", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadCategoryOverview } = await import("../trackerCategory");
    await expect(loadCategoryOverview(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadCategoryOverview(tenant, run, doc)).decisionStyle.status).toBe("ok");
  });
});
