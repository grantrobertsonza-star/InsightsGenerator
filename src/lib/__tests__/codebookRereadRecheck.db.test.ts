// Codex E1-F04: Read again on a codebook (readInstrumentItems, no Match click) whose answer list changed withdraws the
// automatic confirmations of the changed entries in the same transaction and checks them again through the matching
// owner on every wave: an entry that still fits is confirmed again, one that no longer covers a code the wave holds
// stays a suggestion, a researcher's decision is untouched, and a failed read changes nothing. Local engine (real
// dictionaries) and a real disposable PostgreSQL; storage and the model are mocked (a CSV codebook needs no model).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

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

const WAVE1 = "brand,region\n1,1\n8,2\n10,3\n";
const WAVE3 = "brand,region\n1,1\n8,2\n";
const codebook = (brandValues: string) => `Variable,Label,Values\nbrand,Which brand is your first choice?,"${brandValues}"\nregion,Region,"1=North, 2=South, 3=East"\n`;
const FULL = "1=Toyota, 8=BMW, 10=Haval";

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("E1-F04: Read again re-checks automatic codebook confirmations (real database, actual engine)", () => {
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
    const file = async (kind: "table" | "instrument", name: string, body: string) => {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.objects.set(key, Buffer.from(body));
      const id = kind === "table"
        ? await one("insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup) values ($1, $2, 'table', 'raw', $3, $4, $5) returning id", [tenant, run, name, key, setup])
        : await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, instrument_type) values ($1, $2, 'instrument', $3, $4, 'codebook') returning id", [tenant, run, name, key]);
      return { id, key };
    };
    const w1 = await file("table", "wave1.csv", WAVE1);
    const w3 = await file("table", "wave3.csv", WAVE3);
    const cb = await file("instrument", "codebook.csv", codebook(FULL));
    const { readInstrumentItems, matchCodebookToDataFiles } = await import("../instruments");
    await readInstrumentItems(tenant, run, cb.id);
    await matchCodebookToDataFiles(tenant, run, cb.id);
    // A revised workbook is stored under a new key (the engine's local copy is kept per storage path).
    const reread = async (brandValues: string) => {
      const key = `${tenant}/${run}/${randomUUID()}-codebook.csv`;
      storage.objects.set(key, Buffer.from(codebook(brandValues)));
      await q("update documents set storage_path = $2 where id = $1", [cb.id, key]);
      return readInstrumentItems(tenant, run, cb.id);
    };
    return { run, w1: w1.id, w3: w3.id, cb: cb.id, reread };
  }
  const link = async (cb: string, variable: string, file: string) =>
    (await q("select l.id, l.status, l.decided_by from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1 and l.variable = $2 and l.data_document_id = $3", [cb, variable, file]))[0] ?? null;
  const confirmedBrand = async (run: string, file: string) => {
    const { getConfirmedItemsForData } = await import("../instruments");
    return (await getConfirmedItemsForData(tenant, run, file)).some((i) => i.variable === "brand" && i.confirmed);
  };

  it("before: brand confirmed automatically on both waves", async () => {
    const p = await project();
    for (const w of [p.w1, p.w3]) expect(await link(p.cb, "brand", w)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
  });

  it("Read again with a list that loses code 10: no longer confirmed on wave 1 (holds 10), still confirmed on wave 3 (holds 1 and 8)", async () => {
    const p = await project();
    const r = await p.reread("1=Toyota, 8=BMW");
    expect(r.automaticRecheck).toEqual({ withdrawn: 2, status: "done", reconfirmed: 1 });
    expect(await link(p.cb, "brand", p.w1)).toMatchObject({ status: "suggested", decided_by: null });
    expect(await confirmedBrand(p.run, p.w1)).toBe(false);
    expect(await link(p.cb, "brand", p.w3)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
    expect(await confirmedBrand(p.run, p.w3)).toBe(true);
    // An unchanged entry (region) was not touched.
    expect(await link(p.cb, "region", p.w1)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
  });

  it("a changed list that still covers every code: confirmed again on both waves", async () => {
    const p = await project();
    const r = await p.reread("1=Toyota, 8=BMW, 10=Haval, 12=Kia");
    expect(r.automaticRecheck).toEqual({ withdrawn: 2, status: "done", reconfirmed: 2 });
    for (const w of [p.w1, p.w3]) expect(await link(p.cb, "brand", w)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
  });

  it("the researcher's own confirmation and rejection survive the reread unchanged", async () => {
    const p = await project();
    const { setInstrumentLinkStatus } = await import("../instruments");
    await setInstrumentLinkStatus(tenant, p.run, (await link(p.cb, "brand", p.w1)).id, "confirmed");
    await setInstrumentLinkStatus(tenant, p.run, (await link(p.cb, "brand", p.w3)).id, "rejected");
    const r = await p.reread("1=Toyota, 8=BMW");
    expect(r.automaticRecheck).toBeUndefined();
    expect(await link(p.cb, "brand", p.w1)).toMatchObject({ status: "confirmed", decided_by: "researcher" });
    expect(await link(p.cb, "brand", p.w3)).toMatchObject({ status: "rejected", decided_by: "researcher" });
  });

  it("a read that fails keeps the previous publication and its confirmations", async () => {
    const p = await project();
    await q("update documents set storage_path = $2 where id = $1", [p.cb, `${tenant}/${p.run}/${randomUUID()}-missing.csv`]);
    const { readInstrumentItems } = await import("../instruments");
    await expect(readInstrumentItems(tenant, p.run, p.cb)).rejects.toThrow();
    expect(await link(p.cb, "brand", p.w1)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
  });

  it("recovery: Read again with the full list confirms wave 1 again", async () => {
    const p = await project();
    await p.reread("1=Toyota, 8=BMW");
    expect(await link(p.cb, "brand", p.w1)).toMatchObject({ status: "suggested" });
    const r = await p.reread(FULL);
    expect(r.automaticRecheck).toMatchObject({ status: "done" });
    expect(await link(p.cb, "brand", p.w1)).toMatchObject({ status: "confirmed", decided_by: "automatic" });
    expect(await confirmedBrand(p.run, p.w1)).toBe(true);
  });
});
