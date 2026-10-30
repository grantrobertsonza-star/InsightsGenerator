import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
const state = vi.hoisted(() => ({ partial: false, empty: false, allFail: false, dense: false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../crosstabs", () => ({ loadVariableDictionary: vi.fn() }));
// A dense questionnaire (27 October 2026, the May 2026 IGS poll): 6 pages of 12 questions with long answer
// lists, so one part needs more output than one read returns; the controlled model overflows on more
// than 5,000 characters, as a real one does on a ballot of 61 candidates.
const DENSE_PAGES = Array.from({ length: 6 }, (_, p) => ({
  pageNumber: p + 1,
  text: Array.from({ length: 12 }, (_, q) => `Q${p * 12 + q + 1}. Which candidate do you prefer in contest ${p * 12 + q + 1}? ${"1 Candidate with a long ballot designation ".repeat(4)}`).join("\n"),
}));
vi.mock("../extractFindings", () => ({ extractDocumentText: vi.fn(async () => (state.dense ? { fullText: "Dense questionnaire", pages: DENSE_PAGES } : { fullText: "Synthetic questionnaire", pages: [{ pageNumber: 1, text: "FIRST_CHUNK " + "a".repeat(14000) }, { pageNumber: 2, text: "SECOND_CHUNK " + "b".repeat(14000) }] })) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async (request: { messages: { content: string }[] }) => {
  const content = request.messages[0].content;
  if (state.allFail) throw new Error("Synthetic outage");
  if (state.dense) {
    if (content.length > 5000) return { usage: {}, stop_reason: "max_tokens", content: [{ type: "tool_use", name: "record_items", input: { items: [] } }] };
    const found = [...content.matchAll(/^Q(\d+)\. ([^?]+\?)/gm)].map((m) => ({ code: `Q${m[1]}`, text: m[2], options: [{ code: "1", label: "Candidate" }], routing_text: null, section: null }));
    return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_items", input: { items: found } }] };
  }
  const second = content.includes("SECOND_CHUNK");
  if (state.empty) return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_items", input: { items: [] } }] };
  if (second && state.partial) throw new Error("Synthetic second-chunk outage");
  return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_items", input: { items: [{ code: second ? "Q2" : "Q1", text: second ? "Second question" : "First question", options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }], routing_text: null, section: null }] } }] };
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
  it("a failed read is recorded for the automatic first read, and a later finished read supersedes it", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");
    const fresh = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','guide.docx','synthetic2','focus_group_guide') returning id", [tenant,run])).rows[0].id;
    state.empty = true;
    expect(await readInstrumentAction(run, fresh)).toMatchObject({ ok: false, error: expect.stringMatching(/No question items/) });
    expect((await getInstrumentSummaries(tenant, run)).get(fresh)).toMatchObject({ items: 0, readFailure: expect.stringMatching(/No question items/) });
    state.empty = false;
    expect(await readInstrumentAction(run, fresh)).toMatchObject({ ok: true, complete: true });
    expect((await getInstrumentSummaries(tenant, run)).get(fresh)?.readFailure).toBeUndefined();
  });
  // 27 October 2026 (Grant's May 2026 IGS poll questionnaire): every part of a dense questionnaire overflowed
  // the output budget and was dropped, and the read then said "No question items were found in this file".
  it("a part too dense for one read is read in halves, so every question is found", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentItems } = await import("../instruments");
    const dense = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','poll.docx','synthetic3','questionnaire') returning id", [tenant,run])).rows[0].id;
    state.dense = true;
    try {
      expect(await readInstrumentAction(run, dense)).toMatchObject({ ok: true, complete: true, failedChunks: 0, items: 72 });
      const items = await getInstrumentItems(tenant, dense);
      expect(items.map((i) => i.code)).toEqual(Array.from({ length: 72 }, (_, i) => `Q${i + 1}`));
      // Each half keeps the page it starts on.
      expect(items.find((i) => i.code === "Q13")!.page).toBe(2);
    } finally {
      state.dense = false;
    }
  });
  it("when every part fails, the read says so with the reason, never that the file has no questions", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");
    const failing = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','q.docx','synthetic4','questionnaire') returning id", [tenant,run])).rows[0].id;
    state.allFail = true;
    try {
      const r = await readInstrumentAction(run, failing);
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/^None of this file could be read: 2 of its parts failed \(Synthetic outage\)/) });
      expect((r as { error: string }).error).not.toMatch(/No question items/);
      expect((await getInstrumentSummaries(tenant, run)).get(failing)).toMatchObject({ items: 0, readFailure: expect.stringMatching(/None of this file could be read/) });
    } finally {
      state.allFail = false;
    }
    // Recovery: reading again once the model answers.
    expect(await readInstrumentAction(run, failing)).toMatchObject({ ok: true, complete: true, items: 2 });
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("IMP-012 instrument reread persistence", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
