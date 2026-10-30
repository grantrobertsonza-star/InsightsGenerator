// R6 CSM extension against Codex's independent expected values for the combined CSM pack (30 October 2026;
// fixtures/packs-2026-10-30/csm-combined-codex-reference, never edited here): 540 rows, banking and mobile, waves 1 to 3
// and pooled, every company and all companies; company satisfaction, NPS, continuing use, switching and price
// switching, and each channel's satisfaction on its own channel-user base (ch0k_channel_csat5). Real database, actual
// engine, the pack's XLSX imported as data files.
//   - Every row through the app's statistic reading (csmExtensionMetrics: computeCrosstab + readStatistic), weighted
//     and unweighted: mean, full distribution, top two, top box, bottom two, NPS with its promoter, passive and
//     detractor shares, switching 8 to 10; valid raw base and eligible raw base exactly (eligible = valid + the
//     non-answers disclosed), valid weighted base within 1e-6. Pooled rows read the All_Waves file unfiltered.
//   - The existing CSM dashboard's tiles on each wave file (loadBrandOverview): satisfaction top two and mean, stay
//     top two and switching 8 to 10 by company within 1e-6, NPS from the NPS tool with its raw base exactly.
// Not compared: Kish effective bases (the reading keeps raw and weighted bases; the tiles show the engine's own
// effective base, rounded) and the scope inventory (documentation). Disagreements are reported row by row.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { combinedFile, insertFiles, type Sector } from "./helpers/csmPackDb";

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

