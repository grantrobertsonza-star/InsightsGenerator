// CB1 (Grant, 29 October 2026): "a link of codebook is manual for each wave, i think it should be automatic".
// Through the actual matchCodebookToDataFiles, suggestInstrumentLinks, setInstrumentLinkStatus and
// getInstrumentSummaries, the local engine (real dictionaries, with each variable's observed codes) and a real
// disposable PostgreSQL with migration 0133, and on one stopped before it. Storage and the model are mocked.
//
// The codebook: brand (answers 1 Toyota, 8 BMW, 10 Haval), region (answers 1 to 3, but wave 2 holds a 4), age (no
// answer list), and nps (0 to 10). Two waves of the tracker, a third added later, and another study that shares
// only "age".
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { answerCodesFit } from "../instrumentMatch";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

const WAVE1 = "brand,region,age,nps\n1,1,34,9\n8,2,51,10\n10,3,28,6\n1,1,45,8\n";
const WAVE2 = "brand,region,age,nps\n8,4,39,7\n1,2,62,10\n10,1,30,3\n";
const WAVE3 = "brand,region,age,nps\n10,1,41,9\n8,3,55,5\n";
const OTHER = "age,score\n40,3\n22,5\n";
const opts = (pairs: [number, string][]) => JSON.stringify(pairs.map(([code, label]) => ({ code: String(code), label })));

