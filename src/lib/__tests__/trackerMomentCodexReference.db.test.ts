// Page 02's Moment profile and Moment reach against a second, separately produced reference: Codex's independent
// calculation from the raw BMW wave CSVs (read-only task of 30 October 2026, bmw-independent-reference.json; the
// moment measures are extracted unchanged into fixtures/tracker-packs/bmw_car/codex_moment_reference_w1_w2.json with
// the source hashes and method text). This complements trackerMomentProfile.db.test.ts (our own pandas reference):
// Codex did not read the app's code, the pack's validate script or our reference script.
// Through the actual loaders (loadMomentProfile, loadMomentReach), real disposable PostgreSQL and the actual engine,
// on the labelled SPSS files of waves 1 and 2, weighted (the default) and unweighted. Storage is an in-memory stand-in
// and the model is stubbed (never called).
// Stated tolerances: percentages and moments per person or per linker to 1e-6 (absolute); bases and linker counts
// exact; Kish effective bases to 0.05, because the engine reports an effective base rounded to one decimal place
// (api/parse-stats-file.py, every "nEff": round(n_eff, 1)), so half that unit is the closest a correct value can be.
// A disagreement is a failure to investigate, never a value to copy.
// Skipped, with the reason, without a test database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

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

vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);

type Base = { raw_n: number; sum_weights: number; sum_squared_weights: number; kish_effective_n: number };
type Strength = {
  brand_code: number;
  eligible_base: Base;
  linker_base: Base;
  moments_per_eligible: number | null;
  at_least_one_moment_percent: number | null;
  moments_per_linker: number | null;
  share_all_moment_links_percent: number | null;
};
type Recall = Base & { brand_code: number; moment_code: number; percent: number | null };
type Kind = "weighted" | "unweighted";
type Codex = { waves: Record<"1" | "2", { rows: number } & Record<Kind, { moment_strength: Strength[]; aware_base_moment_recall: Recall[] }>> };
const CODEX: Codex = JSON.parse(readFileSync(packPath("codex_moment_reference_w1_w2.json"), "utf8"));

const PCT_TOL = 1e-6;
/** Half the engine's reporting unit for an effective base (one decimal place). */
const NEFF_TOL = 0.05 + 1e-9;
const variableOf = (moment: number, brand: number) => `cep_c${String(moment).padStart(2, "0")}_b${String(brand).padStart(2, "0")}`;
function closeAbs(actual: number | null, expected: number | null, label: string) {
  if (expected === null) return expect(actual, label).toBeNull();
  expect(actual, label).not.toBeNull();
  expect(Math.abs((actual as number) - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(PCT_TOL);
}
function closeEffectiveBase(actual: number | null, expected: number, label: string) {
  expect(actual, label).not.toBeNull();
  expect(Math.abs((actual as number) - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(NEFF_TOL);
}

describe.skipIf(!TEST_DATABASE_URL)("Moment profile and Moment reach against Codex's independent BMW reference (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const files: Record<"1" | "2", { run: string; doc: string }> = { "1": { run: "", doc: "" }, "2": { run: "", doc: "" } };

  async function storedSav(name: string, bytes: Buffer) {
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, "BMW car tracker"]))[0].id as string;
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    return { run, doc };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    files["1"] = await storedSav("bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    files["2"] = await storedSav("bmw_wave2.sav", readFileSync(packPath("wave2_labels_only_compressed.sav")));
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  /** Compares one wave and one weighting; returns the number of values compared. */
  async function compare(wave: "1" | "2", kind: Kind) {
    const ref = CODEX.waves[wave][kind];
    const { run, doc } = files[wave];
    const { loadMomentProfile } = await import("../trackerMomentProfile");
    const { loadMomentReach } = await import("../trackerMomentReach");
    const m = await loadMomentProfile(tenant, run, doc);
    const r = await loadMomentReach(tenant, run, doc);
    expect([m.weighted, r.weighted]).toEqual([kind === "weighted", kind === "weighted"]);
    if (m.profile.status !== "ok") throw new Error(m.profile.reason);
    if (r.reach.status !== "ok") throw new Error(r.reach.reason);
    let compared = 0;

    // Moment profile: every brand x moment share on the brand's aware base, and the base.
    const cells = new Map(m.profile.moments.flatMap((mo) => mo.cells.map((c) => [c.variable, c] as const)));
    expect(ref.aware_base_moment_recall).toHaveLength(120);
    for (const x of ref.aware_base_moment_recall) {
      const v = variableOf(x.moment_code, x.brand_code);
      const c = cells.get(v);
      expect(c, v).toBeDefined();
      expect(c!.code, v).toBe(String(x.brand_code));
      expect(c!.base, `${v} base`).toBe(x.raw_n);
      closeAbs(c!.share, x.percent, `${v} share`);
      compared += 2;
    }
    // Aware bases: count and, weighted, the Kish effective base (the same for every moment of a brand in the reference).
    for (const b of m.profile.bases) {
      const x = ref.aware_base_moment_recall.find((y) => String(y.brand_code) === b.code)!;
      expect(b.n, `aware ${b.code}`).toBe(x.raw_n);
      if (kind === "weighted") closeEffectiveBase(b.effectiveBase, x.kish_effective_n, `aware ${b.code} effective base`);
      else expect(b.effectiveBase).toBeNull();
      compared += 2;
    }

    // Moment reach: the four measures, the eligible base, linkers and the eligible effective base.
    expect(ref.moment_strength).toHaveLength(10);
    expect(r.reach.brands).toHaveLength(10);
    for (const x of ref.moment_strength) {
      const b = r.reach.brands.find((y) => y.code === String(x.brand_code))!;
      const label = `reach ${x.brand_code}`;
      expect(b, label).toBeDefined();
      expect(b.base, `${label} base`).toBe(x.eligible_base.raw_n);
      expect(b.linkers, `${label} linkers`).toBe(x.linker_base.raw_n);
      closeAbs(b.perPerson, x.moments_per_eligible, `${label} moments per person`);
      closeAbs(b.penetration, x.at_least_one_moment_percent, `${label} penetration`);
      closeAbs(b.perLinker, x.moments_per_linker, `${label} moments per linker`);
      closeAbs(b.shareOfLinks, x.share_all_moment_links_percent, `${label} share of links`);
      if (kind === "weighted") closeEffectiveBase(b.effectiveBase, x.eligible_base.kish_effective_n, `${label} effective base`);
      compared += 7;
    }
    return compared;
  }

  async function withUnweighted(wave: "1" | "2", fn: () => Promise<void>) {
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const { run, doc } = files[wave];
    const v = await loadTrackerDashboard(tenant, run, doc);
    expect((await saveTrackerChoices(tenant, run, doc, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      await fn();
    } finally {
      const again = await loadTrackerDashboard(tenant, run, doc);
      await saveTrackerChoices(tenant, run, doc, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  }

  // 120 cells x 2 + 10 bases x 2 + 10 brands x 7 = 330 values per wave and weighting.
  it("wave 1, weighted: every profile value, aware base and reach measure equal to Codex's reference", async () => {
    expect(await compare("1", "weighted")).toBe(330);
  });
  it("wave 1, unweighted: equal to Codex's unweighted reference", async () => {
    await withUnweighted("1", async () => void expect(await compare("1", "unweighted")).toBe(330));
  });
  it("wave 2, weighted: equal to Codex's reference", async () => {
    expect(await compare("2", "weighted")).toBe(330);
  });
  it("wave 2, unweighted: equal to Codex's unweighted reference", async () => {
    await withUnweighted("2", async () => void expect(await compare("2", "unweighted")).toBe(330));
  });
});
