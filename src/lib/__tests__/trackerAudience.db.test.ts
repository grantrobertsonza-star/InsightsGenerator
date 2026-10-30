// Page 05 "Audience & media" of the brand tracking dashboard (Grant's design, 29 October 2026) through the actual
// loader, loadBrandAudience: recognition from what was imported, figures from the Cross tab engine computed without
// saving a table, the client's brand's recent acquirers selected by the raw acquisition code, with the dashboard's
// weight. Real disposable PostgreSQL and the actual engine; storage is an in-memory stand-in and the model is stubbed
// (never called). The client's brand is BMW, pre-filled from the project name.
// Expected values are computed independently by src/lib/__tests__/helpers/audience_reference.py (pandas over the same
// file, written from the pack's specification), never taken from the app:
//   1. BMW wave 1 as SPSS with labels only (1,000 respondents, 13 BMW acquirers): every age group's share and the
//      twelve media shares for the acquirers and for all eligible respondents, weighted (the default) and
//      unweighted, to 1e-6, with their bases; the base of 13 is "very small" (below 30: descriptive only); opening
//      the page saves no table.
//   2. Boundary, the pack's first 60 respondents as CSV with metadata.json as the codebook, 35 of them BMW acquirers
//      ("small": flagged, below 50): two blank age answers leave the age base only; a respondent using no listed
//      media stays in the media base.
//   3. Unknown: nobody acquired BMW is a base of 0 with the acquirers' figures n/a (never 0%) and the category still
//      shown; two questions claiming acquisition are "Mapping needed"; a file without age groups or media is
//      "Not measured" for both cards.
//   4. Failure: a file that cannot be read rejects with the reason, never an empty page.
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

vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "audience_reference.py");
type Profile = { age: Record<string, [number | null, number]>; media: Record<string, [number | null, number]> };
type Ref = { acquirers_n: number } & Record<"weighted" | "unweighted", { category: Profile; acquirers: Profile }>;
function reference(file: string): Ref {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "shares", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function variant(kind: string, dir: string): string {
  const out = path.join(dir, `${kind}.csv`);
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "variant", packPath("wave1_first60.csv"), out, kind], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}
type Page = Awaited<ReturnType<typeof import("../trackerAudience").loadBrandAudience>>;

