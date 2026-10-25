// SEC500-F01 (Codex, 2026-10-24): an answer with no findings list, or whose findings were all invalid,
// was published as a complete reading with zero findings. The report's previous unreviewed findings were
// moved to history and the screen showed "Extracted, 0 findings". These run the actual
// extractFindingsFromDocument (text read, chunk validation, staged replacement and publication) on a
// real disposable PostgreSQL. Controlled: the model's answer (scripted per case), storage (the report
// text), Next's cache and the verification hook.
//   malformed  no findings member; a non-array member; every record invalid: the reading fails with an
//              actionable message, nothing is replaced, the cause is traced
//   mixed      some records valid: on a re-read the partial reading is withheld and the previous findings
//              stay; on a first read the valid ones are published and the document counts as read in part
//   controls   an explicit empty list is a genuine empty reading; a cut-off answer and a model error keep
//              the previous reading; a researcher-edited finding is kept; a healthy retry replaces
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
const hooks = vi.hoisted(() => ({
  storageText: "",
  answer: (): unknown => ({ stop_reason: "tool_use", usage: {}, content: [] }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../tableComputation", () => ({ getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async () => ({ data: { arrayBuffer: async () => Buffer.from(hooks.storageText) }, error: null })),
        upload: vi.fn(async () => ({ error: null })),
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: { messages: { create: vi.fn(async () => hooks.answer()) } },
}));
vi.setConfig({ testTimeout: 60000 });

const TENANT = "00000000-0000-4000-8000-0000000000f8";
const OLD_Q = "Satisfaction rose to 72 percent among members this year.";
const NEW_Q = "Renewals fell to 61 percent after the price change.";
const TEXT = `Annual member survey report for the loyalty programme. ${OLD_Q} ${NEW_Q} The rest of this report describes the method in detail and lists the tables.`;
const valid = (quote = NEW_Q) => ({ finding_text: "Renewals fell to 61%.", finding_kind: "fact", theme: "Retention", data_type: "quantitative", source_quote: quote });
const invalidKind = { finding_text: "Satisfaction is 72%.", finding_kind: "guess", theme: "Satisfaction", data_type: "quantitative", source_quote: OLD_Q };
const tool = (input: unknown, stop = "tool_use") => () => ({ stop_reason: stop, usage: { output_tokens: 10 }, content: [{ type: "tool_use", id: "tu", name: "record_findings", input }] });

describe.skipIf(!TEST_DATABASE_URL)("SEC500-F01 a malformed reading never replaces findings (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0];
  const report = async (name: string) =>
    (await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1,$2,'report',$3,$3) returning id", [TENANT, run, name])).id as string;
  /** A finding as an earlier automatic reading leaves it: accepted, provenance tracked, never reviewed. */
  const priorFinding = async (doc: string) =>
    (await one("insert into findings (tenant_id, run_id, origin, finding_text, finding_kind, status, theme, source_document_id, source_quote) values ($1,$2,'stated','Satisfaction is 72%.','fact','accepted','Satisfaction',$3,$4) returning id", [TENANT, run, doc, OLD_Q])).id as string;
  const active = async (doc: string) =>
    (await db.pool.query("select id, finding_text from findings where source_document_id = $1 and status <> 'rejected' order by finding_text", [doc])).rows;
  const traces = async (doc: string) =>
    (await db.pool.query("select detail->>'reason' as reason from trace where run_id = $1 and event = 'extract_findings_bad_response' and detail->>'documentId' = $2 order by id", [run, doc])).rows.map((r) => r.reason);
  const extract = async (doc: string) => (await import("../extractFindings")).extractFindingsFromDocument(TENANT, run, doc);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [TENANT]);
    run = (await one("insert into runs (tenant_id, project_name, entry_point) values ($1, 'Malformed reading', 'generate') returning id", [TENANT])).id;
    hooks.storageText = TEXT;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it.each([
    ["no findings member", {}, "no_findings_list", /had no findings list, so it could not be used and nothing was replaced/],
    ["a findings member that is not a list", { findings: "none" }, "no_findings_list", /had no findings list/],
    ["every record invalid", { findings: [invalidKind, { ...valid(), source_quote: "" }] }, "no_usable_findings", /None of the 2 findings Claude returned .* could be used/],
  ])("%s: the reading fails, the previous finding stays, the cause is traced", async (_label, input, reason, message) => {
    const doc = await report(`malformed-${reason}-${Math.random()}.txt`);
    const prior = await priorFinding(doc);
    hooks.answer = tool(input);
    await expect(extract(doc)).rejects.toThrow(message);
    expect((await active(doc)).map((f) => f.id)).toEqual([prior]);
    expect(await traces(doc)).toEqual([reason]);
  });

  it("some records valid on a re-read: the partial reading is withheld and the previous finding stays", async () => {
    const doc = await report("mixed-reread.txt");
    const prior = await priorFinding(doc);
    hooks.answer = tool({ findings: [valid(), invalidKind] });
    const r = await extract(doc);
    expect(r.published).toBe(false);
    expect(r.failedParts).toBe(1);
    expect(r.notPublishedReason).toMatch(/could not be read in full, so the new reading was not applied and the previous 1 finding is unchanged.*1 of the findings Claude returned .* could not be used and were left out/);
    expect((await active(doc)).map((f) => f.id)).toEqual([prior]);
    expect(await traces(doc)).toEqual(["some_findings_unusable"]);
  });

  it("some records valid on a first read: the valid one is published and the document counts as read in part", async () => {
    const doc = await report("mixed-first.txt");
    hooks.answer = tool({ findings: [valid(), invalidKind] });
    const r = await extract(doc);
    expect(r.published).toBe(true);
    expect(r.failedParts).toBe(1);
    expect((await active(doc)).map((f) => f.finding_text)).toEqual(["Renewals fell to 61%."]);
  });

  it("an explicit empty list is a genuine empty reading and replaces an unreviewed finding", async () => {
    const doc = await report("genuine-empty.txt");
    await priorFinding(doc);
    hooks.answer = tool({ findings: [] });
    const r = await extract(doc);
    expect(r).toMatchObject({ published: true, failedParts: 0, rows: [] });
    expect(await active(doc)).toEqual([]);
    expect(await traces(doc)).toEqual([]);
  });

  it("a cut-off answer and a model error keep the previous reading; a researcher-edited finding is kept by a malformed reading", async () => {
    const doc = await report("controls.txt");
    const prior = await priorFinding(doc);
    hooks.answer = tool({ findings: [valid()] }, "max_tokens");
    await expect(extract(doc)).rejects.toThrow(/cut off/);
    hooks.answer = () => { throw new Error("provider unavailable"); };
    await expect(extract(doc)).rejects.toThrow(/provider unavailable/);
    await db.pool.query("update findings set human_reviewed_at = now(), human_edited_fields = array['finding_text'], finding_text = 'Satisfaction is 72% (edited).' where id = $1", [prior]);
    hooks.answer = tool({});
    await expect(extract(doc)).rejects.toThrow(/no findings list/);
    expect(await active(doc)).toEqual([{ id: prior, finding_text: "Satisfaction is 72% (edited)." }]);
  });

  it("a healthy retry after a malformed reading replaces the unreviewed finding", async () => {
    const doc = await report("retry.txt");
    await priorFinding(doc);
    hooks.answer = tool({ findings: [invalidKind] });
    await expect(extract(doc)).rejects.toThrow(/could be used/);
    hooks.answer = tool({ findings: [valid()] });
    const r = await extract(doc);
    expect(r).toMatchObject({ published: true, failedParts: 0 });
    expect((await active(doc)).map((f) => f.finding_text)).toEqual(["Renewals fell to 61%."]);
  });
});
