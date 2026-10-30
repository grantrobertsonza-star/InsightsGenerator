// Batch 49 (Grant, 27 October 2026): a questionnaire question worded identically to a codebook entry the
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

describe.skipIf(!TEST_DATABASE_URL)("links through the codebook (real database, migration 0125)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let p: Awaited<ReturnType<typeof project>>;
  const linksOf = async (item: string) => (await db.pool.query("select variable, method, status, basis_item_id from instrument_links where item_id = $1 order by variable", [item])).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [tenant]);
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    process.env.DATABASE_URL = db.url;
    p = await project(db, tenant);
  }, 180_000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("1A is linked to Q1 through the confirmed codebook entry, confirmed, with the entry as its basis", async () => {
    const { suggestInstrumentLinks, getInstrumentLinks, getConfirmedItemsForData } = await import("../instruments");
    expect(await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data)).toMatchObject({ fromCodebook: 1, codebookUnavailable: false });
    expect(await linksOf(p.q1a)).toEqual([{ variable: "Q1", method: "codebook", status: "confirmed", basis_item_id: p.cbQ1 }]);
    const shown = (await getInstrumentLinks(tenant, p.questionnaire)).find((l) => l.itemId === p.q1a)!;
    expect(shown).toMatchObject({ variable: "Q1", method: "codebook", status: "confirmed", basisCode: "Q1", basisHolds: true });
    // Calculations see it: the questionnaire's 1A is a confirmed meaning of Q1, after the codebook's own entry.
    const confirmed = (await getConfirmedItemsForData(tenant, p.run, p.data)).filter((c) => c.variable === "Q1");
    expect(confirmed.map((c) => [c.code, c.instrumentType, c.confirmed])).toEqual([["Q1", "codebook", true], ["1A", "questionnaire", true]]);
  });

  it("matching again changes nothing and adds no second link", async () => {
    const { suggestInstrumentLinks } = await import("../instruments");
    expect(await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data)).toMatchObject({ fromCodebook: 0 });
    expect(await linksOf(p.q1a)).toEqual([{ variable: "Q1", method: "codebook", status: "confirmed", basis_item_id: p.cbQ1 }]);
  });

  it("withdrawing the codebook entry withdraws the link through it, which says so; confirming the entry again restores it", async () => {
    const { getInstrumentLinks, getConfirmedItemsForData } = await import("../instruments");
    await db.pool.query("update instrument_links set status = 'rejected' where id = $1", [p.cbLink]);
    expect((await getConfirmedItemsForData(tenant, p.run, p.data)).filter((c) => c.variable === "Q1")).toEqual([]);
    expect((await getInstrumentLinks(tenant, p.questionnaire)).find((l) => l.itemId === p.q1a)).toMatchObject({ method: "codebook", status: "confirmed", basisHolds: false });
    await db.pool.query("update instrument_links set status = 'confirmed' where id = $1", [p.cbLink]);
    expect((await getConfirmedItemsForData(tenant, p.run, p.data)).filter((c) => c.variable === "Q1").map((c) => c.code)).toEqual(["Q1", "1A"]);
  });

  it("the researcher's own rejection is never overwritten by matching again", async () => {
    const { suggestInstrumentLinks } = await import("../instruments");
    await db.pool.query("update instrument_links set status = 'rejected' where item_id = $1", [p.q1a]);
    expect(await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data)).toMatchObject({ fromCodebook: 0 });
    expect((await linksOf(p.q1a)).map((l) => l.status)).toEqual(["rejected"]);
  });

  it("a deleted codebook entry leaves the link with no basis, which does not count as confirmed", async () => {
    const { suggestInstrumentLinks, getConfirmedItemsForData } = await import("../instruments");
    const fresh = await project(db, tenant);
    await suggestInstrumentLinks(tenant, fresh.run, fresh.questionnaire, fresh.data);
    await db.pool.query("delete from instrument_items where id = $1", [fresh.cbQ1]);
    expect(await linksOf(fresh.q1a)).toEqual([{ variable: "Q1", method: "codebook", status: "confirmed", basis_item_id: null }]);
    expect((await getConfirmedItemsForData(tenant, fresh.run, fresh.data)).filter((c) => c.variable === "Q1")).toEqual([]);
  });

  // B49-F01 (Codex, 28 October 2026): wording that differs in meaning was linked as identical and confirmed.
  async function meaningPair(questionnaireText: string, codebookText: string) {
    const fresh = await project(db, tenant);
    await db.pool.query("update instrument_items set item_text = $2 where id = $1", [fresh.cbQ1, codebookText]);
    await db.pool.query("update instrument_items set item_text = $2 where id = $1", [fresh.q1a, questionnaireText]);
    return fresh;
  }
  const INCOME_LT = "Is your monthly household income < 5000 dollars?";
  const INCOME_GT = "Is your monthly household income > 5000 dollars?";

  it("B49-F01: different meanings are not linked through the codebook, and nothing is confirmed for them", async () => {
    const { suggestInstrumentLinks, getConfirmedItemsForData } = await import("../instruments");
    for (const [a, b] of [[INCOME_LT, INCOME_GT], ["How satisfied are you with service in 東京?", "How satisfied are you with service in 大阪?"], ["18 years and older should receive this benefit automatically", "21 years and older should receive this benefit automatically"]]) {
      const f = await meaningPair(a, b);
      expect(await suggestInstrumentLinks(tenant, f.run, f.questionnaire, f.data), a).toMatchObject({ fromCodebook: 0 });
      expect((await linksOf(f.q1a)).filter((l) => l.status === "confirmed"), a).toEqual([]);
      expect((await getConfirmedItemsForData(tenant, f.run, f.data)).map((c) => c.code), a).toEqual(["Q1"]);
    }
  });

  it("B49-F01: a false link left by the first rule is not used and says why; matching again makes it a suggestion, once; corrected wording links", async () => {
    const { suggestInstrumentLinks, getConfirmedItemsForData, getInstrumentLinks } = await import("../instruments");
    const f = await meaningPair(INCOME_LT, INCOME_GT);
    // As the first rule stored it: confirmed through the codebook.
    await db.pool.query(
      "insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status, basis_item_id) values ($1,$2,$3,$4,'Q1','codebook',1,'confirmed',$5)",
      [tenant, f.run, f.q1a, f.data, f.cbQ1],
    );
    expect((await getConfirmedItemsForData(tenant, f.run, f.data)).map((c) => c.code)).toEqual(["Q1"]);
    expect((await getInstrumentLinks(tenant, f.questionnaire)).find((l) => l.itemId === f.q1a)).toMatchObject({ method: "codebook", basisHolds: false, basisLapse: "wording" });
    await suggestInstrumentLinks(tenant, f.run, f.questionnaire, f.data);
    expect(await linksOf(f.q1a)).toEqual([{ variable: "Q1", method: "wording", status: "suggested", basis_item_id: null }]);
    // Again: suggestions are worked out afresh, as on every match; this pair has no ordinary one (the data
    // label differs), so none remains. Nothing is confirmed, nothing duplicated, and again gives the same.
    for (let i = 0; i < 2; i++) {
      expect(await suggestInstrumentLinks(tenant, f.run, f.questionnaire, f.data)).toMatchObject({ fromCodebook: 0 });
      expect(await linksOf(f.q1a)).toEqual([]);
    }
    // The questionnaire corrected to the codebook's wording: linked through it, confirmed.
    await db.pool.query("update instrument_items set item_text = $2 where id = $1", [f.q1a, INCOME_GT]);
    expect(await suggestInstrumentLinks(tenant, f.run, f.questionnaire, f.data)).toMatchObject({ fromCodebook: 1 });
    expect(await linksOf(f.q1a)).toEqual([{ variable: "Q1", method: "codebook", status: "confirmed", basis_item_id: f.cbQ1 }]);
    expect((await getConfirmedItemsForData(tenant, f.run, f.data)).map((c) => c.code)).toEqual(["Q1", "1A"]);
  });

  it("B49-F01: a link the researcher confirmed or rejected is never changed by the stricter rule", async () => {
    const { suggestInstrumentLinks } = await import("../instruments");
    const f = await meaningPair(INCOME_LT, INCOME_GT);
    await db.pool.query(
      "insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status) values ($1,$2,$3,$4,'Q1','manual',1,'confirmed')",
      [tenant, f.run, f.q1a, f.data],
    );
    await suggestInstrumentLinks(tenant, f.run, f.questionnaire, f.data);
    expect(await linksOf(f.q1a)).toEqual([{ variable: "Q1", method: "manual", status: "confirmed", basis_item_id: null }]);
  });
});
