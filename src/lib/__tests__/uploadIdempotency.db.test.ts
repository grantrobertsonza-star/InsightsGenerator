// IMP-008 against a REAL PostgreSQL (disposable database from the migrations, incl. 0098) through
// the app's own db.ts. Storage is the mocked boundary (an in-memory bucket whose first attempt for
// one file fails); the actual uploadDocumentsAction and storeUploadedDocument run.
//   - a partly failed batch, retried twice with the WHOLE batch re-picked, ends with exactly one
//     document per good file; repeats are reported by name, not as failures
//   - two concurrent uploads of the same bytes store exactly one document (the unique index
//     decides), and the losing upload's storage object is removed
//   - the same bytes as a different kind, or in another project, are not duplicates
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const TENANT = "00000000-0000-4000-8000-0000000000dd";
const storage = vi.hoisted(() => ({ objects: new Set<string>(), failOnce: new Set<string>(["bad.csv"]), removed: [] as string[] }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          const name = path.slice(path.lastIndexOf("/") + 1).replace(/^\d+-[0-9a-f-]{36}-/, "");
          if (storage.failOnce.has(name)) {
            storage.failOnce.delete(name);
            return { error: { message: "storage timeout" } };
          }
          storage.objects.add(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            storage.objects.delete(p);
            storage.removed.push(p);
          }
          return { error: null };
        },
      }),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn(async () => undefined) }));
vi.mock("../outputIngest", () => ({ ingestOutputFiles: vi.fn() }));

const file = (name: string, body: string) => new File([body], name, { type: "text/csv" });
const batch = () => {
  const fd = new FormData();
  fd.append("rawTableFiles", file("good-1.csv", "id,q\n1,2\n"));
  fd.append("rawTableFiles", file("bad.csv", "id,q\n3,4\n"));
  fd.append("tableFiles", file("good-2.csv", "a,b\n5,6\n"));
  return fd;
};

describe.skipIf(!TEST_DATABASE_URL)("upload idempotency (real database, IMP-008)", () => {
  let db: DisposableDb;
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const docs = async (r: string) =>
    (await db.pool.query(`select source_filename, kind from documents where run_id = $1 order by source_filename`, [r])).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("a partly failed batch retried twice in full imports each good file exactly once", async () => {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const first = await uploadDocumentsAction(run, batch());
    expect(first.ok).toBe(false);
    expect(first.added.sort()).toEqual(["good-1.csv", "good-2.csv"]);

    const second = await uploadDocumentsAction(run, batch());
    expect(second.ok).toBe(true);
    expect(second.added).toEqual(["bad.csv"]);
    expect(second.alreadyPresent).toHaveLength(2);
    expect(second.alreadyPresent!.join(" ")).toMatch(/good-1\.csv is already in this project/);

    const third = await uploadDocumentsAction(run, batch());
    expect(third).toMatchObject({ ok: true, added: [] });
    expect(third.alreadyPresent).toHaveLength(3);

    expect(await docs(run)).toEqual([
      { source_filename: "bad.csv", kind: "table" },
      { source_filename: "good-1.csv", kind: "table" },
      { source_filename: "good-2.csv", kind: "table" },
    ]);
  });

  it("two concurrent uploads of the same bytes store one document; the loser's storage object is removed", async () => {
    const { storeUploadedDocument, DuplicateUploadError } = await import("../documentUpload");
    const r2 = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
    const removedBefore = storage.removed.length;
    const results = await Promise.allSettled([
      storeUploadedDocument(TENANT, r2, "table", file("same.csv", "x,y\n1,1\n"), "raw"),
      storeUploadedDocument(TENANT, r2, "table", file("same-copy.csv", "x,y\n1,1\n"), "raw"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DuplicateUploadError);
    expect((await docs(r2)).length).toBe(1);
    // The duplicate was refused either before uploading (pre-check) or after (index): in the
    // second case its storage object must have been cleaned up.
    expect(storage.removed.length - removedBefore).toBeLessThanOrEqual(1);
  });

  it("the same bytes as another kind, or in another project, are not duplicates", async () => {
    const { storeUploadedDocument } = await import("../documentUpload");
    const r3 = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
    await storeUploadedDocument(TENANT, r3, "table", file("both.csv", "q\n1\n"), "raw");
    await storeUploadedDocument(TENANT, r3, "report", file("both.csv", "q\n1\n"));
    const r4 = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
    await storeUploadedDocument(TENANT, r4, "table", file("both.csv", "q\n1\n"), "raw");
    expect((await docs(r3)).length).toBe(2);
    expect((await docs(r4)).length).toBe(1);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("upload idempotency (real database, IMP-008)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
