// Codex T2-F02 (independent T2 review, 30 October 2026): a table running on across three five-page reading parts was
// stored as two tables, because the join compared the accumulated table's start page with the previous part's last
// page. documentTableShape.joinAcrossParts now keeps the start page as the citation page and tracks the last page
// reached separately.
//
// These run the actual extractAndStoreDocumentTables (parts read concurrently, shaped, joined, stored with their
// reading notes in one transaction) against a real disposable PostgreSQL built from every migration. Only external
// boundaries are stubbed: the page text of the PDF (extractDocumentText, which converts and reads the stored file) and
// the model's answer for each part (keyed by the pages it is sent).
//   three parts   pages 1-5, 6-10, 11-15: one stored table cited at page 5, every row in page order, the continuation
//                 notes recorded; a titled table later on page 13 is stored separately
//   incomplete    a reread with one part cut off fails, names the part count, and leaves the stored tables as they
//                 were; a part answering without its list of tables fails the same way
//   retry         the same reread once every part answers stores the joined table again under the same table id
// Skipped, with the reason, without a test database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: () => ({ download: async () => ({ data: null, error: { message: "not used" } }) }) } } }));

/** 15 pages of text; the text itself is not read by the stubbed model. */
vi.mock("../extractFindings", () => ({
  extractDocumentText: vi.fn(async () => ({ pages: Array.from({ length: 15 }, (_, i) => ({ pageNumber: i + 1, text: `Page ${i + 1} text` })) })),
}));

type Answer = { stop_reason: string; tables?: unknown };
const model = vi.hoisted(() => ({ answers: new Map<number, Answer>() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        const first = Number(/--- Page (\d+) ---/.exec(req.messages[0].content)?.[1]);
        const a = model.answers.get(first);
        if (!a) throw new Error(`test: no answer for the part starting at page ${first}`);
        const input = a.tables === undefined ? {} : { tables: a.tables };
        return { stop_reason: a.stop_reason, content: [{ type: "tool_use", name: "record_tables", input }], usage: { input_tokens: 1, output_tokens: 1 } };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const rowsFor = (page: number) => [[`R${page}a`, page], [`R${page}b`, page]];
const CONTINUING = {
  1: { stop_reason: "tool_use", tables: [{ page_number: 5, label: "Table 1: Region", headers: ["Region", "n"], rows: rowsFor(5) }] },
  6: { stop_reason: "tool_use", tables: [{ page_number: 6, last_page_number: 10, headers: ["Region", "n"], rows: rowsFor(6) }] },
  11: {
    stop_reason: "tool_use",
    tables: [
      { page_number: 11, headers: ["Region", "n"], rows: rowsFor(11) },
      { page_number: 13, label: "Table 2: Brand", headers: ["Brand", "%"], rows: [["K", 40], ["L", 60]] },
    ],
  },
} as Record<number, Answer>;

describe.skipIf(!TEST_DATABASE_URL)("a document table running on across three reading parts (Codex T2-F02; real database)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  let doc = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const stored = () => q("select id, table_index, label, source_page, headers, rows from document_tables where document_id = $1 order by table_index", [doc]);
  const answer = (overrides: Record<number, Answer> = {}) => {
    model.answers = new Map(Object.entries({ ...CONTINUING, ...overrides }).map(([k, v]) => [Number(k), v]));
  };
  const read = async () => (await import("../documentTables")).extractAndStoreDocumentTables(tenant, run, doc);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id;
    doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path)
       values ($1, $2, 'table', 'aggregated', 'tables.pdf', $3) returning id`,
      [tenant, run, `${tenant}/${run}/tables.pdf`],
    ))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("three parts: one table cited at its start page, all rows in order, notes recorded; the later table stays apart", async () => {
    answer();
    const ids = await read();
    expect(ids).toHaveLength(2);
    const [joined, brand] = await stored();
    expect(joined).toMatchObject({ table_index: 0, label: "Table 1: Region", source_page: 5, headers: ["Region", "n"] });
    expect(joined.rows.map((r: { Region: string }) => r.Region)).toEqual(["R5a", "R5b", "R6a", "R6b", "R11a", "R11b"]);
    expect(brand).toMatchObject({ table_index: 1, label: "Table 2: Brand", source_page: 13, rows: [{ Brand: "K", "%": 40 }, { Brand: "L", "%": 60 }] });
    const trace = await q("select detail from trace where run_id = $1 and event = 'document_table_reading_notes' order by id", [run]);
    expect(trace.at(-1)!.detail).toEqual({
      documentId: doc,
      tables: [{ tableId: joined.id, label: "Table 1: Region", notes: ["Continues on page 6; read as one table.", "Continues on page 11; read as one table."] }],
    });
  });

  it("incomplete: a part cut off, or answering without its list, fails the reread and leaves the stored tables as they were", async () => {
    const before = await stored();
    const notesBefore = await q("select count(*)::int as n from trace where run_id = $1 and event = 'document_table_reading_notes'", [run]);
    answer({ 6: { stop_reason: "max_tokens", tables: [{ page_number: 6, headers: ["Region", "n"], rows: rowsFor(6).slice(0, 1) }] } });
    await expect(read()).rejects.toThrow(/^1 of 3 part\(s\) of this document could not be read for tables, so no tables were stored: .*cut off/);
    expect(await stored()).toEqual(before);
    answer({ 11: { stop_reason: "tool_use" } });
    await expect(read()).rejects.toThrow(/^1 of 3 part\(s\).*returned no list of tables/);
    expect(await stored()).toEqual(before);
    // Nothing was written: no reading notes for a read that did not finish.
    expect(await q("select count(*)::int as n from trace where run_id = $1 and event = 'document_table_reading_notes'", [run])).toEqual(notesBefore);
  });

  it("retry: once every part answers, the joined table is stored again under the same table id", async () => {
    const before = await stored();
    answer();
    expect(await read()).toEqual(before.map((t) => t.id));
    expect(await stored()).toEqual(before);
  });
});
