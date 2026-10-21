// GT100-F01 (Codex golden-thread 100 review, 2026-10-21): a confirmed questionnaire link defines what
// a data file's codes mean, including which code is Don't know. A failed read of those links used to
// be treated as "no confirmed links", so a table was computed with the file's own labels: with 20
// Yes, 20 No and 20 Don't know the valid base went from 40 to 60 and Yes from 50% to 33.3%.
// Real disposable PostgreSQL and the app's actual functions, run as a restricted non-owner role whose
// SELECT on instrument_links is revoked to make the read fail; only the storage download and the
// engine transport (runStatsTool) are replaced, by a stub that records each call.
//   - confirmed links: the overlay carries Yes=1, No=2, Don't know=99
//   - healthy file with no links: no overlay, no error
//   - permission failure: InstrumentMeaningUnavailableError from the lookup; the dictionary,
//     categories and cross tab refuse before any engine call; nothing is written, the saved table
//     and the confirmed link are unchanged
//   - retry after access returns: the confirmed overlay reaches the engine again
//   - a database without the questionnaire table (42P01) is the supported old schema: no overlay
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const { engineCalls, DICTIONARY } = vi.hoisted(() => ({
  engineCalls: [] as unknown[][],
  DICTIONARY: {
    version: 10,
    layout: "rows_are_cases",
    nCases: 60,
    variables: [
      { name: "Q1", label: "Q1", numeric: true, valueLabels: { "1": "1", "2": "2", "99": "99" } },
      { name: "Region", label: "Region", numeric: false },
    ],
  },
}));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../parseStatsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parseStatsFile")>()),
  runStatsTool: vi.fn(async (...args: unknown[]) => {
    engineCalls.push(args);
    // The file's own structure for a dictionary read; an empty answer for anything else.
    return args[0] === "dictionary" ? structuredClone(DICTIONARY) : { variable: "Q1", categories: [] };
  }),
}));

