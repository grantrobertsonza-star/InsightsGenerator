// The Conversion view of the brand dashboard's page 01 (Grant, 30 October 2026) through the actual loader,
// loadBrandConversion: recognition from what was imported, figures from the Cross tab engine computed without saving a
// table, each brand's conversion among the respondents at the earlier stage (selected by the raw code), with the
// dashboard's weight. Real disposable PostgreSQL and the actual engine; storage is an in-memory stand-in and the model
// is stubbed (never called).
// Expected values come from src/lib/__tests__/helpers/conversion_reference.py (pandas over the same file, written from
// the contract), never from the app:
//   1. BMW wave 1 as SPSS (1,000 respondents), weighted (the default) and unweighted: every brand and step (30 cells)
//      equal to the reference to 1e-6 with every base and count; the stages are nested in this file, so the ratio of
//      shares equals the conversion here (a control) and every non-nested count is 0; usage to frequent usage is
//      skipped (no frequent usage question); no table saved.
//   2. Boundary file: 40 respondents not aware of brand 10 considering it (non-nested: the ratio of shares differs and
//      the app reports the conditional figure and the count 40); BMW's don't know (labelled by the codebook) and an
//      unlabelled code at consideration (outside the base, counted by kind); BMW's don't know at awareness (not at
//      awareness, and those considering count as non-nested). As CSV with the pack's metadata.json linked as its
//      codebook (the stage questions grouped by the codebook's sets; the SPSS reader alone does not group a yes/no
//      variable holding a third code); brand 9 with 8 at shortlist (suppressed, base shown, not ranked); brand 7
//      with 6 blank first choice answers (outside the base, counted).
//   3. A file without the consideration question: Awareness to Shortlist, labelled as bridged, equal to the reference;
//      the two adjacent pairs skipped with the reason.
//   4. The weight multiplied by 3.7: every conversion unchanged to 1e-9.
//   5. Failure: a file that cannot be read rejects with the reason; once readable again the view returns.
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
const WAVE1 = packPath("wave1_labels_only_compressed.sav");
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "conversion_reference.py");
type RefCell = { conversion: number | null; base: number; converted: number; at_s: number; unknown: number; no_answer: number; non_nested: number; share_ratio: number };
type Ref = Record<"weighted" | "unweighted", Record<string, Record<string, RefCell>>> & { steps: string[] };
function reference(file: string): Ref {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "conversions", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function variant(kind: string, dir: string): string {
  const out = path.join(dir, kind === "boundary" ? `${kind}.csv` : `${kind}.sav`);
  const r = spawnSync(PYTHON, ["-I", REFERENCE, "variant", WAVE1, out, kind, packPath("metadata.json")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}
const METRIC: Record<string, string> = { awareness: "aware", consideration: "consider", shortlist: "shortlist", first_choice: "firstchoice" };
const brandKey = (code: string) => `b${String(Number(code)).padStart(2, "0")}`;
type Loaded = Awaited<ReturnType<typeof import("../trackerConversion").loadBrandConversion>>;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Brand conversion against independent reference values (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "conversion-"));
  let savRun = "";
  let sav = "";
  let weightedW1: Loaded;

  async function stored(run: string, name: string, bytes: Buffer, kind: "table" | "instrument" = "table") {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, kind === "table" ? null : "codebook", kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  /** A CSV with its codebook (the pack's metadata.json with the variant's labels) linked, in a project of its own. */
  async function csvWithCodebook(file: string) {
    const run = await newRun("BMW car tracker");
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored(run, "metadata.json", readFileSync(`${file}.metadata.json`), "instrument");
    const doc = await stored(run, "Car_Brand_Tracker_Wave_1.csv", readFileSync(file));
    await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, doc);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    const { loadBrandConversion } = await import("../trackerConversion");
    return { run, doc, m: await loadBrandConversion(tenant, run, doc) };
  }
  const newRun = async (name: string) => (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
  async function load(file: string) {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, path.basename(file), readFileSync(file));
    const { loadBrandConversion } = await import("../trackerConversion");
    return { run, doc, m: await loadBrandConversion(tenant, run, doc) };
  }
  const stepsOf = (m: Loaded) => {
    if (m.conversion.status !== "ok") throw new Error(m.conversion.reason);
    return m.conversion;
  };
  /** Every cell of every step equal to the reference, suppression applied with the engine's minimum base. */
  function expectReference(m: Loaded, ref: Record<string, Record<string, RefCell>>, refSteps: string[]): number {
    const { steps } = stepsOf(m);
    expect(steps.map((s) => `${METRIC[s.from]}>${METRIC[s.to]}`)).toEqual(refSteps);
    let cells = 0;
    for (const s of steps) {
      expect(s.cells.map((c) => c.code)).toEqual(m.dashboard.brands.map((b) => b.code));
      for (const c of s.cells) {
        const r = ref[`${METRIC[s.from]}>${METRIC[s.to]}`][brandKey(c.code)];
        const at = `${s.label} ${brandKey(c.code)}`;
        expect(c.fromVariable, at).toBe(`${METRIC[s.from]}_${brandKey(c.code)}`);
        expect(c.toVariable, at).toBe(`${METRIC[s.to]}_${brandKey(c.code)}`);
        expect(c.base, at).toBe(r.base);
        expect(c.atFrom, at).toBe(r.at_s);
        expect(c.converted, at).toBe(r.converted);
        expect(c.unknownAtTo.reduce((t, u) => t + u.n, 0), at).toBe(r.unknown);
        expect(c.noAnswerAtTo, at).toBe(r.no_answer);
        expect(c.nonNested, at).toBe(r.non_nested);
        if (r.base < m.minBase!) {
          expect(c.conversion, at).toBeNull();
          expect(c.suppressed, at).toBe(true);
          expect(c.reason, at).toMatch(/small base/);
        } else {
          expect(c.suppressed, at).toBe(false);
          expect(c.conversion, at).toBeCloseTo(r.conversion!, 6);
        }
        cells += 1;
      }
    }
    return cells;
  }
  const cellOf = (m: Loaded, from: string, code: string) => stepsOf(m).steps.find((s) => s.from === from)!.cells.find((c) => c.code === code)!;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    savRun = await newRun("BMW car tracker");
    sav = await stored(savRun, "bmw_wave1.sav", readFileSync(WAVE1));
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("BMW wave 1, weighted by default: all 30 cells equal to the reference to 1e-6; nested, so every non-nested count is 0; usage to frequent usage skipped; no table saved", async () => {
    const ref = reference(WAVE1);
    const { loadBrandConversion, conversionHeadline } = await import("../trackerConversion");
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n);
    const m = await loadBrandConversion(tenant, savRun, sav);
    weightedW1 = m;
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [savRun]))[0].n)).toBe(before);
    expect([m.weighted, m.weightVar, m.minBase]).toEqual([true, "weight", 10]);
    expect(m.effectiveBase).toBeGreaterThan(700);
    const c = stepsOf(m);
    expect(c.steps.map((s) => s.label)).toEqual(["Awareness to Consideration", "Consideration to Shortlist", "Shortlist to First choice"]);
    expect(c.skipped).toEqual([{ from: "usage", to: "frequent_usage", status: "not_measured", reason: "Usage to Frequent usage: no frequent usage question was found in this file." }]);
    expect(expectReference(m, ref.weighted, ref.steps)).toBe(30);
    // Nested in this file (a control): the ratio of shares equals the conditional figure, and nobody is at T without S.
    for (const s of c.steps) for (const cell of s.cells) {
      expect(cell.conversion!, `${s.label} ${cell.code}`).toBeCloseTo(ref.weighted[`${METRIC[s.from]}>${METRIC[s.to]}`][brandKey(cell.code)].share_ratio, 6);
      expect(cell.nonNested).toBe(0);
    }
    // BMW (code 8) aware to consideration, written out: 321 of 831 unweighted; the headline ranks it among 10.
    const bmw = cellOf(m, "awareness", "8");
    expect([bmw.atFrom, bmw.converted, bmw.base]).toEqual([831, 321, 831]);
    const line = conversionHeadline(c.steps[0], c.steps[0].cells, { code: "8", label: "BMW" });
    expect(line).toMatch(/^BMW converts \d+% of aware respondents to consideration, \d+(st|nd|rd|th) of 10 brands\.$/);
  });

  it("unweighted when the researcher chose so: equal to the unweighted reference", async () => {
    const ref = reference(WAVE1);
    const { saveTrackerChoices, loadTrackerDashboard } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, savRun, sav);
    expect((await saveTrackerChoices(tenant, savRun, sav, { scope: v.scopeKey, revision: v.revision }, { weighted: false }, "x")).saved).toBe(true);
    try {
      const { loadBrandConversion } = await import("../trackerConversion");
      const m = await loadBrandConversion(tenant, savRun, sav);
      expect([m.weighted, m.effectiveBase]).toEqual([false, null]);
      expect(expectReference(m, ref.unweighted, ref.steps)).toBe(30);
      // Unweighted, the conversion is converted / base exactly.
      const bmw = cellOf(m, "awareness", "8");
      expect(bmw.conversion).toBeCloseTo((100 * 321) / 831, 9);
      // Weighting changes the figure (the weight is not ignored).
      expect(Math.abs(bmw.conversion! - cellOf(weightedW1, "awareness", "8").conversion!)).toBeGreaterThan(0.01);
    } finally {
      const again = await loadTrackerDashboard(tenant, savRun, sav);
      await saveTrackerChoices(tenant, savRun, sav, { scope: again.scopeKey, revision: again.revision }, {}, "x");
    }
  });

  it("boundary: non-nested respondents counted and the conditional figure reported (not the ratio of shares); don't know and unlabelled answers outside the base; unknown at S is not at S; small base suppressed; blanks outside the base", async () => {
    const file = variant("boundary", dir);
    const ref = reference(file);
    const { m } = await csvWithCodebook(file);
    expect(expectReference(m, ref.weighted, ref.steps)).toBe(30);

    // Brand 10: 40 respondents consider it without being aware of it.
    const b10 = cellOf(m, "awareness", "10");
    const r10 = ref.weighted["aware>consider"].b10;
    expect(b10.nonNested).toBe(40);
    expect(Math.abs(r10.share_ratio - r10.conversion!)).toBeGreaterThan(5);
    expect(b10.conversion).toBeCloseTo(r10.conversion!, 6);
    expect(Math.abs(b10.conversion! - r10.share_ratio)).toBeGreaterThan(5);

    // BMW: 30 don't know (labelled by the codebook) and 5 unlabelled answers at consideration, outside the base,
    // counted by kind; 20 don't know at awareness are not aware, and the 7 of them considering BMW are non-nested.
    const bmw = cellOf(m, "awareness", "8");
    expect(bmw.unknownAtTo.map((u) => [u.code, u.kind, u.n]).sort()).toEqual([["7", "unlabelled", 5], ["9", "non_answer", 30]]);
    expect([bmw.atFrom, bmw.base]).toEqual([811, 776]);
    expect(bmw.nonNested).toBe(7);

    // Brand 9: 8 at shortlist, under the engine's minimum base of 10: no figure, base shown, never 0, not ranked.
    const b9 = cellOf(m, "shortlist", "9");
    expect([b9.conversion, b9.suppressed, b9.base]).toEqual([null, true, 8]);
    const { conversionHeadline, rankConversion } = await import("../trackerConversion");
    const last = stepsOf(m).steps[2];
    expect(rankConversion(last.cells).suppressed).toEqual(["9"]);
    expect(rankConversion(last.cells).ranked).toHaveLength(9);
    expect(conversionHeadline(last, last.cells, { code: "8", label: "BMW" })).toMatch(/, \d+(st|nd|rd|th) of 9 brands; 1 brand not ranked \(1 small base\)\.$/);
    expect(conversionHeadline(last, last.cells, { code: "9", label: "Brand 9" })).toBe("Brand 9: no figure, base too small (n=8). 1 brand not ranked (1 small base).");

    // Brand 7: 6 blank first choice answers among those shortlisting, outside the base.
    const b7 = cellOf(m, "shortlist", "7");
    expect([b7.noAnswerAtTo, b7.base, b7.atFrom]).toEqual([6, 176, 182]);
  });

  it("a stage with no question: Awareness to Shortlist, labelled as bridged, equal to the reference; the adjacent pairs skipped with the reason", async () => {
    const file = variant("no_consideration", dir);
    const ref = reference(file);
    expect(ref.steps).toEqual(["aware>shortlist", "shortlist>firstchoice"]);
    const { m } = await load(file);
    const c = stepsOf(m);
    expect(c.steps.map((s) => [s.label, s.bridged])).toEqual([
      ["Awareness to Shortlist (no consideration question)", ["consideration"]],
      ["Shortlist to First choice", []],
    ]);
    expect(c.skipped.map((s) => [s.from, s.to, s.status])).toEqual([
      ["awareness", "consideration", "not_measured"],
      ["consideration", "shortlist", "not_measured"],
      ["usage", "frequent_usage", "not_measured"],
    ]);
    expect(expectReference(m, ref.weighted, ref.steps)).toBe(20);
  });

  it("weight rescaling: the weight multiplied by 3.7 changes no conversion (to 1e-9) and no base", async () => {
    const { m } = await load(variant("rescaled", dir));
    const a = stepsOf(m).steps;
    const b = stepsOf(weightedW1).steps;
    expect(a.map((s) => s.label)).toEqual(b.map((s) => s.label));
    a.forEach((s, i) =>
      s.cells.forEach((cell, j) => {
        expect(cell.conversion!, `${s.label} ${cell.code}`).toBeCloseTo(b[i].cells[j].conversion!, 9);
        expect(cell.base).toBe(b[i].cells[j].base);
        expect(cell.weightedBase!).toBeCloseTo(b[i].cells[j].weightedBase! * 3.7, 6);
      }),
    );
  });

  it("failure: a file that cannot be read rejects with the reason; once readable again the view returns", async () => {
    const run = await newRun("BMW car tracker");
    const doc = await stored(run, "bmw_wave1.sav", readFileSync(WAVE1));
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [doc, `${key}.missing`]);
    const { loadBrandConversion } = await import("../trackerConversion");
    await expect(loadBrandConversion(tenant, run, doc)).rejects.toThrow();
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    expect((await loadBrandConversion(tenant, run, doc)).conversion.status).toBe("ok");
  });
});
