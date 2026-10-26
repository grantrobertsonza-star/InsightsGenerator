// LBL-01 (2026-10-26): a codebook and a questionnaire linked to the same raw data file. Each
// document decides its own links, so both can confirm the same variable; the confirmation rule
// (IR-04) still holds inside one document. The labels the app applies come from the codebook first,
// the question wording from the questionnaire, and a disagreement in answer labels is reported.
// Real disposable PostgreSQL and the actual actions; the variable dictionary is the mocked boundary.
//   - matching the questionnaire after the codebook's Q5 is confirmed still suggests Q5 (it was skipped)
//   - Confirm, bulk Confirm and a hand choice each succeed for the second document (they were refused)
//   - two questions of one document still cannot both confirm a variable
//   - getLabelOverlay applies the codebook's answer labels whichever document was uploaded first,
//     and lists the disagreement
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../extractFindings", () => ({ extractDocumentText: vi.fn() }));
// The file's own dictionary: Q5 has no label of its own, Q6 has its own label and answer labels, Q7
// is documented nowhere.
const fileDictionary = {
  nCases: 10,
  variables: [
    { name: "Q5", label: "Q5", numeric: true, nValid: 10, pctValid: 100, nDistinct: 3, labelled: false, weightLike: false },
    { name: "Q6", label: "Uses mobile money", numeric: true, nValid: 10, pctValid: 100, nDistinct: 2, labelled: true, weightLike: false },
    { name: "Q7", label: "", numeric: true, nValid: 10, pctValid: 100, nDistinct: 4, labelled: false, weightLike: false },
  ],
};
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => fileDictionary),
  loadFileOwnVariableDictionary: vi.fn(async () => fileDictionary),
}));

