// The Conversion view against Codex's independent reference values (30 October 2026), computed person by person from
// the raw BMW CSV files with a script of Codex's own, never from this app or from conversion_reference.py.
// fixtures/tracker-packs/bmw_car/independent/codex-bmw-reference-2026-10-30.json is copied unchanged; its sha256 is checked so an edit
// to the expected values cannot pass unnoticed.
//
// Codex's method (the file's `method.conversion`): for consecutive aware, consider, shortlist, first choice,
// sum(w * I(earlier = 1 and later = 1)) / sum(w * I(earlier = 1)), plus the raw and weighted count of later = 1 without
// earlier = 1. Its denominator is everyone at the earlier stage; ours (contract D3h) is everyone at the earlier stage
// with a known answer at the later one. The two agree only when nobody at the earlier stage has an unknown or blank
// answer at the later one, so the test asserts that condition (0 unknown, 0 blank) instead of assuming it.
//
// Compared for waves 1 and 2 (the pack's SPSS files, which hold the same respondents as Codex's CSV sources),
// weighted and unweighted, 120 cells: the conversion to 1e-6 percentage points, the unweighted base, count at the
// earlier stage, count at both and the non-nested count exactly, the weighted base and weighted count at both to 1e-6.
// Real disposable PostgreSQL and the actual engine; storage is an in-memory stand-in, the model is stubbed (never called).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
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

vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const CODEX_FILE = packPath("independent/codex-bmw-reference-2026-10-30.json");
const CODEX_SHA256 = "bfe50f5eede27e9474fa7b309992a7937c7eba641dff9d38a7a875fb9b65f7a8";
const WAVE_FILES: Record<"1" | "2", string> = { "1": "wave1_labels_only_compressed.sav", "2": "wave2_labels_only_compressed.sav" };

type CodexConversion = {
  brand_code: number;
  brand: string;
  earlier: string;
  later: string;
  raw_n: number;
  sum_weights: number;
  numerator_raw: number;
  numerator_weighted: number;
  percent: number | null;
  later_without_earlier_raw: number;
};
type Codex = { waves: Record<"1" | "2", Record<"weighted" | "unweighted", { conversions: CodexConversion[] }>> };
const STAGE: Record<string, string> = { awareness: "aware", consideration: "consider", shortlist: "shortlist", first_choice: "firstchoice" };

type Loaded = Awaited<ReturnType<typeof import("../trackerConversion").loadBrandConversion>>;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Brand conversion against Codex's independent BMW reference (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const bytes = readFileSync(CODEX_FILE);
  const codex = JSON.parse(bytes.toString("utf8")) as Codex;

  async function loadWave(wave: "1" | "2", weighted: boolean): Promise<Loaded> {
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id as string;
    const key = `${tenant}/${run}/${randomUUID()}-${WAVE_FILES[wave]}`;
    storage.objects.set(key, readFileSync(packPath(WAVE_FILES[wave])));
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, WAVE_FILES[wave], key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    if (!weighted) {
      // The researcher's choice, saved through the dashboard's own path (as on the screen).
      const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
      const v = await loadTrackerDashboard(tenant, run, doc);
      expect((await saveTrackerChoices(tenant, run, doc, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    }
    const { loadBrandConversion } = await import("../trackerConversion");
    return loadBrandConversion(tenant, run, doc);
  }

  /** Every Codex row matched to exactly one cell of the app, and every app cell to one Codex row. */
  function compare(m: Loaded, rows: CodexConversion[]): number {
    if (m.conversion.status !== "ok") throw new Error(m.conversion.reason);
    const cells = new Map<string, Extract<Loaded["conversion"], { status: "ok" }>["steps"][number]["cells"][number]>();
    for (const s of m.conversion.steps) for (const c of s.cells) cells.set(`${STAGE[s.from]}>${STAGE[s.to]} ${Number(c.code)}`, c);
    expect(cells.size).toBe(rows.length);
    for (const r of rows) {
      const at = `${r.earlier}>${r.later} ${r.brand} (${r.brand_code})`;
      const c = cells.get(`${r.earlier}>${r.later} ${r.brand_code}`);
      expect(c, at).toBeDefined();
      // Codex's denominator is everyone at the earlier stage; ours excludes unknown and blank answers at the later
      // one. Comparable only because there are none in these files, which is asserted, not assumed.
      expect(c!.unknownAtTo, at).toEqual([]);
      expect(c!.noAnswerAtTo, at).toBe(0);
      expect(c!.atFrom, at).toBe(r.raw_n);
      expect(c!.base, at).toBe(r.raw_n);
      expect(c!.converted, at).toBe(r.numerator_raw);
      expect(c!.nonNested, at).toBe(r.later_without_earlier_raw);
      expect(c!.weightedBase!, at).toBeCloseTo(r.sum_weights, 6);
      expect(c!.weightedConverted!, at).toBeCloseTo(r.numerator_weighted, 6);
      if (r.raw_n < m.minBase!) {
        expect(c!.conversion, at).toBeNull();
        expect(c!.suppressed, at).toBe(true);
      } else {
        expect(r.percent, at).not.toBeNull();
        expect(c!.suppressed, at).toBe(false);
        expect(Math.abs(c!.conversion! - r.percent!), at).toBeLessThan(1e-6);
      }
    }
    return rows.length;
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("the reference file is Codex's, unchanged (sha256), with 30 conversions per wave and weighting", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(CODEX_SHA256);
    for (const w of ["1", "2"] as const) for (const k of ["weighted", "unweighted"] as const) expect(codex.waves[w][k].conversions).toHaveLength(30);
  });

  for (const wave of ["1", "2"] as const) {
    for (const weighting of ["weighted", "unweighted"] as const) {
      it(`wave ${wave}, ${weighting}: every brand and step equal to Codex's person-by-person values`, async () => {
        const m = await loadWave(wave, weighting === "weighted");
        expect(m.weighted).toBe(weighting === "weighted");
        expect(compare(m, codex.waves[wave][weighting].conversions)).toBe(30);
      });
    }
  }

  it("BMW wave 1 weighted, written out: aware to consideration 321 of 831, 38.48%; consideration to shortlist 166 of 321; shortlist to first choice 61 of 166", async () => {
    const m = await loadWave("1", true);
    if (m.conversion.status !== "ok") throw new Error(m.conversion.reason);
    const bmw = m.conversion.steps.map((s) => s.cells.find((c) => c.code === "8")!);
    expect(bmw.map((c) => [c.converted, c.base])).toEqual([[321, 831], [166, 321], [61, 166]]);
    expect(bmw.map((c) => Number(c.conversion!.toFixed(4)))).toEqual([38.4806, 50.2593, 35.4254]);
  });
});