describe.skipIf(!TEST_DATABASE_URL)("GT100-F01 a failed confirmed-questionnaire lookup refuses the calculation", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const role = `ie_meaning_${randomUUID().replaceAll("-", "")}`;
  let run = "";
  let data = "";
  let bare = "";
  let link = "";

  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query("insert into tenants (id, name) values ($1, 'Synthetic meaning')", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
    const doc = async (name: string) =>
      (
        await db.pool.query(
          `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, variable_dictionary)
           values ($1, $2, 'table', 'raw', $3, $4, $5, $6) returning id`,
          [tenant, run, name, `${tenant}/${run}/${name}`, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }), JSON.stringify(DICTIONARY)],
        )
      ).rows[0].id as string;
    data = await doc("survey.csv");
    bare = await doc("no-questionnaire.csv");
    const questionnaire = (
      await db.pool.query("insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'instrument', 'q.docx', $3) returning id", [tenant, run, randomUUID()])
    ).rows[0].id;
    const item = (
      await db.pool.query(
        "insert into instrument_items (tenant_id, run_id, document_id, item_order, code, item_text, response_options) values ($1, $2, $3, 1, 'Q1', 'Would you buy again?', $4) returning id",
        [tenant, run, questionnaire, JSON.stringify([{ code: "1", label: "Yes" }, { code: "2", label: "No" }, { code: "99", label: "Don't know" }])],
      )
    ).rows[0].id;
    link = (
      await db.pool.query(
        "insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status) values ($1, $2, $3, $4, 'Q1', 'code', 1, 'confirmed') returning id",
        [tenant, run, item, data],
      )
    ).rows[0].id;
    // A saved table that must be left exactly as it is by a refused build.
    await db.pool.query(
      "insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type) values ($1, $2, $3, 100, 'Saved earlier', $4, $5, 'aggregated')",
      [tenant, run, data, JSON.stringify(["Q1", "%"]), JSON.stringify([{ Q1: "Yes", "%": 50 }])],
    );
    await db.pool.query(
      `create role ${role} login nosuperuser nobypassrls; grant usage on schema public to ${role};
       grant select, insert, update, delete on all tables in schema public to ${role};
       grant usage, select on all sequences in schema public to ${role}`,
    );
    const url = new URL(db.url);
    url.username = role;
    url.password = "";
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    process.env.DATABASE_URL = url.toString();
  }, 180000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    const admin = new Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`drop role if exists ${role}`);
    } finally {
      await admin.end();
    }
  });

  beforeEach(() => {
    engineCalls.length = 0;
  });

  const snapshot = async () => ({
    tables: (await db.pool.query("select id, label, rows from document_tables where run_id = $1 order by table_index", [run])).rows,
    links: (await db.pool.query("select id, status, variable from instrument_links where run_id = $1", [run])).rows,
  });

  it("confirmed links give the confirmed labels; a file without links gives none", async () => {
    const { getLabelOverlay } = await import("../instruments");
    const overlay = await getLabelOverlay(tenant, run, data);
    expect(overlay?.valueLabels.Q1).toEqual({ "1": "Yes", "2": "No", "99": "Don't know" });
    expect(await getLabelOverlay(tenant, run, bare)).toBeNull();
  });

  it("a failed read refuses the dictionary, categories and cross tab, writes nothing, and recovers on retry", async () => {
    const { getLabelOverlay, InstrumentMeaningUnavailableError } = await import("../instruments");
    const { loadVariableDictionary, loadCategories, buildCrosstab } = await import("../crosstabs");
    const before = await snapshot();

    await db.pool.query(`revoke select on instrument_links from ${role}`);
    try {
      await expect(getLabelOverlay(tenant, run, data)).rejects.toBeInstanceOf(InstrumentMeaningUnavailableError);
      await expect(getLabelOverlay(tenant, run, data)).rejects.toThrow(/confirmed questionnaire labels could not be read/);
      await expect(loadVariableDictionary(tenant, run, data)).rejects.toBeInstanceOf(InstrumentMeaningUnavailableError);
      await expect(loadCategories(tenant, run, data, "Q1")).rejects.toBeInstanceOf(InstrumentMeaningUnavailableError);
      await expect(
        buildCrosstab(tenant, run, data, { rowItems: [{ key: "Q1", label: "Q1", vars: ["Q1"] }], columnVars: [] } as never),
      ).rejects.toBeInstanceOf(InstrumentMeaningUnavailableError);
      // Refused before any calculation: reading the file's own structure for the dictionary is
      // allowed, but no categories or table were computed without the confirmed meaning.
      expect(engineCalls.filter((c) => c[0] !== "dictionary")).toHaveLength(0);
      // Nothing written, and the confirmed link is untouched.
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.pool.query(`grant select on instrument_links to ${role}`);
    }

    // Retry: the confirmed meaning reaches the engine again.
    expect((await getLabelOverlay(tenant, run, data))?.valueLabels.Q1).toEqual({ "1": "Yes", "2": "No", "99": "Don't know" });
    engineCalls.length = 0;
    await loadCategories(tenant, run, data, "Q1");
    expect(engineCalls.map((c) => c[0])).toEqual(["categories"]);
    expect((engineCalls[0][3] as { overlay: { valueLabels: Record<string, unknown> } }).overlay.valueLabels.Q1).toEqual({ "1": "Yes", "2": "No", "99": "Don't know" });
    expect((await snapshot()).links).toEqual(before.links);
    expect(link).toBeTruthy();
  });

  it("a database without the questionnaire table is the supported old schema: no overlay, no error", async () => {
    const { getLabelOverlay } = await import("../instruments");
    const { loadCategories } = await import("../crosstabs");
    await db.pool.query("alter table instrument_links rename to instrument_links_hidden");
    try {
      expect(await getLabelOverlay(tenant, run, data)).toBeNull();
      await loadCategories(tenant, run, data, "Q1");
      expect(engineCalls.map((c) => c[0])).toEqual(["categories"]);
      expect((engineCalls[0][3] as { overlay: unknown }).overlay).toBeNull();
    } finally {
      await db.pool.query("alter table instrument_links_hidden rename to instrument_links");
    }
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("GT100-F01 a failed confirmed-questionnaire lookup refuses the calculation", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
