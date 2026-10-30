// Batch 59, CT5K-F01 (Codex, 28 October 2026): row % and share of responses must not change when every
// positive weight is multiplied by the same constant. Before the fix the engine divided counts already
// rounded to one decimal, so with weights of 1/1024 the selected answer's row % read 0/0/100 and a column's
// share of responses was blank despite 100 unweighted cases. Through the actual buildCrosstab, loadCrosstab,
// listCrosstabs, the Excel export route and loadInsightSupport, the local engine and a real disposable
// PostgreSQL; storage and the model are the mocked boundaries. Expected values are hand counts from the
// generator's design (10, 30 and 60 selected of 100 per group; options chosen by 10/30/60 and 30/50/70).
//   - Saved and reloaded at weight 1 and 1/1024: the same row % and shares, and the current method version.
//   - The export prints the same row % and shares of responses as the saved table.
//   - A table saved under the previous method ("2026.10.27") is listed as built with an earlier method and an
//     insight on its finding reads "stale" (method_changed); nothing is recalculated, the finding's and
//     insight's wording is kept; rebuilding records the current method and leaves the old table as it was.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { CURRENT_TABLE_METHOD } from "../tableMethod";
import type { CrosstabRequest, CrosstabResult } from "../parseStatsFile";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/crosstabMeanRows", async () => await import("../crosstabMeanRows"));
vi.mock("@/lib/crosstabExact", async () => await import("../crosstabExact"));
vi.mock("@/lib/crosstabSlides", async () => await import("../crosstabSlides"));
vi.mock("@/lib/convertToPdf", async () => await import("../convertToPdf"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
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

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

/** 300 respondents in three groups of 100; W = 1 and Ws = 1/1024 for everyone. */
function designed(): Buffer {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "ct5k-")), "scale.sav");
  const script = String.raw`
import sys, pandas as pd, pyreadstat
rows = []
for g in range(3):
    for i in range(100):
        rows.append({"Y": 1.0 if i < [10, 30, 60][g] else 2.0, "G": float(g + 1), "W": 1.0, "Ws": 1 / 1024,
                     "M_1": float(i < [10, 30, 60][g]), "M_2": float(i < [30, 50, 70][g])})
pyreadstat.write_sav(pd.DataFrame(rows), sys.argv[1], variable_value_labels={"Y": {1: "Selected", 2: "Other"}, "G": {1: "G1", 2: "G2", 3: "G3"},
    "M_1": {0: "No", 1: "Yes"}, "M_2": {0: "No", 1: "Yes"}})
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(out);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("CT5K-F01: percentages unchanged by weight scale (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  let doc = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id;
    const key = `${tenant}/${run}/${randomUUID()}-scale.sav`;
    storage.objects.set(key, designed());
    doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'scale.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const frequency = (weightVar: string): CrosstabRequest => ({ columnVars: ["G"], weightVar, correction: "none", rowItems: [{ key: "Y", label: "Y", vars: ["Y"] }] });
  const multi = (weightVar: string): CrosstabRequest => ({ columnVars: ["G"], weightVar, correction: "none", rowItems: [{ key: "M", label: "M", vars: ["M_1", "M_2"] }] });
  const stored = async (tableId: string) => (await q("select crosstab from document_tables where id = $1", [tableId]))[0].crosstab as CrosstabResult;
  const answer = (t: CrosstabResult, by: (r: CrosstabResult["questions"][number]["rows"][number]) => boolean) => t.questions[0].rows.find((r) => !r.isBase && by(r))!;
  const tables: Record<string, string> = {};

  it("saved and reloaded at weight 1 and 1/1024: row % 10/30/60 and 45/35/20, shares of responses 40/60 and 25/75", async () => {
    const { buildCrosstab, loadCrosstab, listCrosstabs } = await import("../crosstabs");
    for (const w of ["W", "Ws"]) {
      tables[`freq-${w}`] = (await buildCrosstab(tenant, run, doc, frequency(w))).tableId;
      tables[`multi-${w}`] = (await buildCrosstab(tenant, run, doc, multi(w))).tableId;
      const f = (await loadCrosstab(tenant, run, tables[`freq-${w}`])).result!;
      expect(answer(f, (r) => r.label === "Selected").rowPct).toEqual([10, 30, 60]);
      expect(answer(f, (r) => r.label === "Other").rowPct).toEqual([45, 35, 20]);
      expect(f).toEqual(await stored(tables[`freq-${w}`]));
      const m = (await loadCrosstab(tenant, run, tables[`multi-${w}`])).result!;
      const m1 = answer(m, (r) => r.variable === "M_1");
      const m2 = answer(m, (r) => r.variable === "M_2");
      expect([m1.total.respPct, m2.total.respPct]).toEqual([40, 60]);
      expect([m1.respPct?.[0], m2.respPct?.[0]]).toEqual([25, 75]);
      expect(JSON.stringify(m)).not.toContain('"_w"');
    }
    const listed = await listCrosstabs(tenant, run, doc);
    for (const id of Object.values(tables)) {
      expect((await stored(id)).notes?.methodVersion).toBe(CURRENT_TABLE_METHOD);
      expect(listed.find((x) => x.id === id)?.methodFreshness).toBe("current");
    }
  });

  it("the Excel export prints the same row % and shares of responses at weight 1/1024", async () => {
    const XLSX = await import("xlsx");
    const { GET } = await import("../../app/api/runs/[id]/crosstab/export/route");
    const sheet = async (tableId: string) => {
      const res = await GET(new Request(`http://local/api/runs/${run}/crosstab/export?tableId=${tableId}&format=xlsx&net=0&measures=col,row,resp`), { params: Promise.resolve({ id: run }) });
      expect(res.status).toBe(200);
      const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
      return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];
    };
    const line = (rows: unknown[][], label: string, measure: string) => rows.find((r) => r[0] === label && r[1] === measure)!.slice(2, 5) as number[];
    const f = await sheet(tables["freq-Ws"]);
    line(f, "Selected", "% within row").forEach((v, j) => expect(v).toBeCloseTo([0.1, 0.3, 0.6][j], 10));
    line(f, "Other", "% within row").forEach((v, j) => expect(v).toBeCloseTo([0.45, 0.35, 0.2][j], 10));
    const m = await sheet(tables["multi-Ws"]);
    const labels = (await stored(tables["multi-Ws"])).questions[0].rows.filter((r) => !r.isBase).map((r) => r.label);
    expect(line(m, labels[0], "% of responses")[0]).toBeCloseTo(0.25, 10);
    expect(line(m, labels[1], "% of responses")[0]).toBeCloseTo(0.75, 10);
  });

  it("a table saved under the previous method is marked earlier, its insight stale; wording kept, nothing recalculated; rebuilding records the current method", async () => {
    const { buildCrosstab, listCrosstabs } = await import("../crosstabs");
    const { loadInsightSupport } = await import("../supportStatus");
    const old = tables["freq-Ws"];
    // As batch 47 saved it: its method version, and the row % it printed from rounded counts.
    await q(
      `update document_tables set crosstab = jsonb_set(jsonb_set(crosstab, '{notes,methodVersion}', '"2026.10.27"'),
         '{questions,0,rows,2,rowPct}', '[0, 0, 100]') where id = $1`,
      [old],
    );
    const one = async (sql: string, p: unknown[]) => (await q(sql, p))[0].id as string;
    const finding = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, status, source_table_id) values ($1, $2, 'generated', 'Researcher wording kept', 'accepted', $3) returning id`,
      [tenant, run, old],
    );
    const pre = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`, [tenant, run, finding]);
    const insight = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, review_status) values ($1, $2, 'Insight headline kept', 'o', 't', 'i', 'accepted') returning id`,
      [tenant, run],
    );
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1, $2, $3, finding_support_parts($4))`, [tenant, insight, pre, finding]);
    const savedBefore = await stored(old);

    expect((await listCrosstabs(tenant, run, doc)).find((x) => x.id === old)?.methodFreshness).toBe("earlier");
    const support = (await loadInsightSupport(tenant, run, [insight])).statusOf(insight);
    expect(support.status).toBe("stale");
    expect(JSON.stringify(support)).toMatch(/method_changed/);
    expect((await q("select finding_text from findings where id = $1", [finding]))[0].finding_text).toBe("Researcher wording kept");
    expect((await q("select headline, review_status from synthesized_insights where id = $1", [insight]))[0]).toEqual({ headline: "Insight headline kept", review_status: "accepted" });
    expect(await stored(old)).toEqual(savedBefore);

    const rebuilt = (await buildCrosstab(tenant, run, doc, frequency("Ws"))).tableId;
    const listed = await listCrosstabs(tenant, run, doc);
    expect(listed.find((x) => x.id === rebuilt)?.methodFreshness).toBe("current");
    expect(answer(await stored(rebuilt), (r) => r.label === "Selected").rowPct).toEqual([10, 30, 60]);
    expect(listed.find((x) => x.id === old)?.methodFreshness).toBe("earlier");
    expect(await stored(old)).toEqual(savedBefore);
  });

  // Derived figures (coordinator follow-up): 100 cases per answer, each weighted by its answer's share / 100,
  // so the weighted shares are exactly those written here. NPS scale: 0 to 6 at 4.54% each, 7 at 16.00%,
  // 8 at 15.94%, 9 and 10 at 18.14%: NPS 36.28 - 31.78 = 4.50 (4.7 from the display parts 36.2 - 31.5);
  // the 11 weighted counts add to 100.00 (99.6 from the display counts). Rating 1 to 5: 20.00, 20.00,
  // 19.92, 20.04, 20.04: top two 40.08 (40.0 from the display parts).
  async function derivedFile(): Promise<string> {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "ct5k-derived-")), "derived.sav");
    const script = String.raw`
import sys, pandas as pd, pyreadstat
nps = [4.54] * 7 + [16.0, 15.94, 18.14, 18.14]
rating = [20.0, 20.0, 19.92, 20.04, 20.04]
rows = []
for k, s in enumerate(nps):
    for i in range(100):
        rows.append({"rec": float(k), "rate": None, "w": s / 100})
for k, s in enumerate(rating):
    for i in range(100):
        rows.append({"rec": None, "rate": float(k + 1), "w": s / 100})
pyreadstat.write_sav(pd.DataFrame(rows), sys.argv[1], column_labels=["Recommend", "Rating", "Weight"],
    variable_value_labels={"rec": {float(k): str(k) for k in range(11)}, "rate": {float(k): str(k) for k in range(1, 6)}})
`;
    const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const key = `${tenant}/${run}/${randomUUID()}-derived.sav`;
    storage.objects.set(key, readFileSync(out));
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'derived.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  }

  it("NPS, top-two box, the CSM box and the export's Total line come from the unrounded figures, saved and reloaded", async () => {
    const { buildCrosstab, loadCrosstab, commitCrosstabs } = await import("../crosstabs");
    const { runNpsAction } = await import("../npsActions");
    const { runDistributionAction } = await import("../chartActions");
    const { summarizeSeries } = await import("../csmMetrics");
    const XLSX = await import("xlsx");
    const { GET } = await import("../../app/api/runs/[id]/crosstab/export/route");
    const d = await derivedFile();
    const request: CrosstabRequest = { columnVars: [], weightVar: "w", correction: "none", rowItems: [{ key: "rec", label: "Recommend", vars: ["rec"] }, { key: "rate", label: "Rating", vars: ["rate"] }] };
    const tableId = (await buildCrosstab(tenant, run, d, request)).tableId;
    const t = (await loadCrosstab(tenant, run, tableId)).result!;
    expect(t).toEqual(await stored(tableId));
    const detractor = t.questions[0].rows.find((r) => r.rawCode === "0")!;
    expect(detractor.total.pct).toBe(4.5);
    expect(detractor.total.pctExact).toBeCloseTo(4.54, 9);
    expect(detractor.total.countExact).toBeCloseTo(4.54, 9);

    const nps = await runNpsAction(run, d, "rec", "w", null, null);
    expect(nps.ok).toBe(true);
    if (nps.ok) expect(nps.result).toMatchObject({ nps: 4.5, promoters: 36.3, passives: 31.9, detractors: 31.8 });

    const dist = await runDistributionAction(run, d, "rate", "w", null);
    expect(dist.ok).toBe(true);
    if (dist.ok) expect(summarizeSeries(dist.result.series[0], "top2").value).toBe(40.1);

    await commitCrosstabs(tenant, run, d);
    const texts = (await q("select finding_text from findings where source_table_id = $1", [tableId])).map((r) => r.finding_text as string);
    expect(texts.some((x) => x.startsWith("Net Promoter Score on Recommend is 4.5 (promoters 36.3%, passives 31.9%, detractors 31.8%"))).toBe(true);
    expect(texts.some((x) => /^Top two box on Rating .*: 40\.1%/.test(x))).toBe(true);

    const res = await GET(new Request(`http://local/api/runs/${run}/crosstab/export?tableId=${tableId}&format=xlsx&net=0&measures=col,count`), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const sheet = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];
    const totalCount = sheet.find((r) => r[0] === "Total" && r[1] === "Weighted count")!;
    expect(totalCount.slice(2, 4)).toEqual([100, 100]); // the column and the Total column, Recommend question
    expect((await loadCrosstab(tenant, run, tableId)).result).toEqual(t);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CT5K-F01: percentages unchanged by weight scale (real database, actual engine)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
