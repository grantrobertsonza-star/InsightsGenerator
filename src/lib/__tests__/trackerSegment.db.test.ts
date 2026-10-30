// R5 segment (Grant, 30 October 2026: "filter on a segment (age, gender, etc.)") through the actual page loaders and
// the actual engine: every page of the brand dashboard computed on the respondents in a segment, by the one owner
// (trackerSegment.computeInSegment, the engine's raw-code filter). Real disposable PostgreSQL and the actual Python
// engine; storage is an in-memory stand-in and the model is stubbed (never called). Expected values come from
// src/lib/__tests__/helpers/segment_reference.py (pandas over the same file, written from the pack's specification
// and the segment contract), never from the app:
//   1. BMW wave 1, segment Woman (gender 2) AND 25-34 or 35-49 (age_band 2 or 3), 228 respondents: page 01 funnel
//      shares (every brand, four stages), the BMW association scores, every moment recall value shown, every media
//      share and every decision style share, with the segment's raw, weighted and effective bases, weighted (the
//      default) and unweighted; no table saved.
//   2. Across waves: wave 2 against wave 1, the segment applied in both: BMW's change equals the difference of the
//      two segmented references.
//   3. Missing answer: five respondents with no gender answer are outside a segment on gender (CSV with codebook).
//   4. Small and empty: a segment of 3 has every share suppressed for a small base (never 0); a segment nobody is in
//      is refused with the reason.
//   5. A segment code absent in the compared wave (wave 1's gender list without Woman): the change is withheld with
//      the reason, the wave draws no trend point, and this wave's figures are still shown; the segment opened on
//      that wave itself is refused with the reason.
//   6. Weight rescaling: every weight times 2.5 leaves every share and the effective bases unchanged.
//   7. The profile questions offered, and a segment on a question that is not one, refused.
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
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

vi.setConfig({ testTimeout: 600_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "segment_reference.py");

type Share = [number | null, number];
type Side = {
  base: { n: number; weighted: number; effective: number };
  funnel: Record<string, Record<string, Share>>;
  association: { aware_n: number; aware_eff: number } & Record<string, Share | number>;
  recall: Record<string, Share>;
  media: Record<string, Share>;
  category: Record<string, Share>;
};
type Ref = { n: number; weighted: Side; unweighted: Side };
type SegmentArg = { questions: { variable: string; codes: string[] }[] };
const asJson = (s: SegmentArg) => JSON.stringify(Object.fromEntries(s.questions.map((q) => [q.variable, q.codes])));
function reference(file: string, s: SegmentArg): Ref {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "figures", file, asJson(s)], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function variant(src: string, kind: string, dir: string, ext: string): string {
  const out = path.join(dir, `${kind}.${ext}`);
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "variant", src, out, kind], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}

