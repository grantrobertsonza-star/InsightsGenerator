// Multiple-response families through the actual actions (Grant, 2026-10-22: FinScope's EN20 stem
// showed No match although the data has EN20_1 to EN20_n). Real disposable PostgreSQL; the variable
// dictionary (read from the stored file) is the mocked boundary.
//   - matching links the stem EN20 to every EN20_k, not EN201, while EN2 keeps its exact EN2 and a
//     wording question does not take a family member away
//   - "Confirm same-code matches" confirms the family, and a family link the researcher rejected
//     stays rejected; matching again changes no decision
//   - "Link all" in the picker links the family, skips a member confirmed for another question and
//     says so, adds nothing when repeated, and refuses a variable outside the family
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
const FAMILY = ["EN20_1", "EN20_2", "EN20_3", "EN20_4"];
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => ({
    variables: [
      ...["EN20_1", "EN20_2", "EN20_3", "EN20_4"].map((name) => ({ name, label: `${name}. With which mobile networks or companies do you have a data SIM card?` })),
      { name: "EN2", label: "EN2. Do you own a mobile phone" },
      { name: "EN201", label: "EN201. A separate question" },
      { name: "Q9", label: "Overall rating" },
    ],
  })),
}));

describe.skipIf(!TEST_DATABASE_URL)("multiple-response families in questionnaire links", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic families')", [tenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  const setUp = async () => {
    const run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id as string;
    const doc = async (kind: string, col: string, val: string) =>
      (await db.pool.query(`insert into documents(tenant_id,run_id,kind,source_filename,storage_path,${col}) values($1,$2,$3,'f','s',$4) returning id`, [tenant, run, kind, val])).rows[0].id as string;
    const instrument = await doc("instrument", "instrument_type", "questionnaire");
    const data = await doc("table", "ingestion_type", "raw");
    const items: Record<string, string> = {};
    let order = 0;
    for (const [code, text] of [
      ["EN19", "With which mobile networks or companies do you have a data SIM card?"],
      ["EN2", "Do you own a mobile phone?"],
      ["EN20", "(Mobile networks or companies used for data/data SIM cards)"],
      ["EN201", "A separate question"],
    ]) {
      items[code] = (await db.pool.query("insert into instrument_items(tenant_id,run_id,document_id,item_order,code,item_text) values($1,$2,$3,$4,$5,$6) returning id", [tenant, run, instrument, order++, code, text])).rows[0].id;
    }
    const links = async () =>
      (await db.pool.query<{ item_id: string; variable: string; method: string; status: string }>(
        "select item_id, variable, method, status from instrument_links where data_document_id = $1 order by variable", [data],
      )).rows;
    return { run, instrument, data, items, links };
  };

  it("matches the family, confirms it with the same-code matches, and keeps a rejection through matching again", async () => {
    const { setInstrumentTargetAction, confirmLinksAction, setLinkStatusAction } = await import("../instrumentActions");
    const { run, instrument, data, items, links } = await setUp();

    expect(await setInstrumentTargetAction(run, instrument, data)).toMatchObject({ ok: true });
    const first = await links();
    expect(first.filter((l) => l.item_id === items.EN20).map((l) => l.variable)).toEqual(FAMILY);
    expect(first.filter((l) => l.item_id === items.EN2).map((l) => l.variable)).toEqual(["EN2"]);
    expect(first.filter((l) => l.item_id === items.EN201).map((l) => l.variable)).toEqual(["EN201"]);
    expect(first.filter((l) => l.item_id === items.EN19)).toEqual([]);

    // The researcher turns one member down, then confirms the same-code matches.
    const en20_3 = (await db.pool.query("select id from instrument_links where item_id = $1 and variable = 'EN20_3'", [items.EN20])).rows[0].id;
    expect(await setLinkStatusAction(run, en20_3, "rejected")).toMatchObject({ ok: true });
    expect(await confirmLinksAction(run, instrument)).toMatchObject({ ok: true, confirmed: 5, refused: [] });
    const byVar = (rows: Awaited<ReturnType<typeof links>>) => Object.fromEntries(rows.filter((l) => l.item_id === items.EN20).map((l) => [l.variable, l.status]));
    expect(byVar(await links())).toEqual({ EN20_1: "confirmed", EN20_2: "confirmed", EN20_3: "rejected", EN20_4: "confirmed" });

    // Matching again changes no decision and adds nothing.
    const before = await links();
    expect(await setInstrumentTargetAction(run, instrument, data)).toMatchObject({ ok: true });
    expect(await links()).toEqual(before);
  });

  it("links the whole family from the picker, skipping a member another question has", async () => {
    const { chooseInstrumentLinkAction, chooseInstrumentLinkFamilyAction } = await import("../instrumentActions");
    const { run, instrument, data, items, links } = await setUp();

    // EN20_4 was chosen for EN19 by hand first.
    expect(await chooseInstrumentLinkAction(run, instrument, items.EN19, data, "EN20_4")).toEqual({ ok: true });
    const r = await chooseInstrumentLinkFamilyAction(run, instrument, items.EN20, data, "EN20_2");
    expect(r).toMatchObject({ ok: true, linked: 3, family: FAMILY });
    expect(r.ok && r.refused).toEqual([{ variable: "EN20_4", reason: expect.stringMatching(/already confirmed for EN19/) }]);
    expect((await links()).filter((l) => l.item_id === items.EN20)).toEqual(
      ["EN20_1", "EN20_2", "EN20_3"].map((variable) => ({ item_id: items.EN20, variable, method: "manual", status: "confirmed" })),
    );

    // Repeating it links nothing new.
    expect(await chooseInstrumentLinkFamilyAction(run, instrument, items.EN20, data, "EN20_1")).toMatchObject({ ok: true, linked: 0 });

    // A variable outside the family, or a question with no family, is refused and writes nothing.
    const before = await links();
    expect(await chooseInstrumentLinkFamilyAction(run, instrument, items.EN20, data, "Q9")).toMatchObject({ ok: false, error: expect.stringMatching(/not one of a set/) });
    expect(await chooseInstrumentLinkFamilyAction(run, instrument, items.EN2, data, "EN20_1")).toMatchObject({ ok: false });
    expect(await links()).toEqual(before);
  });

  it.skipIf(!!TEST_DATABASE_URL)(DISPOSABLE_DB_SKIP_REASON, () => {});
});
