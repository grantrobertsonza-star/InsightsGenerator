// D3 (Grant, 28 October 2026 previews): the brand overview's figures come from the Cross tab engine, read by code,
// and must equal the independent reference values in Grant's BMW pack (reference_results.json, chart "Funnel /
// timeline / advertising"): every brand's awareness, consideration, shortlist and first choice in wave 1, weighted
// (the default, D2) and unweighted (a researcher's choice), and the change from wave 1 to wave 2. Data: the pack's
// waves 1 and 2 as SPSS with their labels only (fixtures/tracker-packs/bmw_car), two wave files in one project.
// Real disposable PostgreSQL and the actual engine; storage is an in-memory stand-in. Skipped, with the reason,
// without a test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

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
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const packFile = (n: string) => readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n));
type Ref = { wave: number; metric: string; brand: string; expected: number; weighting: string; raw_base: number };
const REF: Ref[] = JSON.parse(packFile("reference_funnel_w1_w2.json").toString("utf8")).results;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("D3 brand overview figures against the pack's reference results (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  const docs: string[] = [];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id;
    for (const [w, date] of [[1, "2026-02"], [2, "2026-06"]] as const) {
      const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, packFile(`wave${w}_labels_only_compressed.sav`));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `bmw_wave${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: date })],
      ))[0].id);
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const METRIC: Record<string, string> = { awareness: "aware", consideration: "consider", shortlist: "shortlist", first_choice: "firstchoice" };
  async function figures(doc: string) {
    const { loadTrackerDashboard } = await import("../trackerDashboards");
    const { loadRoleInput } = await import("../trackerInput");
    const { brandOverviewFigures } = await import("../trackerFigures");
    const view = await loadTrackerDashboard(tenant, run, doc);
    const input = await loadRoleInput(tenant, run, doc);
    return { view, f: await brandOverviewFigures(tenant, run, doc, view.recognition, view.dashboard, input.variables) };
  }

  it("wave 1, weighted by default: every brand's awareness, consideration, shortlist and first choice equal the reference to 1e-6", async () => {
    const { view, f } = await figures(docs[0]);
    expect([f.weighted, f.weightVar]).toEqual([true, "weight"]);
    expect(f.stages.map((s) => s.stage)).toEqual(["awareness", "consideration", "shortlist", "first_choice", "usage"]);
    const label = new Map(view.dashboard.brands.map((b) => [b.code, b.label]));
    let compared = 0;
    for (const s of f.stages.filter((x) => METRIC[x.stage])) {
      for (const b of s.byBrand) {
        const ref = REF.find((r) => r.wave === 1 && r.weighting === "weighted" && r.metric === METRIC[s.stage] && r.brand === label.get(b.code))!;
        expect(b.share, `${s.stage} ${label.get(b.code)}`).toBeCloseTo(ref.expected, 6);
        expect(b.base).toBe(ref.raw_base);
        compared += 1;
      }
    }
    expect(compared).toBe(40);
    expect(f.effectiveBase).toBeGreaterThan(900);
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, run, docs[0]);
    expect((await saveTrackerChoices(tenant, run, docs[0], { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    const { view, f } = await figures(docs[0]);
    expect(f.weighted).toBe(false);
    const bmw = view.dashboard.brands.find((b) => b.label === "BMW")!.code;
    const aware = f.stages.find((s) => s.stage === "awareness")!.byBrand.find((b) => b.code === bmw)!;
    expect(aware.share).toBeCloseTo(REF.find((r) => r.wave === 1 && r.weighting === "unweighted" && r.metric === "aware" && r.brand === "BMW")!.expected, 6);
    const again = await loadTrackerDashboard(tenant, run, docs[0]);
    await saveTrackerChoices(tenant, run, docs[0], { scope: again.scopeKey, revision: again.revision }, {}, "x");
  });

  it("change against the previous wave: wave 2 minus wave 1 by variable and code, unrounded, equal to the references' difference", async () => {
    const { changesAgainst } = await import("../trackerFigures");
    const w1 = await figures(docs[0]);
    const w2 = await figures(docs[1]);
    const changes = changesAgainst(w2.f.stages, w1.f.stages);
    const bmw = w2.view.dashboard.brands.find((b) => b.label === "BMW")!.code;
    for (const stage of ["awareness", "consideration", "shortlist", "first_choice"] as const) {
      const c = changes.find((x) => x.stage === stage && x.code === bmw)!;
      const ref = (w: number) => REF.find((r) => r.wave === w && r.weighting === "weighted" && r.metric === METRIC[stage] && r.brand === "BMW")!.expected;
      expect(c.changePp, stage).toBeCloseTo(ref(2) - ref(1), 6);
    }
    expect(changesAgainst(w1.f.stages, null).every((c) => c.changePp === null && c.reason === "No earlier wave.")).toBe(true);
  });

  it("opening the overview saves no table, and the change is taken from the previous wave file in the project's wave order", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n);
    const o2 = await loadBrandOverview(tenant, run, docs[1]);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n)).toBe(before);
    expect(o2.wave).toBe("Wave 2");
    expect(o2.previous).toMatchObject({ status: "ok", documentId: docs[0], wave: "Wave 1" });
    const bmw = o2.view.dashboard.brands.find((b) => b.label === "BMW")!.code;
    const aware = o2.changes.find((c) => c.stage === "awareness" && c.code === bmw)!;
    const ref = (w: number) => REF.find((r) => r.wave === w && r.weighting === "weighted" && r.metric === "aware" && r.brand === "BMW")!.expected;
    expect(aware.changePp).toBeCloseTo(ref(2) - ref(1), 6);
    const o1 = await loadBrandOverview(tenant, run, docs[0]);
    expect(o1.previous).toEqual({ status: "none", reason: "This is the earliest wave of this project." });
    expect(o1.changes.every((c) => c.changePp === null)).toBe(true);
    // Default comparators: five brands, the client's first (BMW, suggested from the project's name), then list order.
    const bmwCode = o1.view.dashboard.brands.find((b) => b.label === "BMW")!.code;
    expect(o1.view.dashboard.focalBrand).toMatchObject({ code: bmwCode, source: "prefilled" });
    expect(o1.suggestedComparators).toEqual([bmwCode, ...o1.view.dashboard.brands.filter((b) => b.code !== bmwCode).slice(0, 4).map((b) => b.code)]);
  });

  it("a previous wave whose file cannot be read is reported as failed, never as no change; this wave still shows", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    // The previous wave's file goes missing from storage (a new path nothing was uploaded to, so no cached copy applies).
    const key = (await q("select storage_path from documents where id = $1", [docs[0]]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [docs[0], `${key}.missing`]);
    try {
      const o = await loadBrandOverview(tenant, run, docs[1]);
      expect(o.previous.status).toBe("failed");
      expect(o.figures.stages.length).toBeGreaterThan(0);
      expect(o.changes.every((c) => c.changePp === null && c.reason === "The previous wave's figures could not be read.")).toBe(true);
    } finally {
      await q("update documents set storage_path = $2 where id = $1", [docs[0], key]);
    }
    expect((await loadBrandOverview(tenant, run, docs[1])).previous.status).toBe("ok");
  });
});
