import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
const state = vi.hoisted(() => ({ partial: false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../crosstabs", () => ({ loadVariableDictionary: vi.fn() }));
vi.mock("../extractFindings", () => ({ extractDocumentText: vi.fn(async () => ({ fullText: "Synthetic questionnaire", pages: [{ pageNumber: 1, text: "FIRST_CHUNK " + "a".repeat(14000) }, { pageNumber: 2, text: "SECOND_CHUNK " + "b".repeat(14000) }] })) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async (request: { messages: { content: string }[] }) => {
  const second = request.messages[0].content.includes("SECOND_CHUNK");
  if (second && state.partial) throw new Error("Synthetic second-chunk outage");
  return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", input: { items: [{ code: second ? "Q2" : "Q1", text: second ? "Second question" : "First question", options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }], routing_text: null, section: null }] } }] };
} ) } } }));
describe.skipIf(!TEST_DATABASE_URL)("IMP-012 instrument reread persistence", () => {
  let db: DisposableDb; const tenant = randomUUID(); let run: string, instrument: string, data: string;
  beforeAll(async () => {
    db = await createDisposableDb(); process.env.DATABASE_URL = db.url; process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic instrument')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    instrument = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','questionnaire.docx','synthetic','questionnaire') returning id", [tenant,run])).rows[0].id;
    data = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','data.csv','data','raw') returning id", [tenant,run])).rows[0].id;
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  it("complete then partial reread preserves confirmed item/link identities and truthful reloaded coverage; retry never duplicates", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentItems, getInstrumentLinks, getInstrumentSummaries } = await import("../instruments");
    expect(await readInstrumentAction(run,instrument)).toMatchObject({ ok: true, complete: true, items: 2 });
    const initial = await getInstrumentItems(tenant,instrument);
    const second = initial.find(i => i.code === "Q2")!;
    const link = (await db.pool.query("insert into instrument_links(tenant_id,run_id,item_id,data_document_id,variable,method,confidence,status) values($1,$2,$3,$4,'q2','manual',1,'confirmed') returning id", [tenant,run,second.id,data])).rows[0].id;
    state.partial = true;
    expect(await readInstrumentAction(run,instrument)).toMatchObject({ ok: true, complete: false, failedChunks: 1, items: 2 });
    expect((await getInstrumentItems(tenant,instrument)).map(i => i.id).sort()).toEqual(initial.map(i => i.id).sort());
    expect(await getInstrumentLinks(tenant,instrument)).toMatchObject([{ id: link, itemId: second.id, status: "confirmed" }]);
    expect((await getInstrumentSummaries(tenant,run)).get(instrument)).toMatchObject({ readStatus: { complete: false, failedChunks: 1 } });
    await readInstrumentAction(run,instrument);
    expect(await getInstrumentItems(tenant,instrument)).toHaveLength(2);
    state.partial = false;
    expect(await readInstrumentAction(run,instrument)).toMatchObject({ ok: true, complete: true, items: 2 });
    expect(await getInstrumentLinks(tenant,instrument)).toMatchObject([{ id: link, status: "confirmed" }]);
    expect((await getInstrumentSummaries(tenant,run)).get(instrument)).toMatchObject({ readStatus: { complete: true } });
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("IMP-012 instrument reread persistence", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
