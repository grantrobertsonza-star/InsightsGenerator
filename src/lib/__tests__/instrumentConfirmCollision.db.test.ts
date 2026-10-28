// IR-04 (independent review, 2026-10-20): every way of confirming a questionnaire link follows one
// rule. A variable of a data file means one question, so a variable confirmed for one question is
// refused for another, naming it, whether the link is chosen by hand, confirmed singly or confirmed
// in bulk. Real disposable PostgreSQL, actual actions; the variable dictionary is the mocked boundary.
//   - two simultaneous Confirms of one variable for two questions: one confirmed, one refused
//   - Confirm after a hand-chosen link, and a hand choice after a Confirm: refused, naming the question
//   - bulk Confirm with a conflict: the free links are confirmed, the conflicting one stays suggested
//     and is reported; repeating it confirms nothing new
//   - repeating a Confirm is a no-op; rejecting the holder frees the variable; another project's link
//     is refused
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
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => ({ variables: [{ name: "V", label: "Region" }, { name: "W", label: "Age" }] })),
}));

describe.skipIf(!TEST_DATABASE_URL)("IR-04 one confirmation rule for questionnaire links", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, otherRun: string, instrument: string, data: string;
  const items: Record<string, string> = {};
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic confirm rule')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    otherRun = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    instrument = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','q.docx','q','questionnaire') returning id", [tenant, run])).rows[0].id;
    data = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','d.csv','d','raw') returning id", [tenant, run])).rows[0].id;
    let order = 0;
    for (const code of ["Q1", "Q2", "Q3"]) {
      items[code] = (await db.pool.query("insert into instrument_items(tenant_id,run_id,document_id,item_order,code,item_text) values($1,$2,$3,$4,$5,$6) returning id", [tenant, run, instrument, order++, code, `Question ${code}`])).rows[0].id;
    }
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  // Each case starts from three suggestions: Q1 and Q2 both suggest V (Q1 stronger), Q3 suggests W.
  const ids: Record<string, string> = {};
  beforeEach(async () => {
    await db.pool.query("delete from instrument_links where run_id = $1", [run]);
    for (const [key, code, variable, confidence] of [["Q1V", "Q1", "V", 0.97], ["Q2V", "Q2", "V", 0.93], ["Q3W", "Q3", "W", 0.95]] as const) {
      ids[key] = (await db.pool.query("insert into instrument_links(tenant_id,run_id,item_id,data_document_id,variable,method,confidence,status) values($1,$2,$3,$4,$5,'code',$6,'suggested') returning id", [tenant, run, items[code], data, variable, confidence])).rows[0].id;
    }
  });
  const statuses = async () =>
    Object.fromEntries((await db.pool.query<{ id: string; status: string }>("select id, status from instrument_links where run_id = $1", [run])).rows.map((r) => [Object.keys(ids).find((k) => ids[k] === r.id) ?? r.id, r.status]));
  const confirmedFor = async (variable: string) => (await db.pool.query("select item_id from instrument_links where data_document_id = $1 and variable = $2 and status = 'confirmed'", [data, variable])).rows.map((r) => r.item_id);

  it("decides two simultaneous Confirms of one variable one after the other: one confirmed, one refused naming it", async () => {
    const { setLinkStatusAction } = await import("../instrumentActions");
    // Hold the data file's row so both requests reach the lock before either can decide.
    const holder = await db.pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from documents where id = $1 for update", [data]);
      const a = setLinkStatusAction(run, ids.Q1V, "confirmed");
      const b = setLinkStatusAction(run, ids.Q2V, "confirmed");
      for (let i = 0; i < 100; i++) {
        const waiting = await db.pool.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
        if (waiting.rows[0].n >= 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await holder.query("commit");
      const results = await Promise.all([a, b]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const refused = results.find((r) => !r.ok);
      expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/V is already confirmed for Q[12]/) });
    } finally {
      holder.release();
    }
    expect(await confirmedFor("V")).toHaveLength(1);
  });

  it("refuses a Confirm whose variable another question already has, repeats as a no-op, and frees it on Reject", async () => {
    const { setLinkStatusAction } = await import("../instrumentActions");
    expect(await setLinkStatusAction(run, ids.Q1V, "confirmed")).toEqual({ ok: true });
    expect(await setLinkStatusAction(run, ids.Q1V, "confirmed")).toEqual({ ok: true });
    expect(await setLinkStatusAction(run, ids.Q2V, "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/V is already confirmed for Q1/) });
    expect(await statuses()).toMatchObject({ Q1V: "confirmed", Q2V: "suggested" });
    // Rejecting is never refused, and once Q1 lets V go, Q2 may have it.
    expect(await setLinkStatusAction(run, ids.Q1V, "rejected")).toEqual({ ok: true });
    expect(await setLinkStatusAction(run, ids.Q2V, "confirmed")).toEqual({ ok: true });
    expect(await confirmedFor("V")).toEqual([items.Q2]);
  });

  it("confirms the free links in bulk, keeps a conflicting one as a suggestion and reports it", async () => {
    const { confirmLinksAction } = await import("../instrumentActions");
    const first = await confirmLinksAction(run, instrument, 0.9);
    expect(first).toMatchObject({ ok: true, confirmed: 2, refused: [{ variable: "V", reason: expect.stringMatching(/already confirmed for Q1/) }] });
    expect(await statuses()).toMatchObject({ Q1V: "confirmed", Q2V: "suggested", Q3W: "confirmed" });
    const again = await confirmLinksAction(run, instrument, 0.9);
    expect(again).toMatchObject({ ok: true, confirmed: 0, refused: [{ variable: "V" }] });
    expect(await confirmedFor("V")).toEqual([items.Q1]);
  });

  it("refuses bulk Confirm for a variable already confirmed singly, and a link of another project", async () => {
    const { confirmLinksAction, setLinkStatusAction } = await import("../instrumentActions");
    expect(await setLinkStatusAction(run, ids.Q2V, "confirmed")).toEqual({ ok: true });
    expect(await confirmLinksAction(run, instrument, 0.9)).toMatchObject({ ok: true, confirmed: 1, refused: [{ variable: "V", reason: expect.stringMatching(/for Q2/) }] });
    expect(await confirmedFor("V")).toEqual([items.Q2]);
    expect(await setLinkStatusAction(otherRun, ids.Q1V, "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/not in this project/) });
    expect(await confirmLinksAction(otherRun, instrument, 0.9)).toMatchObject({ ok: false, error: expect.stringMatching(/not in this project/) });
  });

  it("applies the same rule between a hand-chosen link and Confirm, both ways", async () => {
    const { chooseInstrumentLinkAction, setLinkStatusAction } = await import("../instrumentActions");
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q1, data, "V")).toEqual({ ok: true });
    // The review's finding: a suggestion Confirm after the hand choice made a second confirmed question for V.
    expect(await setLinkStatusAction(run, ids.Q2V, "confirmed")).toMatchObject({ ok: false, error: expect.stringMatching(/V is already confirmed for Q1/) });
    expect(await confirmedFor("V")).toEqual([items.Q1]);
    // The other way round: W confirmed for Q3 by Confirm, then chosen by hand for Q2.
    expect(await setLinkStatusAction(run, ids.Q3W, "confirmed")).toEqual({ ok: true });
    expect(await chooseInstrumentLinkAction(run, instrument, items.Q2, data, "W")).toMatchObject({ ok: false, error: expect.stringMatching(/W is already confirmed for Q3/) });
    expect(await confirmedFor("W")).toEqual([items.Q3]);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("IR-04 one confirmation rule for questionnaire links", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
