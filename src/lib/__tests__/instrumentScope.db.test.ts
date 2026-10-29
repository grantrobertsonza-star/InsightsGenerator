// IS-F03 (Codex import stress review, 27 October 2026, S1): a codebook from another project of the same
// tenant, or one removed to the bin, could be matched to the active data file and confirmed, and its
// "1=Refused" then took the two 1 answers out of the base (Codex: base 4 became 2). Through the actual
// suggestInstrumentLinks, setInstrumentLinkStatus, confirmInstrumentLinks, chooseInstrumentLink,
// getConfirmedItemsForData, buildCrosstab, removeDocumentToBin and restoreDocumentFromBin, with the local
// engine and a real disposable PostgreSQL (storage an in-memory stand-in; the model stubbed, never called).
// Expected bases are counted from the data written here: q1 = 1, 2, 1, 3, so with no codebook every answer
// is substantive (base 4), and with this codebook's "1=Refused" confirmed the base is 2.
//   1. Another project's codebook: matching refuses and changes nothing (no links, instrument_for kept);
//      a stale suggestion cannot be confirmed (one, all, or chosen by hand); a confirmed link left by an
//      earlier version is not used by the tables (base 4).
//   2. The bin: a removed codebook cannot be matched or confirmed, and its links do not count; restored,
//      its links come back and confirming them applies its meanings (base 2).
//   3. Removal racing confirmation: a confirmation waiting on the codebook's lock while it is removed is
//      refused, and nothing is confirmed.
//   4. Wrong tenant refused; a legitimate codebook of this project linked to two waves still works.
//   5. IS-F06 end to end: a codebook entry q1 with columns q1 and Q1 is bulk-confirmed to q1 only.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
        copy: async () => ({ data: {}, error: null }),
        move: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const CODEBOOK = Buffer.from('Variable,Label,Values\nid,Respondent,as is\nq1,Would you recommend us?,"1=Refused, 2=Yes, 3=No"\n', "utf-8");