/** Every age group and media share of both groups equal to the reference; returns the number of figures compared. */
function expectReference(m: Page, ref: Ref["weighted"]) {
  if (m.age.status !== "ok") throw new Error(m.age.reason);
  if (m.media.status !== "ok") throw new Error(m.media.reason);
  let figures = 0;
  const same = (got: { share: number | null; base: number | null }, want: [number | null, number], what: string) => {
    expect(got.share, what).toBeCloseTo(want[0]!, 6);
    expect(got.base, what).toBe(want[1]);
    figures += 1;
  };
  expect(m.age.rows.map((r) => r.key)).toEqual(Object.keys(ref.category.age));
  for (const r of m.age.rows) {
    same(r.category, ref.category.age[r.key], `category age ${r.key}`);
    same(r.acquirers, ref.acquirers.age[r.key], `acquirers age ${r.key}`);
  }
  expect(m.media.rows.map((r) => r.key).sort()).toEqual(Object.keys(ref.category.media).sort());
  for (const r of m.media.rows) {
    same(r.category, ref.category.media[r.key], `category ${r.key}`);
    same(r.acquirers, ref.acquirers.media[r.key], `acquirers ${r.key}`);
  }
  // Media ordered by the category's share, highest first.
  const shares = m.media.rows.map((r) => r.category.share!);
  expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  return figures;
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Audience & media figures against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "audience-"));
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

  it("BMW wave 1, weighted by default: BMW's 13 recent acquirers and all eligible respondents, every age group and media share equal to the reference to 1e-6; very small base; no table saved", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    expect(ref.acquirers_n).toBe(13);
    const { loadBrandAudience } = await import("../trackerAudience");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadBrandAudience(tenant, savRun, sav);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar, m.categoryN]).toEqual([true, "weight", 1000]);
    expect(m.acquirers).toMatchObject({ status: "ok", brand: { code: "8", label: "BMW" }, variable: "bought12_b08", code: "1", n: 13, level: "very_small" });
    if (m.acquirers.status !== "ok") throw new Error(m.acquirers.reason);
    expect(m.acquirers.effectiveBase).toBeGreaterThan(0);
    expect(m.acquirers.effectiveBase).toBeLessThanOrEqual(13);
    expect(expectReference(m, ref.weighted)).toBe(2 * 4 + 2 * 12);
    if (m.age.status !== "ok") throw new Error(m.age.reason);
    expect(m.age.rows.map((r) => r.label)).toEqual(["18\u201324", "25\u201334", "35\u201349", "50\u201369"]);
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const ref = reference(packPath("wave1_labels_only_compressed.sav"));
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadBrandAudience } = await import("../trackerAudience");
      const m = await loadBrandAudience(tenant, savRun, sav);
      expect([m.weighted, m.effectiveBase]).toEqual([false, null]);
      expect(m.acquirers).toMatchObject({ n: 13, effectiveBase: null });
      expect(expectReference(m, ref.unweighted)).toBe(32);
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: a base of 35 is flagged small; blank age answers leave the age base only; no listed media stays in the media base", async () => {
    const file = variant("boundary", dir);
    const ref = reference(file);
    // The reference's own reading of the variant.
    expect(ref.acquirers_n).toBe(35);
    expect(ref.weighted.acquirers.age["1"][1]).toBe(33);
    expect(ref.weighted.acquirers.media.media_m01[1]).toBe(35);
    const { run, data } = await csvWithCodebook(file);
    const { loadBrandAudience } = await import("../trackerAudience");
    const m = await loadBrandAudience(tenant, run, data);
    expect(m.acquirers).toMatchObject({ status: "ok", n: 35, level: "small" });
    expect(expectReference(m, ref.weighted)).toBe(32);
  });

  it("unknown: no acquirer is a base of 0 with n/a figures (never 0%); two acquisition questions are Mapping needed; no age or media question is Not measured", async () => {
    const { loadBrandAudience } = await import("../trackerAudience");
    const none = await csvWithCodebook(variant("none", dir));
    const z = await loadBrandAudience(tenant, none.run, none.data);
    expect(z.acquirers).toMatchObject({ status: "ok", n: 0, reason: expect.stringMatching(/No respondent in this file is a recent acquirer of BMW/) });
    if (z.age.status !== "ok" || z.media.status !== "ok") throw new Error("cards should still show the category");
    expect(z.age.rows.every((r) => r.acquirers.share === null && r.category.share !== null)).toBe(true);
    expect(z.media.rows.every((r) => r.acquirers.share === null && /No respondent/.test(r.acquirers.reason ?? ""))).toBe(true);

    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    // A second question claiming acquisition: which one is the researcher's choice, never guessed.
    const repeatGroup = v.dashboard.stages.find((s) => s.stage === "repeat")!.group;
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { stages: { [repeatGroup]: "acquisition" } }, "x")).saved).toBe(true);
    try {
      const m = await loadBrandAudience(tenant, savRun, sav);
      expect(m.acquirers).toMatchObject({ status: "mapping_needed", reason: expect.stringMatching(/Two questions could be recent acquisition/) });
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
    const gone = await csvWithCodebook(variant("no_audience", dir));
    const n = await loadBrandAudience(tenant, gone.run, gone.data);
    expect(n.age).toMatchObject({ status: "not_measured" });
    expect(n.media).toMatchObject({ status: "not_measured" });
    expect(n.acquirers).toMatchObject({ status: "ok", n: expect.any(Number) });
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again the page returns", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "table", "bmw_wave1.sav", readFileSync(packPath("wave1_labels_only_compressed.sav")));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadBrandAudience } = await import("../trackerAudience");
    await expect(loadBrandAudience(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadBrandAudience(tenant, run, doc)).age.status).toBe("ok");
  });
});
