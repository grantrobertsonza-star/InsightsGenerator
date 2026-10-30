// R5 segment against Codex's independent segment reference (30 October 2026): fixtures/tracker-packs/bmw_car/
// independent/codex-segment-reference-2026-10-30.json, a copy of Codex's bmw-segment-reference.json (sha256 680f3205...),
// computed by Codex's own script from the pack's SPSS files (the same files: wave 1 sha256 bc8009ce..., wave 2 e19978de...,
// both checked below), never from the app. Segment: gender 2 (Woman) AND age_band 2 or 3; 228 respondents in wave 1, 241
// in wave 2. Its methods are stated inside the file ("method"). Every figure the dashboard's loaders show for that segment
// is compared with it, in both waves, weighted (the default) and unweighted, through the actual loaders, the real
// disposable database and the actual engine (storage in memory, model stubbed):
//   segment base (raw n, weighted total, Kish effective base), page 01 funnel shares and bases by variable (awareness,
//   consideration, shortlist, first choice and the ownership question the dashboard reads as usage), every association
//   cell (each brand on its aware base in the segment) and each brand's aware base, every moment recall cell shown
//   (Codex's all-segment base), every media share, the decision style and acquisition channel shares with their bases,
//   the brand repertoire means (from Codex's distributions: sum of code x share / 100), and wave 2 against wave 1
//   changes in points. Codex's two-proportion z test is not compared: the dashboard computes no significance for the
//   change (contract D3: "in points, no significance claim").
// The file states no tolerances, so these are ours: shares, changes and means 1e-6 points; raw bases exact; weighted
// totals and effective bases 0.051 (the engine reports them to one decimal). Disagreements are collected and listed,
// never adjusted to match.
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
const REFERENCE_FILE = packPath(path.join("independent", "codex-segment-reference-2026-10-30.json"));
type Base = { raw_n: number; weighted_n: number; kish_effective_n: number };
type Prop = { base: Base; share_percent: number | null };
type Wave = {
  segment_base: Base;
  funnel_shares: (Prop & { variable: string })[];
  association_scores: (Prop & { variable: string })[];
  moment_by_brand_recall: { variable: string; all_segment_base: Prop }[];
  media_use_shares: (Prop & { variable: string })[];
  category_overview: Record<string, { valid_answer_base: Base; categories: (Prop & { code: number })[] }>;
};
type Codex = {
  sources: { path: string; sha256: string }[];
  waves: Record<"1" | "2", Record<"weighted" | "unweighted", Wave>>;
  wave_comparison_tests: { weighting: string; brand: string; stage: string; difference_percentage_points: number }[];
};
const CODEX: Codex = JSON.parse(readFileSync(REFERENCE_FILE, "utf8"));
const SEG = { questions: [{ variable: "gender", codes: ["2"] }, { variable: "age_band", codes: ["2", "3"] }] };
const SHARE_TOL = 1e-6;
const BASE_TOL = 0.051;

