// IR-05 (independent review, 2026-10-20): the paid read of a questionnaire or guide runs once at a
// time per document across sessions, not only once per page. Real disposable PostgreSQL, actual
// actions; the model and the stored file's text are the mocked boundaries, and model calls are counted.
//   - two simultaneous reads of one document: one read, one "already being read", 1 model call
//   - a read requested while another is in progress: refused before any model call, not recorded as
//     a failure, and reported as in progress until that read ends
//   - a failed read releases its claim: Read again works straight away
//   - a claim abandoned by a crashed read lapses after INSTRUMENT_READ_CLAIM_MINUTES; a fresh one does not
//   - RR-03: a read that outlives its claim, after a newer read took over, ends neither the newer claim
//     nor overwrites its results; the newer read's items and completion are the ones kept. A late
//     failure records nothing; the newer read failing is recorded, and Read again recovers
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../crosstabs", () => ({ loadVariableDictionary: vi.fn() }));
vi.mock("../extractFindings", () => ({ extractDocumentText: vi.fn(async () => ({ fullText: "Q1 First question", pages: [{ pageNumber: 1, text: "Q1 First question" }] })) }));
const model = vi.hoisted(() => {
  const m = { calls: 0, fail: false, gate: null as Promise<void> | null, text: "First question" };
  return m;
});
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async () => {
        model.calls += 1;
        // Each call keeps the gate and wording in force when it started, so two overlapping reads
        // can be released separately and told apart by what they return.
        const { gate, text } = model;
        if (gate) await gate;
        if (model.fail) throw new Error("Synthetic model outage");
        return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_items", input: { items: [{ code: "Q1", text, options: [], routing_text: null, section: null }] } }] };
      }),
    },
  },
}));

