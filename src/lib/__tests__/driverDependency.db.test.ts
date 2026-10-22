// R1000-01 (Codex, 2026-10-22): a driver result is returned to the browser before it is saved, and
// the save trusted the variable list inside it. A result whose `provenance.variables` had been
// emptied or shortened was accepted, so a later correction to a variable the analysis used left the
// accepted insight "Support current", in Excel too. These run the actual driver save and post
// actions, the actual correction action (saveVariableOverrideAction), both support loaders and the
// synthesized-insight Excel export (all and accepted) against a real disposable PostgreSQL. The driver
// result is the real engine's on synthetic data; only Next's request plumbing, storage and the
// variable dictionary (the file read the correction action checks a name against) are stubbed.
//   lists        omitted, empty, subset, foreign and wrongly typed lists are replaced by the checked
//                request's variables on save; a correction to a used variable is changed support
//   roles        outcome, predictor, weight, group and stated-importance variables each count
//   control      a correction to a variable the analysis did not use leaves support current
//   recorded     a finding whose stored list was shortened afterwards still follows the saved request
//   clear        clearing the correction returns support to current; a result rebuilt with the
//                correction in effect is current while it stands
//   snapshot     a corrections snapshot that is not a plain object is not known: not checked, never current
//   refusal      a result naming another file is refused, and the same result for its own file saves
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { driverAnalysis } from "../driverAnalysis";
import type { DriverReport, DriverRequest } from "../drivers";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })), download: vi.fn(async () => ({ data: null, error: { message: "synthetic: no stored file" } })), upload: vi.fn() }) } },
}));
// The correction action confirms the variable exists by reading the file's dictionary; the file
// itself is not stored here, so the dictionary is the boundary supplied.
const VARS = ["Y", "X1", "X2", "W", "G", "S1", "OTHER"];
vi.mock("../crosstabs", async (orig) => ({
  ...(await orig<typeof import("../crosstabs")>()),
  loadVariableDictionary: vi.fn(async () => ({ variables: VARS.map((name) => ({ name, label: name, type: "numeric", inSet: false })) })),
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("R1000-01 driver dependencies come from the checked request (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0];
  const actions = async () => await import("../driverActions");

  async function newRun(): Promise<string> {
    run = (await one("insert into runs(tenant_id,project_name,entry_point) values($1,'Driver dependencies','generate') returning id", [tenant])).id;
    return run;
  }
  async function dataFile(name: string): Promise<string> {
    return (await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report',$3,$4) returning id", [tenant, run, name, `${tenant}/${run}/${name}`])).id;
  }

  const baseRequest: DriverRequest = { outcome: "Y", outcomeType: "continuous", topBoxMin: null, predictors: ["X1", "X2"], weightVar: null, statedImportance: {}, groupVar: null };

  /** A real engine result, with provenance as runDriverAnalysisFor records it, then `variables` replaced as given. */
  async function report(documentId: string, request: DriverRequest = baseRequest, variables?: unknown, omitVariables = false): Promise<DriverReport> {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = Array.from({ length: 120 }, () => {
      const x = request.predictors.map(() => Math.round(rand() * 10));
      return { x, y: 2 + 0.6 * x[0] + 0.2 * (x[1] ?? 0) + rand() * 2 };
    });
    const result = driverAnalysis({ y: rows.map((r) => r.y), x: rows.map((r) => r.x), names: request.predictors, outcome: "continuous", bootstrap: 20, seed: 1 });
    if ("error" in result) throw new Error(result.error);
    const { loadVariableOverrides } = await import("../variableOverrides");
    const { driverRequestVariables } = await import("../driverRequest");
    const provenance: Record<string, unknown> = { documentId, overridesSnapshot: await loadVariableOverrides(tenant, run, documentId) };
    if (!omitVariables) provenance.variables = variables === undefined ? driverRequestVariables(request) : variables;
    return { request, provenance, outcomeLabel: "Satisfaction", outcomeNote: "", casesInFile: 120, weighted: false, skipped: [], result, performance: [] } as unknown as DriverReport;
  }

  async function posted(documentId: string, title: string, rep: DriverReport) {
    const { saveDriverAnalysisAction, addDriverFindingsAction } = await actions();
    const saved = await saveDriverAnalysisAction(run, documentId, title, rep);
    if (!saved.ok) throw new Error(saved.error);
    const added = await addDriverFindingsAction(run, saved.id);
    if (!added.ok) throw new Error(added.error);
    const findings = (await db.pool.query("select id, stated_stats from findings where run_id=$1 and stated_stats->>'analysisId'=$2 order by created_at, id", [run, saved.id])).rows;
    return { id: saved.id, findings };
  }

  async function insightOn(findingId: string, headline: string) {
    const pre = (await one("insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication, support_snapshot) values ($1,$2,$3,'h','o','t','i', finding_support_parts($3)) returning id", [tenant, run, findingId])).id;
    const si = (await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
       values ($1,$2,$3,'o','t','i',1,1,1,'exploratory','accepted') returning id`,
      [tenant, run, headline],
    )).id;
    await db.pool.query("insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1,$2,$3, finding_support_parts($4))", [tenant, si, pre, findingId]);
    return { pre, si };
  }

  async function statusBoth(ins: { pre: string; si: string }) {
    const { loadInsightSupportOrUnchecked, loadPreInsightSupportOrUnchecked } = await import("../supportStatus");
    const s = (await loadInsightSupportOrUnchecked(tenant, run, [ins.si])).statusOf(ins.si);
    const p = (await loadPreInsightSupportOrUnchecked(tenant, run, [ins.pre])).statusOf(ins.pre);
    return { si: s.status, pre: p.status, reasons: s.reasons.map((r) => r.kind) };
  }

  async function correct(documentId: string, variable: string, type: "categorical" | null) {
    const { saveVariableOverrideAction } = await import("../variableOverrideActions");
    const r = await saveVariableOverrideAction(run, documentId, variable, { type });
    if (!r.ok) throw new Error(r.error);
  }

  /** The Support cell of each insight row in the synthesized-insight Excel export. */
  async function excelSupport(scope: "all" | "accepted"): Promise<Map<string, string>> {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export/route");
    const res = await GET(new Request(`http://x/?scope=${scope}`), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const book = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: "" });
    const header = rows.findIndex((r) => r.some((c) => String(c).trim() === "Support"));
    expect(header).toBeGreaterThanOrEqual(0);
    const col = rows[header].findIndex((c) => String(c).trim() === "Support");
    const out = new Map<string, string>();
    for (const r of rows.slice(header + 1)) {
      const headline = r.map(String).find((c) => /^Dependency /.test(c));
      if (headline) out.set(headline, String(r[col]));
    }
    return out;
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic driver dependencies')", [tenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("an omitted, empty, subset, foreign or wrongly typed list is replaced on save; a correction to a used predictor is changed support everywhere", async () => {
    await newRun();
    // Each list on its own data file: normalised, they are one identical result, which a second save
    // on the same file would rightly reuse (saveDriverAnalysis dedupes identical results).
    const cases: [string, unknown, boolean][] = [
      ["Dependency canonical", undefined, false],
      ["Dependency omitted", undefined, true],
      ["Dependency empty", [], false],
      ["Dependency subset", ["Y", "X1"], false],
      ["Dependency foreign", ["Q99", "Z"], false],
      ["Dependency mistyped", ["Y", 5, null], false],
      ["Dependency not a list", "Y", false],
    ];
    const insights = new Map<string, { pre: string; si: string }>();
    const docs = new Map<string, string>();
    for (const [headline, variables, omit] of cases) {
      const doc = await dataFile(`${headline}.sav`);
      docs.set(headline, doc);
      const p = await posted(doc, headline, await report(doc, baseRequest, variables, omit));
      const stored = await one("select report->'provenance'->'variables' as v from driver_analyses where id=$1", [p.id]);
      expect(stored.v, headline).toEqual(["Y", "X1", "X2"]);
      for (const f of p.findings) expect(f.stated_stats.provenance.variables, headline).toEqual(["Y", "X1", "X2"]);
      insights.set(headline, await insightOn(p.findings[0].id, headline));
    }
    for (const [headline, ins] of insights) expect((await statusBoth(ins)).si, headline).toBe("current");

    for (const doc of docs.values()) await correct(doc, "X2", "categorical");
    for (const [headline, ins] of insights) {
      const s = await statusBoth(ins);
      expect(s.si, headline).toBe("stale");
      expect(s.pre, headline).toBe("stale");
      expect(s.reasons, headline).toContain("corrections_changed");
    }
    for (const scope of ["all", "accepted"] as const) {
      const excel = await excelSupport(scope);
      for (const [headline] of cases) {
        expect(excel.get(headline), `${scope}: ${headline}`).toMatch(/^Support changed since drafted/);
      }
    }

    // Clearing the correction returns every one of them to current.
    for (const doc of docs.values()) await correct(doc, "X2", null);
    for (const [headline, ins] of insights) expect((await statusBoth(ins)).si, headline).toBe("current");
  });

  it("outcome, weight, group and stated-importance variables count as used; a variable the analysis did not use does not", async () => {
    await newRun();
    const doc = await dataFile("roles.sav");
    const request: DriverRequest = { ...baseRequest, weightVar: "W", groupVar: "G", statedImportance: { X1: "S1" } };
    const p = await posted(doc, "Dependency roles", await report(doc, request, []));
    expect(p.findings[0].stated_stats.provenance.variables).toEqual(["Y", "X1", "X2", "W", "G", "S1"]);
    const ins = await insightOn(p.findings[0].id, "Dependency roles");

    await correct(doc, "OTHER", "categorical");
    expect((await statusBoth(ins)).si).toBe("current");
    await correct(doc, "OTHER", null);

    for (const used of ["Y", "X1", "W", "G", "S1"]) {
      await correct(doc, used, "categorical");
      const s = await statusBoth(ins);
      expect(s.si, used).toBe("stale");
      expect(s.pre, used).toBe("stale");
      await correct(doc, used, null);
      expect((await statusBoth(ins)).si, `${used} cleared`).toBe("current");
    }
  });

  it("a finding whose stored list was shortened afterwards still follows its saved analysis's request", async () => {
    await newRun();
    const doc = await dataFile("recorded.sav");
    const p = await posted(doc, "Dependency recorded", await report(doc));
    await db.pool.query(`update findings set stated_stats = jsonb_set(stated_stats, '{provenance,variables}', '[]'::jsonb) where stated_stats->>'analysisId'=$1`, [p.id]);
    const ins = await insightOn(p.findings[0].id, "Dependency recorded");
    await correct(doc, "X1", "categorical");
    expect((await statusBoth(ins)).si).toBe("stale");
  });

  it("a result rebuilt with the correction in effect is current while it stands, and changed when it is cleared", async () => {
    await newRun();
    const doc = await dataFile("rebuild.sav");
    const first = await posted(doc, "Dependency before", await report(doc, baseRequest, []));
    const before = await insightOn(first.findings[0].id, "Dependency before");
    await correct(doc, "X1", "categorical");
    expect((await statusBoth(before)).si).toBe("stale");
    const rebuilt = await posted(doc, "Dependency rebuilt", await report(doc, baseRequest, ["Y"]));
    const after = await insightOn(rebuilt.findings[0].id, "Dependency rebuilt");
    expect((await statusBoth(after)).si).toBe("current");
    await correct(doc, "X1", null);
    expect((await statusBoth(after)).si).toBe("stale");
    expect((await statusBoth(before)).si).toBe("current");
  });

  it("a corrections snapshot that is not a plain object is not known: not checked, never current", async () => {
    await newRun();
    const doc = await dataFile("snapshot.sav");
    const rep = await report(doc);
    (rep as unknown as { provenance: { overridesSnapshot: unknown } }).provenance.overridesSnapshot = ["not", "a", "map"];
    const p = await posted(doc, "Dependency snapshot", rep);
    expect(p.findings[0].stated_stats.provenance.overridesSnapshot).toBeNull();
    const s = await statusBoth(await insightOn(p.findings[0].id, "Dependency snapshot"));
    expect(s.si).toBe("unknown");
    expect(s.pre).toBe("unknown");
  });

  it("a result naming another file is refused; the same request for its own file then saves", async () => {
    await newRun();
    const doc = await dataFile("refusal.sav");
    const other = await dataFile("refusal-other.sav");
    const { saveDriverAnalysisAction } = await actions();
    expect((await saveDriverAnalysisAction(run, doc, "Dependency refused", await report(other, baseRequest, []))).ok).toBe(false);
    expect(Number((await one("select count(*) as n from driver_analyses where document_id=$1", [doc])).n)).toBe(0);
    const retry = await saveDriverAnalysisAction(run, doc, "Dependency retried", await report(doc, baseRequest, []));
    expect(retry.ok).toBe(true);
    if (retry.ok) expect((await one("select report->'provenance'->'variables' as v from driver_analyses where id=$1", [retry.id])).v).toEqual(["Y", "X1", "X2"]);
  });
});
