// Page 02 "Moments & needs": the Moment profile view and the Moment reach card (Grant, 30 October 2026), through the
// actual loaders, loadMomentProfile and loadMomentReach: recognition from what was imported, figures from the Cross
// tab engine computed without saving a table, with the dashboard's weight. Real disposable PostgreSQL and the actual
// engine; storage is an in-memory stand-in and the model is stubbed (never called).
// Expected values are computed independently by src/lib/__tests__/helpers/moment_profile_reference.py (pandas over
// the same file, written from the pack's specification and the D3c contracts), never taken from the app:
//   1. BMW wave 1 as SPSS with labels only (1,000 respondents), weighted (the default) and unweighted: every profile
//      value (10 brands x 12 moments) with its base, every brand's aware base, and every brand's moments per person,
//      penetration, moments per linker, share of moment links and base, to 1e-6; opening the page saves no table;
//      a profile value differs from the same link among all respondents (unaware respondents' links never count).
//   2. Boundary, the pack's first 60 respondents as CSV with metadata.json as the codebook: Haval aware for 8 only
//      (suppressed, its base shown); a BMW moment with blanks (those leave that cell's base only); a respondent with
//      every BMW link blank (outside BMW's reach base, counted); a brand nobody links (0, known; per linker n/a).
//   3. Weight rescaling: the same CSV with the weight x 3.7 gives the same weighted figures.
//   4. Unknown and recovery: awareness unmapped is "Mapping needed" for the profile (never all respondents), the reach
//      card is unaffected (it needs no awareness); once awareness is mapped again the profile is the reference.
//   5. Failure: a file that cannot be read rejects with the reason, never an empty profile; readable again, it returns.
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

vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "moment_profile_reference.py");
type ReachRef = { per_person: number; penetration: number; per_linker: number | null; links: number; base: number; none_valid: number; partly: number; share: number | null };
type Ref = {
  profile: Record<"weighted" | "unweighted", Record<string, [number | null, number]>> & { aware_n: Record<string, number> };
  reach: Record<"weighted" | "unweighted", Record<string, ReachRef>>;
};
function reference(file: string): Ref {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "values", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function variant(kind: string, dir: string): string {
  const out = path.join(dir, `${kind}.csv`);
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "variant", packPath("wave1_first60.csv"), out, kind], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}
const brandKey = (code: string) => `b${String(Number(code)).padStart(2, "0")}`;
/** The engine's small-base rule, stated independently: an unweighted base under 10 is not shown. */
const SUPPRESS_BELOW = 10;

type Profile = Awaited<ReturnType<typeof import("../trackerMomentProfile").loadMomentProfile>>;
type Reach = Awaited<ReturnType<typeof import("../trackerMomentReach").loadMomentReach>>;