describe("answer codes fit (CB1 rule)", () => {
  it("every observed code must be listed; the list may hold more; unknown is never a fit", () => {
    expect(answerCodesFit([{ code: "1" }, { code: "8" }, { code: "10" }, { code: "99" }], ["1", "8", "10"])).toBe(true);
    expect(answerCodesFit([{ code: "01" }, { code: "8.0" }], ["1", "8"])).toBe(true);
    expect(answerCodesFit([{ code: "1" }, { code: "2" }, { code: "3" }], ["1", "2", "4"])).toBe(false);
    expect(answerCodesFit([], ["1"])).toBe(false);
    expect(answerCodesFit(null, ["1"])).toBe(false);
    expect(answerCodesFit([{ code: "1" }], null)).toBe(false);
    expect(answerCodesFit([{ code: "1" }], [])).toBe(false);
  });
});

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("codebook linked to every wave, confirmed where the codes fit (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const one = async (sql: string, p: unknown[]) => (await q(sql, p))[0].id as string;
  const setup = JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true });

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function project() {
    const run = await one("insert into runs (tenant_id, project_name) values ($1, 'Tracker') returning id", [tenant]);
    const data = async (name: string, csv: string | null) => {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      if (csv !== null) storage.objects.set(key, Buffer.from(csv));
      return one(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup) values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, name, key, setup],
      );
    };
    const codebook = await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, instrument_type) values ($1, $2, 'instrument', 'Master_Codebook.xlsx', $3, 'codebook') returning id", [tenant, run, randomUUID()]);
    const item = (order: number, code: string, text: string, options: string) =>
      one("insert into instrument_items (tenant_id, run_id, document_id, item_order, code, item_text, response_options) values ($1, $2, $3, $4, $5, $6, $7) returning id", [tenant, run, codebook, order, code, text, options]);
    const items = {
      brand: await item(1, "brand", "Which brand is your first choice?", opts([[1, "Toyota"], [8, "BMW"], [10, "Haval"]])),
      region: await item(2, "region", "Region", opts([[1, "North"], [2, "South"], [3, "East"]])),
      age: await item(3, "age", "Age in years", "[]"),
      nps: await item(4, "nps", "How likely are you to recommend us?", opts(Array.from({ length: 11 }, (_, i) => [i, String(i)] as [number, string]))),
    };
    return { run, codebook, items, data };
  }
  const linkOf = async (item: string, file: string) => (await q("select id, method, status, decided_by from instrument_links where item_id = $1 and data_document_id = $2", [item, file]))[0] ?? null;

  it("matches both waves, confirms brand and nps where the codes fit, suggests region in wave 2 and age, leaves the other study alone", async () => {
    const p = await project();
    const w1 = await p.data("wave1.csv", WAVE1);
    const w2 = await p.data("wave2.csv", WAVE2);
    const other = await p.data("other_study.csv", OTHER);
    const { matchCodebookToDataFiles } = await import("../instruments");
    const r = await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    expect(r.autoUnavailable).toBe(false);
    expect(r.files.map((f) => [f.dataDocumentId, f.status])).toEqual([[w1, "matched"], [w2, "matched"], [other, "few_names"]]);
    for (const w of [w1, w2]) {
      expect(await linkOf(p.items.brand, w)).toMatchObject({ method: "code", status: "confirmed", decided_by: "automatic" });
      expect(await linkOf(p.items.nps, w)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
      expect(await linkOf(p.items.age, w)).toMatchObject({ status: "suggested", decided_by: null });
    }
    expect(await linkOf(p.items.region, w1)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
    // Wave 2 holds region 4, which the codebook does not list: left for the researcher.
    expect(await linkOf(p.items.region, w2)).toMatchObject({ status: "suggested", decided_by: null });
    expect((await q("select count(*)::int as n from instrument_links where data_document_id = $1", [other]))[0].n).toBe(0);
    expect((await q("select instrument_for from documents where id = $1", [p.codebook]))[0].instrument_for).toBe(w1);
    // Repeating it adds nothing and changes nothing.
    const again = await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    expect(again.files.filter((f) => f.status === "matched").length).toBe(2);
    expect((await q("select count(*)::int as n from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1", [p.codebook]))[0].n).toBe(8);
  });

  it("the researcher's decisions survive matching again, including returning an automatic link to a suggestion", async () => {
    const p = await project();
    const w1 = await p.data("wave1.csv", WAVE1);
    const w2 = await p.data("wave2.csv", WAVE2);
    const { matchCodebookToDataFiles, setInstrumentLinkStatus } = await import("../instruments");
    await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    await setInstrumentLinkStatus(tenant, p.run, (await linkOf(p.items.brand, w1)).id, "rejected");
    await setInstrumentLinkStatus(tenant, p.run, (await linkOf(p.items.brand, w2)).id, "suggested");
    await setInstrumentLinkStatus(tenant, p.run, (await linkOf(p.items.nps, w1)).id, "confirmed");
    await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    expect(await linkOf(p.items.brand, w1)).toMatchObject({ status: "rejected", decided_by: "researcher" });
    expect(await linkOf(p.items.brand, w2)).toMatchObject({ status: "suggested", decided_by: "researcher" });
    expect(await linkOf(p.items.nps, w1)).toMatchObject({ status: "confirmed", decided_by: "researcher" });
  });

  it("a wave added later is matched on its own; an automatic link whose codes stop fitting goes back to a suggestion", async () => {
    const p = await project();
    const w1 = await p.data("wave1.csv", WAVE1);
    const { matchCodebookToDataFiles, getInstrumentSummaries } = await import("../instruments");
    await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    const w3 = await p.data("wave3.csv", WAVE3);
    expect((await getInstrumentSummaries(tenant, p.run)).get(p.codebook)?.unlinkedDataFiles).toBe(1);
    const added = await matchCodebookToDataFiles(tenant, p.run, p.codebook, { onlyUnlinked: true });
    expect(added.files.map((f) => [f.dataDocumentId, f.status])).toEqual([[w3, "matched"]]);
    expect(await linkOf(p.items.brand, w3)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
    expect((await getInstrumentSummaries(tenant, p.run)).get(p.codebook)?.unlinkedDataFiles).toBe(0);
    // The codebook no longer lists Haval (10), which wave 1 holds: brand goes back to a suggestion there.
    await q("update instrument_items set response_options = $2 where id = $1", [p.items.brand, opts([[1, "Toyota"], [8, "BMW"]])]);
    await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    expect(await linkOf(p.items.brand, w1)).toMatchObject({ status: "suggested", decided_by: null });
  });

  it("a file that cannot be read is reported as failed and the other waves are still matched", async () => {
    const p = await project();
    const broken = await p.data("wave0.csv", null);
    const w1 = await p.data("wave1.csv", WAVE1);
    const { matchCodebookToDataFiles } = await import("../instruments");
    const r = await matchCodebookToDataFiles(tenant, p.run, p.codebook);
    expect(r.files.find((f) => f.dataDocumentId === broken)?.status).toBe("failed");
    expect(r.files.find((f) => f.dataDocumentId === w1)?.status).toBe("matched");
    expect(await linkOf(p.items.brand, w1)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
  });

  it("before migration 0133 nothing is confirmed automatically and the result says so", async () => {
    const p = await project();
    const w1 = await p.data("wave1.csv", WAVE1);
    await q("alter table instrument_links drop column decided_by");
    try {
      const { matchCodebookToDataFiles } = await import("../instruments");
      const r = await matchCodebookToDataFiles(tenant, p.run, p.codebook);
      expect(r).toMatchObject({ autoUnavailable: true, autoConfirmed: 0 });
      expect(await q("select status from instrument_links where data_document_id = $1 and status <> 'suggested'", [w1])).toEqual([]);
    } finally {
      await q("alter table instrument_links add column decided_by text");
    }
  });
});