/** Collects every disagreement as "what: app X, Codex Y", so a failure lists them all. */
function comparer() {
  const out: string[] = [];
  let compared = 0;
  const num = (what: string, app: number | null | undefined, codex: number | null | undefined, tol: number) => {
    compared += 1;
    if (app === null || app === undefined || codex === null || codex === undefined) {
      if (!(app == null && codex == null)) out.push(`${what}: app ${app}, Codex ${codex}`);
      return;
    }
    if (Math.abs(app - codex) > tol) out.push(`${what}: app ${app}, Codex ${codex} (difference ${app - codex})`);
  };
  const share = (what: string, got: { share: number | null; base: number | null }, want: Prop | undefined) => {
    if (!want) return void out.push(`${what}: not in Codex's reference`);
    num(`${what} share`, got.share, want.share_percent, SHARE_TOL);
    num(`${what} base`, got.base, want.base.raw_n, 0);
  };
  return { out, num, share, count: () => compared };
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R5 segment against Codex's independent segment reference (real database, actual engine)", () => {
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
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id;
    for (const [w, date] of [[1, "2026-02"], [2, "2026-06"]] as const) {
      const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, readFileSync(packPath(`wave${w}_labels_only_compressed.sav`)));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `bmw_wave${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: date })],
      ))[0].id);
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("the reference was computed from the same files", async () => {
    const { createHash } = await import("node:crypto");
    for (const w of [1, 2]) {
      const sha = createHash("sha256").update(readFileSync(packPath(`wave${w}_labels_only_compressed.sav`))).digest("hex");
      expect(CODEX.sources.find((s) => s.path.endsWith(`wave${w}_labels_only_compressed.sav`))!.sha256).toBe(sha);
    }
    expect([CODEX.waves["1"].weighted.segment_base.raw_n, CODEX.waves["2"].weighted.segment_base.raw_n]).toEqual([228, 241]);
  });

  async function compareWave(w: 1 | 2, mode: "weighted" | "unweighted", c: ReturnType<typeof comparer>) {
    const ref = CODEX.waves[String(w) as "1" | "2"][mode];
    const doc = docs[w - 1];
    const tag = `wave ${w} ${mode}`;
    const [{ loadBrandOverview }, { loadBrandMoments }, { loadBrandAssociations }, { loadBrandAudience }, { loadCategoryOverview }] = await Promise.all([
      import("../trackerOverview"),
      import("../trackerMoments"),
      import("../trackerAssociations"),
      import("../trackerAudience"),
      import("../trackerCategory"),
    ]);
    const overview = await loadBrandOverview(tenant, run, doc, "brand", SEG);
    // Segment base.
    c.num(`${tag} segment n`, overview.segment!.n, ref.segment_base.raw_n, 0);
    if (mode === "weighted") {
      c.num(`${tag} segment weighted total`, overview.segment!.weighted, ref.segment_base.weighted_n, BASE_TOL);
      c.num(`${tag} segment effective base`, overview.segment!.effectiveBase, ref.segment_base.kish_effective_n, BASE_TOL);
    }
    // Page 01: every cell by variable.
    const funnel = new Map(ref.funnel_shares.map((f) => [f.variable, f]));
    for (const s of overview.figures.stages) for (const b of s.byBrand) c.share(`${tag} funnel ${s.stage} ${b.variable}`, b, funnel.get(b.variable));
    // Page 03: every cell, each brand's aware base.
    const assoc = await loadBrandAssociations(tenant, run, doc, SEG);
    if (assoc.profile.status !== "ok") throw new Error(assoc.profile.reason);
    const cells = new Map(ref.association_scores.map((a) => [a.variable, a]));
    for (const a of assoc.profile.attributes) for (const cell of a.cells) c.share(`${tag} association ${cell.variable}`, cell, cells.get(cell.variable));
    for (const base of assoc.profile.bases) {
      const any = ref.association_scores.find((a) => a.variable.endsWith(`_b${base.code.padStart(2, "0")}`));
      if (!any) continue;
      c.num(`${tag} aware base b${base.code}`, base.n, any.base.raw_n, 0);
      if (mode === "weighted") c.num(`${tag} aware effective base b${base.code}`, base.effectiveBase, any.base.kish_effective_n, BASE_TOL);
    }
    // Page 02: every recall cell shown, on the all-segment base.
    const moments = await loadBrandMoments(tenant, run, doc, SEG);
    if (moments.recall.status !== "ok") throw new Error(moments.recall.reason);
    const recall = new Map(ref.moment_by_brand_recall.map((m) => [m.variable, m.all_segment_base]));
    for (const row of moments.recall.rows) for (const cell of row.cells) if (cell.variable) c.share(`${tag} recall ${cell.variable}`, cell, recall.get(cell.variable));
    // Page 05: every media share among all eligible in the segment.
    const audience = await loadBrandAudience(tenant, run, doc, SEG);
    if (audience.media.status !== "ok") throw new Error(audience.media.reason);
    const media = new Map(ref.media_use_shares.map((m) => [m.variable, m]));
    for (const row of audience.media.rows) c.share(`${tag} media ${row.key}`, row.category, media.get(row.key));
    // Page 06: decision style, acquisition channel, repertoire means.
    const category = await loadCategoryOverview(tenant, run, doc, SEG);
    for (const [name, dist] of [["decision_style", category.decisionStyle], ["acquisition_channel", category.acquisitionChannel]] as const) {
      if (dist.status !== "ok") throw new Error(dist.reason);
      const r = ref.category_overview[name];
      c.num(`${tag} ${name} base`, dist.base, r.valid_answer_base.raw_n, 0);
      for (const a of dist.answers) c.num(`${tag} ${name} code ${a.code} share`, a.share, r.categories.find((x) => String(x.code) === a.code)?.share_percent, SHARE_TOL);
    }
    const repKey: Record<string, string> = { awareness: "aware_tracked_brand_repertoire", consideration: "consider_tracked_brand_repertoire", acquisition: "bought12_tracked_brand_repertoire" };
    for (const rep of category.repertoire) {
      if (rep.status !== "ok") throw new Error(`repertoire ${rep.stage}: ${"reason" in rep ? rep.reason : ""}`);
      const r = ref.category_overview[repKey[rep.stage]];
      const mean = r.categories.reduce((sum, x) => sum + x.code * (x.share_percent ?? 0), 0) / 100;
      c.num(`${tag} repertoire ${rep.stage} mean`, rep.mean, mean, SHARE_TOL);
      c.num(`${tag} repertoire ${rep.stage} base`, rep.base, r.valid_answer_base.raw_n, 0);
    }
    return overview;
  }

  it("weighted (the default), both waves, and wave 2 against wave 1: every figure and base equals Codex's reference", async () => {
    const c = comparer();
    await compareWave(1, "weighted", c);
    const o2 = await compareWave(2, "weighted", c);
    // The change in points (Codex's difference); Codex's z and p are not compared: the dashboard computes none.
    expect(o2.previous.status).toBe("ok");
    const stageOf: Record<string, string> = { aware: "awareness", consider: "consideration" };
    const brandCode = new Map(o2.view.dashboard.brands.map((b) => [b.label, b.code]));
    for (const t of CODEX.wave_comparison_tests.filter((x) => x.weighting === "weighted")) {
      const ch = o2.changes.find((x) => x.stage === stageOf[t.stage] && x.code === brandCode.get(t.brand));
      c.num(`change ${t.stage} ${t.brand}`, ch?.changePp, t.difference_percentage_points, SHARE_TOL);
    }
    console.info(`weighted: ${c.count()} figures compared, ${c.out.length} disagreements`);
    expect(c.out).toEqual([]);
    expect(c.count()).toBeGreaterThan(600);
  });

  it("unweighted (a researcher's choice), both waves, and the change: equal to Codex's unweighted reference", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, run, docs[0]);
    expect((await saveTrackerChoices(tenant, run, docs[0], { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const c = comparer();
      await compareWave(1, "unweighted", c);
      const o2 = await compareWave(2, "unweighted", c);
      const stageOf: Record<string, string> = { aware: "awareness", consider: "consideration" };
      const brandCode = new Map(o2.view.dashboard.brands.map((b) => [b.label, b.code]));
      for (const t of CODEX.wave_comparison_tests.filter((x) => x.weighting === "unweighted")) {
        const ch = o2.changes.find((x) => x.stage === stageOf[t.stage] && x.code === brandCode.get(t.brand));
        c.num(`unweighted change ${t.stage} ${t.brand}`, ch?.changePp, t.difference_percentage_points, SHARE_TOL);
      }
      console.info(`unweighted: ${c.count()} figures compared, ${c.out.length} disagreements`);
      expect(c.out).toEqual([]);
      expect(c.count()).toBeGreaterThan(600);
    } finally {
      const again = await loadTrackerDashboard(tenant, run, docs[0]);
      await saveTrackerChoices(tenant, run, docs[0], { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });
});
