// Codex E1-F03: "Update table" saves the edited table and removes the draft it replaces in one transaction, and a retry
// of the same edit converges on one table. Real disposable PostgreSQL and the actual engine on the banking pack; a
// disposable trigger refusing the draft's deletion stands in for a failure between the two steps. Storage is an
// in-memory stand-in.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
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

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("E1-F03: Update table is atomic and its retry converges (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  let doc = "";
  const base = { source: "workspace" as const, columnVars: ["segment"], rowItems: [{ key: "company_csat5", label: "Satisfaction", vars: ["company_csat5"] }], weightVar: "weight", correction: "fdr" as const, excludeDk: true, meanRows: false, columnGroups: {} };
  const edited = { ...base, columnVars: ["company"] };

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Update table') returning id", [tenant]))[0].id;
    const key = `${tenant}/${run}/${randomUUID()}-w1.sav`;
    storage.objects.set(key, readFileSync(path.join(process.cwd(), "fixtures", "csm", "banking_relationship_w1_labels.sav")));
    doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'banking_w1.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: "Wave 1" })],
    ))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const drafts = async () => (await q("select id, crosstab->'savedRequest'->'columnVars' as cols from document_tables where document_id = $1 and crosstab is not null order by table_index", [doc])) as { id: string; cols: string[] }[];
  const freshDraft = async () => {
    await q("delete from document_tables where document_id = $1 and crosstab is not null", [doc]);
    const { addCrosstabAction } = await import("../crosstabActions");
    const r = await addCrosstabAction(run, doc, base);
    if (!r.ok) throw new Error(r.error);
    return (await drafts())[0].id;
  };

  it("a failure removing the old draft keeps no new table; the retry then gives exactly one edited draft", async () => {
    const { replaceDraftCrosstabAction } = await import("../crosstabActions");
    const old = await freshDraft();
    await q(`create function refuse_delete() returns trigger language plpgsql as $$ begin raise exception 'refused for the test'; end $$`);
    await q("create trigger refuse_delete before delete on document_tables for each row execute function refuse_delete()");
    try {
      expect(await replaceDraftCrosstabAction(run, doc, old, edited)).toMatchObject({ ok: false });
      expect(await drafts()).toEqual([{ id: old, cols: ["segment"] }]);
    } finally {
      await q("drop trigger refuse_delete on document_tables");
      await q("drop function refuse_delete()");
    }
    const r = await replaceDraftCrosstabAction(run, doc, old, edited);
    expect(r).toMatchObject({ ok: true, replaced: true });
    const after = await drafts();
    expect(after.map((d) => d.cols)).toEqual([["company"]]);
    // The answer was lost and the same edit is sent again: the same table, still one.
    const again = await replaceDraftCrosstabAction(run, doc, old, edited);
    expect(again).toMatchObject({ ok: true, replaced: true, tableId: r.ok ? r.tableId : "" });
    expect((await drafts()).length).toBe(1);
  });

  it("two Updates of one draft at the same moment: the same edit saves one table; a different edit is refused, not added", async () => {
    const { replaceDraftCrosstabAction } = await import("../crosstabActions");
    let old = await freshDraft();
    const both = await Promise.all([replaceDraftCrosstabAction(run, doc, old, edited), replaceDraftCrosstabAction(run, doc, old, edited)]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(new Set(both.map((r) => (r.ok ? r.tableId : ""))).size).toBe(1);
    expect((await drafts()).map((d) => d.cols)).toEqual([["company"]]);
    old = await freshDraft();
    const other = { ...base, columnVars: [] as string[] };
    const mixed = await Promise.all([replaceDraftCrosstabAction(run, doc, old, edited), replaceDraftCrosstabAction(run, doc, old, other)]);
    expect(mixed.filter((r) => r.ok).length).toBe(1);
    expect(mixed.find((r) => !r.ok)).toMatchObject({ ok: false, error: expect.stringContaining("already updated with another edit") });
    expect((await drafts()).length).toBe(1);
  });

  it("a draft committed before the update is kept (never removed by an edit); the edited table is added beside it", async () => {
    const { replaceDraftCrosstabAction } = await import("../crosstabActions");
    const old = await freshDraft();
    await q("update document_tables set crosstab_status = 'committed' where id = $1", [old]);
    expect(await replaceDraftCrosstabAction(run, doc, old, edited)).toMatchObject({ ok: false, error: expect.stringContaining("Only a draft") });
    expect((await drafts()).map((d) => d.id)).toEqual([old]);
  });
});
