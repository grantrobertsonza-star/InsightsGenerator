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

// Batch 56 (conformance L052, S2): rewording a confirmed codebook entry's label and reading the codebook again
// deleted the entry (its identity was its name plus its wording), and its confirmed link with it, so the meanings
// resting on it stopped applying. Through the actual readInstrumentItems, setInstrumentLinkStatus and
// getConfirmedItemsForData, the local engine and a real disposable PostgreSQL; storage is an in-memory stand-in.
//   - Reworded label, same name: the same item, its confirmed link kept, the new wording stored.
//   - Control: an entry removed from the codebook still goes, with its link.
const cb = (q1: string, extra = "") => Buffer.from(`Variable,Label,Values\nid,Respondent,as is\nq1,${q1},"1=Yes, 2=No"\n${extra}`, "utf-8");

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("a reworded codebook entry keeps its confirmed link on reread (real database, actual engine)", () => {
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
  async function setUp(first: Buffer) {
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id as string;
    const put = async (kind: "instrument" | "table", name: string, bytes: Buffer) => {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.objects.set(key, bytes);
      const id = (await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [tenant, run, kind, kind === "table" ? "raw" : null, name, key, kind === "instrument" ? "codebook" : null, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
      ))[0].id as string;
      return { id, key };
    };
    const data = await put("table", "poll.csv", Buffer.from("id,q1\n1,1\n2,2\n3,1\n", "utf-8"));
    const codebook = await put("instrument", "cb.csv", first);
    const { readInstrumentItems, suggestInstrumentLinks, setInstrumentLinkStatus } = await import("../instruments");
    await readInstrumentItems(tenant, run, codebook.id);
    await suggestInstrumentLinks(tenant, run, codebook.id, data.id);
    const link = (await q("select l.id, l.item_id from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1 and l.variable = 'q1'", [codebook.id]))[0];
    await setInstrumentLinkStatus(tenant, run, link.id, "confirmed");
    return { run, data: data.id, codebook, link };
  }
  // The changed file goes in under a new storage path, as a replaced file does (the engine reuses a download of the
  // same path for a short while).
  const reread = async (s: Awaited<ReturnType<typeof setUp>>, bytes: Buffer) => {
    const key = `${tenant}/${s.run}/${randomUUID()}-cb.csv`;
    storage.objects.set(key, bytes);
    await q("update documents set storage_path = $2 where id = $1", [s.codebook.id, key]);
    const { readInstrumentItems } = await import("../instruments");
    return readInstrumentItems(tenant, s.run, s.codebook.id);
  };

  it("the reworded entry is the same item, its confirmed link kept and the new wording stored", async () => {
    const s = await setUp(cb("Would you recommend us to a friend?"));
    await reread(s, cb("Would you recommend us to a friend or colleague?"));
    const item = (await q("select id, item_text from instrument_items where document_id = $1 and code = 'q1'", [s.codebook.id]))[0];
    expect(item).toEqual({ id: s.link.item_id, item_text: "Would you recommend us to a friend or colleague?" });
    expect((await q("select status from instrument_links where id = $1", [s.link.id]))[0]?.status).toBe("confirmed");
    const { getConfirmedItemsForData } = await import("../instruments");
    expect((await getConfirmedItemsForData(tenant, s.run, s.data)).find((c) => c.variable === "q1")?.text).toBe("Would you recommend us to a friend or colleague?");
  });

  it("control: an entry removed from the codebook still goes, with its link", async () => {
    const s = await setUp(cb("Recommend?"));
    await reread(s, Buffer.from("Variable,Label,Values\nid,Respondent,as is\n", "utf-8"));
    expect(await q("select id from instrument_items where id = $1", [s.link.item_id])).toEqual([]);
    expect(await q("select id from instrument_links where id = $1", [s.link.id])).toEqual([]);
  });
});
