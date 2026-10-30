// Batch 49, before migration 0125: the same project as codebookWordingLinks.db.test.ts on a database
// stopped before 0125. Nothing is linked through the codebook and the match says why; confirmed meanings
// still read.
// (Shared setup below.) Batch 49 (Grant, 27 October 2026): a questionnaire question worded identically to a codebook entry the
// researcher confirmed is linked to that variable through the codebook. Through the actual
// suggestInstrumentLinks, getInstrumentLinks and getConfirmedItemsForData on a real disposable PostgreSQL
// with migration 0125, and on one stopped before it. The data file's dictionary comes from the engine
// boundary (mocked): Q1's own label is short, as in Grant's file, so the questionnaire can only reach Q1
// through the codebook. The texts are Grant's (1A has a double space the codebook lacks).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const { DICTIONARY } = vi.hoisted(() => ({
  DICTIONARY: {
    version: 14,
    layout: "rows_are_cases",
    nCases: 40,
    variables: [
      { name: "Q1", label: "Plan to vote June primary", numeric: true, valueLabels: { "1": "Planning to vote", "2": "Not planning", "3": "Already voted" } },
      { name: "Q2", label: "Gender", numeric: true, valueLabels: { "1": "Male", "2": "Female" } },
    ],
  },
}));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../parseStatsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parseStatsFile")>()),
  runStatsTool: vi.fn(async (tool: string) => (tool === "dictionary" ? structuredClone(DICTIONARY) : { items: [] })),
}));

const Q1A = "California will be holding a statewide primary election on June 2nd.  Are you planning or not planning to vote in this election, or have you already voted early or by mail?";
const CODEBOOK_Q1 = "California will be holding a statewide primary election on June 2nd. Are you planning or not planning to vote in this election, or have you already voted early or by mail?";

async function project(db: DisposableDb, tenant: string) {
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const run = await one("insert into runs (tenant_id, project_name) values ($1, 'Poll') returning id", [tenant]);
  const data = await one(
    `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, variable_dictionary)
     values ($1, $2, 'table', 'raw', 'poll.sav', $3, $4, $5) returning id`,
    [tenant, run, `${tenant}/${run}/poll.sav`, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }), JSON.stringify(DICTIONARY)],
  );
  const instrument = (name: string, type: string) =>
    one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, instrument_type) values ($1, $2, 'instrument', $3, $4, $5) returning id", [tenant, run, name, randomUUID(), type]);
  const codebook = await instrument("poll_codebook.xlsx", "codebook");
  const questionnaire = await instrument("poll_questionnaire.docx", "questionnaire");
  const item = (doc: string, order: number, code: string, text: string) =>
    one("insert into instrument_items (tenant_id, run_id, document_id, item_order, code, item_text, response_options) values ($1, $2, $3, $4, $5, $6, '[]') returning id", [tenant, run, doc, order, code, text]);
  const cbQ1 = await item(codebook, 1, "Q1", CODEBOOK_Q1);
  const cbLink = await one(
    "insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status) values ($1, $2, $3, $4, 'Q1', 'code', 1, 'confirmed') returning id",
    [tenant, run, cbQ1, data],
  );
  const q1a = await item(questionnaire, 1, "1A", Q1A);
  await item(questionnaire, 2, "2", "Are you male or female?");
  return { run, data, codebook, questionnaire, cbQ1, cbLink, q1a };
}

describe.skipIf(!TEST_DATABASE_URL)("links through the codebook before migration 0125 (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb("0125");
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [tenant]);
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    process.env.DATABASE_URL = db.url;
  }, 180_000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("nothing is linked through the codebook, the match says why, and confirmed meanings still read", async () => {
    const p = await project(db, tenant);
    const { suggestInstrumentLinks, getConfirmedItemsForData, getInstrumentLinks } = await import("../instruments");
    expect(await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data)).toMatchObject({ fromCodebook: 0, codebookUnavailable: true });
    const q1a = (await getInstrumentLinks(tenant, p.questionnaire)).filter((l) => l.itemId === p.q1a);
    expect(q1a.every((l) => l.status === "suggested" && l.method !== "codebook")).toBe(true);
    expect((await getConfirmedItemsForData(tenant, p.run, p.data)).map((c) => c.code)).toEqual(["Q1"]);
  });
});
