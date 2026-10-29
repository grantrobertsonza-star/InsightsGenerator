// D3 customer satisfaction tiles (trackerCsmFigures.ts) against Grant's banking CSM pack: the relationship survey's
// waves 1 and 2 as SPSS with labels (fixtures/csm), every value compared with the pack's reference_results.json
// (company 0, all customers, weighted): satisfaction mean and top-two box, NPS, likely to continue (top two) and
// switching risk (8 to 10). Also: a role the researcher set to none is a blank tile, not 0; a file that cannot be
// read gives failed tiles with the reason; nothing is saved as a table. Real disposable PostgreSQL and the actual
// engine; storage is an in-memory stand-in.
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
const ref = (variable: string, statistic: string, wave = 1) => REF.find((r) => r.wave === wave && r.company === 0 && r.variable === variable && r.statistic === statistic)!;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("D3 CSM tiles against the banking pack's reference results (real database, actual engine)", () => {
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

  const tiles = async (doc: string) => {
    const { loadTrackerDashboard } = await import("../trackerDashboards");
    const { csmOverviewFigures } = await import("../trackerCsmFigures");
    const view = await loadTrackerDashboard(tenant, run, doc);
    const t = await csmOverviewFigures(tenant, run, doc, view.dashboard);
    return { view, byId: new Map(t.map((x) => [x.id, x])), t };
  };

  it("wave 1, weighted by default: satisfaction, NPS, likely to continue and switching risk equal the reference", async () => {
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n);
    const { view, byId, t } = await tiles(docs[0]);
    expect([view.dashboard.weighted, view.dashboard.weightVar]).toEqual([true, "weight"]);
    expect(t.map((x) => x.id)).toEqual(["satisfaction", "recommend", "stay", "switch", "drivers"]);
    const sat = byId.get("satisfaction");
    if (sat?.status !== "ok" || sat.id !== "satisfaction") throw new Error(JSON.stringify(sat));
    expect(sat.mean).toBeCloseTo(ref("company_csat5", "mean5").expected, 6);
    expect(sat.box).toBeCloseTo(ref("company_csat5", "t2b").expected, 6);
    // Weighted: the effective base, below the number answering.
    expect(sat.effectiveBase).toBeGreaterThan(900);
    expect(sat.effectiveBase).toBeLessThan(ref("company_csat5", "t2b").raw_base);
    const nps = byId.get("recommend");
    if (nps?.status !== "ok" || nps.id !== "recommend") throw new Error(JSON.stringify(nps));
    // The NPS tool reports the score to one decimal.
    expect(Math.abs(nps.nps - ref("recommend_0to10", "nps").expected)).toBeLessThanOrEqual(0.05);
    expect(nps.base).toBe(ref("recommend_0to10", "nps").raw_base);
    const stay = byId.get("stay");
    if (stay?.status !== "ok" || stay.id !== "stay") throw new Error(JSON.stringify(stay));
    expect(stay.box).toBeCloseTo(ref("continue5", "t2b").expected, 6);
    const sw = byId.get("switch");
    if (sw?.status !== "ok" || sw.id !== "switch") throw new Error(JSON.stringify(sw));
    expect(sw.boxCodes).toBe("8 to 10");
    expect(sw.box).toBeCloseTo(ref("switch_0to10", "risk").expected, 6);
    const drv = byId.get("drivers");
    if (drv?.status !== "ok" || drv.id !== "drivers") throw new Error(JSON.stringify(drv));
    expect(drv.rows).toHaveLength(6);
    expect(drv.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 6);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n)).toBe(before);
  });

  it("a role set to none is a blank tile with the reason, never 0; the other tiles still show", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, run, docs[0]);
    expect((await saveTrackerChoices(tenant, run, docs[0], { scope: v.scopeKey, revision: v.revision }, { csm: { likelyToStay: null } }, "x")).saved).toBe(true);
    const { byId } = await tiles(docs[1]);
    expect(byId.get("stay")).toEqual({ id: "stay", status: "missing", reason: "No likelihood-to-stay question was found in this file." });
    expect(byId.get("satisfaction")?.status).toBe("ok");
    const again = await loadTrackerDashboard(tenant, run, docs[0]);
    await saveTrackerChoices(tenant, run, docs[0], { scope: again.scopeKey, revision: again.revision }, {}, "x");
  });

  it("a file that cannot be read gives failed tiles with the reason; restored, they calculate again", async () => {
    const { loadTrackerDashboard } = await import("../trackerDashboards");
    const { csmOverviewFigures } = await import("../trackerCsmFigures");
    const view = await loadTrackerDashboard(tenant, run, docs[1]);
    const key = (await q("select storage_path from documents where id = $1", [docs[1]]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [docs[1], `${key}.missing`]);
    try {
      const t = await csmOverviewFigures(tenant, run, docs[1], view.dashboard);
      expect(t.every((x) => x.status === "failed" && x.error.length > 0)).toBe(true);
    } finally {
      await q("update documents set storage_path = $2 where id = $1", [docs[1], key]);
    }
    const t2 = await csmOverviewFigures(tenant, run, docs[1], view.dashboard);
    const sat = t2.find((x) => x.id === "satisfaction");
    if (sat?.status !== "ok" || sat.id !== "satisfaction") throw new Error(JSON.stringify(sat));
    expect(sat.box).toBeCloseTo(ref("company_csat5", "t2b", 2).expected, 6);
  });
});
