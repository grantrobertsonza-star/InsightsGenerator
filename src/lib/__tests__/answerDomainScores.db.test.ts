// Codex RP0-F01 (programme S1, 25 October 2026): an excluded non-answer code took a top-two-box slot.
// A declared "Don't know" (99) was masked from the valid cases but put back into the table as a 0% row
// (every declared code is kept since IMP-004), its raw code reached the chart series, and box scoring,
// which ranks codes numerically, picked 99 and 5 instead of 5 and 4: 20% instead of 40%, reported as a
// success. The engine now keeps non-answer codes (declared user-missing, and "don't know"-type labels
// when non-answers are excluded) out of a variable's answer domain (_non_answer_codes); substantive
// declared codes with no cases stay in (IMP-004).
//
// Real database built from every migration; the actual buildCsmDashboardAction -> runDistributionAction ->
// buildCrosstab -> engine (local runner) -> stored document_tables -> reload -> summarizeSeries. Storage
// is an in-memory stand-in and the model is stubbed (never reached). Expected scores are written out
// here from the source counts, not read from the app.
//   1. Codex's own source (fixtures/csm/dk-score-source.sav, SHA-256 checked): 20 cases at each of 1-5 and
//      99 "Don't know": base 100, top two box 40, and no 99 row in the stored table or the series
//   2. a substantive top code with no cases (5 declared, never chosen): it stays a 0% row and still
//      counts as the top code, so top two box is 25 (4 alone), not 50 (4 and 3)
//   3. no non-answer code at all: 1-5, 20 each: 40
//   4. a code the file declares user-missing whose label is not a "don't know" word (9 "Item not shown"):
//      outside the domain, top two box 40
//   5. explicitly included non-answers (excludeDk false, the crosstab's own option): the 99 row is shown
//      with its 20 cases (16.7%), so a researcher who asks for it gets it
//   6. weighted (a variable named "weight" is the default weight) and segmented: weight 2 on every "5";
//      each segment's top two box from its own weighted counts (men 66.7, women 20), overall 45.5
//   7. refusal and recovery: a variable whose only answers are "Don't know" and one code is refused
//      with the reason rather than scored; a valid file then scores normally
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const CODEX_SOURCE_SHA256 = "f796fc7452d654d79bef1c2d3d143d97dc6da23b24472952ed1dd31aef0fec11";
const SCALE = { 1: "Very dissatisfied", 2: "Dissatisfied", 3: "Neutral", 4: "Satisfied", 5: "Very satisfied" };

