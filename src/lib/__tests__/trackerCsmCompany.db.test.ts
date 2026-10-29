// D3b customer satisfaction by company and against the previous wave, against Grant's banking CSM pack (waves 1 and 2
// as labelled SPSS, fixtures/csm): the company question is found ("Main company"), and every bank's satisfaction
// top-two box, NPS, likely to continue (top two) and switching risk (8 to 10) equal reference_results.json, weighted,
// read by company code; the wave 2 minus wave 1 change for all customers and for a bank equals the references'
// difference; the client's bank is saved by code and a code the company question does not have is refused.
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
const packFile = (n: string) => readFileSync(path.join(process.cwd(), "fixtures", "csm", n));
type Ref = { wave: number; company: number; variable: string; statistic: string; expected: number; raw_base: number };
const REF: Ref[] = JSON.parse(packFile("reference_relationship_w1_w2.json").toString("utf8")).results;
const ref = (variable: string, statistic: string, wave = 1, company = 0) => REF.find((r) => r.wave === wave && r.company === company && r.variable === variable && r.statistic === statistic)!;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("D3b CSM by company and against the previous wave (real database, actual engine)", () => {
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
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Banking CSM') returning id", [tenant]))[0].id;
    for (const [w, date] of [[1, "2026-02"], [2, "2026-06"]] as const) {
      const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, packFile(`banking_relationship_w${w}_labels.sav`));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `banking_w${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: date })],
      ))[0].id);
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("wave 2: each bank's figures by company code equal the reference; all customers unchanged by the split", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[1], "csm");
    if (!o.csmCompany || !("companies" in o.csmCompany)) throw new Error(JSON.stringify(o.csmCompany));
    expect(o.csmCompany.variable).toBe("company");
    expect(o.csmCompany.companies.map((c) => c.label)).toEqual(["FNB", "Standard Bank", "Absa", "Nedbank", "Capitec", "Discovery Bank", "GoTyme Bank (formerly TymeBank)"]);
    const tile = (id: string) => o.csm.find((t) => t.id === id)!;
    const checks: [string, string, string][] = [["satisfaction", "company_csat5", "t2b"], ["stay", "continue5", "t2b"], ["switch", "switch_0to10", "risk"]];
    for (const [id, variable, statistic] of checks) {
      const t = tile(id);
      if (t.status !== "ok" || t.id === "drivers" || t.id === "recommend" || !Array.isArray(t.byCompany)) throw new Error(JSON.stringify(t));
      expect(t.box, `${id} all`).toBeCloseTo(ref(variable, statistic, 2).expected, 6);
      for (const c of t.byCompany) expect(c.box, `${id} company ${c.code}`).toBeCloseTo(ref(variable, statistic, 2, Number(c.code)).expected, 6);
    }
    const nps = tile("recommend");
    if (nps.status !== "ok" || nps.id !== "recommend" || !Array.isArray(nps.byCompany)) throw new Error(JSON.stringify(nps));
    for (const c of nps.byCompany) expect(Math.abs((c.nps as number) - ref("recommend_0to10", "nps", 2, Number(c.code)).expected), `nps ${c.code}`).toBeLessThanOrEqual(0.05);
  });

  it("change against wave 1 for all customers and for one bank equals the references' difference", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[1], "csm");
    const all = o.csmChanges.find((c) => c.id === "satisfaction" && c.code === null)!;
    expect(all.changePp).toBeCloseTo(ref("company_csat5", "t2b", 2).expected - ref("company_csat5", "t2b", 1).expected, 6);
    const fnb = o.csmChanges.find((c) => c.id === "stay" && c.code === "1")!;
    expect(fnb.changePp).toBeCloseTo(ref("continue5", "t2b", 2, 1).expected - ref("continue5", "t2b", 1, 1).expected, 6);
    const npsAll = o.csmChanges.find((c) => c.id === "recommend" && c.code === null)!;
    expect(Math.abs((npsAll.changePp as number) - (ref("recommend_0to10", "nps", 2).expected - ref("recommend_0to10", "nps", 1).expected))).toBeLessThanOrEqual(0.1);
    const first = await loadBrandOverview(tenant, run, docs[0], "csm");
    expect(first.csmChanges.every((c) => c.changePp === null && c.reason === "This is the earliest wave of this project.")).toBe(true);
  });

  it("the client's bank is saved by code and shown; a code the company question does not have is refused", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const { loadBrandOverview } = await import("../trackerOverview");
    const v = await loadTrackerDashboard(tenant, run, docs[1]);
    const bad = await saveTrackerChoices(tenant, run, docs[1], { scope: v.scopeKey, revision: v.revision }, { focalCompanyCode: "42" }, "x");
    expect(bad).toEqual({ saved: false, reason: "invalid", problems: ["Company code 42 is not an answer of this file's company question."] });
    expect((await saveTrackerChoices(tenant, run, docs[1], { scope: v.scopeKey, revision: v.revision }, { focalCompanyCode: "5" }, "x")).saved).toBe(true);
    const o = await loadBrandOverview(tenant, run, docs[1], "csm");
    expect(o.csmCompany).toMatchObject({ focal: { code: "5", label: "Capitec", source: "chosen" } });
  });

  it("the CSM dashboard's trend and service attributes equal the reference: satisfaction mean per wave, each driver's mean", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[1], "csm");
    expect(o.kind).toBe("csm");
    expect(o.figures.stages).toEqual([]);
    expect(o.timeline.map((p) => p.wave)).toEqual(["Wave 1", "Wave 2"]);
    o.timeline.forEach((p, i) => expect(p.satisfaction?.mean, p.wave).toBeCloseTo(ref("company_csat5", "mean5", i + 1).expected, 6));
    expect(o.attributes.map((a) => a.variable)).toEqual(["company_driver_d01", "company_driver_d02", "company_driver_d03", "company_driver_d04", "company_driver_d05", "company_driver_d06"]);
    for (const a of o.attributes) {
      expect(a.mean, a.variable).toBeCloseTo(ref(a.variable, "mean5", 2).expected, 6);
      expect(a.scaleTop).toBe(5);
    }
    const sat = o.csm.find((t) => t.id === "satisfaction")!;
    if (sat.status !== "ok" || sat.id !== "satisfaction") throw new Error(JSON.stringify(sat));
    expect(sat.scaleTop).toBe(5);
    const mean = o.csmChanges.find((c) => c.id === "satisfaction" && c.code === null)!;
    expect(mean.meanChange).toBeCloseTo(ref("company_csat5", "mean5", 2).expected - ref("company_csat5", "mean5", 1).expected, 6);
    // The brand dashboard of the same file calculates no CSM figures.
    const b = await loadBrandOverview(tenant, run, docs[1], "brand");
    expect([b.csm, b.attributes]).toEqual([[], []]);
  });
});

