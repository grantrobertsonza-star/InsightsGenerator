// Codex CT500-F02 and Grant, 24 October 2026 (CSM Analytics, Build dashboard with Segment by set): the dashboard showed
// `duplicate key value violates unique constraint "document_tables_document_id_table_index_key"`.
// scoreVariable builds a variable's overall and segmented distributions at the same time, and each
// saves a table numbered "highest so far plus one" for the file; both read the same highest number.
// buildCrosstab now locks the file's row before numbering, so saves for one file take turns.
// Real disposable PostgreSQL and the actual buildCrosstab; only the engine transport (runStatsTool)
// and storage are replaced.
//   - five tables saved at once for one file: all saved, with five different numbers after the
//     existing ones, nothing else in the file changed
//   - a file of another run: refused, nothing written
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const { DICTIONARY, RESULT } = vi.hoisted(() => ({
  DICTIONARY: {
    version: 11,
    layout: "rows_are_cases",
    nCases: 4,
    sets: [],
    variables: [
      { name: "sat", label: "Satisfaction", numeric: true, nValid: 4, nDistinct: 4, pctValid: 100 },
      { name: "reason", label: "Call reason", numeric: true, nValid: 4, nDistinct: 2, pctValid: 100 },
    ],
  },
  RESULT: {
    version: 2,
    weightVar: null,
    weightLabel: null,
    overall: true,
    blocks: [{ var: "", label: "All respondents" }],
    columns: [{ block: 0, blockLabel: "All respondents", name: "All respondents", n: 4, w: 4, nEff: 4 }],
    total: { n: 4, w: 4, nEff: 4 },
    questions: [
      {
        key: "sat",
        label: "Satisfaction",
        kind: "single",
        rows: [{ label: "Base", isBase: true, count: [4], pct: [null], total: { count: 4, pct: null } }],
      },
    ],
  },
}));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../parseStatsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parseStatsFile")>()),
  runStatsTool: vi.fn(async (tool: string) => {
    // A short wait so every build reaches its save while the others are still in flight.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return structuredClone(tool === "dictionary" ? DICTIONARY : RESULT);
  }),
}));

describe.skipIf(!TEST_DATABASE_URL)("tables saved at once for one file each get their own number", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let otherRun = "";
  let file = "";

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants (id, name) values ($1, 'Synthetic concurrent tables')", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
    otherRun = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'Q') returning id", [tenant])).rows[0].id;
    file = (
      await db.pool.query(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, variable_dictionary)
         values ($1, $2, 'table', 'raw', 'csm.xlsx', 'x/csm.xlsx', $3, $4) returning id`,
        [tenant, run, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }), JSON.stringify(DICTIONARY)],
      )
    ).rows[0].id;
    // The file's own imported table (index 0) and one earlier saved table.
    await db.pool.query(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type)
       values ($1, $2, $3, 0, 'imported', '[]', '[]', 'raw')`,
      [tenant, run, file],
    );
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  const request = (segment: string | null) => ({
    columnVars: segment ? [segment] : [],
    rowItems: [{ key: "sat", label: "Satisfaction", kind: "var" as const, vars: ["sat"] }],
  });

  it("five saves at once all succeed with five different numbers", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const before = (await db.pool.query("select coalesce(max(table_index), 0)::int as top from document_tables where document_id = $1", [file])).rows[0].top as number;
    const results = await Promise.allSettled(
      [null, "reason", null, "reason", null].map((segment) => buildCrosstab(tenant, run, file, request(segment) as never)),
    );
    expect(results.map((r) => (r.status === "rejected" ? String(r.reason) : "saved"))).toEqual(Array(5).fill("saved"));
    const rows = (
      await db.pool.query("select table_index from document_tables where document_id = $1 and crosstab is not null order by table_index", [file])
    ).rows.map((r) => r.table_index as number);
    expect(rows).toHaveLength(5);
    expect(new Set(rows).size).toBe(5);
    expect(Math.min(...rows)).toBeGreaterThan(before);
    // The imported table is untouched.
    const imported = (await db.pool.query("select label from document_tables where document_id = $1 and table_index = 0", [file])).rows;
    expect(imported).toEqual([{ label: "imported" }]);
  });

  it("a file of another run is refused and nothing is written", async () => {
    const { buildCrosstab } = await import("../crosstabs");
    const count = async () => (await db.pool.query("select count(*)::int as n from document_tables")).rows[0].n as number;
    const was = await count();
    await expect(buildCrosstab(tenant, otherRun, file, request(null) as never)).rejects.toThrow();
    expect(await count()).toBe(was);
  });
});