/** A .sav written by pyreadstat from columns of values; labels per column; optional user-missing codes. */
function sav(columns: Record<string, (number | null)[]>, labels: Record<string, Record<number, string>>, missing: Record<string, number[]> = {}): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "answer-domain-"));
  const out = path.join(dir, "data.sav");
  const script = String.raw`
import json, sys, pandas as pd, pyreadstat
spec = json.loads(sys.argv[1])
df = pd.DataFrame({k: pd.Series(v, dtype="float64") for k, v in spec["columns"].items()})
labels = {k: {float(c): t for c, t in v.items()} for k, v in spec["labels"].items()}
kw = {"missing_ranges": {k: [float(c) for c in v] for k, v in spec["missing"].items()}} if spec["missing"] else {}
pyreadstat.write_sav(df, sys.argv[2], variable_value_labels=labels, **kw)
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, JSON.stringify({ columns, labels, missing }), out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(out);
}
const repeat = (pairs: [number, number][]) => pairs.flatMap(([code, n]) => Array.from({ length: n }, () => code));

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("answer domain for scores (Codex RP0-F01; real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function file(bytes: Buffer, name = "rating.sav") {
    const p = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(p, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, p, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  }
  const dashboard = async (doc: string, segmentVar: string | null = null) => {
    const { buildCsmDashboardAction } = await import("../csmActions");
    return buildCsmDashboardAction(run, doc, { overallVar: "rating", overallMetric: "top2", attributes: [], loyaltyVar: null, segmentVar });
  };
  /** The answer rows of the last table stored for this document, reloaded from the database. */
  const storedCodes = async (doc: string) => {
    const t = (await q("select crosstab from document_tables where document_id = $1 order by table_index desc limit 1", [doc]))[0];
    const rows = (t.crosstab?.questions?.[0]?.rows ?? []) as { rawCode?: string | null; isBase?: boolean; isEffBase?: boolean; isNet?: boolean; isScore?: boolean; isMean?: boolean }[];
    return rows.filter((r) => !r.isBase && !r.isEffBase && !r.isNet && !r.isScore && !r.isMean).map((r) => String(r.rawCode));
  };

  it("Codex's source: 'Don't know' stays out of the base and the box: base 100, top two box 40", async () => {
    const bytes = readFileSync(path.resolve("fixtures/csm/dk-score-source.sav"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(CODEX_SOURCE_SHA256);
    const doc = await file(bytes);
    const r = await dashboard(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dashboard.overall?.n).toBe(100);
    expect(r.dashboard.overall?.overall).toBe(40);
    expect(await storedCodes(doc)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("a substantive top code with no cases stays in the domain: top two box 25, not 50", async () => {
    const doc = await file(sav({ rating: repeat([[1, 25], [2, 25], [3, 25], [4, 25]]) }, { rating: SCALE }));
    const r = await dashboard(doc);
    expect(r.ok && r.dashboard.overall?.overall).toBe(25);
    expect(await storedCodes(doc)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("no non-answer code: top two box 40; a declared user-missing code is outside the domain too", async () => {
    const plain = await file(sav({ rating: repeat([[1, 20], [2, 20], [3, 20], [4, 20], [5, 20]]) }, { rating: SCALE }));
    expect(((await dashboard(plain)) as { ok: true; dashboard: { overall: { overall: number } } }).dashboard.overall.overall).toBe(40);
    const declared = await file(sav(
      { rating: repeat([[1, 20], [2, 20], [3, 20], [4, 20], [5, 20], [9, 20]]) },
      { rating: { ...SCALE, 9: "Item not shown" } },
      { rating: [9] },
    ));
    const r = await dashboard(declared);
    expect(r.ok && r.dashboard.overall?.n).toBe(100);
    expect(r.ok && r.dashboard.overall?.overall).toBe(40);
    expect(await storedCodes(declared)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("explicitly included non-answers are shown with their cases", async () => {
    const bytes = readFileSync(path.resolve("fixtures/csm/dk-score-source.sav"));
    const doc = await file(bytes);
    const { runStatsTool } = await import("../parseStatsFile");
    const d = (await q("select storage_path, source_filename from documents where id = $1", [doc]))[0];
    type Row = { rawCode?: string | null; total: { count: number; pct: number | null } };
    const result = await runStatsTool<{ questions: { rows: Row[] }[] }>("crosstab", d.storage_path, d.source_filename, {
      rowItems: [{ key: "rating", label: "rating", vars: ["rating"] }], columnVars: [], excludeDk: false,
    });
    const dk = result.questions[0].rows.find((x) => x.rawCode === "99");
    expect(dk?.total.count).toBe(20);
    expect(dk?.total.pct).toBeCloseTo(100 * 20 / 120, 1);
  });

  it("weighted and segmented: each segment from its own counts, and the weighted overall", async () => {
    // Men: 5 x10, 4 x20, 3 x20, 99 x10. Women: 5 x0, 4 x10, 2 x40, 99 x10. Weight 2 on every "5", 1 elsewhere.
    const men = repeat([[5, 10], [4, 20], [3, 20], [99, 10]]);
    const women = repeat([[4, 10], [2, 40], [99, 10]]);
    const rating = [...men, ...women];
    const gender = [...men.map(() => 1), ...women.map(() => 2)];
    const weight = rating.map((v) => (v === 5 ? 2 : 1));
    const doc = await file(sav({ rating, gender, weight }, { rating: { ...SCALE, 99: "Don't know" }, gender: { 1: "Men", 2: "Women" } }));
    const r = await dashboard(doc, "gender");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Weighted, non-answers out. Men: valid weight 20+20+20 = 60, top two (5,4) = 20+20 = 40 -> 66.7.
    // Women: valid 10+40 = 50, top two (5 none, 4) = 10 -> 20. Overall: valid 110, top two 50 -> 45.5.
    const seg = Object.fromEntries(r.dashboard.overall!.bySegment.map((x) => [x.name, x.value]));
    // The box sums the bars' one-decimal percentages (33.3 + 33.3), so 66.6 for 66.67.
    expect(seg.Men).toBeCloseTo(66.6, 1);
    expect(seg.Women).toBeCloseTo(20, 1);
    expect(r.dashboard.overall!.overall).toBeCloseTo(45.5, 1);
  });

  it("a variable whose only answer is one code beside 'Don't know' is refused, and a valid file then scores", async () => {
    const doc = await file(sav({ rating: repeat([[3, 30], [99, 30]]) }, { rating: { 3: "Neutral", 99: "Don't know" } }));
    const r = await dashboard(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be tabulated|Fewer than two|answer categories/i);
    const good = await file(sav({ rating: repeat([[1, 20], [2, 20], [3, 20], [4, 20], [5, 20], [99, 5]]) }, { rating: { ...SCALE, 99: "Don't know" } }));
    expect(((await dashboard(good)) as { ok: true; dashboard: { overall: { overall: number } } }).dashboard.overall.overall).toBe(40);
  });
});