/** Every profile value and aware base equal to the reference; a value on a base under 10 suppressed with its base. */
function expectProfile(m: Profile, ref: Record<string, [number | null, number]>, awareN: Record<string, number>) {
  if (m.profile.status !== "ok") throw new Error(m.profile.reason);
  expect(m.profile.bases.map((b) => b.code)).toEqual(m.dashboard.brands.map((b) => b.code));
  for (const b of m.profile.bases) {
    expect(b.reason, b.code).toBeUndefined();
    expect(b.n, b.code).toBe(awareN[brandKey(b.code)]);
  }
  let cells = 0;
  for (const mo of m.profile.moments) {
    expect(mo.cells.map((c) => c.code)).toEqual(m.dashboard.brands.map((b) => b.code));
    for (const c of mo.cells) {
      expect(c.variable).toBe(`cep_${mo.group.slice(-3)}_${brandKey(c.code)}`);
      const [share, base] = ref[c.variable];
      expect(c.base, c.variable).toBe(base);
      if (base < SUPPRESS_BELOW) {
        expect(c.share, c.variable).toBeNull();
        expect(c.reason, c.variable).toMatch(/small base/);
      } else expect(c.share, c.variable).toBeCloseTo(share as number, 6);
      cells += 1;
    }
  }
  return cells;
}
/** Every brand's four reach measures, base and left-out counts equal to the reference. */
function expectReach(r: Reach, ref: Record<string, ReachRef>) {
  if (r.reach.status !== "ok") throw new Error(r.reach.reason);
  expect(r.reach.brands.map((b) => b.code)).toEqual(r.dashboard.brands.map((b) => b.code));
  for (const b of r.reach.brands) {
    const x = ref[brandKey(b.code)];
    expect(b.base, b.code).toBe(x.base);
    expect([b.noneValid, b.partlyValid], b.code).toEqual([x.none_valid, x.partly]);
    expect(b.perPerson!, b.code).toBeCloseTo(x.per_person, 6);
    expect(b.penetration!, b.code).toBeCloseTo(x.penetration, 6);
    if (x.per_linker === null) expect(b.perLinker, b.code).toBeNull();
    else expect(b.perLinker!, b.code).toBeCloseTo(x.per_linker, 6);
    if (x.share === null) expect(b.shareOfLinks, b.code).toBeNull();
    else expect(b.shareOfLinks!, b.code).toBeCloseTo(x.share, 6);
    // (1) = (2) x (3) on the same base, where (3) is known.
    if (b.perLinker !== null) expect(b.perPerson!).toBeCloseTo((b.penetration! / 100) * b.perLinker, 9);
  }
  return r.reach.brands.length;
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Moment profile and Moment reach against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "moment-profile-"));
  let savRun = "";
  let sav = "";

  async function stored(run: string, kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  const newRun = async (name: string) => (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
  /** A CSV of the pack with metadata.json linked as its codebook, in a project of its own. */
  async function csvWithCodebook(file: string) {
    const run = await newRun("BMW car tracker");
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored(run, "instrument", "metadata.json", readFileSync(packPath("metadata.json")), "codebook");
    const data = await stored(run, "table", "Car_Brand_Tracker_Wave_1.csv", readFileSync(file));
    await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    return { run, data };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    savRun = await newRun("BMW car tracker");
    sav = await stored(savRun, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("BMW wave 1, weighted by default: all 120 profile values, every aware base and every brand's reach equal to the reference to 1e-6; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { loadMomentProfile } = await import("../trackerMomentProfile");
    const { loadMomentReach } = await import("../trackerMomentReach");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadMomentProfile(tenant, savRun, sav);
    const r = await loadMomentReach(tenant, savRun, sav);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar, r.weighted]).toEqual([true, "weight", true]);
    expect(expectProfile(m, ref.profile.weighted, ref.profile.aware_n)).toBe(120);
    if (m.profile.status !== "ok") throw new Error(m.profile.reason);
    expect(m.profile.moments).toHaveLength(12);
    const bmw = m.profile.bases.find((b) => b.code === "8")!;
    expect(bmw.n).toBe(831);
    expect(bmw.effectiveBase).toBeGreaterThan(700);
    // Among the aware, not all respondents: BMW's link to the first moment differs from the all-respondents reading.
    const { loadBrandMoments } = await import("../trackerMoments");
    const all = await loadBrandMoments(tenant, savRun, sav);
    if (all.recall.status !== "ok") throw new Error("recall");
    const row = all.recall.rows[0];
    const allShare = row.cells.find((c) => c.code === "8")!.share!;
    const awareShare = m.profile.moments.find((x) => x.group === row.gridGroup)!.cells.find((c) => c.code === "8")!.share!;
    expect(Math.abs(awareShare - allShare)).toBeGreaterThan(0.5);
    expect(expectReach(r, ref.reach.weighted)).toBe(10);
    if (r.reach.status !== "ok") throw new Error(r.reach.reason);
    expect(r.reach.shareWithheld).toBeNull();
    expect(r.reach.brands.reduce((t, b) => t + b.shareOfLinks!, 0)).toBeCloseTo(100, 9);
    expect(r.reach.brands.find((b) => b.code === "8")!.effectiveBase).toBeGreaterThan(900);
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadMomentProfile } = await import("../trackerMomentProfile");
      const { loadMomentReach } = await import("../trackerMomentReach");
      const m = await loadMomentProfile(tenant, savRun, sav);
      expect(m.weighted).toBe(false);
      expect(expectProfile(m, ref.profile.unweighted, ref.profile.aware_n)).toBe(120);
      if (m.profile.status !== "ok") throw new Error(m.profile.reason);
      expect(m.profile.bases.every((b) => b.effectiveBase === null)).toBe(true);
      const r = await loadMomentReach(tenant, savRun, sav);
      expect(r.weighted).toBe(false);
      expect(expectReach(r, ref.reach.unweighted)).toBe(10);
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: a small aware base suppressed with its base shown, a moment with blanks, a respondent with every link blank, a brand nobody links", async () => {
    const file = variant("boundary", dir);
    const ref = reference(file);
    // The reference's own reading of the variant.
    expect(ref.profile.aware_n.b10).toBe(8);
    expect(ref.profile.unweighted.cep_c01_b10[1]).toBe(8);
    expect(ref.profile.unweighted.cep_c02_b08[1]).toBe(ref.profile.aware_n.b08 - 3);
    expect(ref.profile.unweighted.cep_c01_b08[1]).toBe(ref.profile.aware_n.b08 - 1);
    expect([ref.reach.weighted.b08.base, ref.reach.weighted.b08.none_valid, ref.reach.weighted.b08.partly]).toEqual([57, 1, 2]);
    expect(ref.reach.weighted.b07.per_person).toBe(0);
    const { run, data } = await csvWithCodebook(file);
    const { loadMomentProfile } = await import("../trackerMomentProfile");
    const { loadMomentReach } = await import("../trackerMomentReach");
    const m = await loadMomentProfile(tenant, run, data);
    expect(m.weighted).toBe(true);
    expect(expectProfile(m, ref.profile.weighted, ref.profile.aware_n)).toBe(120);
    if (m.profile.status !== "ok") throw new Error(m.profile.reason);
    expect(m.profile.bases.find((b) => b.code === "10")!.n).toBe(8);
    expect(m.profile.moments.every((x) => x.cells.find((c) => c.code === "10")!.share === null)).toBe(true);
    const r = await loadMomentReach(tenant, run, data);
    expect(expectReach(r, ref.reach.weighted)).toBe(10);
    if (r.reach.status !== "ok") throw new Error(r.reach.reason);
    const suzuki = r.reach.brands.find((b) => b.code === "7")!;
    expect([suzuki.perPerson, suzuki.penetration, suzuki.perLinker, suzuki.linkers]).toEqual([0, 0, null, 0]);
    expect(suzuki.perLinkerReason).toMatch(/Nobody links/);
    // BMW's base is no longer every eligible respondent, so the share of links is withheld for every brand.
    expect(r.reach.shareWithheld).toMatch(/did not answer every moment/);
    expect(r.reach.brands.every((b) => b.shareOfLinks === null)).toBe(true);
  });

  it("weight rescaling: the weight x 3.7 gives the same weighted figures", async () => {
    const plain = await csvWithCodebook(packPath("wave1_first60.csv"));
    const scaled = await csvWithCodebook(variant("rescaled", dir));
    const ref = reference(packPath("wave1_first60.csv"));
    const { loadMomentProfile } = await import("../trackerMomentProfile");
    const { loadMomentReach } = await import("../trackerMomentReach");
    const [a, b] = [await loadMomentProfile(tenant, plain.run, plain.data), await loadMomentProfile(tenant, scaled.run, scaled.data)];
    expect(expectProfile(a, ref.profile.weighted, ref.profile.aware_n)).toBe(120);
    expect(expectProfile(b, ref.profile.weighted, ref.profile.aware_n)).toBe(120);
    const [ra, rb] = [await loadMomentReach(tenant, plain.run, plain.data), await loadMomentReach(tenant, scaled.run, scaled.data)];
    expect(expectReach(ra, ref.reach.weighted)).toBe(10);
    expect(expectReach(rb, ref.reach.weighted)).toBe(10);
    if (ra.reach.status !== "ok" || rb.reach.status !== "ok") throw new Error("reach");
    rb.reach.brands.forEach((x, i) => expect(x.shareOfLinks!).toBeCloseTo(ra.reach.status === "ok" ? ra.reach.brands[i].shareOfLinks! : NaN, 9));
  });

  it("unknown: awareness unmapped is Mapping needed for the profile (never all respondents); reach is unaffected; mapping it again recovers the reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const { loadMomentProfile } = await import("../trackerMomentProfile");
    const { loadMomentReach } = await import("../trackerMomentReach");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    const awareGroup = v.dashboard.stages.find((s) => s.stage === "awareness")!.group;
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { stages: { [awareGroup]: null } }, "x")).saved).toBe(true);
    const m = await loadMomentProfile(tenant, savRun, sav);
    expect(m.profile).toMatchObject({ status: "mapping_needed" });
    expect(m.profile.status === "mapping_needed" && m.profile.reason).toMatch(/No question is mapped as awareness/);
    expect(expectReach(await loadMomentReach(tenant, savRun, sav), ref.reach.weighted)).toBe(10);
    // The researcher maps awareness again (the suggestion back): the profile returns, equal to the reference.
    const again = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, { stages: { [awareGroup]: "awareness" } }, "x")).saved).toBe(true);
    try {
      expect(expectProfile(await loadMomentProfile(tenant, savRun, sav), ref.profile.weighted, ref.profile.aware_n)).toBe(120);
    } finally {
      const last = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: last.scopeKey, revision: last.revision }, {}, "x");
    }
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again both return", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadMomentProfile } = await import("../trackerMomentProfile");
    const { loadMomentReach } = await import("../trackerMomentReach");
    await expect(loadMomentProfile(tenant, run, doc)).rejects.toThrow();
    await expect(loadMomentReach(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadMomentProfile(tenant, run, doc)).profile.status).toBe("ok");
    expect((await loadMomentReach(tenant, run, doc)).reach.status).toBe("ok");
  });
});
