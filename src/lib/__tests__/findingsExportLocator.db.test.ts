// EF-FND-F04 (batch 62): the Findings spreadsheet carries each finding's exact source locator. Through
// the real export route against a real disposable PostgreSQL. Covered: two tables of one file; two
// files with the same name; two Cross tabs of one file that differ only by filter; a report finding
// with page and quote; a finding whose file was removed from the project; and one with no recorded
// source. Every finding has a row on the Evidence sheet, joined by Finding ID, and an unrecorded field
// says so instead of being blank.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/analysisPlan", async () => await import("../analysisPlan"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Sheet = Record<string, string | number>[];

describe.skipIf(!TEST_DATABASE_URL)("findings export: exact source locator (real database, actual route)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  const ids: Record<string, string> = {};
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [tenant]);
    run = await one("insert into runs (tenant_id, project_name) values ($1, 'Locator') returning id", [tenant]);
    const doc = (kind: string, name: string) =>
      one(
        "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type) values ($1, $2, $3, $4, $5, case when $3 = 'table' then 'aggregated' end) returning id",
        [tenant, run, kind, name, randomUUID()],
      );
    ids.dataA = await doc("table", "survey.xlsx");
    ids.dataB = await doc("table", "survey.xlsx"); // same name, different file
    ids.report = await doc("report", "report.pdf");
    ids.removed = await doc("table", "old.xlsx");
    await db.pool.query("update documents set removed_at = now() where id = $1", [ids.removed]);
    const table = (docId: string, index: number, label: string, crosstab: unknown = null) =>
      one(
        `insert into document_tables (tenant_id, run_id, document_id, table_index, label, ingestion_type, crosstab, crosstab_status)
         values ($1, $2, $3, $4, $5, 'aggregated', $6, $7) returning id`,
        [tenant, run, docId, index, label, crosstab ? JSON.stringify(crosstab) : null, crosstab ? "committed" : null],
      );
    ids.t1 = await table(ids.dataA, 0, "Waiting times");
    ids.t2 = await table(ids.dataA, 1, "Payment methods");
    ids.t3 = await table(ids.dataB, 0, "Waiting times");
    ids.ctNorth = await table(ids.dataA, 100, "Satisfaction by Segment", { filters: [{ text: "Region is North" }], weightVar: "wt" });
    ids.ctSouth = await table(ids.dataA, 101, "Satisfaction by Segment", { filters: [{ text: "Region is South" }], weightVar: "wt" });
    ids.tRemoved = await table(ids.removed, 0, "Old table");
    const finding = (text: string, cols: Record<string, unknown>) => {
      const keys = Object.keys(cols);
      return one(
        `insert into findings (tenant_id, run_id, origin, finding_text, status${keys.map((k) => `, ${k}`).join("")})
         values ($1, $2, $3, $4, 'accepted'${keys.map((_, i) => `, $${i + 5}`).join("")}) returning id`,
        [tenant, run, cols.source_document_id ? "stated" : "generated", text, ...keys.map((k) => (typeof cols[k] === "object" && cols[k] !== null ? JSON.stringify(cols[k]) : cols[k]))],
      );
    };
    ids.f1 = await finding("Waiting is longer in A.", { source_table_id: ids.t1, source_cells: { rowIndices: [2, 4] }, stated_stats: { variable1: "Wait", variable2: "Age" } });
    ids.f2 = await finding("Cash is most common.", { source_table_id: ids.t2, stated_stats: { bannerColumn: "Region", stubColumn: "Method" } });
    ids.f3 = await finding("Waiting is longer in B.", { source_table_id: ids.t3, stated_stats: {} });
    ids.fNorth = await finding("Satisfaction higher for A.", { source_table_id: ids.ctNorth, stated_stats: { question: "Satisfaction", answer: "Mean", bannerVariable: "Segment", column: "A" } });
    ids.fSouth = await finding("Satisfaction higher for A.", { source_table_id: ids.ctSouth, stated_stats: { question: "Satisfaction", answer: "Mean", bannerVariable: "Segment", column: "A" } });
    ids.fReport = await finding("Satisfaction was 61%.", { source_document_id: ids.report, source_page: 4, source_quote: "Satisfaction was 61% in this study." });
    ids.fReportNoPage = await finding("Adoption grew.", { source_document_id: ids.report });
    ids.fRemoved = await finding("Old finding.", { source_table_id: ids.tRemoved });
    ids.fNone = await finding("No source.", {});
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function exported() {
    const { GET } = await import("../../app/api/runs/[id]/findings/export/route");
    const res = await GET(new Request("http://local/x"), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const book = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const findings = XLSX.utils.sheet_to_json<Sheet[number]>(book.Sheets.Findings);
    const evidence = XLSX.utils.sheet_to_json<Sheet[number]>(book.Sheets.Evidence);
    const byId = (id: string) => evidence.find((r) => r["Finding ID"] === id)!;
    return { findings, evidence, byId };
  }

  it("every finding has an Evidence row; no locator field is blank", async () => {
    const { findings, evidence } = await exported();
    expect(evidence).toHaveLength(findings.length);
    expect(new Set(evidence.map((r) => r["Finding ID"]))).toEqual(new Set(findings.map((r) => r["Finding ID"])));
    for (const row of evidence) {
      for (const k of ["Source state", "File", "File ID", "Table", "Table ID", "Sheet", "Page", "Quote", "Rows", "Variables", "Filters", "Weight"]) {
        expect(String(row[k] ?? "").trim(), `${k} of ${row["Finding ID"]}`).not.toBe("");
      }
    }
  });

  it("two tables of one file, and the same-named table of another file, are told apart", async () => {
    const { byId } = await exported();
    const [a, b, c] = [byId(ids.f1), byId(ids.f2), byId(ids.f3)];
    expect(a).toMatchObject({ File: "survey.xlsx", "File ID": ids.dataA, Table: "Table 1: Waiting times", "Table ID": ids.t1, Rows: "2 rows: 3, 5", Variables: "Wait with Age" });
    expect(b).toMatchObject({ File: "survey.xlsx", "File ID": ids.dataA, Table: "Table 2: Payment methods", "Table ID": ids.t2, Variables: "Method by Region" });
    expect(c).toMatchObject({ File: "survey.xlsx", "File ID": ids.dataB, Table: "Table 1: Waiting times", "Table ID": ids.t3, Variables: "Not recorded" });
    expect(c["File ID"]).not.toBe(a["File ID"]);
    expect(a.Rows).not.toBe(c.Rows);
  });

  it("two Cross tabs that differ only by filter are told apart by filter and table id", async () => {
    const { byId, findings } = await exported();
    const north = byId(ids.fNorth);
    const south = byId(ids.fSouth);
    expect(north).toMatchObject({ Table: "Cross tab: Satisfaction by Segment", Filters: "Region is North", Weight: "wt", "Table ID": ids.ctNorth });
    expect(south).toMatchObject({ Filters: "Region is South", "Table ID": ids.ctSouth });
    expect(north.Variables).toContain("Question: Satisfaction");
    expect(findings.filter((r) => r.Table === "Cross tab: Satisfaction by Segment")).toHaveLength(2);
  });

  it("a report finding carries its page and quote; one without a page says it was not recorded", async () => {
    const { byId } = await exported();
    expect(byId(ids.fReport)).toMatchObject({ File: "report.pdf", Page: "4", Quote: "Satisfaction was 61% in this study.", Table: "Not applicable", Rows: "Not applicable" });
    expect(byId(ids.fReportNoPage)).toMatchObject({ Page: "Not recorded", Quote: "Not recorded" });
  });

  it("a removed file and an unrecorded source are stated, not blank", async () => {
    const { byId, findings } = await exported();
    expect(byId(ids.fRemoved)).toMatchObject({ "Source state": "Source file removed from the project", File: "old.xlsx" });
    expect(byId(ids.fNone)).toMatchObject({ "Source state": "Source not recorded", File: "Not recorded", "File ID": "Not recorded" });
    expect(findings.find((r) => r["Finding ID"] === ids.fNone)).toMatchObject({ Source: "Source not recorded", "Source state": "Source not recorded" });
  });
});
