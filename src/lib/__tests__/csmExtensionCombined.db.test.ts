// R6 CSM extension on the COMBINED pack (Grant, 30 October 2026, 15:20; fixtures/packs-2026-10-30/csm-combined): one
// customer row per wave with company answers and four channel blocks ch01_ to ch04_. Real database, actual engine, the
// pack's XLSX imported as data files labelled by wave:
//   1. every row of each sector's reference/Reference_Metrics.csv reproduced (Company rows by company; Channel rows
//      by block, the block's users being the base; channel 0 pooled over the four blocks; optional noncustomers),
//      tolerance 0.000001 and raw bases exact;
//   2. the sections' loaders on the combined file: journey, six emotions at journey grain and from the channel blocks,
//      preference, staying reasons, benchmark and noncustomers equal the references, with the channel records
//      read from the blocks (never a separate file) and counted as records and distinct customers;
//   3. the pooled All_Waves file read one wave at a time (default the latest), equal to that wave's references;
//   4. a combined file and a separate Channel file for the same wave are refused together;
//   5. the existing CSM dashboard's company tiles on the combined file equal the Company references by company.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { combinedFile, combinedNoncustomerFile, combinedReferences, insertFiles, PACK, type CombinedRef, type Sector } from "./helpers/csmPackDb";

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

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 600_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;
const TOL = 1e-6;
type Fig = { status: string; reading?: { value: number | null; numerator: number | null; weightedBase: number; rawBase: number } };
function matches(label: string, fig: Fig | undefined, ref: CombinedRef) {
  if (!fig || fig.status !== "ok" || !fig.reading) throw new Error(`${label}: ${JSON.stringify(fig)}`);
  expect(Math.abs((fig.reading.value as number) - (ref.expected as number)), `${label} value ${fig.reading.value} vs ${ref.expected}`).toBeLessThan(TOL);
  expect(Math.abs((fig.reading.numerator as number) - ref.numerator), `${label} numerator`).toBeLessThan(TOL);
  expect(Math.abs(fig.reading.weightedBase - ref.weighted_base), `${label} weighted base`).toBeLessThan(TOL);
  expect(fig.reading.rawBase, `${label} raw base`).toBe(ref.raw_base);
}
const none = { company: null, task: null, journeyChannel: null };

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R6 CSM extension on the combined company and channel pack (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const packs: Partial<Record<Sector, { run: string; docs: string[] }>> = {};
  const counts: Record<string, number> = {};

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    for (const s of ["banking", "mobile"] as const) {
      // docs: combined wave 1 to 3, then noncustomers wave 1 to 3.
      packs[s] = await insertFiles(db, tenant, storage.objects, `${s} combined`, [
        ...[1, 2, 3].map((w) => ({ file: combinedFile(s, w), wave: `Wave ${w}` })),
        ...[1, 2, 3].map((w) => ({ file: combinedNoncustomerFile(s, w), wave: `Wave ${w}` })),
      ]);
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    console.log("R6 combined comparisons:", JSON.stringify(counts));
  });

  for (const sector of ["banking", "mobile"] as const) {
    it(`${sector}: every Reference_Metrics.csv row, read the same way (company, each channel block, pooled channels, noncustomers)`, async () => {
      const { tabulate, readStatistic, columnOf } = await import("../csmExtensionMetrics");
      const refs = combinedReferences(sector);
      const { run, docs } = packs[sector]!;
      const groups = new Map<string, CombinedRef[]>();
      for (const r of refs) {
        const key = `${r.wave}|${r.section === "Optional noncustomers" ? "nc" : "customer"}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      let n = 0;
      for (const [key, rs] of groups) {
        const [w, kind] = key.split("|");
        const doc = kind === "nc" ? docs[3 + Number(w) - 1] : docs[Number(w) - 1];
        const vars = [...new Set(rs.flatMap((r) => r.variable.split(" ; ")))];
        const t = await tabulate(tenant, run, doc, vars, kind === "nc" ? null : "weight", [], rs.some((r) => r.company !== 0) ? "company" : null);
        for (const r of rs) {
          const qs = r.variable.split(" ; ").map((v) => t.questions.find((q) => q.key === v));
          if (qs.some((q) => !q)) throw new Error(`${key} ${r.variable} not tabulated`);
          const col = r.company === 0 ? "total" : columnOf(t, "company", String(r.company));
          if (col === null) throw new Error(`${key} company ${r.company}`);
          const reading = readStatistic(qs.length === 1 ? qs[0]! : (qs as NonNullable<(typeof qs)[number]>[]), col, r.statistic as never);
          if (r.expected === null) expect(reading.value).toBeNull();
          else matches(`${key} ${r.variable} ${r.statistic} c${r.company}`, { status: "ok", reading }, r);
          n++;
        }
      }
      counts[`${sector}:all`] = n;
      expect(n).toBe(refs.length);
    });

    it(`${sector}: the sections' loaders on the combined file equal the references, waves 1 to 3`, async () => {
      const { loadCsmExtension } = await import("../csmExtension");
      const refs = combinedReferences(sector);
      const { run, docs } = packs[sector]!;
      let n = 0;
      for (const w of [1, 2, 3]) {
        const ref = (section: string, variable: string, statistic: string, channel = 0) => {
          const r = refs.find((x) => x.wave === w && x.section === section && x.company === 0 && x.channel === channel && x.source_variable === variable && x.statistic === statistic);
          if (!r) throw new Error(`no reference ${section} ${variable} ${statistic} ch${channel} wave ${w}`);
          n++;
          return r;
        };
        const j = await loadCsmExtension(tenant, run, docs[w - 1], "journey", none);
        expect(j.files.map((f) => [f.grain, f.used])).toEqual([
          ["relationship", true],
          ["noncustomer", true],
        ]);
        expect(j.files[0].evidence).toMatch(/channel blocks ch01_, ch02_, ch03_, ch04_/);
        expect(j.linkProblems).toEqual([]);
        const js = j.journey!;
        if (js.status !== "ok") throw new Error(JSON.stringify(js));
        matches("journey_recent30", js.recentShare, ref("Company", "journey_recent30", "yes"));
        matches("journey_completed", js.completion, ref("Company", "journey_completed", "yes"));
        matches("journey_csat5", js.journeyCsat, ref("Company", "journey_csat5", "t2b"));
        matches("journey_transferred", js.transferred, ref("Company", "journey_transferred", "yes"));

        const e = (await loadCsmExtension(tenant, run, docs[w - 1], "experience", none)).experience!;
        if (e.journey.status !== "ok" || e.channel.status !== "ok") throw new Error(JSON.stringify([e.journey, e.channel]).slice(0, 500));
        expect(e.channel.source).toMatch(/Channel blocks of the combined file/);
        for (const em of e.journey.emotions) matches(`journey_${em.emotion}5`, em.mean, ref("Company", `journey_${em.emotion}5`, "mean5"));
        for (const em of e.channel.all.emotions.filter((x) => !["angry", "disappointed"].includes(x.emotion))) matches(`pooled channel_${em.emotion}5`, em.mean, ref("Channel", `channel_${em.emotion}5`, "mean5"));
        matches("pooled channel_preference5", e.channel.all.preference, ref("Channel", "channel_preference5", "t2b"));
        for (const g of e.channel.byChannel) {
          for (const em of g.emotions.filter((x) => x.emotion === "angry" || x.emotion === "disappointed")) {
            matches(`ch${g.code} ${em.emotion} mean`, em.mean, ref("Channel", `channel_${em.emotion}5`, "mean5", Number(g.code)));
            matches(`ch${g.code} ${em.emotion} t2b`, em.high, ref("Channel", `channel_${em.emotion}5`, "t2b", Number(g.code)));
          }
        }
        // Records and distinct customers: the pooled reference's raw base is records with a valid answer.
        expect(e.channel.all.records).toBeGreaterThanOrEqual(ref("Channel", "channel_reassured5", "mean5").raw_base);
        n--;
        expect(e.channel.all.distinctCustomers).toBeLessThan(e.channel.all.records as number);
        matches("experience_preference5", e.experiencePreference, ref("Company", "experience_preference5", "t2b"));
        e.reasons.shares.forEach((f, i) => matches(`stay_reason_r0${i + 1}`, f, ref("Company", `stay_reason_r0${i + 1}`, "yes")));

        const c = (await loadCsmExtension(tenant, run, docs[w - 1], "competitive", none)).competitive!;
        if ("status" in c.benchmark) throw new Error(JSON.stringify(c.benchmark));
        matches("benchmark_gap5", c.benchmark.customer, ref("Company", "benchmark_gap5", "mean_gap"));
        if (c.noncustomer.status !== "ok") throw new Error(JSON.stringify(c.noncustomer));
        matches("focal_consider5", c.noncustomer.consider, ref("Optional noncustomers", "focal_consider5", "t2b"));
        c.noncustomer.attributes.forEach((a, i) => matches(`expect_level_d0${i + 1}`, a.expected, ref("Optional noncustomers", `expect_level_d0${i + 1}`, "mean5")));
      }
      counts[`${sector}:sections`] = n;
    });

    it(`${sector}: the pooled All_Waves file is read one wave at a time, the latest by default`, async () => {
      const { loadCsmExtension } = await import("../csmExtension");
      const refs = combinedReferences(sector);
      const pooled = await insertFiles(db, tenant, storage.objects, `${sector} pooled`, [{ file: combinedFile(sector, "all"), wave: "All waves" }]);
      const ref = (w: number, variable: string, statistic: string, section = "Company") => refs.find((x) => x.wave === w && x.section === section && x.company === 0 && x.channel === 0 && x.source_variable === variable && x.statistic === statistic)!;
      const latest = await loadCsmExtension(tenant, pooled.run, pooled.docs[0], "journey", none);
      expect(latest.dataWaves).toEqual(["1", "2", "3"]);
      expect(latest.filters.dataWave).toBe("3");
      expect(latest.files[0]).toMatchObject({ records: 3000, distinctPeople: 3000 });
      if (latest.journey!.status !== "ok") throw new Error("journey");
      matches("pooled latest completion", latest.journey!.completion, ref(3, "journey_completed", "yes"));
      const w2 = await loadCsmExtension(tenant, pooled.run, pooled.docs[0], "experience", { ...none, dataWave: "2" });
      if (w2.experience!.channel.status !== "ok" || w2.experience!.journey.status !== "ok") throw new Error("experience");
      matches("pooled w2 channel reassured", w2.experience!.channel.all.emotions[0].mean, ref(2, "channel_reassured5", "mean5", "Channel"));
      matches("pooled w2 journey angry", w2.experience!.journey.emotions.find((x) => x.emotion === "angry")!.mean, ref(2, "journey_angry5", "mean5"));
      await expect(loadCsmExtension(tenant, pooled.run, pooled.docs[0], "journey", { ...none, dataWave: "7" })).rejects.toThrow(/Wave 7 is not in the wave column/);
    });
  }

  it("a combined file and a separate Channel file for the same wave are never used together", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    const both = await insertFiles(db, tenant, storage.objects, "both representations", [
      { file: combinedFile("banking", 1), wave: "Wave 1" },
      { file: path.join(PACK, "banking", "Banking_CSM_Channel_Wave_1.xlsx"), wave: "Wave 1" },
    ]);
    const v = await loadCsmExtension(tenant, both.run, both.docs[0], "experience", none);
    expect(v.linkProblems.join(" ")).toMatch(/choose one representation/);
    expect(v.files.find((f) => f.grain === "channel")).toMatchObject({ used: false });
    expect(v.experience!.channel.status).toBe("not_measured");
  });

  it("the existing CSM dashboard's company tiles on the combined file equal the Company references by company", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    for (const sector of ["banking", "mobile"] as const) {
      const refs = combinedReferences(sector);
      const { run, docs } = packs[sector]!;
      const o = await loadBrandOverview(tenant, run, docs[1], "csm");
      expect(o.previous).toMatchObject({ status: "ok", documentId: docs[0] });
      for (const [id, variable, statistic] of [["satisfaction", "company_csat5", "t2b"], ["stay", "continue5", "t2b"], ["switch", "switch_0to10", "risk"]] as const) {
        const t = o.csm.find((x) => x.id === id)!;
        if (t.status !== "ok" || t.id === "drivers" || t.id === "recommend" || !Array.isArray(t.byCompany)) throw new Error(`${sector} ${id}: ${JSON.stringify(t).slice(0, 400)}`);
        const r = (company: number) => refs.find((x) => x.wave === 2 && x.section === "Company" && x.company === company && x.variable === variable && x.statistic === statistic)!.expected!;
        expect(Math.abs((t.box as number) - r(0))).toBeLessThan(TOL);
        for (const c of t.byCompany) expect(Math.abs((c.box as number) - r(Number(c.code))), `${sector} ${id} ${c.code}`).toBeLessThan(TOL);
      }
    }
  });
});
