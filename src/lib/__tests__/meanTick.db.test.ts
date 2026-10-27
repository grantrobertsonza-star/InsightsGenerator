// Batch 48, the Mean tick (Grant, 27 October 2026: "add Mean to the Show in each cell list"). Through the
// actual buildCrosstab and commitCrosstabs, the local engine and a real disposable PostgreSQL; storage and
// the model are the mocked boundaries. A designed .sav: Satisfaction 0 to 10 with "Don't know" = 99 (a
// rating scale) and Region 1 to 3 (codes that are not a scale), split by Segment, with the expected means
// computed by plain arithmetic in the generator, independently of the engine.
//   - Mean on: a "Mean" row first under Satisfaction's bases with the independent means; Region gets none
//     and is named; the request and provenance record the choice, so it is saved with the table.
//   - Mean off, and a request saved before the tick existed: no mean row, nothing named.
//   - An invalid setting is refused at the boundary and saves nothing.
//   - Committing a table with Mean on makes its tested mean difference a finding worded as a mean.
//   - B48-F01 (Codex): an ordinal 1 to 3 scale whose codes 2 and 3 share the label "High" still gets its
//     Mean row (before: refused, because the automatic mean resolved labels to codes), unweighted and
//     weighted with "Don't know" left out, equal to the generator's arithmetic; Mean off adds none; the
//     row is saved and becomes a finding; the same file with distinct labels gives the same means; a group
//     the researcher defines by the shared label is still refused.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import type { CrosstabRequest, CrosstabResult } from "../parseStatsFile";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
// The export route's own modules, through the same relative paths (this suite does not resolve "@/").
vi.mock("@/lib/crosstabMeanRows", async () => await import("../crosstabMeanRows"));
vi.mock("@/lib/crosstabSlides", async () => await import("../crosstabSlides"));
vi.mock("@/lib/convertToPdf", async () => await import("../convertToPdf"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
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

/** 400 respondents; Segment A answers Satisfaction 2 points higher on average than Segment B. */
function designed(): { bytes: Buffer; meanA: number; meanB: number; meanAll: number } {
  const dir = mkdtempSync(path.join(tmpdir(), "mean-tick-"));
  const out = path.join(dir, "means.sav");
  const script = String.raw`
import sys, json, pandas as pd, pyreadstat
n = 400
seg = [1.0 if i % 2 == 0 else 2.0 for i in range(n)]
sat = []
for i in range(n):
    v = (i * 7) % 9 + (2 if seg[i] == 1.0 else 0)
    sat.append(99.0 if i % 25 == 0 else float(min(10, v)))
region = [float(i % 3 + 1) for i in range(n)]
labels = {"seg": {1.0: "Segment A", 2.0: "Segment B"}, "sat": {**{float(k): str(k) for k in range(11)}, 99.0: "Don't know"}, "region": {1.0: "North", 2.0: "South", 3.0: "East"}}
pyreadstat.write_sav(pd.DataFrame({"seg": seg, "sat": sat, "region": region}), sys.argv[1], column_labels=["Segment", "Satisfaction", "Region"], variable_value_labels=labels)
mean = lambda xs: sum(xs) / len(xs)
a = [s for s, g in zip(sat, seg) if g == 1.0 and s != 99.0]
b = [s for s, g in zip(sat, seg) if g == 2.0 and s != 99.0]
print(json.dumps({"meanA": mean(a), "meanB": mean(b), "meanAll": mean(a + b)}))
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return { bytes: readFileSync(out), ...JSON.parse(r.stdout) };
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("the Mean tick (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  let doc = "";
  let expected: ReturnType<typeof designed>;
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
    expected = designed();
    const key = `${tenant}/${run}/${randomUUID()}-means.sav`;
    storage.objects.set(key, expected.bytes);
    doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'means.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const request = (extra: Partial<CrosstabRequest> = {}): CrosstabRequest => ({
    columnVars: ["seg"],
    rowItems: [
      { key: "sat", label: "Satisfaction", vars: ["sat"] },
      { key: "region", label: "Region", vars: ["region"] },
    ],
    weightVar: null,
    correction: "none",
    ...extra,
  });
  const stored = async (tableId: string) => (await q("select crosstab from document_tables where id = $1", [tableId]))[0].crosstab as CrosstabResult & { savedRequest: CrosstabRequest };

  it("Mean on: a mean row first under the rating scale with the independent means; the other question named; the choice saved", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const built = await buildCrosstab(tenant, run, doc, request({ meanRows: true }));
    const t = await stored(built.tableId);
    const sat = t.questions.find((x) => x.key === "sat")!;
    const first = sat.rows.find((r) => !r.isBase)!;
    expect(first).toMatchObject({ label: "Mean", autoMean: true, isMean: true });
    expect(first.pct[0]).toBeCloseTo(expected.meanA, 2);
    expect(first.pct[1]).toBeCloseTo(expected.meanB, 2);
    expect(first.total.pct).toBeCloseTo(expected.meanAll, 2);
    expect(t.questions.find((x) => x.key === "region")!.rows.some((r) => r.autoMean)).toBe(false);
    expect(t.notes?.meanNotAdded).toMatch(/^No mean row for Region: /);
    expect(t.savedRequest.meanRows).toBe(true);
    expect(t.provenance?.meanRows).toBe(true);
  });

  it("Mean off, and a request saved before the tick: no mean row, nothing named", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    for (const extra of [{ meanRows: false }, {}]) {
      const t = await stored((await buildCrosstab(tenant, run, doc, request(extra))).tableId);
      expect(t.questions.some((x) => x.rows.some((r) => r.autoMean))).toBe(false);
      expect(t.notes?.meanNotAdded ?? null).toBeNull();
      expect(t.provenance?.meanRows).toBe(false);
    }
  });

  it("an invalid setting is refused at the boundary and saves nothing", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const before = (await q("select count(*)::int as n from document_tables where document_id = $1", [doc]))[0].n;
    await expect(buildCrosstab(tenant, run, doc, request({ meanRows: "yes" as unknown as boolean }))).rejects.toThrow("The Mean setting must be on or off.");
    expect((await q("select count(*)::int as n from document_tables where document_id = $1", [doc]))[0].n).toBe(before);
  });

  it("committing makes the tested mean difference a finding worded as a mean", async () => {
    const { commitCrosstabs } = await import("../crosstabs");
    await commitCrosstabs(tenant, run, doc);
    const texts = (await q("select finding_text from findings where run_id = $1", [run])).map((r) => r.finding_text as string);
    expect(texts.some((x) => x.startsWith("The mean of Satisfaction is higher for Segment \"Segment A\""))).toBe(true);
  });

  // B48-F01: repeated answer labels. 300 respondents, codes 1 to 3 declared ordinal, 9 = "Don't know";
  // Segment A answers a code higher than Segment B where it can; a weight of 1 or 2.
  function repeatedLabels(labels: Record<number, string>): { bytes: Buffer; expected: { a: number; b: number; all: number; wAll: number } } {
    const dir = mkdtempSync(path.join(tmpdir(), "mean-dup-"));
    const out = path.join(dir, "dup.sav");
    const script = String.raw`
import sys, json, pandas as pd, pyreadstat
labels = {float(k): v for k, v in json.loads(sys.argv[2]).items()}
n = 300
seg = [1.0 if i % 2 == 0 else 2.0 for i in range(n)]
lvl = []
for i in range(n):
    v = i % 3 + 1
    if seg[i] == 1.0 and v < 3 and i % 4 == 0:
        v += 1
    lvl.append(9.0 if i % 30 == 0 else float(v))
w = [1.0 if i % 5 else 2.0 for i in range(n)]
pyreadstat.write_sav(pd.DataFrame({"seg": seg, "lvl": lvl, "wt": w}), sys.argv[1], column_labels=["Segment", "Level", "Weight"],
    variable_value_labels={"seg": {1.0: "Segment A", 2.0: "Segment B"}, "lvl": {**labels, 9.0: "Don't know"}}, variable_measure={"seg": "nominal", "lvl": "ordinal", "wt": "scale"})
ok = [(x, g, ww) for x, g, ww in zip(lvl, seg, w) if x != 9.0]
mean = lambda xs: sum(xs) / len(xs)
print(json.dumps({"a": mean([x for x, g, _ in ok if g == 1.0]), "b": mean([x for x, g, _ in ok if g == 2.0]), "all": mean([x for x, _, _ in ok]),
                  "wAll": sum(x * ww for x, _, ww in ok) / sum(ww for _, _, ww in ok)}))
`;
    const r = spawnSync(PYTHON, ["-I", "-c", script, out, JSON.stringify(labels)], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return { bytes: readFileSync(out), expected: JSON.parse(r.stdout) };
  }
  const dupFile = async (labels: Record<number, string>) => {
    const made = repeatedLabels(labels);
    const key = `${tenant}/${run}/${randomUUID()}-dup.sav`;
    storage.objects.set(key, made.bytes);
    const id = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'dup.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    return { id, expected: made.expected };
  };
  const levelRequest = (extra: Partial<CrosstabRequest> = {}): CrosstabRequest => ({
    columnVars: ["seg"],
    rowItems: [{ key: "lvl", label: "Level", vars: ["lvl"] }],
    weightVar: null,
    correction: "none",
    ...extra,
  });
  const meanRow = (t: CrosstabResult) => t.questions.find((x) => x.key === "lvl")!.rows.find((r) => r.autoMean);

  it("B48-F01: codes 2 and 3 both labelled High still get the Mean row, unweighted and weighted, Don't know left out", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const dup = await dupFile({ 1: "Low", 2: "High", 3: "High" });
    const t = await stored((await buildCrosstab(tenant, run, dup.id, levelRequest({ meanRows: true }))).tableId);
    const m = meanRow(t)!;
    expect(m).toMatchObject({ label: "Mean", isMean: true });
    expect(m.pct[0]).toBeCloseTo(dup.expected.a, 2);
    expect(m.pct[1]).toBeCloseTo(dup.expected.b, 2);
    expect(m.total.pct).toBeCloseTo(dup.expected.all, 2);
    expect(t.notes?.meanNotAdded ?? null).toBeNull();
    const w = await stored((await buildCrosstab(tenant, run, dup.id, levelRequest({ meanRows: true, weightVar: "wt" }))).tableId);
    expect(meanRow(w)!.total.pct).toBeCloseTo(dup.expected.wAll, 2);
    // Mean off: none.
    expect(meanRow(await stored((await buildCrosstab(tenant, run, dup.id, levelRequest({ meanRows: false }))).tableId))).toBeUndefined();
    // The same file with distinct labels: the same means (labels do not enter the arithmetic).
    const distinct = await dupFile({ 1: "Low", 2: "Middle", 3: "High" });
    const d = meanRow(await stored((await buildCrosstab(tenant, run, distinct.id, levelRequest({ meanRows: true }))).tableId))!;
    expect(d.total.pct).toBeCloseTo(m.total.pct!, 6);
    expect(d.pct).toEqual(m.pct);
  });

  it("B48-F01: a group the researcher defines by the shared label is still refused, with its reason", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const dup = await dupFile({ 1: "Low", 2: "High", 3: "High" });
    const t = await stored((await buildCrosstab(tenant, run, dup.id, levelRequest({
      meanRows: true,
      rowItems: [{ key: "lvl", label: "Level", vars: ["lvl"], groups: [{ label: "Top", cats: ["High"] }] }],
    }))).tableId);
    const rows = t.questions.find((x) => x.key === "lvl")!.rows;
    expect(rows.some((r) => r.label === "NET: Top")).toBe(false);
    expect(t.skipped.map((x) => x.reason)).toContainEqual(expect.stringMatching(/^"Top" \(positive answers "High"\) matches more than one answer code/));
    expect(meanRow(t)).toBeDefined();
  });

  it("B48-F01: committing the repeated-label table makes its mean difference a finding worded as a mean", async () => {
    const { buildCrosstab, commitCrosstabs } = await import("../crosstabs");
    const dup = await dupFile({ 1: "Low", 2: "High", 3: "High" });
    await buildCrosstab(tenant, run, dup.id, levelRequest({ meanRows: true }));
    await commitCrosstabs(tenant, run, dup.id);
    const texts = (await q("select finding_text from findings where run_id = $1", [run])).map((r) => r.finding_text as string);
    expect(texts.some((x) => x.startsWith("The mean of Level is higher for Segment \"Segment A\""))).toBe(true);
  });

  it("B48-F01: the Excel export of the repeated-label table prints its Mean row, and mean=0 leaves it out", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const XLSX = await import("xlsx");
    const { GET } = await import("../../app/api/runs/[id]/crosstab/export/route");
    const dup = await dupFile({ 1: "Low", 2: "High", 3: "High" });
    const tableId = (await buildCrosstab(tenant, run, dup.id, levelRequest({ meanRows: true }))).tableId;
    const sheetRows = async (extra: string) => {
      const res = await GET(new Request(`http://local/api/runs/${run}/crosstab/export?tableId=${tableId}&format=xlsx${extra}`), { params: Promise.resolve({ id: run }) });
      expect(res.status).toBe(200);
      const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
      return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][];
    };
    const shown = (await sheetRows("")).filter((r) => r.some((c) => c === "Mean"));
    expect(shown.length).toBeGreaterThan(0);
    const total = (shown[0].filter((c) => typeof c === "number") as number[]).pop()!;
    expect(total).toBeCloseTo(dup.expected.all, 2);
    expect((await sheetRows("&mean=0")).some((r) => r.some((c) => c === "Mean"))).toBe(false);
  });
});
