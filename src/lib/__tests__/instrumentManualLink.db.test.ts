// Choosing a questionnaire question's variable by hand (Grant, 2026-10-20: no way to pick a match
// when matching found none, or the wrong one). Real disposable PostgreSQL; the variable dictionary
// (read from the stored file) is the mocked boundary.
//   - a chosen link is stored confirmed, as "manual"; repeating the choice adds nothing
//   - a variable confirmed for one question is refused for another, with that question named
//   - a variable outside the data file, a question from another questionnaire, and a data file of
//     another project are refused, and leave nothing behind
//   - matching again keeps the chosen link and does not suggest its variable for another question
//   - the summary counts questions to check, not links
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../extractFindings", () => ({ extractDocumentText: vi.fn() }));
// Q1 matches REGION by code; Q2's wording matches nothing; Q3 is a grid stem with three variables.
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => ({
    variables: [
      { name: "REGION", label: "Region" },
      { name: "SAT", label: "Overall rating of the service" },
      { name: "Q3_1", label: "Grid item one" },
      { name: "Q3_2", label: "Grid item two" },
      { name: "Q3_3", label: "Grid item three" },
    ],
  })),
}));

describe.skipIf(!TEST_DATABASE_URL)("manual questionnaire links", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, otherRun: string, instrument: string, otherInstrument: string, data: string, otherData: string;
  const items: Record<string, string> = {};
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic manual links')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    otherRun = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    const doc = async (r: string, kind: string, extra: string) =>
      (await db.pool.query(`insert into documents(tenant_id,run_id,kind,source_filename,storage_path${extra ? "," + extra.split("=")[0] : ""}) values($1,$2,$3,'f','s'${extra ? ",'" + extra.split("=")[1] + "'" : ""}) returning id`, [tenant, r, kind])).rows[0].id;
    instrument = await doc(run, "instrument", "instrument_type=questionnaire");
    otherInstrument = await doc(run, "instrument", "instrument_type=questionnaire");
    data = await doc(run, "table", "ingestion_type=raw");
    otherData = await doc(otherRun, "table", "ingestion_type=raw");
    let order = 0;
    for (const [code, text, inst] of [["Q1", "Which region do you live in?", instrument], ["Q2", "How satisfied are you overall?", instrument], ["Q3", "Grid", instrument], ["X1", "Elsewhere", otherInstrument]] as const) {
      items[code] = (await db.pool.query("insert into instrument_items(tenant_id,run_id,document_id,item_order,code,item_text) values($1,$2,$3,$4,$5,$6) returning id", [tenant, run, inst, order++, code, text])).rows[0].id;
    }
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  const links = async () => (await db.pool.query("select item_id, variable, method, status from instrument_links where data_document_id = $1 order by variable", [data])).rows;

  it("chooses, refuses a second claim and anything outside the project, and survives matching again", async () => {
    const { chooseInstrumentLinkAction, setInstrumentTargetAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");

    // Matching first: Q1 by code, Q3 by stem (three links), Q2 nothing.
    expect(await setInstrumentTargetAction(run, instrument, data)).toMatchObject({ ok: true });
    expect((await getInstrumentSummaries(tenant, run)).get(instrument)).toMatchObject({ links: { suggested: 4 }, itemsToCheck: 2 });

    // Q2 by hand: confirmed, "manual"; the same choice again changes nothing.
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q2, data, "SAT")).toEqual({ ok: true });
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q2, data, "SAT")).toEqual({ ok: true });
    expect((await links()).filter((l) => l.variable === "SAT")).toEqual([{ item_id: items.Q2, variable: "SAT", method: "manual", status: "confirmed" }]);

    // SAT is now Q2's: refused for Q1, naming Q2.
    const refused = await chooseInstrumentLinkAction(run, instrument, items.Q1, data, "SAT");
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/already confirmed for Q2/) });

    // Outside the file, another questionnaire's question, another project's data file: refused, nothing written.
    const before = await links();
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q1, data, "NOT_A_VARIABLE")).toMatchObject({ ok: false, error: expect.stringMatching(/not a variable of this data file/) });
    expect(await chooseInstrumentLinkAction(run, instrument, items.X1, data, "REGION")).toMatchObject({ ok: false, error: expect.stringMatching(/not in this questionnaire/) });
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q1, otherData, "REGION")).toMatchObject({ ok: false, error: expect.stringMatching(/not in this project/) });
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q1, data, "")).toMatchObject({ ok: false });
    expect(await links()).toEqual(before);

    // Matching again keeps the chosen link and never suggests SAT for another question.
    expect(await setInstrumentTargetAction(run, instrument, data)).toMatchObject({ ok: true });
    const after = await links();
    expect(after.filter((l) => l.variable === "SAT")).toEqual([{ item_id: items.Q2, variable: "SAT", method: "manual", status: "confirmed" }]);
    // Questions to check counts Q1 and Q3 once each, though Q3 carries three links.
    expect((await getInstrumentSummaries(tenant, run)).get(instrument)).toMatchObject({ links: { suggested: 4, confirmed: 1 }, itemsToCheck: 2 });
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("manual questionnaire links", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
