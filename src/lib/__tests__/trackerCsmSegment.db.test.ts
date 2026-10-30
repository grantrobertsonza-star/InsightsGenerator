// R5 CSM segment (Grant, 30 October 2026: "CSM needs a segment tool as well"): the CSM dashboard computed in a segment,
// against independent reference values from src/lib/__tests__/helpers/csm_segment_reference.py (pandas and numpy over
// the same SPSS file, written from the banking pack's answer lists and the segment contract, never from the app's
// output). The banking CSM pack's relationship waves (fixtures/csm) have one profile question of their own (segment);
// the reference script adds two seeded profile questions (gender, with 12 blanks, and age_band) to copies of them, so
// a two-question segment can be taken: Woman AND segment 1 or 3. Real disposable PostgreSQL and the actual Python
// engine; storage is an in-memory stand-in; nothing calls the model.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import type { CsmBoxFigure, CsmDriverFigure, CsmNpsFigure, CsmTile } from "../trackerCsmFigures";

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
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "csm_segment_reference.py");
const pack = (n: string) => path.join(process.cwd(), "fixtures", "csm", n);

type Rating = { shares: Record<string, number>; mean: number; raw: number; weighted: number; effective: number };
type Side = {
  base: { n: number; weighted: number; effective: number };
  satisfaction: Rating & { box: number };
  stay: Rating & { box: number };
  switch: Rating & { box: number };
  nps: { promoters: number; passives: number; detractors: number; score: number; raw: number; weighted: number; effective: number };
  attributes: Record<string, Rating>;
  drivers: { n: number; rSquared: number; coefficients: Record<string, number>; shares: Record<string, number> } | null;
};
type Ref = { weighted: Side; unweighted: Side };
type SegmentArg = { questions: { variable: string; codes: string[] }[] };
const asJson = (s: SegmentArg) => JSON.stringify(Object.fromEntries(s.questions.map((q) => [q.variable, q.codes])));

function reference(file: string, s: SegmentArg): Ref {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "figures", file, asJson(s)], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function variant(src: string, kind: string, out: string): string {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "variant", src, out, kind], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}

/** Woman AND segment 1 or 3: two profile questions, OR within the second. */
const SEG: SegmentArg = { questions: [{ variable: "gender", codes: ["2"] }, { variable: "segment", codes: ["1", "3"] }] };
const DRIVERS = [1, 2, 3, 4, 5, 6].map((j) => `company_driver_d0${j}`);