describe.skipIf(!TEST_DATABASE_URL)("LBL-01 a codebook and a questionnaire for one data file", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, codebook: string, questionnaire: string, data: string;
  const items: Record<string, string> = {};
  const yesNoRefused = [{ code: "1", label: "Yes" }, { code: "2", label: "No" }, { code: "9", label: "Refused" }];
  const yesNo = [{ code: "1", label: "Yes" }, { code: "2", label: "No" }];
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic two sources')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    data = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','d.csv','d','raw') returning id", [tenant, run])).rows[0].id;
    // The questionnaire is uploaded first, so upload order alone would favour it.
    questionnaire = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type,uploaded_at) values($1,$2,'instrument','q.docx','q','questionnaire',now() - interval '1 hour') returning id", [tenant, run])).rows[0].id;
    codebook = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','cb.xlsx','cb','codebook') returning id", [tenant, run])).rows[0].id;
    const add = async (key: string, doc: string, order: number, code: string, text: string, options: unknown) =>
      (items[key] = (await db.pool.query("insert into instrument_items(tenant_id,run_id,document_id,item_order,code,item_text,response_options) values($1,$2,$3,$4,$5,$6,$7) returning id", [tenant, run, doc, order, code, text, JSON.stringify(options)])).rows[0].id);
    await add("cbQ5", codebook, 0, "Q5", "Bank account", yesNoRefused);
    await add("cbQ6", codebook, 1, "Q6", "Mobile money", yesNo);
    await add("qnQ5", questionnaire, 0, "Q5", "Do you have a bank account?", yesNo);
    await add("qnQ6", questionnaire, 1, "Q6", "Do you use mobile money?", yesNo);
    await add("cbQ99", codebook, 2, "Q99", "Interviewer notes", []);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(async () => {
    await db.pool.query("delete from instrument_links where run_id = $1", [run]);
  });
  const linkOf = async (item: string, variable: string) =>
    (await db.pool.query<{ id: string; status: string }>("select id, status from instrument_links where item_id = $1 and data_document_id = $2 and variable = $3", [item, data, variable])).rows[0];
  const confirmedItems = async (variable: string) =>
    (await db.pool.query<{ item_id: string }>("select item_id from instrument_links where data_document_id = $1 and variable = $2 and status = 'confirmed' order by item_id", [data, variable])).rows.map((r) => r.item_id).sort();

  it("suggests and confirms the questionnaire's Q5 after the codebook's Q5 is confirmed", async () => {
    const { setInstrumentTargetAction, confirmLinksAction, setLinkStatusAction } = await import("../instrumentActions");
    expect(await setInstrumentTargetAction(run, codebook, data)).toMatchObject({ ok: true, suggested: 2 });
    expect(await confirmLinksAction(run, codebook, 0.9)).toMatchObject({ ok: true, confirmed: 2, refused: [] });
    // Before LBL-01 matching skipped Q5 and Q6 here, as already taken by the codebook.
    expect(await setInstrumentTargetAction(run, questionnaire, data)).toMatchObject({ ok: true, suggested: 2 });
    const q5 = await linkOf(items.qnQ5, "Q5");
    expect(await setLinkStatusAction(run, q5.id, "confirmed")).toEqual({ ok: true });
    expect(await confirmLinksAction(run, questionnaire, 0.9)).toMatchObject({ ok: true, confirmed: 1, refused: [] });
    expect(await confirmedItems("Q5")).toEqual([items.cbQ5, items.qnQ5].sort());
    expect(await confirmedItems("Q6")).toEqual([items.cbQ6, items.qnQ6].sort());
  });

  it("lets a hand choice in the questionnaire stand beside the codebook's, and still refuses a second question of one document", async () => {
    const { chooseInstrumentLinkAction } = await import("../instrumentActions");
    expect(await chooseInstrumentLinkAction(run, codebook, items.cbQ5, data, "Q5")).toEqual({ ok: true });
    expect(await chooseInstrumentLinkAction(run, questionnaire, items.qnQ5, data, "Q5")).toEqual({ ok: true });
    // IR-04 inside the questionnaire: Q6's question may not also take Q5.
    expect(await chooseInstrumentLinkAction(run, questionnaire, items.qnQ6, data, "Q5")).toMatchObject({ ok: false, error: expect.stringMatching(/Q5 is already confirmed for Q5/) });
    expect(await confirmedItems("Q5")).toEqual([items.cbQ5, items.qnQ5].sort());
  });

  it("applies the codebook's answer labels and the questionnaire's wording, and lists the disagreement", async () => {
    const { chooseInstrumentLinkAction } = await import("../instrumentActions");
    for (const [doc, item] of [[questionnaire, items.qnQ5], [codebook, items.cbQ5]] as const) {
      expect(await chooseInstrumentLinkAction(run, doc, item, data, "Q5")).toEqual({ ok: true });
    }
    const { getLabelOverlay } = await import("../instruments");
    const o = await getLabelOverlay(tenant, run, data);
    expect(o?.valueLabels.Q5).toEqual({ "1": "Yes", "2": "No", "9": "Refused" });
    expect(o?.variableLabels.Q5).toBe("Q5. Bank account");
    expect(o?.questions.Q5).toBe("Q5. Do you have a bank account?");
    expect(o?.conflicts).toEqual([
      { variable: "Q5", applied: { documentId: codebook, instrumentType: "codebook", labels: { "1": "Yes", "2": "No", "9": "Refused" } }, other: { documentId: questionnaire, instrumentType: "questionnaire", labels: { "1": "Yes", "2": "No" } } },
    ]);
  });

  it("documents each variable with its sources, coverage, the disagreement and codebook entries with no column", async () => {
    const { chooseInstrumentLinkAction, setInstrumentTargetAction, loadLabelDocumentationAction } = await import("../instrumentActions");
    await setInstrumentTargetAction(run, questionnaire, data);
    await setInstrumentTargetAction(run, codebook, data);
    for (const [doc, item, variable] of [[questionnaire, items.qnQ5, "Q5"], [codebook, items.cbQ5, "Q5"], [questionnaire, items.qnQ6, "Q6"]] as const) {
      expect(await chooseInstrumentLinkAction(run, doc, item, data, variable)).toEqual({ ok: true });
    }
    const r = await loadLabelDocumentationAction(run, data);
    if (!r.ok) throw new Error(r.error);
    const d = r.documentation;
    // The codebook is listed first, whatever the upload order.
    expect(d.documents.map((x) => [x.type, x.entries, x.confirmed])).toEqual([["codebook", 3, 1], ["questionnaire", 2, 2]]);
    const byName = Object.fromEntries(d.variables.map((v) => [v.name, v]));
    expect(byName.Q5).toMatchObject({ fileLabel: null, labelFrom: "codebook", answerLabelsFrom: "codebook", conflict: true, codebook: { code: "Q5", answers: 3 }, questionnaire: { code: "Q5", answers: 2 } });
    // The file's own label and answer labels are never replaced, so they are reported as the source.
    expect(byName.Q6).toMatchObject({ fileLabel: "Uses mobile money", labelFrom: "data_file", answerLabelsFrom: "data_file", codebook: null, questionnaire: { code: "Q6" } });
    expect(byName.Q7).toMatchObject({ fileLabel: null, labelFrom: null, answerLabelsFrom: null, codebook: null, questionnaire: null });
    expect(d.coverage).toEqual({ variables: 3, documented: 2, byCodebook: 1, byQuestionnaire: 2, undocumented: 1 });
    expect(d.conflicts).toEqual([{ variable: "Q5", applied: { filename: "cb.xlsx", labels: { "1": "Yes", "2": "No", "9": "Refused" } }, other: { filename: "q.docx", labels: { "1": "Yes", "2": "No" } } }]);
    // Q6's codebook entry has a suggestion waiting; Q99 matched nothing.
    expect(d.entriesWithoutColumn.map((e) => [e.code, e.state])).toEqual([["Q6", "suggested"], ["Q99", "no_match"]]);
    expect(d.entriesWithoutColumnTotal).toBe(2);
  });

  it("refuses rather than reporting nothing documented when the links cannot be read, and refuses another project's file", async () => {
    const { loadLabelDocumentationAction } = await import("../instrumentActions");
    const other = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    expect(await loadLabelDocumentationAction(other, data)).toMatchObject({ ok: false });
    await db.pool.query("alter table instrument_items rename column response_options to response_options_moved");
    try {
      expect(await loadLabelDocumentationAction(run, data)).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read|Apply migration/) });
    } finally {
      await db.pool.query("alter table instrument_items rename column response_options_moved to response_options");
    }
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("LBL-01 a codebook and a questionnaire for one data file", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