const DATA = Buffer.from("id,q1\n1,1\n2,2\n3,1\n4,3\n", "utf-8");

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("a link counts only while both its files are active in its project (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const project = async () => (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id as string;
  async function stored(run: string, kind: "instrument" | "table", name: string, bytes: Buffer) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, kind === "instrument" ? "codebook" : null, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  const lib = () => import("../instruments");
  /** The base of q1 for everyone in a table built now. */
  async function base(run: string, data: string) {
    const { buildCrosstab } = await import("../crosstabs");
    const built = await buildCrosstab(tenant, run, data, { columnVars: [], rowItems: [{ key: "q1", label: "q1", vars: ["q1"] }], weightVar: null, correction: "none" });
    const t = (await q("select crosstab from document_tables where id = $1", [built.tableId]))[0].crosstab;
    return (t.questions[0].rows as { isBase?: boolean; total: { base: { n: number } } }[]).find((r) => !r.isBase)!.total.base.n;
  }
  const q1Item = async (codebook: string) => (await q("select id from instrument_items where document_id = $1 and code = 'q1'", [codebook]))[0].id as string;
  const linksOf = async (codebook: string) => (await q("select l.run_id, l.data_document_id, l.variable, l.status from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1 order by l.variable", [codebook]));

  it("1. another project's codebook: refused at matching and confirming, and a link left from before is not used", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, setInstrumentLinkStatus, confirmInstrumentLinks, chooseInstrumentLink, getConfirmedItemsForData } = await lib();
    const active = await project();
    const other = await project();
    const data = await stored(active, "table", "poll.csv", DATA);
    const outside = await stored(other, "instrument", "cb.csv", CODEBOOK);
    await readInstrumentItems(tenant, other, outside);
    expect(await base(active, data)).toBe(4);

    // (Batch 49 already refused this one step, worded "not found in this project".)
    await expect(suggestInstrumentLinks(tenant, active, outside, data)).rejects.toThrow(/not (found )?in this project/);
    expect(await linksOf(outside)).toEqual([]);
    expect((await q("select instrument_for from documents where id = $1", [outside]))[0].instrument_for).toBeNull();

    // A link written against the active project by a stale or crafted request: never confirmed, never used.
    const stale = (await q(
      "insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status) values ($1,$2,$3,$4,'q1','code',1,'suggested') returning id",
      [tenant, active, await q1Item(outside), data],
    ))[0].id;
    await expect(setInstrumentLinkStatus(tenant, active, stale, "confirmed")).rejects.toThrow(/question is not in this project/);
    await expect(confirmInstrumentLinks(tenant, active, outside, 0.9)).rejects.toThrow(/not in this project/);
    await expect(chooseInstrumentLink(tenant, active, outside, await q1Item(outside), data, "q1")).rejects.toThrow(/not in this project/);
    expect((await q("select status from instrument_links where id = $1", [stale]))[0].status).toBe("suggested");
    await q("update instrument_links set status = 'confirmed' where id = $1", [stale]);
    expect(await getConfirmedItemsForData(tenant, active, data)).toEqual([]);
    expect(await base(active, data)).toBe(4);
  });

  it("2. the bin: a removed codebook is refused and its links do not count; restored, confirming it applies its meanings", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, setInstrumentLinkStatus, confirmInstrumentLinks } = await lib();
    const { removeDocumentToBin, restoreDocumentFromBin } = await import("../documentBin");
    const run = await project();
    const data = await stored(run, "table", "poll.csv", DATA);
    const cb = await stored(run, "instrument", "cb.csv", CODEBOOK);
    await readInstrumentItems(tenant, run, cb);
    await suggestInstrumentLinks(tenant, run, cb, data);
    const suggestion = (await q("select l.id from instrument_links l where l.item_id = $1", [await q1Item(cb)]))[0].id;
    const { removalId } = await removeDocumentToBin(tenant, run, cb, null);

    await expect(suggestInstrumentLinks(tenant, run, cb, data)).rejects.toThrow(/not (found )?in this project/);
    await expect(setInstrumentLinkStatus(tenant, run, suggestion, "confirmed")).rejects.toThrow(/not in this project/);
    await expect(confirmInstrumentLinks(tenant, run, cb, 0.9)).rejects.toThrow(/not in this project/);
    expect(await base(run, data)).toBe(4);

    // Restored: the links come back with the file, as suggestions, and confirming them applies the codebook.
    await restoreDocumentFromBin(tenant, run, removalId);
    expect((await linksOf(cb)).map((l) => [l.variable, l.status])).toEqual([["id", "suggested"], ["q1", "suggested"]]);
    expect(await confirmInstrumentLinks(tenant, run, cb, 0.9)).toMatchObject({ confirmed: 2 });
    expect(await base(run, data)).toBe(2);

    // Removed again after confirming: its confirmed meaning stops counting at once.
    await removeDocumentToBin(tenant, run, cb, null);
    expect(await base(run, data)).toBe(4);
  });

  it("3. a confirmation waiting while the codebook is removed is refused, and nothing is confirmed", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await lib();
    const run = await project();
    const bin = await project();
    const data = await stored(run, "table", "poll.csv", DATA);
    const cb = await stored(run, "instrument", "cb.csv", CODEBOOK);
    await readInstrumentItems(tenant, run, cb);
    await suggestInstrumentLinks(tenant, run, cb, data);
    // Another connection holds the codebook's row, as a removal does, and moves it out while the
    // confirmation waits for that lock.
    const remover = new pg.Client({ connectionString: db.url });
    await remover.connect();
    try {
      await remover.query("begin");
      await remover.query("select id from documents where id = $1 for update", [cb]);
      // Settled into a value at once: the refusal can arrive between the commit and the assertion below, and an
      // unobserved rejection in that gap is reported by the runner as an unhandled error.
      const confirming = confirmInstrumentLinks(tenant, run, cb, 0.9).then(
        () => null,
        (e: unknown) => e,
      );
      await new Promise((r) => setTimeout(r, 400));
      await remover.query("update documents set run_id = $2, removed_at = now(), removed_from_run = $3 where id = $1", [cb, bin, run]);
      await remover.query("commit");
      const refused = await confirming;
      expect(refused).toBeInstanceOf(Error);
      expect((refused as Error).message).toMatch(/not in this project/);
    } finally {
      await remover.end();
    }
    expect((await linksOf(cb)).every((l) => l.status === "suggested")).toBe(true);
  });

  it("4. another tenant is refused; one codebook of this project linked to two waves still works", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await lib();
    const run = await project();
    const w1 = await stored(run, "table", "wave1.csv", DATA);
    const w2 = await stored(run, "table", "wave2.csv", DATA);
    const cb = await stored(run, "instrument", "cb.csv", CODEBOOK);
    await readInstrumentItems(tenant, run, cb);
    const stranger = randomUUID();
    await q("insert into tenants (id, name) values ($1, 'Other')", [stranger]);
    await expect(suggestInstrumentLinks(stranger, run, cb, w1)).rejects.toThrow();
    expect(await linksOf(cb)).toEqual([]);
    await suggestInstrumentLinks(tenant, run, cb, w1);
    await suggestInstrumentLinks(tenant, run, cb, w2);
    expect(await confirmInstrumentLinks(tenant, run, cb, 0.9)).toMatchObject({ confirmed: 4 });
    expect(await base(run, w1)).toBe(2);
    expect(await base(run, w2)).toBe(2);
    // Retried: nothing new, no duplicates.
    expect(await confirmInstrumentLinks(tenant, run, cb, 0.9)).toMatchObject({ confirmed: 0 });
    expect((await linksOf(cb)).length).toBe(4);
  });

  it("5. IS-F06: a codebook entry q1 with columns q1 and Q1 is confirmed to q1 only", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await lib();
    const run = await project();
    const data = await stored(run, "table", "cases.csv", Buffer.from("id,q1,Q1\n1,1,2\n2,2,1\n", "utf-8"));
    const cb = await stored(run, "instrument", "cb.csv", CODEBOOK);
    await readInstrumentItems(tenant, run, cb);
    await suggestInstrumentLinks(tenant, run, cb, data);
    await confirmInstrumentLinks(tenant, run, cb, 0.9);
    expect((await linksOf(cb)).filter((l) => l.status === "confirmed").map((l) => l.variable)).toEqual(["id", "q1"]);
  });
});