type Base = { raw: number; weighted: number; kish: number };
type Est = { mean: number; distribution_percent: Record<string, number>; top_two_percent?: number; top_box_percent?: number; bottom_two_percent?: number; nps?: number; promoter_percent?: number; passive_percent?: number; detractor_percent?: number; risk_8_to_10_percent?: number };
type CodexRow = { wave: string; company_code: string; channel_code: number; variable: string; bases_by_weighting: Record<"weighted" | "unweighted", { eligible: Base; valid: Base }>; estimates: Record<"weighted" | "unweighted", Est> };
const CODEX = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "packs-2026-10-30", "csm-combined-codex-reference", "codex-csm-reference-values-2026-10-30.json"), "utf8")) as { sectors: Record<Sector, { results: CodexRow[] }> };

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R6 CSM extension against Codex's independent combined-pack values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const docs: Partial<Record<Sector, { run: string; docs: string[] }>> = {};
  const disagreements: string[] = [];
  const counts: Record<string, number> = {};

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    for (const s of ["banking", "mobile"] as const) {
      // Waves labelled in a project of their own; the pooled file in another (never both in one analysis).
      docs[s] = await insertFiles(db, tenant, storage.objects, `${s} codex`, [1, 2, 3].map((w) => ({ file: combinedFile(s, w), wave: `Wave ${w}` })));
      const pooled = await insertFiles(db, tenant, storage.objects, `${s} codex pooled`, [{ file: combinedFile(s, "all"), wave: "All waves" }]);
      docs[s]!.docs.push(pooled.docs[0]);
      (docs[s] as { pooledRun?: string }).pooledRun = pooled.run;
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    console.log("R6 Codex comparisons:", JSON.stringify(counts), "disagreements:", disagreements.length ? disagreements.join("\n") : "none");
  });

  const check = (label: string, actual: number | null, expected: number | undefined, exact = false) => {
    if (expected === undefined) return 0;
    const ok = actual !== null && (exact ? actual === expected : Math.abs(actual - expected) <= TOL);
    if (!ok) disagreements.push(`${label}: app ${actual} vs Codex ${expected}`);
    return 1;
  };

  for (const sector of ["banking", "mobile"] as const) {
    it(`${sector}: every row through the statistic reading, weighted and unweighted, bases exact`, async () => {
      const { tabulate, readStatistic, columnOf } = await import("../csmExtensionMetrics");
      const rows = CODEX.sectors[sector].results;
      const pack = docs[sector] as { run: string; docs: string[]; pooledRun: string };
      let n = 0;
      for (const wave of ["1", "2", "3", "pooled"]) {
        const waveRows = rows.filter((r) => r.wave === wave);
        const vars = [...new Set(waveRows.map((r) => r.variable))];
        const run = wave === "pooled" ? pack.pooledRun : pack.run;
        const doc = wave === "pooled" ? pack.docs[3] : pack.docs[Number(wave) - 1];
        for (const weighting of ["weighted", "unweighted"] as const) {
          const t = await tabulate(tenant, run, doc, vars, weighting === "weighted" ? "weight" : null, [], "company");
          for (const r of waveRows) {
            const q = t.questions.find((x) => x.key === r.variable)!;
            const col = r.company_code === "0" ? "total" : columnOf(t, "company", r.company_code);
            const label = `${sector} wave ${wave} ${r.variable} company ${r.company_code} ${weighting}`;
            if (!q || col === null) {
              disagreements.push(`${label}: not tabulated`);
              continue;
            }
            const isScale10 = r.variable === "recommend_0to10" || r.variable === "switch_0to10";
            const mean = readStatistic(q, col, isScale10 ? "mean_gap" : "mean5");
            // 0 to 10 means are read over their own 0 to 10 domain (readStatistic's nps domain), not mean_gap's.
            const nps = isScale10 ? readStatistic(q, col, "nps") : null;
            const est = r.estimates[weighting];
            const base = r.bases_by_weighting[weighting];
            const main = nps ?? mean;
            n += check(`${label} valid raw`, main.rawBase, base.valid.raw, true);
            n += check(`${label} eligible raw`, main.rawBase + main.nonresponse + main.outsideDomain, base.eligible.raw, true);
            n += check(`${label} valid weighted`, main.weightedBase, base.valid.weighted);
            if (isScale10) {
              const meanOf = (() => {
                // The 0 to 10 mean from the same reading's counts.
                let w = 0;
                let s = 0;
                for (const row of q.rows) {
                  if (row.rawCode === undefined || row.isBase) continue;
                  const c = Number(row.rawCode);
                  if (!Number.isInteger(c) || c < 0 || c > 10) continue;
                  const x = col === "total" ? (row.total.countExact ?? 0) : (row.countExact?.[col] ?? 0);
                  w += x;
                  s += c * x;
                }
                return w > 0 ? s / w : null;
              })();
              n += check(`${label} mean`, meanOf, est.mean);
              if (r.variable === "recommend_0to10") {
                n += check(`${label} nps`, nps!.value, est.nps);
                const share = (codes: number[]) => {
                  const d = readStatistic(q, col, "nps");
                  void d;
                  let w = 0;
                  let tot = 0;
                  for (const row of q.rows) {
                    if (row.rawCode === undefined || row.isBase) continue;
                    const c = Number(row.rawCode);
                    if (!Number.isInteger(c) || c < 0 || c > 10) continue;
                    const x = col === "total" ? (row.total.countExact ?? 0) : (row.countExact?.[col] ?? 0);
                    tot += x;
                    if (codes.includes(c)) w += x;
                  }
                  return tot > 0 ? (w / tot) * 100 : null;
                };
                n += check(`${label} promoters`, share([9, 10]), est.promoter_percent);
                n += check(`${label} passives`, share([7, 8]), est.passive_percent);
                n += check(`${label} detractors`, share([0, 1, 2, 3, 4, 5, 6]), est.detractor_percent);
              } else n += check(`${label} risk 8 to 10`, readStatistic(q, col, "risk").value, est.risk_8_to_10_percent);
              continue;
            }
            n += check(`${label} mean`, mean.value, est.mean);
            n += check(`${label} top two`, readStatistic(q, col, "t2b").value, est.top_two_percent);
            n += check(`${label} top box`, readStatistic(q, col, "top").value, est.top_box_percent);
            n += check(`${label} bottom two`, readStatistic(q, col, "b2b").value, est.bottom_two_percent);
            for (const [code, v] of Object.entries(est.distribution_percent)) n += check(`${label} dist ${code}`, readStatistic(q, col, `dist${code}` as "dist1").value, v);
          }
        }
      }
      counts[`${sector}:reading`] = n;
      expect(disagreements.filter((d) => d.startsWith(sector)), disagreements.join("\n")).toEqual([]);
    });

    it(`${sector}: the existing CSM tiles on each wave file equal Codex by company`, async () => {
      const { loadBrandOverview } = await import("../trackerOverview");
      const rows = CODEX.sectors[sector].results;
      const pack = docs[sector]!;
      let n = 0;
      for (const w of [1, 2, 3]) {
        const o = await loadBrandOverview(tenant, pack.run, pack.docs[w - 1], "csm");
        const row = (variable: string, company: string) => rows.find((r) => r.wave === String(w) && r.variable === variable && r.company_code === company)!;
        for (const [id, variable] of [["satisfaction", "company_csat5"], ["stay", "continue5"], ["switch", "switch_0to10"]] as const) {
          const t = o.csm.find((x) => x.id === id)!;
          if (t.status !== "ok" || t.id === "drivers" || t.id === "recommend" || !Array.isArray(t.byCompany)) {
            disagreements.push(`${sector} wave ${w} tile ${id}: ${t.status}`);
            continue;
          }
          const pick = (est: Est) => (id === "switch" ? est.risk_8_to_10_percent : est.top_two_percent);
          n += check(`${sector} wave ${w} tile ${id} all`, t.box, pick(row(variable, "0").estimates.weighted));
          if (id === "satisfaction") n += check(`${sector} wave ${w} tile satisfaction mean all`, t.mean, row(variable, "0").estimates.weighted.mean);
          for (const c of t.byCompany) {
            n += check(`${sector} wave ${w} tile ${id} company ${c.code}`, c.box, pick(row(variable, c.code).estimates.weighted));
            if (id === "satisfaction") n += check(`${sector} wave ${w} tile satisfaction mean company ${c.code}`, c.mean, row(variable, c.code).estimates.weighted.mean);
          }
        }
        const nps = o.csm.find((x) => x.id === "recommend")!;
        if (nps.status !== "ok" || nps.id !== "recommend" || !Array.isArray(nps.byCompany)) disagreements.push(`${sector} wave ${w} tile recommend: ${nps.status}`);
        else {
          n += check(`${sector} wave ${w} tile NPS all`, nps.nps, row("recommend_0to10", "0").estimates.weighted.nps);
          n += check(`${sector} wave ${w} tile NPS base all`, nps.base, row("recommend_0to10", "0").bases_by_weighting.weighted.valid.raw, true);
          for (const c of nps.byCompany) {
            n += check(`${sector} wave ${w} tile NPS company ${c.code}`, c.nps, row("recommend_0to10", c.code).estimates.weighted.nps);
            n += check(`${sector} wave ${w} tile NPS base company ${c.code}`, c.base, row("recommend_0to10", c.code).bases_by_weighting.weighted.valid.raw, true);
          }
        }
      }
      counts[`${sector}:tiles`] = n;
      expect(disagreements.filter((d) => d.startsWith(`${sector} wave`) && d.includes("tile")), disagreements.join("\n")).toEqual([]);
    });
  }
});