describe.skipIf(!TEST_DATABASE_URL)("IR-05 one read of a questionnaire at a time", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic single read')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  // A failed assertion must not leave the model failing or held for the next case.
  beforeEach(() => {
    model.fail = false;
    model.gate = null;
    model.text = "First question";
  });
  const newInstrument = async () =>
    (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,instrument_type) values($1,$2,'instrument','q.docx',$3,'questionnaire') returning id", [tenant, run, randomUUID()])).rows[0].id as string;
  const opened = () => {
    let open!: () => void;
    model.gate = new Promise<void>((r) => (open = r));
    return () => {
      model.gate = null;
      open();
    };
  };
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  };

  it("lets one of two simultaneous reads through and tells the other a read is under way", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const doc = await newInstrument();
    model.calls = 0;
    const release = opened();
    const both = Promise.all([readInstrumentAction(run, doc), readInstrumentAction(run, doc)]);
    await until(() => model.calls >= 1);
    // The second request has been answered without a model call while the first is still reading.
    await new Promise((r) => setTimeout(r, 300));
    expect(model.calls).toBe(1);
    release();
    const results = await both;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, inFlight: true, error: expect.stringMatching(/already being read/) });
    expect(model.calls).toBe(1);
  });

  it("refuses a read while one is in progress, without recording a failure, and reports it until that read ends", async () => {
    const { readInstrumentAction, instrumentReadInFlightAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");
    const doc = await newInstrument();
    model.calls = 0;
    const release = opened();
    const first = readInstrumentAction(run, doc);
    await until(() => model.calls >= 1);
    expect(await readInstrumentAction(run, doc)).toMatchObject({ ok: false, inFlight: true });
    expect(await instrumentReadInFlightAction(run, doc)).toEqual({ ok: true, inFlight: true });
    expect((await getInstrumentSummaries(tenant, run)).get(doc)?.readFailure).toBeUndefined();
    release();
    expect(await first).toMatchObject({ ok: true, items: 1 });
    expect(await instrumentReadInFlightAction(run, doc)).toEqual({ ok: true, inFlight: false });
    expect(model.calls).toBe(1);
  });

  it("releases the claim when a read fails, so Read again works at once", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");
    const doc = await newInstrument();
    model.calls = 0;
    model.fail = true;
    expect(await readInstrumentAction(run, doc)).toMatchObject({ ok: false, error: expect.stringMatching(/^None of this file could be read: .*Synthetic model outage/) });
    expect((await getInstrumentSummaries(tenant, run)).get(doc)?.readFailure).toMatch(/^None of this file could be read: .*Synthetic model outage/);
    model.fail = false;
    expect(await readInstrumentAction(run, doc)).toMatchObject({ ok: true, items: 1 });
    expect(model.calls).toBe(2);
  });

  it("lets a claim abandoned by a crashed read lapse, but honours a fresh one", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { INSTRUMENT_READ_CLAIM_MINUTES } = await import("../instruments");
    const stale = await newInstrument();
    const fresh = await newInstrument();
    const claim = (doc: string, minutesAgo: number) =>
      db.pool.query("insert into trace(tenant_id,run_id,event,detail,occurred_at) values($1,$2,'instrument_read_started',$3, now() - make_interval(mins => $4))", [tenant, run, JSON.stringify({ documentId: doc }), minutesAgo]);
    await claim(stale, INSTRUMENT_READ_CLAIM_MINUTES + 1);
    await claim(fresh, 1);
    model.calls = 0;
    expect(await readInstrumentAction(run, stale)).toMatchObject({ ok: true, items: 1 });
    expect(await readInstrumentAction(run, fresh)).toMatchObject({ ok: false, inFlight: true });
    expect(model.calls).toBe(1);
  });

  it("RR-03: a read that outlived its claim neither ends the newer claim nor overwrites its results", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { INSTRUMENT_READ_CLAIM_MINUTES, isInstrumentReadInFlight } = await import("../instruments");
    const doc = await newInstrument();
    const claims = async () =>
      (await db.pool.query("select id::text from trace where event = 'instrument_read_started' and detail->>'documentId' = $1 order by id", [doc])).rows.map((r) => r.id as string);
    model.calls = 0;
    model.text = "Wording read by the expired claim";
    const releaseOld = opened();
    const late = readInstrumentAction(run, doc);
    await until(() => model.calls >= 1);
    // The first read stalls past the claim window, so the claim lapses and a newer read takes over.
    await db.pool.query(
      "update trace set occurred_at = now() - make_interval(mins => $2) where event = 'instrument_read_started' and detail->>'documentId' = $1",
      [doc, INSTRUMENT_READ_CLAIM_MINUTES + 1],
    );
    model.text = "Wording read by the newer claim";
    const releaseNew = opened();
    const current = readInstrumentAction(run, doc);
    await until(() => model.calls >= 2);
    const [oldClaim, newClaim] = await claims();
    expect(newClaim).toBeDefined();

    // The late read completes now: refused as superseded, nothing written, no failure recorded.
    releaseOld();
    expect(await late).toMatchObject({ ok: false, inFlight: true, error: expect.stringMatching(/newer read/) });
    expect((await db.pool.query("select count(*)::int as n from instrument_items where document_id = $1", [doc])).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int as n from trace where event = 'instrument_read_finished' and detail->>'documentId' = $1", [doc])).rows[0].n).toBe(0);
    // Its own release names its own claim, so the newer claim still stands.
    expect((await db.pool.query("select detail->>'claimId' as c from trace where event = 'instrument_read_released' and detail->>'documentId' = $1", [doc])).rows.map((r) => r.c)).toEqual([oldClaim]);
    expect(await isInstrumentReadInFlight(tenant, run, doc)).toBe(true);
    expect(await readInstrumentAction(run, doc)).toMatchObject({ ok: false, inFlight: true });

    // The newer read's results are the ones kept, and its finish names its own claim.
    releaseNew();
    expect(await current).toMatchObject({ ok: true, items: 1, complete: true });
    expect((await db.pool.query("select item_text from instrument_items where document_id = $1", [doc])).rows.map((r) => r.item_text)).toEqual(["Wording read by the newer claim"]);
    expect((await db.pool.query("select detail->>'claimId' as c from trace where event = 'instrument_read_finished' and detail->>'documentId' = $1", [doc])).rows.map((r) => r.c)).toEqual([newClaim]);
    expect(await isInstrumentReadInFlight(tenant, run, doc)).toBe(false);
    expect(model.calls).toBe(2);
    model.text = "First question";
  });

  // Read A stalls past the claim window and read B takes over; both are held at the model call.
  const takeOver = async (doc: string) => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { INSTRUMENT_READ_CLAIM_MINUTES } = await import("../instruments");
    model.calls = 0;
    model.text = "Wording read by the expired claim";
    const releaseOld = opened();
    const late = readInstrumentAction(run, doc);
    await until(() => model.calls >= 1);
    await db.pool.query(
      "update trace set occurred_at = now() - make_interval(mins => $2) where event = 'instrument_read_started' and detail->>'documentId' = $1",
      [doc, INSTRUMENT_READ_CLAIM_MINUTES + 1],
    );
    model.text = "Wording read by the newer claim";
    const releaseNew = opened();
    const current = readInstrumentAction(run, doc);
    await until(() => model.calls >= 2);
    return { late, current, releaseOld, releaseNew };
  };
  const failures = async (doc: string) =>
    (await db.pool.query("select count(*)::int as n from trace where event = 'instrument_read_failed' and detail->>'documentId' = $1", [doc])).rows[0].n;

  it("RR-03: a read that fails after a newer read took over records no failure and leaves the newer read running", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");
    const doc = await newInstrument();
    const { late, current, releaseOld, releaseNew } = await takeOver(doc);
    model.fail = true;
    releaseOld();
    expect(await late).toMatchObject({ ok: false, inFlight: true, error: expect.stringMatching(/newer read/) });
    model.fail = false;
    expect(await failures(doc)).toBe(0);
    expect((await getInstrumentSummaries(tenant, run)).get(doc)?.readFailure).toBeUndefined();
    // A third request while the newer read runs is refused without a model call.
    expect(await readInstrumentAction(run, doc)).toMatchObject({ ok: false, inFlight: true });
    releaseNew();
    expect(await current).toMatchObject({ ok: true, items: 1 });
    expect((await db.pool.query("select item_text from instrument_items where document_id = $1", [doc])).rows.map((r) => r.item_text)).toEqual(["Wording read by the newer claim"]);
    expect(model.calls).toBe(2);
    model.text = "First question";
  });

  it("RR-03: when the newer read fails after the old one was refused, its failure is recorded and Read again works", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const { getInstrumentSummaries } = await import("../instruments");
    const doc = await newInstrument();
    const { late, current, releaseOld, releaseNew } = await takeOver(doc);
    releaseOld();
    expect(await late).toMatchObject({ ok: false, inFlight: true });
    model.fail = true;
    releaseNew();
    expect(await current).toMatchObject({ ok: false, error: expect.stringMatching(/^None of this file could be read: .*Synthetic model outage/) });
    model.fail = false;
    expect(await failures(doc)).toBe(1);
    expect((await getInstrumentSummaries(tenant, run)).get(doc)?.readFailure).toMatch(/^None of this file could be read: .*Synthetic model outage/);
    model.text = "Wording read by the retry";
    expect(await readInstrumentAction(run, doc)).toMatchObject({ ok: true, items: 1 });
    expect((await db.pool.query("select item_text from instrument_items where document_id = $1", [doc])).rows.map((r) => r.item_text)).toEqual(["Wording read by the retry"]);
    expect(model.calls).toBe(3);
    model.text = "First question";
  });

  it("refuses a document of another project before claiming anything", async () => {
    const { readInstrumentAction } = await import("../instrumentActions");
    const otherRun = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    const doc = await newInstrument();
    model.calls = 0;
    expect(await readInstrumentAction(otherRun, doc)).toMatchObject({ ok: false, error: expect.stringMatching(/not found for this run/) });
    expect((await db.pool.query("select count(*)::int as n from trace where event = 'instrument_read_started' and detail->>'documentId' = $1", [doc])).rows[0].n).toBe(0);
    expect(model.calls).toBe(0);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("IR-05 one read of a questionnaire at a time", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