const SEG: SegmentArg = { questions: [{ variable: "gender", codes: ["2"] }, { variable: "age_band", codes: ["2", "3"] }] };
const STAGE_PREFIX: Record<string, string> = { awareness: "aware", consideration: "consider", shortlist: "shortlist", first_choice: "firstchoice" };
const brandVar = (variable: string) => variable.slice(variable.lastIndexOf("_") + 1);

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R5 segment: every dashboard page on the segment, against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "segment-"));
  let run = "";
  const docs: string[] = [];

  const newRun = async (name = "BMW car tracker") => (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
  async function stored(r: string, kind: "instrument" | "table", name: string, bytes: Buffer, extra: Record<string, unknown> = {}, type: string | null = null) {
    const key = `${tenant}/${r}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, r, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, ...extra }) : null],
    ))[0].id as string;
  }
  /** Two wave files in one project, wave 1 first. */
  async function twoWaves(w1: Buffer, w2: Buffer) {
    const r = await newRun();
    const a = await stored(r, "table", "bmw_wave1.sav", w1, { wave: "Wave 1", waveDate: "2026-02" });
    const b = await stored(r, "table", "bmw_wave2.sav", w2, { wave: "Wave 2", waveDate: "2026-06" });
    return { run: r, w1: a, w2: b };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    const p = await twoWaves(readFileSync(packPath("wave1_labels_only_compressed.sav")), readFileSync(packPath("wave2_labels_only_compressed.sav")));
    run = p.run;
    docs.push(p.w1, p.w2);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Every page of one file under the segment. */
  async function pages(r: string, doc: string, segment: SegmentArg | null) {
    const [{ loadBrandOverview }, { loadBrandMoments }, { loadBrandAssociations }, { loadBrandAudience }, { loadCategoryOverview }, { loadBrandAdvertising }] = await Promise.all([
      import("../trackerOverview"),
      import("../trackerMoments"),
      import("../trackerAssociations"),
      import("../trackerAudience"),
      import("../trackerCategory"),
      import("../trackerAdvertising"),
    ]);
    const overview = await loadBrandOverview(tenant, r, doc, "brand", segment);
    const moments = await loadBrandMoments(tenant, r, doc, segment);
    const associations = await loadBrandAssociations(tenant, r, doc, segment);
    const audience = await loadBrandAudience(tenant, r, doc, segment);
    const category = await loadCategoryOverview(tenant, r, doc, segment);
    const advertising = await loadBrandAdvertising(tenant, r, doc, segment);
    return { overview, moments, associations, audience, category, advertising };
  }
  type Pages = Awaited<ReturnType<typeof pages>>;

  /** Every compared figure equal to the reference; returns how many figures were compared. */
  function expectReference(p: Pages, ref: Side, weighted: boolean) {
    let compared = 0;
    const same = (got: { share: number | null; base: number | null }, want: Share, what: string) => {
      expect(got.share, what).toBeCloseTo(want[0]!, 6);
      expect(got.base, what).toBe(want[1]);
      compared += 1;
    };
    // The segment's own base on every page: raw n, weighted total and Kish effective base (engine: one decimal).
    for (const [name, seg] of [["overview", p.overview.segment], ["moments", p.moments.segment], ["associations", p.associations.segment], ["audience", p.audience.segment], ["category", p.category.segment], ["advertising", p.advertising.segment]] as const) {
      expect(seg, name).not.toBeNull();
      expect(seg!.n, name).toBe(ref.base.n);
      expect(seg!.text, name).toBe("Woman; 25–34 or 35–49");
      expect(seg!.filters, name).toEqual([{ variable: "gender", op: "codes", codes: ["2"] }, { variable: "age_band", op: "codes", codes: ["2", "3"] }]);
      if (weighted) {
        expect(Math.abs(seg!.weighted! - ref.base.weighted), name).toBeLessThan(0.051);
        expect(Math.abs(seg!.effectiveBase! - ref.base.effective), name).toBeLessThan(0.051);
      } else expect([seg!.weighted, seg!.effectiveBase], name).toEqual([null, null]);
    }
    // Page 01: every brand at the four funnel stages.
    for (const s of p.overview.figures.stages.filter((x) => STAGE_PREFIX[x.stage])) for (const b of s.byBrand) same(b, ref.funnel[STAGE_PREFIX[s.stage]][brandVar(b.variable)], `${s.stage} ${b.variable}`);
    // Page 03: BMW's aware base in the segment and two of its association scores.
    if (p.associations.profile.status !== "ok") throw new Error(p.associations.profile.reason);
    const bmw = p.associations.profile.bases.find((b) => b.variable === "aware_b08")!;
    expect(bmw.n).toBe(ref.association.aware_n);
    if (weighted) expect(Math.abs(bmw.effectiveBase! - ref.association.aware_eff)).toBeLessThan(0.051);
    for (const v of ["attr_a01_b08", "attr_a05_b08"]) {
      const cell = p.associations.profile.attributes.flatMap((a) => a.cells).find((c) => c.variable === v)!;
      same(cell, ref.association[v] as Share, v);
    }
    // Page 02: every moment recall value shown.
    if (p.moments.recall.status !== "ok") throw new Error(p.moments.recall.reason);
    for (const row of p.moments.recall.rows) for (const c of row.cells) if (c.variable) same(c, ref.recall[c.variable], c.variable);
    // Page 05: every media share among all eligible respondents in the segment.
    if (p.audience.media.status !== "ok") throw new Error(p.audience.media.reason);
    for (const row of p.audience.media.rows) same(row.category, ref.media[row.key], row.key);
    expect(p.audience.categoryN).toBe(ref.base.n);
    // Page 06: every decision style share.
    if (p.category.decisionStyle.status !== "ok") throw new Error(p.category.decisionStyle.reason);
    for (const a of p.category.decisionStyle.answers) {
      expect(a.share, `decision ${a.code}`).toBeCloseTo(ref.category[a.code][0]!, 6);
      compared += 1;
    }
    expect(p.category.decisionStyle.base).toBe(ref.category["1"][1]);
    return compared;
  }

  it("BMW wave 1, Woman and 25-34 or 35-49, weighted by default: every page's figures and the segment's raw, weighted and effective bases equal the reference; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"), SEG);
    expect(ref.n).toBe(228);
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n);
    const p = await pages(run, docs[0], SEG);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n)).toBe(before);
    const compared = expectReference(p, ref.weighted, true);
    // 40 funnel shares, 2 associations, the recall cells shown, 12 media and 3 decision style shares.
    expect(compared).toBeGreaterThanOrEqual(40 + 2 + 12 + 3 + 6);
    // The unsegmented page differs (the segment really restricts the figures).
    const all = await (await import("../trackerOverview")).loadBrandOverview(tenant, run, docs[0], "brand", null);
    expect(all.segment).toBeNull();
    const aw = (o: typeof all) => o.figures.stages.find((s) => s.stage === "awareness")!.byBrand.find((b) => b.variable === "aware_b08")!;
    expect(aw(all).base).toBe(1000);
    expect(aw(p.overview).share).not.toBeCloseTo(aw(all).share!, 3);
  });

  it("unweighted when the researcher chose so: equal to the unweighted segmented reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"), SEG);
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, run, docs[0]);
    expect((await saveTrackerChoices(tenant, run, docs[0], { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      expect(expectReference(await pages(run, docs[0], SEG), ref.unweighted, false)).toBeGreaterThanOrEqual(63);
    } finally {
      const again = await loadTrackerDashboard(tenant, run, docs[0]);
      await saveTrackerChoices(tenant, run, docs[0], { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("across waves: the segment is applied in both waves, and BMW's change equals the difference of the segmented references", async () => {
    const r1 = reference(packPath("wave1_labels_only_compressed.sav"), SEG).weighted;
    const r2 = reference(packPath("wave2_labels_only_compressed.sav"), SEG).weighted;
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[1], "brand", SEG);
    expect(o.previous).toMatchObject({ status: "ok", documentId: docs[0] });
    expect(o.segment!.n).toBe(r2.base.n);
    for (const stage of ["awareness", "consideration", "shortlist", "first_choice"]) {
      const code = o.figures.stages.find((s) => s.stage === stage)!.byBrand.find((b) => b.variable.endsWith("_b08"))!.code;
      const c = o.changes.find((x) => x.stage === stage && x.code === code)!;
      const v = `${STAGE_PREFIX[stage]}`;
      expect(c.changePp, stage).toBeCloseTo(r2.funnel[v].b08[0]! - r1.funnel[v].b08[0]!, 6);
    }
    // The trend's earlier point is the segmented wave 1 too.
    const t1 = o.timeline.find((t) => t.documentId === docs[0])!;
    expect(t1.status).toBe("ok");
    expect(t1.stages!.find((s) => s.stage === "awareness")!.byBrand.find((b) => b.variable === "aware_b08")!.share).toBeCloseTo(r1.funnel.aware.b08[0]!, 6);
  });

  it("missing answer: respondents with no gender answer are outside a segment on gender", async () => {
    const file = variant(packPath("wave1_first60.csv"), "blank_gender", dir, "csv");
    const seg = { questions: [{ variable: "gender", codes: ["1", "2"] }] };
    const ref = reference(file, seg);
    // 59 of the 60 answered Man or Woman; five of them now have no answer.
    expect(ref.n).toBe(54);
    const r = await newRun();
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored(r, "instrument", "metadata.json", readFileSync(packPath("metadata.json")), {}, "codebook");
    const data = await stored(r, "table", "Car_Brand_Tracker_Wave_1.csv", readFileSync(file));
    await readInstrumentItems(tenant, r, codebook);
    await suggestInstrumentLinks(tenant, r, codebook, data);
    await confirmInstrumentLinks(tenant, r, codebook, 0.9);
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, r, data, "brand", seg);
    expect(o.segment).toMatchObject({ n: 54, text: "Man or Woman" });
    expect(Math.abs(o.segment!.effectiveBase! - ref.weighted.base.effective)).toBeLessThan(0.051);
    const aw = o.figures.stages.find((s) => s.stage === "awareness")!.byBrand.find((b) => b.variable === "aware_b08")!;
    expect(aw.share).toBeCloseTo(ref.weighted.funnel.aware.b08[0]!, 6);
    expect(aw.base).toBe(54);
  });

  it("small and empty: a segment of 3 is suppressed for a small base on every share (never 0); a segment nobody is in is refused with the reason", async () => {
    const tiny = { questions: [{ variable: "gender", codes: ["3"] }, { variable: "age_band", codes: ["1"] }] };
    expect(reference(packPath("wave1_labels_only_compressed.sav"), tiny).n).toBe(3);
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[0], "brand", tiny);
    expect(o.segment).toMatchObject({ n: 3, text: "Another identity; 18–24" });
    const shares = o.figures.stages.flatMap((s) => s.byBrand);
    expect(shares.length).toBeGreaterThan(0);
    expect(shares.every((b) => b.share === null && b.reason === "Suppressed for a small base." && b.base === 3)).toBe(true);
    const { loadBrandAudience } = await import("../trackerAudience");
    const a = await loadBrandAudience(tenant, run, docs[0], tiny);
    if (a.media.status !== "ok") throw new Error(a.media.reason);
    expect(a.media.rows.every((r) => r.category.share === null)).toBe(true);

    const none = { questions: [...tiny.questions, { variable: "settlement", codes: ["3"] }] };
    expect(reference(packPath("wave1_labels_only_compressed.sav"), none).n).toBe(0);
    await expect(loadBrandOverview(tenant, run, docs[0], "brand", none)).rejects.toThrow(/No respondent in this file is in the segment Another identity; 18–24; Rural area \(n=0\)/);
    const { loadBrandMomentsAction } = await import("../trackerDashboardActions");
    expect(await loadBrandMomentsAction(run, docs[0], none)).toEqual({ ok: false, error: expect.stringMatching(/No respondent in this file is in the segment/) });
  });

  it("a segment code absent in the compared wave: the change is withheld with the reason and the wave draws no trend point; this wave's figures are still shown", async () => {
    const w1 = variant(packPath("wave1_labels_only_compressed.sav"), "no_woman_label", dir, "sav");
    const p = await twoWaves(readFileSync(w1), readFileSync(packPath("wave2_labels_only_compressed.sav")));
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, p.run, p.w2, "brand", SEG);
    expect(o.previous).toMatchObject({ status: "withheld", documentId: p.w1, reason: expect.stringMatching(/Not compared with Wave 1: Gender answer code 2 is not in the previous wave's answer list of Gender\. The segment cannot be applied to that wave\./) });
    expect(o.changes.length).toBeGreaterThan(0);
    expect(o.changes.every((c) => c.changePp === null && /Gender answer code 2/.test(c.reason ?? ""))).toBe(true);
    expect(o.timeline.find((t) => t.documentId === p.w1)).toMatchObject({ status: "failed", error: expect.stringMatching(/Gender answer code 2/) });
    const r2 = reference(packPath("wave2_labels_only_compressed.sav"), SEG).weighted;
    expect(o.figures.stages.find((s) => s.stage === "awareness")!.byBrand.find((b) => b.variable === "aware_b08")!.share).toBeCloseTo(r2.funnel.aware.b08[0]!, 6);
    // Without a segment the same two waves are compared as before.
    expect((await loadBrandOverview(tenant, p.run, p.w2, "brand", null)).previous.status).toBe("ok");
    // The segment opened on the wave that lacks the code is refused with the reason, never shown unsegmented.
    await expect(loadBrandOverview(tenant, p.run, p.w1, "brand", SEG)).rejects.toThrow(/The segment cannot be applied to this file: Answer code 2 is not in the answer list of Gender \(gender\)/);
  });

  it("weight rescaling: every weight times 2.5 leaves every segmented share and effective base unchanged, the weighted total times 2.5", async () => {
    const scaled = variant(packPath("wave1_labels_only_compressed.sav"), "weight_x25", dir, "sav");
    const r = await newRun();
    const doc = await stored(r, "table", "bmw_wave1.sav", readFileSync(scaled));
    const a = await pages(run, docs[0], SEG);
    const b = await pages(r, doc, SEG);
    const flat = (p: Pages) => [
      ...p.overview.figures.stages.flatMap((s) => s.byBrand.map((x) => x.share)),
      ...(p.associations.profile.status === "ok" ? p.associations.profile.attributes.flatMap((x) => x.cells.map((c) => c.share)) : []),
      ...(p.moments.recall.status === "ok" ? p.moments.recall.rows.flatMap((x) => x.cells.map((c) => c.share)) : []),
      ...(p.audience.media.status === "ok" ? p.audience.media.rows.map((x) => x.category.share) : []),
      ...(p.category.decisionStyle.status === "ok" ? p.category.decisionStyle.answers.map((x) => x.share) : []),
    ];
    const fa = flat(a);
    const fb = flat(b);
    expect(fb.length).toBe(fa.length);
    expect(fa.length).toBeGreaterThan(100);
    fa.forEach((v, i) => expect(fb[i], `figure ${i}`).toBeCloseTo(v!, 9));
    expect(b.overview.segment!.effectiveBase).toBeCloseTo(a.overview.segment!.effectiveBase!, 1);
    expect(b.overview.segment!.n).toBe(a.overview.segment!.n);
    expect(Math.abs(b.overview.segment!.weighted! - 2.5 * a.overview.segment!.weighted!)).toBeLessThan(0.2);
  });

  it("the profile questions offered, and a segment on a question that is not one refused with the reason", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[0], "brand", null);
    expect(o.segmentQuestions.map((x) => x.variable)).toEqual(["gender", "age_band", "province", "settlement", "income", "life_stage"]);
    expect(o.segmentQuestions.find((x) => x.variable === "income")!.answers.map((x) => x.code)).toEqual(["1", "2", "3", "4", "5", "99"]);
    await expect(loadBrandOverview(tenant, run, docs[0], "brand", { questions: [{ variable: "decision_style", codes: ["1"] }] })).rejects.toThrow(/Typical vehicle decision style \(decision_style\) is not a profile question with an answer list in this file/);
    // R5 CSM segment: the CSM dashboard now takes the segment too (it was refused here before); this brand file has no
    // CSM questions, so its tiles are blank, and the page still names the segment with its base.
    expect((await loadBrandOverview(tenant, run, docs[0], "csm", SEG)).segment?.n).toBe(228);
    const { loadBrandOverviewAction } = await import("../trackerDashboardActions");
    expect(await loadBrandOverviewAction(run, docs[0], "brand", { questions: [{ variable: "gender", codes: [2] }] })).toEqual({ ok: false, error: "The segment was not understood. Choose it again." });
  });
});