const tile = <I extends CsmTile["id"]>(tiles: CsmTile[], id: I) => {
  const t = tiles.find((x) => x.id === id);
  if (!t || t.status !== "ok") throw new Error(`${id}: ${JSON.stringify(t)}`);
  return t as I extends "recommend" ? CsmNpsFigure : I extends "drivers" ? CsmDriverFigure : CsmBoxFigure;
};

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R5 CSM segment: every CSM figure in a two-question segment, against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "csm-segment-"));
  const files: Record<string, string> = {};

  /** One project with the given wave files, wave 1 first. */
  async function project(name: string, waves: string[]) {
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
    const docs: string[] = [];
    for (const [i, file] of waves.entries()) {
      const key = `${tenant}/${run}/${randomUUID()}-w${i + 1}.sav`;
      storage.objects.set(key, readFileSync(file));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `banking_w${i + 1}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${i + 1}`, waveDate: `2026-0${i + 2}` })],
      ))[0].id as string);
    }
    return { run, docs };
  }
  const overview = async (run: string, doc: string, segment: SegmentArg | null) => (await import("../trackerOverview")).loadBrandOverview(tenant, run, doc, "csm", segment);
  async function unweighted(run: string, doc: string) {
    const { loadTrackerDashboard, saveTrackerChoices } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, run, doc);
    expect((await saveTrackerChoices(tenant, run, doc, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    files.w1 = variant(pack("banking_relationship_w1_labels.sav"), "profile", path.join(dir, "w1.sav"));
    files.w2 = variant(pack("banking_relationship_w2_labels.sav"), "profile", path.join(dir, "w2.sav"));
    files.w1NoAge = variant(pack("banking_relationship_w1_labels.sav"), "no_age", path.join(dir, "w1_no_age.sav"));
    files.w1x = variant(files.w1, "weight_x25", path.join(dir, "w1x.sav"));
    files.w2x = variant(files.w2, "weight_x25", path.join(dir, "w2x.sav"));
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Every figure of the open wave against the reference side (weighted or not). */
  function expectFigures(o: Awaited<ReturnType<typeof overview>>, ref: Side, weighted: boolean) {
    expect(o.figures.weighted).toBe(weighted);
    // The page's segment and its base: raw n exact, weighted total and Kish effective base (engine one decimal).
    expect(o.segment?.text).toBe("Woman; Segment 1 or Segment 3");
    expect(o.segment?.filters).toEqual([{ variable: "gender", op: "codes", codes: ["2"] }, { variable: "segment", op: "codes", codes: ["1", "3"] }]);
    expect(o.segment?.n).toBe(ref.base.n);
    if (weighted) {
      expect(Math.abs((o.segment?.weighted ?? NaN) - ref.base.weighted)).toBeLessThanOrEqual(0.051);
      expect(Math.abs((o.segment?.effectiveBase ?? NaN) - ref.base.effective)).toBeLessThanOrEqual(0.051);
    } else expect([o.segment?.weighted, o.segment?.effectiveBase]).toEqual([null, null]);

    const sat = tile(o.csm, "satisfaction");
    expect(sat.mean).toBeCloseTo(ref.satisfaction.mean, 9);
    expect(sat.box).toBeCloseTo(ref.satisfaction.box, 9);
    expect(Object.fromEntries((sat.shares ?? []).map((s) => [s.code, s.share]))).toEqual(Object.fromEntries(Object.keys(ref.satisfaction.shares).map((c) => [c, expect.closeTo(ref.satisfaction.shares[c], 9)])));
    for (const [t, r] of [[sat, ref.satisfaction], [tile(o.csm, "stay"), ref.stay], [tile(o.csm, "switch"), ref.switch]] as const) {
      expect(t.box).toBeCloseTo(r.box, 9);
      expect(t.rawBase).toBe(r.raw);
      // The engine reports a weighted total to one decimal.
      expect(Math.abs((t.weightedBase ?? NaN) - r.weighted)).toBeLessThanOrEqual(0.051);
      // Weighted: the Kish effective base, rounded by the distribution tool; unweighted: the number answering.
      expect(Math.abs(t.effectiveBase - r.effective)).toBeLessThanOrEqual(0.5);
    }
    expect(tile(o.csm, "switch").boxCodes).toBe("8 to 10");

    const nps = tile(o.csm, "recommend");
    // The NPS tool reports its figures to one decimal.
    for (const k of ["promoters", "passives", "detractors"] as const) expect(Math.abs(nps[k] - ref.nps[k])).toBeLessThanOrEqual(0.0500001);
    expect(Math.abs(nps.nps - ref.nps.score)).toBeLessThanOrEqual(0.0500001);
    expect(nps.base).toBe(ref.nps.raw);
    expect(Math.abs((nps.weightedBase ?? NaN) - ref.nps.weighted)).toBeLessThanOrEqual(0.051);
    expect(Math.abs((nps.effectiveBase ?? NaN) - ref.nps.effective)).toBeLessThanOrEqual(0.5);

    expect(o.attributes.map((a) => a.variable)).toEqual(DRIVERS);
    for (const a of o.attributes) {
      const r = ref.attributes[a.variable];
      expect(a.mean).toBeCloseTo(r.mean, 9);
      expect([a.rawBase, Math.abs((a.effectiveBase ?? NaN) - r.effective) <= 0.5]).toEqual([r.raw, true]);
      expect(Math.abs((a.weightedBase ?? NaN) - r.weighted)).toBeLessThanOrEqual(0.051);
    }

    const drv = tile(o.csm, "drivers");
    expect(drv.method).toBe("shapley");
    expect(drv.cases).toBe(ref.base.n);
    expect(drv.n).toBe(ref.drivers!.n);
    expect(drv.rSquared).toBeCloseTo(ref.drivers!.rSquared, 9);
    expect(drv.rows.map((r) => r.variable).sort()).toEqual(DRIVERS);
    for (const r of drv.rows) {
      expect(r.share).toBeCloseTo(ref.drivers!.shares[r.variable], 9);
      expect(r.coefficient).toBeCloseTo(ref.drivers!.coefficients[r.variable], 9);
    }
  }

  it("weighted, wave 2 against wave 1: every tile, attribute mean, NPS part, driver share and coefficient, and the bases equal the reference; the trend's wave 1 point is in the segment", async () => {
    const p = await project("Banking CSM weighted", [files.w1, files.w2]);
    const before = Number((await q("select count(*)::int as n from document_tables")).at(0).n);
    const o = await overview(p.run, p.docs[1], SEG);
    const ref2 = reference(files.w2, SEG);
    const ref1 = reference(files.w1, SEG);
    expectFigures(o, ref2.weighted, true);
    expect(o.previous.status).toBe("ok");
    expect(o.timeline.map((t) => t.status)).toEqual(["ok", "ok"]);
    expect(o.timeline[0].satisfaction?.mean).toBeCloseTo(ref1.weighted.satisfaction.mean, 9);
    expect(o.timeline[1].satisfaction?.mean).toBeCloseTo(ref2.weighted.satisfaction.mean, 9);
    // The change against wave 1 is the difference of the two segmented references.
    const satChange = o.csmChanges.find((c) => c.id === "satisfaction" && c.code === null);
    expect(satChange?.changePp).toBeCloseTo(ref2.weighted.satisfaction.box - ref1.weighted.satisfaction.box, 9);
    expect(satChange?.meanChange).toBeCloseTo(ref2.weighted.satisfaction.mean - ref1.weighted.satisfaction.mean, 9);
    // The profile questions offered: the two added and the pack's own segment; the company question is the CSM's own.
    expect(o.segmentQuestions.map((x) => x.variable)).toEqual(["gender", "age_band", "segment"]);
    // Nothing saved as a table.
    expect(Number((await q("select count(*)::int as n from document_tables")).at(0).n)).toBe(before);
    // Without the segment the figures differ (the filter is not a no-op).
    const all = await overview(p.run, p.docs[1], null);
    expect(all.segment).toBeNull();
    expect(tile(all.csm, "satisfaction").rawBase).toBeGreaterThan(900);
    expect(tile(all.csm, "satisfaction").mean).not.toBeCloseTo(ref2.weighted.satisfaction.mean, 6);
  });

  it("unweighted: the same figures against the reference's unweighted side", async () => {
    const p = await project("Banking CSM unweighted", [files.w1, files.w2]);
    await unweighted(p.run, p.docs[1]);
    expectFigures(await overview(p.run, p.docs[1], SEG), reference(files.w2, SEG).unweighted, false);
  });

  it("a company chosen: each company's figures are within the segment", async () => {
    const p = await project("Banking CSM by company", [files.w1, files.w2]);
    const o = await overview(p.run, p.docs[1], SEG);
    for (const code of ["1", "5"]) {
      const ref = reference(files.w2, { questions: [...SEG.questions, { variable: "company", codes: [code] }] }).weighted;
      const sat = tile(o.csm, "satisfaction");
      const c = Array.isArray(sat.byCompany) ? sat.byCompany.find((x) => x.code === code) : null;
      expect(c?.mean).toBeCloseTo(ref.satisfaction.mean, 9);
      expect(c?.box).toBeCloseTo(ref.satisfaction.box, 9);
      const nps = tile(o.csm, "recommend");
      const n = Array.isArray(nps.byCompany) ? nps.byCompany.find((x) => x.code === code) : null;
      expect(Math.abs((n?.nps ?? NaN) - ref.nps.score)).toBeLessThanOrEqual(0.0500001);
      expect(n?.base).toBe(ref.nps.raw);
    }
  });

  it("a segment too small for the driver model: driver priority refused with the owner's minimum and the segment named; the other tiles still show", async () => {
    const p = await project("Banking CSM small", [files.w2]);
    const small: SegmentArg = { questions: [{ variable: "gender", codes: ["3"] }, { variable: "segment", codes: ["2"] }] };
    const ref = reference(files.w2, small).weighted;
    expect(ref.base.n).toBeLessThan(20);
    const o = await overview(p.run, p.docs[0], small);
    const drv = o.csm.find((t) => t.id === "drivers");
    expect(drv).toEqual({
      id: "drivers",
      status: "failed",
      variable: "company_csat5",
      error: `Fewer than 20 cases in the segment (Gender is Another identity; Synthetic demonstration segment is Segment 2: ${ref.base.n}), so the driver model is not run on it.`,
    });
    expect(o.segment?.n).toBe(ref.base.n);
    expect(tile(o.csm, "satisfaction").rawBase).toBe(ref.satisfaction.raw);
    // The driver owner directly: the same refusal, before any model is fitted.
    const { runDriverAnalysisFor } = await import("../drivers");
    await expect(runDriverAnalysisFor(tenant, p.run, p.docs[0], { outcome: "company_csat5", outcomeType: "continuous", predictors: DRIVERS, weightVar: "weight" }, small)).rejects.toThrow(/Fewer than 20 cases in the segment/);
  });

  it("a wave lacking a segment question is withheld with the reason: no change, no trend point, never unsegmented; the open wave still equals the reference", async () => {
    const segAge: SegmentArg = { questions: [{ variable: "gender", codes: ["2"] }, { variable: "age_band", codes: ["2", "3"] }] };
    const a = await project("Banking CSM withheld", [files.w1NoAge, files.w2]);
    const o = await overview(a.run, a.docs[1], segAge);
    const why = "The segment question Age group (age_band) is not a profile question with an answer list in that wave, so the segment cannot be applied there.";
    expect(o.previous).toMatchObject({ status: "withheld", reason: `Not compared with Wave 1: ${why}` });
    expect(o.timeline[0]).toMatchObject({ status: "failed", error: `Not compared with Wave 1: ${why}` });
    expect(o.csmChanges.filter((c) => c.code === null).every((c) => c.changePp === null && c.reason === `Not compared with Wave 1: ${why}`)).toBe(true);
    expect(tile(o.csm, "satisfaction").mean).toBeCloseTo(reference(files.w2, segAge).weighted.satisfaction.mean, 9);
    // An earlier wave in the trend (two waves back) is withheld the same way.
    const b = await project("Banking CSM withheld trend", [files.w1NoAge, files.w1, files.w2]);
    const o3 = await overview(b.run, b.docs[2], segAge);
    expect(o3.timeline.map((t) => t.status)).toEqual(["failed", "ok", "ok"]);
    expect(o3.timeline[0].error).toBe(`Not drawn for Wave 1: ${why}`);
    expect(o3.timeline[1].satisfaction?.mean).toBeCloseTo(reference(files.w1, segAge).weighted.satisfaction.mean, 9);
    // Without the segment the same waves compare.
    expect((await overview(a.run, a.docs[1], null)).previous.status).toBe("ok");
    // Opened on the wave that lacks it, the segment is refused with the reason.
    await expect(overview(a.run, a.docs[0], segAge)).rejects.toThrow("The segment cannot be applied to this file: The segment question age_band is not in this file. Change or clear the segment.");
  });

  it("weight rescaling: weights times 2.5 leave every segmented figure and the effective bases unchanged, and multiply the weighted totals", async () => {
    const a = await project("Banking CSM weights", [files.w1, files.w2]);
    const b = await project("Banking CSM weights x2.5", [files.w1x, files.w2x]);
    const [o, ox] = await Promise.all([overview(a.run, a.docs[1], SEG), overview(b.run, b.docs[1], SEG)]);
    let compared = 0;
    const same = (x: number | null | undefined, y: number | null | undefined) => {
      expect(typeof x).toBe("number");
      expect(Math.abs((x as number) - (y as number))).toBeLessThanOrEqual(1e-9);
      compared += 1;
    };
    for (const id of ["satisfaction", "stay", "switch"] as const) {
      const [t, tx] = [tile(o.csm, id), tile(ox.csm, id)];
      same(t.box, tx.box);
      if (id !== "switch") same(t.mean, tx.mean);
      for (const [s, sx] of (t.shares ?? []).map((s, i) => [s, tx.shares![i]] as const)) same(s.share, sx.share);
      expect(t.effectiveBase).toBe(tx.effectiveBase);
      expect(t.rawBase).toBe(tx.rawBase);
      // Each weighted total is reported to one decimal, so the rescaled one is within 0.05 + 2.5 x 0.05.
      expect(Math.abs((tx.weightedBase as number) - 2.5 * (t.weightedBase as number))).toBeLessThanOrEqual(0.176);
    }
    const [n, nx] = [tile(o.csm, "recommend"), tile(ox.csm, "recommend")];
    for (const k of ["nps", "promoters", "passives", "detractors"] as const) same(n[k], nx[k]);
    expect(nx.effectiveBase).toBe(n.effectiveBase);
    for (const [a1, a2] of o.attributes.map((x, i) => [x, ox.attributes[i]] as const)) same(a1.mean, a2.mean);
    const [d, dx] = [tile(o.csm, "drivers"), tile(ox.csm, "drivers")];
    same(d.rSquared, dx.rSquared);
    for (const r of d.rows) {
      const rx = dx.rows.find((x) => x.variable === r.variable)!;
      same(r.share, rx.share);
      same(r.coefficient, rx.coefficient);
    }
    same(o.timeline[0].satisfaction?.mean, ox.timeline[0].satisfaction?.mean);
    expect(Math.abs((o.segment?.effectiveBase ?? NaN) - (ox.segment?.effectiveBase ?? NaN))).toBeLessThanOrEqual(0.051);
    expect(Math.abs((ox.segment?.weighted ?? NaN) - 2.5 * (o.segment?.weighted ?? NaN))).toBeLessThanOrEqual(0.176);
    expect(compared).toBeGreaterThan(40);
  });

  it("the tools at their boundary: no segment leaves the result as before; a malformed segment or one naming a variable the file lacks is refused", async () => {
    const p = await project("Banking CSM tools", [files.w2]);
    const { runDistributionAction } = await import("../chartActions");
    const { runNpsAction } = await import("../npsActions");
    const plain = await runDistributionAction(p.run, p.docs[0], "company_csat5", "weight", null, "compute");
    const explicitNull = await runDistributionAction(p.run, p.docs[0], "company_csat5", "weight", null, "compute", null);
    expect(explicitNull).toEqual(plain);
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.result.filters).toBeUndefined();
    const seg = await runDistributionAction(p.run, p.docs[0], "company_csat5", "weight", null, "compute", SEG);
    if (!seg.ok) throw new Error(seg.error);
    expect(seg.result.filters).toEqual([
      { variable: "gender", text: "Gender is Woman" },
      { variable: "segment", text: "Synthetic demonstration segment is Segment 1 or Segment 3" },
    ]);
    expect(seg.result.series[0].base?.n).toBe(reference(files.w2, SEG).weighted.satisfaction.raw);
    expect(await runNpsAction(p.run, p.docs[0], "recommend_0to10", "weight", null, undefined, "compute", { questions: [{ variable: "nope", codes: ["1"] }] })).toEqual({ ok: false, error: "The segment question nope is not in this file." });
    expect(await runNpsAction(p.run, p.docs[0], "recommend_0to10", "weight", null, undefined, "compute", { questions: "gender" })).toEqual({ ok: false, error: "The segment was not understood. Choose it again." });
    expect(await runDistributionAction(p.run, p.docs[0], "company_csat5", "weight", null, "compute", { questions: [{ variable: "gender", codes: [] }] })).toEqual({ ok: false, error: "The segment was not understood. Choose it again." });
  });
});
