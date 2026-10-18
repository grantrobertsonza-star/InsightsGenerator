import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
const storage = vi.hoisted(() => ({ fail: false, objects: new Set<string>(), uploadGate: null as null | (() => Promise<void>) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: () => ({ upload: async (path: string) => { await storage.uploadGate?.(); storage.objects.add(path); return { error: null }; }, remove: async (paths: string[]) => {
  if (storage.fail) return { error: { message: "Synthetic storage outage" } };
  paths.forEach(p => storage.objects.delete(p)); return { error: null };
} }) } } }));
describe.skipIf(!TEST_DATABASE_URL)("IMP-007 durable deletion cleanup", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb(); process.env.DATABASE_URL = db.url; process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic cleanup')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  async function document() {
    const path = `${tenant}/${run}/${randomUUID()}.csv`; storage.objects.add(path);
    const id = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','synthetic.csv',$3,'raw') returning id", [tenant, run, path])).rows[0].id;
    return { id, path };
  }
  it("storage plus trace failure leaves evidence intact or a durable cleanup record", async () => {
    const doc = await document(); storage.fail = true;
    await db.pool.query("create function refuse_cleanup_trace() returns trigger language plpgsql as $$ begin raise exception 'Synthetic trace outage'; end $$; create trigger refuse_cleanup_trace before insert on trace for each row execute function refuse_cleanup_trace()");
    const { deleteDocument } = await import("../documentActions");
    await deleteDocument(run, doc.id).catch(() => {});
    const docs = (await db.pool.query("select id from documents where id=$1", [doc.id])).rowCount;
    const traces = (await db.pool.query("select id from trace where run_id=$1 and event like 'document_storage_cleanup%'", [run])).rowCount;
    expect(docs! + traces!).toBeGreaterThan(0);
    expect(storage.objects.has(doc.path)).toBe(true);
    await db.pool.query("drop trigger refuse_cleanup_trace on trace; drop function refuse_cleanup_trace()");
    storage.fail = false;
  });
  it("storage outage leaves a discoverable job; scoped retry removes only orphaned files and is idempotent", async () => {
    const doc = await document(); storage.fail = true;
    const { deleteDocument, retryDocumentStorageCleanup } = await import("../documentActions");
    const { pendingDocumentStorageCleanupCount } = await import("../documentStorageCleanup");
    await deleteDocument(run, doc.id);
    expect((await db.pool.query("select id from documents where id=$1", [doc.id])).rowCount).toBe(0);
    expect(await pendingDocumentStorageCleanupCount(tenant, run)).toBe(1);
    expect(await retryDocumentStorageCleanup(run)).toMatchObject({ ok: false, error: expect.stringContaining("Synthetic storage outage") });
    expect(storage.objects.has(doc.path)).toBe(true);
    await retryDocumentStorageCleanup(randomUUID());
    expect(storage.objects.has(doc.path)).toBe(true);
    storage.fail = false;
    expect(await retryDocumentStorageCleanup(run)).toEqual({ ok: true });
    expect(await pendingDocumentStorageCleanupCount(tenant, run)).toBe(0);
    expect(storage.objects.has(doc.path)).toBe(false);
    expect(await retryDocumentStorageCleanup(run)).toEqual({ ok: true });
  });
  it("failed upload insertion plus storage and later trace failures retains write-ahead cleanup and safely retries", async () => {
    const { storeUploadedDocument } = await import("../documentUpload");
    const { retryDocumentStorageCleanup } = await import("../documentActions");
    await db.pool.query("create function refuse_document_insert() returns trigger language plpgsql as $$ begin raise exception 'Synthetic insert outage'; end $$; create trigger refuse_document_insert before insert on documents for each row execute function refuse_document_insert()");
    storage.fail = true;
    await expect(storeUploadedDocument(tenant, run, "table", new File(["q\nYes\n"], "recovery.csv"), "raw")).rejects.toThrow("cleanup remains pending");
    const pending = (await db.pool.query("select id,detail from trace where run_id=$1 and event='document_storage_cleanup_pending'", [run])).rows;
    expect(pending).toHaveLength(1);
    const orphan = pending[0].detail.storagePaths[0];
    expect(storage.objects.has(orphan)).toBe(true);
    await db.pool.query("create function refuse_later_trace() returns trigger language plpgsql as $$ begin raise exception 'Synthetic later trace outage'; end $$; create trigger refuse_later_trace before delete on trace for each row execute function refuse_later_trace()");
    storage.fail = false;
    expect(await retryDocumentStorageCleanup(run)).toMatchObject({ ok: false });
    expect((await db.pool.query("select id from trace where id=$1", [pending[0].id])).rowCount).toBe(1);
    await db.pool.query("drop trigger refuse_later_trace on trace; drop function refuse_later_trace(); drop trigger refuse_document_insert on documents; drop function refuse_document_insert()");
    expect(await retryDocumentStorageCleanup(run)).toEqual({ ok: true });
    const id = await storeUploadedDocument(tenant, run, "table", new File(["q\nYes\n"], "recovery.csv"), "raw");
    expect((await db.pool.query("select id from documents where id=$1", [id])).rowCount).toBe(1);
    expect((await db.pool.query("select id from trace where run_id=$1 and event='document_storage_cleanup_pending'", [run])).rowCount).toBe(0);
  });
  it("cleanup concurrent with an in-flight upload cannot remove the successfully stored source", async () => {
    const { storeUploadedDocument } = await import("../documentUpload");
    const { retryDocumentStorageCleanup } = await import("../documentActions");
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    storage.uploadGate = async () => { entered(); await gate; };
    const upload = storeUploadedDocument(tenant, run, "table", new File(["q\nNo\n"], "concurrent.csv"), "raw");
    await started;
    const cleanup = retryDocumentStorageCleanup(run);
    release();
    const id = await upload;
    expect(await cleanup).toEqual({ ok: true });
    storage.uploadGate = null;
    const path = (await db.pool.query("select storage_path from documents where id=$1", [id])).rows[0].storage_path;
    expect(storage.objects.has(path)).toBe(true);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("IMP-007 durable deletion cleanup", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
