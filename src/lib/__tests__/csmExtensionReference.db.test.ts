// R6 CSM extension against the CSM packs' published answer keys (fixtures/packs-2026-10-30/csm/<sector>/test-reference/
// reference_results.json, also in CSM_Reference_Metrics.xlsx), for both sectors and all three waves, through the actual
// loaders (the nine XLSX files imported as raw data files and labelled by wave), the real engine (computeCrosstab) and
// a disposable database. Tolerances: 0.000001 on unrounded values, weighted numerators and weighted bases (the pack's
// stated tolerance); raw bases exactly.
//   1. The added metrics (38 per wave and sector: journey, emotions, preference, reasons for staying, the benchmark,
//      the noncustomer profile) from the sections' own loaders (loadCsmExtension).
//   2. Every other reference statistic (company and channel figures by company and channel) through the same
//      statistic reading (csmExtensionMetrics.readStatistic over computeCrosstab), so the reading of each grain,
//      weight and missing rule is pinned on every published value.
//   3. The existing CSM dashboard's tiles on the new Relationship workbook equal the reference by company.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { insertPack, PACK, packReferences, type Family, type PackDocs, type PackRef, type Sector } from "./helpers/csmPackDb";

/** CSM_Reference_Metrics.xlsx, read with openpyxl: its "Reference metrics" rows and "Focal company overview". */
const metricsWorkbook = (sector: Sector): { metrics: (string | number | null)[][]; focal: (string | number | null)[][] } =>
  JSON.parse(
    execFileSync(PYTHON, ["-I", "-c", "import json,sys,openpyxl\nwb=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True)\nprint(json.dumps({'metrics':[list(r) for r in wb['Reference metrics'].iter_rows(values_only=True)],'focal':[list(r) for r in wb['Focal company overview'].iter_rows(values_only=True)]}))", path.join(PACK, sector, "CSM_Reference_Metrics.xlsx")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );

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

vi.setConfig({ testTimeout: 900_000, hookTimeout: 300_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;
const TOL = 1e-6;

type Reading = { value: number | null; numerator: number | null; weightedBase: number; rawBase: number };
type Fig = { status: string; reading?: Reading; reason?: string; error?: string };

function expectMatches(label: string, fig: Fig | undefined, ref: PackRef) {
  if (!fig || fig.status !== "ok" || !fig.reading) throw new Error(`${label}: ${JSON.stringify(fig)}`);
  const r = fig.reading;
  expect(Math.abs((r.value as number) - (ref.expected as number)), `${label} value ${r.value} vs ${ref.expected}`).toBeLessThan(TOL);
  expect(Math.abs((r.numerator as number) - ref.numerator), `${label} numerator`).toBeLessThan(TOL);
  expect(Math.abs(r.weightedBase - ref.weighted_base), `${label} weighted base`).toBeLessThan(TOL);
  expect(r.rawBase, `${label} raw base`).toBe(ref.raw_base);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R6 CSM extension: pack reference values, both sectors, every wave (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const packs: Partial<Record<Sector, { run: string; docs: PackDocs }>> = {};
  const compared: Record<string, number> = {};

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    for (const s of ["banking", "mobile"] as const) packs[s] = await insertPack(db, tenant, s, storage.objects);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    // The counts compared, for the handover.
    console.log("R6 reference comparisons:", JSON.stringify(compared));
  });

  for (const sector of ["banking", "mobile"] as const) {
    it(`${sector}: the added metrics from the sections' loaders equal the reference, waves 1 to 3`, async () => {
      const { loadCsmExtension } = await import("../csmExtension");
      const refs = packReferences(sector);
      const { run, docs } = packs[sector]!;
      const filters = { company: null, task: null, journeyChannel: null };
      let n = 0;
      for (const w of [1, 2, 3]) {
        const ref = (dataset: Family, variable: string, statistic: string) => {
          const r = refs.find((x) => x.wave === w && x.dataset === dataset && x.company === 0 && x.channel === 0 && x.variable === variable && x.statistic === statistic);
          if (!r) throw new Error(`no reference ${dataset} ${variable} ${statistic} wave ${w}`);
          n++;
          return r;
        };
        // Opened on the Relationship file of the wave; the Channel and Noncustomer files are found by the wave label.
        const doc = docs[w].Relationship;
        const j = await loadCsmExtension(tenant, run, doc, "journey", filters);
        expect(j.files.map((f) => [f.grain, f.sampleType, f.used])).toEqual([
          ["relationship", "current_customers", true],
          ["channel", "current_customers", true],
          ["noncustomer", "focal_noncustomers", true],
        ]);
        expect(j.linkProblems).toEqual([]);
        const js = j.journey;
        if (!js || js.status !== "ok") throw new Error(JSON.stringify(js));
        expectMatches("journey_recent30", js.recentShare, ref("Relationship", "journey_recent30", "yes"));
        expectMatches("journey_completed", js.completion, ref("Relationship", "journey_completed", "yes"));
        expectMatches("journey_multichannel", js.multichannel, ref("Relationship", "journey_multichannel", "yes"));
        expectMatches("journey_transferred", js.transferred, ref("Relationship", "journey_transferred", "yes"));
        expectMatches("journey_repeat_info", js.repeatInfo, ref("Relationship", "journey_repeat_info", "yes"));
        expectMatches("journey_csat5", js.journeyCsat, ref("Relationship", "journey_csat5", "t2b"));

        const e = (await loadCsmExtension(tenant, run, doc, "experience", filters)).experience!;
        if (e.journey.status !== "ok" || e.channel.status !== "ok") throw new Error(JSON.stringify([e.journey, e.channel]));
        for (const em of e.journey.emotions) expectMatches(`journey_${em.emotion}5`, em.mean, ref("Relationship", `journey_${em.emotion}5`, "mean5"));
        expectMatches("journey_preference5", e.journey.preference, ref("Relationship", "journey_preference5", "t2b"));
        for (const em of e.channel.all.emotions) expectMatches(`channel_${em.emotion}5`, em.mean, ref("Channel", `channel_${em.emotion}5`, "mean5"));
        expectMatches("channel_preference5", e.channel.all.preference, ref("Channel", "channel_preference5", "t2b"));
        expectMatches("experience_preference5", e.experiencePreference, ref("Relationship", "experience_preference5", "t2b"));
        e.reasons.shares.forEach((fig, i) => expectMatches(`stay_reason_r0${i + 1}`, fig, ref("Relationship", `stay_reason_r0${i + 1}`, "yes")));

        const c = (await loadCsmExtension(tenant, run, doc, "competitive", filters)).competitive!;
        if ("status" in c.benchmark) throw new Error(JSON.stringify(c.benchmark));
        expectMatches("benchmark_gap5", c.benchmark.customer, ref("Relationship", "benchmark_gap5", "mean_gap"));
        // Recorded comparisons that are not eligible are counted, never zero by default.
        expect(c.benchmark.noncomparable).toBe(c.benchmark.recorded!.comparable - ref("Relationship", "benchmark_gap5", "mean_gap").raw_base);
        n--;
        const nc = c.noncustomer;
        if (nc.status !== "ok") throw new Error(JSON.stringify(nc));
        expect(nc.records).toEqual({ inFile: 500, inSample: 500, leftOut: 0 });
        expect(nc.focal.code).toBe("1");
        nc.attributes.forEach((a, i) => {
          expectMatches(`expect_level_d0${i + 1}`, a.expected, ref("Noncustomer", `expect_level_d0${i + 1}`, "mean5"));
          expectMatches(`expect_importance_d0${i + 1}`, a.importance, ref("Noncustomer", `expect_importance_d0${i + 1}`, "mean5"));
        });
        expectMatches("focal_consider5", nc.consider, ref("Noncustomer", "focal_consider5", "t2b"));
        expectMatches("alternative_csat5", nc.alternative, ref("Noncustomer", "alternative_csat5", "t2b"));
        // Unit weight: the noncustomer raw and weighted bases are equal.
        expect(nc.consider.status === "ok" && nc.consider.reading.weightedBase === nc.consider.reading.rawBase).toBe(true);
      }
      compared[`${sector}:added`] = n;
      expect(n).toBe(3 * 38);
    });

    it(`${sector}: every other published statistic, by company and channel, read the same way`, async () => {
      const { tabulate, readStatistic, columnOf, codeFilter } = await import("../csmExtensionMetrics");
      const refs = packReferences(sector);
      const { run, docs } = packs[sector]!;
      const groups = new Map<string, PackRef[]>();
      for (const r of refs) {
        const key = `${r.wave}|${r.dataset}|${r.channel}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      let n = 0;
      for (const [key, rs] of groups) {
        const [w, dataset, channel] = key.split("|");
        const doc = docs[Number(w)][dataset as Family];
        const vars = [...new Set(rs.map((r) => r.variable))];
        const weightVar = dataset === "Noncustomer" ? null : "weight";
        const filters = Number(channel) ? [codeFilter("channel", channel)] : [];
        const byCompany = rs.some((r) => r.company !== 0);
        const t = await tabulate(tenant, run, doc, vars, weightVar, filters, byCompany ? "company" : null);
        for (const r of rs) {
          const q = t.questions.find((x) => x.key === r.variable);
          if (!q) throw new Error(`${key} ${r.variable} not tabulated`);
          const col = r.company === 0 ? "total" : columnOf(t, "company", String(r.company));
          if (col === null) throw new Error(`${key} company ${r.company} has no column`);
          const reading = readStatistic(q, col, r.statistic as never);
          if (r.expected === null) {
            expect(reading.value, `${key} ${r.variable} ${r.statistic} c${r.company}`).toBeNull();
          } else {
            expectMatches(`${key} ${r.variable} ${r.statistic} company ${r.company}`, { status: "ok", reading }, r);
          }
          n++;
        }
      }
      compared[`${sector}:all`] = n;
      expect(n).toBe(refs.length);
    });

    it(`${sector}: CSM_Reference_Metrics.xlsx holds the same statistics as reference_results.json`, () => {
      const { metrics } = metricsWorkbook(sector);
      const [head, ...rows] = metrics;
      expect(head).toEqual(["wave", "dataset", "company", "channel", "variable", "statistic", "expected", "numerator", "weighted_base", "raw_base", "unit"]);
      const refs = packReferences(sector);
      expect(rows.length).toBe(refs.length);
      rows.forEach((r, i) => {
        const x = refs[i];
        expect([r[0], r[1], r[2], r[3], r[4], r[5], r[9], r[10]]).toEqual([x.wave, x.dataset, x.company, x.channel, x.variable, x.statistic, x.raw_base, x.unit]);
        for (const [a, b] of [[r[6], x.expected], [r[7], x.numerator], [r[8], x.weighted_base]] as const) {
          if (b === null) expect(a).toBeNull();
          else expect(Math.abs((a as number) - (b as number))).toBeLessThan(1e-9);
        }
      });
      compared[`${sector}:workbook rows`] = rows.length;
    });

    it(`${sector}: the existing CSM dashboard on the new Relationship workbook equals the reference by company (waves 1 to 3)`, async () => {
      const { loadBrandOverview } = await import("../trackerOverview");
      const refs = packReferences(sector);
      const { run, docs } = packs[sector]!;
      let n = 0;
      for (const w of [1, 2, 3]) {
        const o = await loadBrandOverview(tenant, run, docs[w].Relationship, "csm");
        const ref = (variable: string, statistic: string, company: number) => refs.find((r) => r.wave === w && r.dataset === "Relationship" && r.channel === 0 && r.company === company && r.variable === variable && r.statistic === statistic)!;
        for (const [id, variable, statistic] of [["satisfaction", "company_csat5", "t2b"], ["stay", "continue5", "t2b"], ["switch", "switch_0to10", "risk"]] as const) {
          const t = o.csm.find((x) => x.id === id)!;
          if (t.status !== "ok" || t.id === "drivers" || t.id === "recommend" || !Array.isArray(t.byCompany)) throw new Error(`${sector} w${w} ${id}: ${JSON.stringify(t)}`);
          expect(Math.abs((t.box as number) - ref(variable, statistic, 0).expected!), `${id} all`).toBeLessThan(TOL);
          n++;
          for (const c of t.byCompany) {
            expect(Math.abs((c.box as number) - ref(variable, statistic, Number(c.code)).expected!), `${id} ${c.code}`).toBeLessThan(TOL);
            n++;
          }
        }
        // The workbook's Focal company overview (company 1): satisfaction top two, NPS, continue intent, switch risk.
        const focal = metricsWorkbook(sector).focal.find((r) => r[0] === w)!;
        const byCode = (id: string) => {
          const t = o.csm.find((x) => x.id === id)!;
          if (t.status !== "ok" || t.id === "drivers" || !Array.isArray(t.byCompany)) throw new Error(id);
          return (t.byCompany as { code: string; box?: number | null; nps?: number | null }[]).find((c) => c.code === "1")!;
        };
        expect(Math.abs((byCode("satisfaction").box as number) - (focal[1] as number))).toBeLessThan(TOL);
        expect(Math.abs((byCode("stay").box as number) - (focal[3] as number))).toBeLessThan(TOL);
        expect(Math.abs((byCode("switch").box as number) - (focal[4] as number))).toBeLessThan(TOL);
        // The NPS tool's own score, compared at the one-decimal display tolerance the pack states.
        expect(Math.abs((byCode("recommend").nps as number) - (focal[2] as number))).toBeLessThanOrEqual(0.05);
        n += 4;
        // The timeline reads only the Relationship files: one point per wave, never a Channel or Noncustomer file.
        expect(o.timeline.map((p) => p.wave)).toEqual(["Wave 1", "Wave 2", "Wave 3"].slice(0, w));
      }
      compared[`${sector}:existing tiles`] = n;
    });
  }
});
