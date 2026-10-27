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
});
