// Indicator Analytics (D6; contract claude/indicator-analytics.md) against a real disposable PostgreSQL built from
// every migration, with the actual upload (uploadDocumentsAction), the actual engine (api/parse-stats-file.py
// indicator_observations), publishIndicatorRead and the tile's loader (loadIndicatorAnalytics,
// loadIndicatorWorkspace). Storage is an in-memory stand-in; the model is never called.
//
// Expected values are Grant's independent reference (fixtures/indicator-data/Chart_Data_RH_ANCC_W_IRN_reference.json,
// built from DHS_SD_WIDEF.csv on 29 October 2026) and cells of the fixture files read with a plain CSV split, never
// the app's own output. Tolerances: a value is compared as written (exact text) and as a number within 1e-9; the
// change since the previous observation is compared after rounding to the shown decimal (one, DECIMALS = 1), within
// 1e-9 of the reference difference 90.2 - 70.5 = 19.7.
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
vi.mock("../outputIngest", () => ({ ingestOutputFiles: vi.fn() }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (key: string, body: Uint8Array) => {
          storage.objects.set(key, new Uint8Array(body));
          return { error: null };
        },
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([storage.objects.get(key)!.slice()]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async (keys: string[]) => {
          for (const k of keys) storage.objects.delete(k);
          return { data: keys.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;
const FIX = path.join(process.cwd(), "fixtures", "indicator-data");
const fixture = (name: string) => readFileSync(path.join(FIX, name));

type RefObservation = { series_key: Record<string, string>; TIME_PERIOD: string; OBS_VALUE: number; COMMENT_OBS: string; OBS_STATUS: string; OBS_CONF: string; DECIMALS: string; labels: Record<string, string> };
const REF = JSON.parse(fixture("Chart_Data_RH_ANCC_W_IRN_reference.json").toString("utf8")) as {
  audit_summary: { observations: number; countries: number; series: number; indicators: number; duplicate_observation_keys: number; empty_year_cells: number; range: [number, number] };
  kenya_observed_trend: RefObservation[];
  common_year_2022: RefObservation[];
  all_two_year_window_observations: RefObservation[];
};

/** Cells of a CSV fixture by header name: quoted or bare cells, a quoted cell may hold a comma (no line breaks). */
function csvRows(name: string): Record<string, string>[] {
  const split = (l: string) => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (quoted && ch === '"' && l[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { out.push(cell); cell = ""; }
      else cell += ch;
    }
    out.push(cell);
    return out;
  };
  const lines = fixture(name).toString("utf8").replace(/\r/g, "").trim().split("\n");
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Indicator Analytics: the tile's figures from the real import path (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  let run = "";
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const analytics = () => import("../indicatorAnalytics");

  async function upload(name: string, bytes: Buffer) {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const fd = new FormData();
    fd.append("indicatorFiles", new File([new Uint8Array(bytes)], name, { type: "text/csv" }));
    return uploadDocumentsAction(run, fd);
  }
  const docId = async (name: string) => (await q<{ id: string }>("select id from documents where run_id = $1 and source_filename = $2", [run, name]))[0].id;
  const request = (documentId: string, extra: Partial<import("../indicatorAnalytics").IndicatorAnalyticsRequest> = {}) => ({
    documentId, readId: null, seriesKey: null, area: null, from: null, to: null, comparePeriod: null, trendAreas: null, ...extra,
  });
  async function view(documentId: string, extra: Partial<import("../indicatorAnalytics").IndicatorAnalyticsRequest> = {}) {
    const v = await (await analytics()).loadIndicatorAnalytics(tenant, run, request(documentId, extra));
    if (v.state !== "ready") throw new Error(`view is ${v.state}: ${JSON.stringify(v).slice(0, 400)}`);
    return v;
  }
  /** The series key of a reference window, from the first view's choices (identity by key, chosen by code). */
  async function windowKey(documentId: string, window: string) {
    const v = await view(documentId);
    return v.filters.seriesChoices.find((c) => c.codes.COMP_BREAKDOWN_1 === window)!.key;
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    for (const t of [tenant, otherTenant]) await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [t]);
    run = (await q<{ id: string }>("insert into runs (tenant_id, project_name) values ($1, 'Indicators') returning id", [tenant]))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("the DHS slice: Kenya two-year window equals the reference trend, headline and change; other windows are other series", async () => {
    expect(await upload("DHS_SD_WIDEF.csv", fixture("DHS_SD_WIDEF.csv"))).toMatchObject({ ok: true });
    const id = await docId("DHS_SD_WIDEF.csv");
    const key02 = await windowKey(id, "ANCC_IRN_02");
    const v = await view(id, { seriesKey: key02, area: { code: "KEN" } });
    // Acceptance test B: 2003 45.8, 2008 71.0, 2014 70.5, 2022 90.2; latest 90.2%, +19.7 pp, not year-on-year.
    const ref = REF.kenya_observed_trend;
    expect(v.overview.trend.map((p) => [p.period, p.valueText, p.note])).toEqual(ref.map((r) => [r.TIME_PERIOD, r.OBS_VALUE.toFixed(Number(r.DECIMALS)), r.COMMENT_OBS]));
    for (const [i, p] of v.overview.trend.entries()) expect(Math.abs(p.value - ref[i].OBS_VALUE)).toBeLessThan(1e-9);
    expect(v.overview.trend.map((p) => p.shown)).toEqual(["45.8%", "71.0%", "70.5%", "90.2%"]);
    const h = v.overview.headline;
    expect([h.latest?.shown, h.latest?.period, h.latest?.note, h.observationCount]).toEqual(["90.2%", "2022", "DHS, 2022", 4]);
    expect(Math.abs(Number(h.change!.value.toFixed(1)) - (ref[3].OBS_VALUE - ref[2].OBS_VALUE))).toBeLessThan(1e-9);
    expect([h.change?.text, h.change?.periodsText, h.change?.arithmetic, h.change?.unitWords]).toEqual(["+19.7 pp", "2022 vs 2014, not year-on-year", "90.2% minus 70.5%", "percentage points"]);
    expect(v.overview.summary).toEqual({
      statement: "For Kenya (KEN), the reported value rose from 70.5% in 2014 to 90.2% in 2022.",
      detail: "This is an 8-year gap between observations. No annual path or statistical significance is inferred.",
    });
    // Definition and provenance from the file's own attribute columns (reader 2026.10.29).
    const line = (label: string) => v.definition.find((d) => d.label === label)?.value;
    expect([line("Decimals"), line("Confidentiality"), line("Observation status"), line("Unit multiplier")]).toEqual(["One (1)", "Public (PU)", "Normal value (A)", "0 (values as written)"]);
    expect(line("Source metadata date")).toBe("not supplied in the file");
    expect(line("Data structure")).toBe("WB.DATA360:DS_DATA360(1.3)");
    expect(v.filters.breakdowns.map((b) => [b.dimension, b.name, b.code])).toEqual([["COMP_BREAKDOWN_1", "Reference window", "ANCC_IRN_02"]]);

    // Acceptance test D: the 03 and 05 windows are separate series, each with its own CSV cells; nothing pooled.
    const rows = csvRows("DHS_SD_WIDEF.csv");
    for (const w of ["ANCC_IRN_02", "ANCC_IRN_03", "ANCC_IRN_05"]) {
      const k = await windowKey(id, w);
      const wv = await view(id, { seriesKey: k, area: { code: "KEN" } });
      const want = rows.filter((r) => r.REF_AREA === "KEN" && r.COMP_BREAKDOWN_1 === w).flatMap((r) => Object.entries(r).filter(([y, x]) => /^[0-9]{4}$/.test(y) && x !== "").map(([y, x]) => [y, x])).sort();
      expect(wv.overview.trend.map((p) => [p.period, p.valueText])).toEqual(want);
      expect(wv.series.key).toBe(k);
      // The comparison and every trend panel are of the same window: each panel's values are this window's cells.
      for (const panel of wv.trends.panels) {
        const cells = rows.filter((r) => r.REF_AREA === panel.areaCode && r.COMP_BREAKDOWN_1 === w).flatMap((r) => Object.entries(r).filter(([y, x]) => /^[0-9]{4}$/.test(y) && x !== "").map(([y, x]) => [y, x])).sort();
        expect(panel.points.map((p) => [p.period, p.valueText])).toEqual(cells);
      }
    }
    // A blank year stays missing: 2010 has no point, there is no zero anywhere, nothing between observations.
    expect(v.overview.trend.some((p) => p.period === "2010" || p.value === 0)).toBe(false);
    // Every slice value of the two-year window is the reference's value for that area and year.
    const refByKey = new Map(REF.all_two_year_window_observations.map((r) => [`${r.series_key.REF_AREA}|${r.TIME_PERIOD}`, r.OBS_VALUE]));
    for (const panel of v.trends.panels) for (const p of panel.points) expect(refByKey.get(`${panel.areaCode}|${p.period}`)).toBeCloseTo(p.value, 9);
  });

  it("the full DHS download: audit counts, Kenya trend, the 2022 comparison and the 210 two-year-window observations equal the reference", async () => {
    expect(await upload("DHS_SD_WIDEF_full.csv", fixture("DHS_SD_WIDEF_full.csv"))).toMatchObject({ ok: true });
    const id = await docId("DHS_SD_WIDEF_full.csv");
    const key02 = await windowKey(id, "ANCC_IRN_02");
    const v = await view(id, { seriesKey: key02, area: { code: "KEN" } });
    // Acceptance test A: 607 observations, 71 areas, 213 series, 1 indicator, range 10.2 to 97.8, no duplicate keys,
    // and the 15,782 blank year cells counted as absent cells, not as failures.
    const a = REF.audit_summary;
    expect([v.coverage.observations, v.coverage.areas, v.coverage.areaSeries, v.coverage.indicators]).toEqual([a.observations, a.countries, a.series, a.indicators]);
    expect(v.coverage.valueRange!.map(Number)).toEqual(a.range);
    const dup = await q<{ n: number }>(
      `select count(*)::int as n from (select o.series_id, o.area_code, o.period from indicator_observations o join indicator_series s on s.id = o.series_id
        where s.document_id = $1 group by 1, 2, 3 having count(*) > 1) d`,
      [id],
    );
    expect(dup[0].n).toBe(a.duplicate_observation_keys);
    expect((await q<{ n: number }>("select (provenance->>'absentCells')::int as n from indicator_reads where document_id = $1", [id]))[0].n).toBe(a.empty_year_cells);
    // Acceptance test B on the full file.
    expect(v.overview.trend.map((p) => [p.period, Number(p.valueText), p.note])).toEqual(REF.kenya_observed_trend.map((r) => [r.TIME_PERIOD, r.OBS_VALUE, r.COMMENT_OBS]));
    expect([v.overview.headline.latest?.shown, v.overview.headline.change?.text]).toEqual(["90.2%", "+19.7 pp"]);
    // Acceptance test C: reference year 2022, highest first, survey labels kept (Mozambique DHS, 2022-23).
    expect(v.compare!.period).toBe("2022");
    expect(v.compare!.rows.map((r) => [r.areaCode, r.value, r.note])).toEqual(REF.common_year_2022.map((r) => [r.series_key.REF_AREA, r.OBS_VALUE, r.COMMENT_OBS]));
    expect(v.compare!.rows.find((r) => r.areaCode === "KEN")!.selected).toBe(true);
    expect(v.compare!.selected?.shown).toBe("90.2%");
    expect(v.compare!.notObserved).toBe(new Set(REF.all_two_year_window_observations.map((r) => r.series_key.REF_AREA)).size - REF.common_year_2022.length);
    // The 210 observations of the two-year window, every one by area and year, as the reference gives them.
    const seen = new Map<string, number>();
    for (const area of v.filters.areas) {
      const panel = (await view(id, { seriesKey: key02, area: { code: area.code } })).overview.trend;
      for (const p of panel) seen.set(`${area.code}|${p.period}`, p.value);
    }
    expect(seen.size).toBe(210);
    expect(REF.all_two_year_window_observations).toHaveLength(210);
    for (const r of REF.all_two_year_window_observations) expect(Math.abs(seen.get(`${r.series_key.REF_AREA}|${r.TIME_PERIOD}`)! - r.OBS_VALUE)).toBeLessThan(1e-9);
    // The other windows hold the remaining observations; none of them is in the two-year window's view.
    const k03 = await windowKey(id, "ANCC_IRN_03");
    const k05 = await windowKey(id, "ANCC_IRN_05");
    const counts = await q<{ key: string; n: number }>("select series_key as key, observation_count as n from indicator_series where document_id = $1", [id]);
    const n = (k: string) => counts.find((c) => c.key === k)!.n;
    expect(n(key02)).toBe(210);
    expect(n(key02) + n(k03) + n(k05)).toBe(a.observations);
    // Acceptance test F: an explicit comparison year another country lacks gives no substituted value.
    const c2014 = (await view(id, { seriesKey: key02, area: { code: "KEN" }, comparePeriod: "2014" })).compare!;
    const refAreas2014 = REF.all_two_year_window_observations.filter((r) => r.TIME_PERIOD === "2014").map((r) => r.series_key.REF_AREA).sort();
    expect(c2014.rows.map((r) => r.areaCode).sort()).toEqual(refAreas2014);
    // A range that ends before 2022 gives 2014 as the latest, with 2008 as the previous observation.
    const to2015 = await view(id, { seriesKey: key02, area: { code: "KEN" }, to: "2015" });
    expect([to2015.overview.headline.latest?.period, to2015.overview.headline.previous?.period, to2015.overview.headline.change?.text]).toEqual(["2014", "2008", "-0.5 pp"]);
    expect(to2015.overview.summary.statement).toBe("For Kenya (KEN), the reported value fell from 71.0% in 2008 to 70.5% in 2014.");
  });

  it("withheld values are shown as withheld, never as 0, in the trend, the headline and the comparison (failure case)", async () => {
    expect(await upload("OECD_FDI_INC_AGGR_filtered_slice.csv", fixture("OECD_FDI_INC_AGGR_filtered_slice.csv"))).toMatchObject({ ok: true });
    const id = await docId("OECD_FDI_INC_AGGR_filtered_slice.csv");
    const first = await view(id);
    // The series of the fixture where Estonia has 2026-Q1 = 3.427 and 2026-Q2 withheld (CONF_STATUS C, no value).
    const rows = csvRows("OECD_FDI_INC_AGGR_filtered_slice.csv");
    const est = rows.filter((r) => r.REF_AREA === "EST" && r.MEASURE === "T_D4P_F" && r.ACCOUNTING_ENTRY === "C" && r.UNIT_MEASURE === "RC" && r.MEASURE_PRINCIPLE === "A" && r.TYPE_ENTITY === "RSP");
    expect(est.map((r) => [r.TIME_PERIOD, r.OBS_VALUE, r.CONF_STATUS]).sort()).toEqual([["2026-Q1", "3.427", "F"], ["2026-Q2", "", "C"]]);
    // The stored series with every breakdown code of those rows (identity by code, never by label).
    const matching = first.filters.seriesChoices.filter((c) => c.indicatorKey === "code:T_D4P_F" && Object.entries(c.codes).every(([d, code]) => est[0][d] === code));
    expect(matching).toHaveLength(1);
    const key = matching[0].key;
    const v = await view(id, { seriesKey: key, area: { code: "EST" } });
    expect(v.overview.trend.map((p) => [p.period, p.valueText])).toEqual([["2026-Q1", "3.427"]]);
    expect(v.overview.withheld).toEqual(["2026-Q2"]);
    expect(v.overview.headline.latest?.period).toBe("2026-Q1");
    expect(v.overview.summary.detail).toContain("2026-Q2 is withheld by the publisher as confidential and not counted.");
    const c = (await view(id, { seriesKey: key, area: { code: "EST" }, comparePeriod: "2026-Q2" })).compare!;
    expect(c.withheld.map((w) => w.areaCode)).toEqual(["EST"]);
    expect(c.rows.map((r) => r.areaCode)).toEqual(["NLD"]);
    expect(c.rows.some((r) => r.value === 0)).toBe(false);
    expect(c.selected).toBeNull();
    // The unit multiplier (6) is applied for display only; two decimals (DECIMALS 2) less six places is none.
    expect(v.overview.trend[0].shown).toBe("3,427,000");
    // Quarters are placed on the common calendar at their first day, on one quarterly axis.
    expect(v.overview.trend[0].position).toBe(Date.UTC(2026, 0, 1) / 86400000);
    expect(v.axis).toMatchObject({ state: "calendar", frequency: "quarter" });
  });

  it("workspace: readiness per file and per provider (OECD metadata only, IMF no file provided); a notes file is definitions only", async () => {
    const { loadIndicatorWorkspace, loadIndicatorAnalytics } = await analytics();
    let w = await loadIndicatorWorkspace(tenant, run);
    if (w.state !== "ready") throw new Error(w.state);
    expect(w.providers.map((p) => p.text)).toEqual(["World Bank: 2 files with observations", "OECD: 1 file with observations", "IMF: no file provided"]);
    expect(await upload("OECD_FDI_INC_AGGR_reference.csv", fixture("OECD_FDI_INC_AGGR_reference.csv"))).toMatchObject({ ok: true });
    w = await loadIndicatorWorkspace(tenant, run);
    if (w.state !== "ready") throw new Error(w.state);
    const notes = w.files.find((f) => f.fileName === "OECD_FDI_INC_AGGR_reference.csv")!;
    expect([notes.state, notes.content, notes.status]).toEqual(["definitions_only", "79 metadata rows, 129 English notes, no values", "Metadata only: no charts"]);
    expect(w.providers.map((p) => p.text)).toContain("OECD: 1 file with observations, 1 metadata only");
    const full = w.files.find((f) => f.fileName === "DHS_SD_WIDEF_full.csv")!;
    expect([full.state, full.provider, full.content]).toEqual(["observations_ready", "world_bank", "607 observations, 3 series, 71 areas"]);
    // Acceptance test E: the OECD reference information produces no numeric view.
    expect((await loadIndicatorAnalytics(tenant, run, request(notes.documentId))).state).toBe("definitions_only");
  });

  it("a reread makes an earlier view stale; a series key not in the read and an area not in the series are refused, never replaced", async () => {
    const { loadIndicatorAnalytics } = await analytics();
    const { readIndicatorDocument } = await import("../indicatorData");
    const id = await docId("DHS_SD_WIDEF.csv");
    const before = await view(id);
    expect(await readIndicatorDocument(tenant, run, id)).toMatchObject({ ok: true });
    expect((await loadIndicatorAnalytics(tenant, run, request(id, { readId: before.readId, seriesKey: before.series.key }))).state).toBe("stale");
    expect((await loadIndicatorAnalytics(tenant, run, request(id, { seriesKey: '["RH_ANCC_W_IRN", [["FREQ", "A"]]]' }))).state).toBe("series_not_found");
    const k03 = await windowKey(id, "ANCC_IRN_03");
    expect(await loadIndicatorAnalytics(tenant, run, request(id, { seriesKey: k03, area: { code: "NPL" } }))).toMatchObject({ state: "invalid" });
    expect(await loadIndicatorAnalytics(tenant, run, request(id, { from: "2020", to: "2010" }))).toMatchObject({ state: "invalid" });
    // Another organisation cannot read this project's file.
    await expect(loadIndicatorAnalytics(otherTenant, run, request(id))).rejects.toThrow(/not Indicator data in this project/);
  });

  it("a series whose rows carry two AGG_METHOD codes needs review and charts nothing", async () => {
    const lines = fixture("DHS_SD_WIDEF.csv").toString("utf8").split("\n");
    // KEN 2008 two-year window (its own row, its own year): a second aggregation method in the same stored series.
    const at = lines.findIndex((l) => l.includes('"KEN","RH_ANCC_W_IRN"') && l.includes('"ANCC_IRN_02"') && l.includes('"DHS, 2008-09"'));
    expect(at).toBeGreaterThan(0);
    lines[at] = lines[at].replace('"_Z","RATIO"', '"WT","RATIO"');
    expect(await upload("DHS_two_methods.csv", Buffer.from(lines.join("\n"), "utf8"))).toMatchObject({ ok: true });
    const id = await docId("DHS_two_methods.csv");
    const v = await (await analytics()).loadIndicatorAnalytics(tenant, run, request(id));
    expect(v.state).toBe("needs_review");
    if (v.state === "needs_review") expect(v.message).toContain("AGG_METHOD has 2 codes in this series (WT, _Z)");
  });
});
