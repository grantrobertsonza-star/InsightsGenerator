// Opening an imported file from the Import screen (Grant 2026-10-19): the actual action against a
// real database, with storage (the external boundary) recording the links it is asked for.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
const storage = vi.hoisted(() => ({ calls: [] as { path: string; seconds: number; options?: { download?: string } }[], fail: false }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, seconds: number, options?: { download?: string }) => {
          storage.calls.push({ path, seconds, options });
          return storage.fail ? { data: null, error: { message: "storage unavailable" } } : { data: { signedUrl: `https://storage.test/sign/${path}` }, error: null };
        },
      }),
    },
  },
}));

describe.skipIf(!TEST_DATABASE_URL)("open an imported file (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string;
  const doc = async (r: string, name: string, preview: string | null) =>
    (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,preview_storage_path) values($1,$2,'report',$3,$4,$5) returning id", [tenant, r, name, `${tenant}/${r}/${name}`, preview])).rows[0].id as string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic open')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    storage.calls.length = 0;
    storage.fail = false;
  });
  const open = async (runId: string, documentId: string) => (await import("../documentOpenActions")).openDocumentAction(runId, documentId);

  it("a Word file with a PDF copy opens the copy in the browser; an original PDF opens as itself", async () => {
    const word = await doc(run, "brief.docx", "copies/brief.docx.preview.pdf");
    expect(await open(run, word)).toEqual({ ok: true, url: "https://storage.test/sign/copies/brief.docx.preview.pdf", opens: "pdf" });
    const pdf = await doc(run, "report.pdf", null);
    expect(await open(run, pdf)).toMatchObject({ ok: true, opens: "pdf" });
    expect(storage.calls.map((c) => [c.path.split("/").at(-1), c.seconds, c.options])).toEqual([
      ["brief.docx.preview.pdf", 600, undefined],
      ["report.pdf", 600, undefined],
    ]);
  });

  it("a file with no PDF view downloads under its own name", async () => {
    const sav = await doc(run, "FinScope SA 2024.sav", null);
    expect(await open(run, sav)).toMatchObject({ ok: true, opens: "download" });
    expect(storage.calls[0]).toMatchObject({ seconds: 600, options: { download: "FinScope SA 2024.sav" } });
  });

  it("a file from another project gets no link, and a storage failure is reported, not hidden", async () => {
    const elsewhere = await doc(other, "other.docx", null);
    expect(await open(run, elsewhere)).toEqual({ ok: false, error: "That file is not in this project." });
    expect(storage.calls).toEqual([]);
    storage.fail = true;
    const mine = await doc(run, "mine.docx", null);
    expect(await open(run, mine)).toMatchObject({ ok: false, error: expect.stringMatching(/could not be opened: storage unavailable/) });
  });
});
