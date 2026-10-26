// Technical documents (Grant, 2026-10-24; migration 0112) added through Import data, against a real
// disposable PostgreSQL built from every migration, with the actual uploadDocumentsAction,
// storeUploadedDocument and readContextDocument. Storage is an in-memory stand-in; the model client
// is stubbed (no model call is made for these files).
//   - a text technical document is stored as kind 'technical', its text read on upload, status ready;
//   - one whose text cannot be read is still stored, and its status says the read failed;
//   - before 0112 the upload is refused with a message naming the migration: no document row, the
//     stored object removed, no cleanup left pending; once 0112 is back the same file is added.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../outputIngest", () => ({ ingestOutputFiles: vi.fn() }));

const TENANT = "00000000-0000-4000-8000-0000000000ee";
const storage = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>(), removed: [] as string[] }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (path: string, body: Uint8Array) => {
          storage.objects.set(path, new Uint8Array(body));
          return { error: null };
        },
        download: async (path: string) =>
          storage.objects.has(path) ? { data: new Blob([storage.objects.get(path)!.slice()]), error: null } : { data: null, error: { message: "not found" } },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            storage.objects.delete(p);
            storage.removed.push(p);
          }
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

const TEXT = "FinScope SA 2024 technical report.\n\nSampling: a stratified multi-stage design with enumeration areas as clusters.\n\nWeighting: benchmark weights.";

describe.skipIf(!TEST_DATABASE_URL)("technical documents added through Import (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const upload = async (name: string, body: string | Uint8Array, type = "text/plain") => {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const fd = new FormData();
    fd.append("technicalFiles", new File([typeof body === "string" ? body : body.slice()], name, { type }));
    return uploadDocumentsAction(run, fd);
  };
  const row = async (name: string) =>
    (await q("select kind, extracted_text, processing_status from documents where run_id = $1 and source_filename = $2", [run, name])).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await q("insert into tenants (id, name) values ($1, 'T')", [TENANT]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Technical') returning id", [TENANT])).rows[0].id;
  }, 120000);
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool?.end?.();
    await db.drop();
  });

  it("stores a technical document as kind technical and reads its text on upload", async () => {
    expect(await upload("FinScope Technical Report.txt", TEXT)).toEqual({ ok: true, added: ["FinScope Technical Report.txt"], alreadyPresent: [] });
    expect(await row("FinScope Technical Report.txt")).toEqual([{ kind: "technical", extracted_text: TEXT, processing_status: "ready" }]);
    // The assistant's tool reads it.
    const { runTechnicalDocumentTool } = await import("../researchAssistantTools");
    const found = await runTechnicalDocumentTool(TENANT, run, "search_technical_documents", { query: "enumeration areas clusters" });
    expect(found.content).toContain("FinScope Technical Report.txt, passage 1 of 1");
  });

  it("keeps a technical document whose text cannot be read, with its status saying so", async () => {
    const r = await upload("Scanned methodology.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0x01]), "application/pdf");
    expect(r).toMatchObject({ ok: true, added: ["Scanned methodology.pdf"] });
    expect(await row("Scanned methodology.pdf")).toEqual([{ kind: "technical", extracted_text: null, processing_status: "failed" }]);
    const { runTechnicalDocumentTool } = await import("../researchAssistantTools");
    // Not offered for search: it has no text. The readable one still is.
    const found = await runTechnicalDocumentTool(TENANT, run, "search_technical_documents", { query: "methodology" });
    expect(found.content).not.toContain("Scanned methodology.pdf");
  });

  it("before migration 0112 the upload is refused with nothing kept; with 0112 back the same file is added", async () => {
    // The kind check as it was before 0112 (not validated against the technical rows already added above).
    await q("alter table documents drop constraint documents_kind_check");
    await q("alter table documents add constraint documents_kind_check check (kind in ('report', 'table', 'evidence', 'transcript', 'instrument', 'output')) not valid");
    const objectsBefore = storage.objects.size;
    try {
      const r = await upload("Weighting note.txt", "Weights were raked to province totals.");
      expect(r).toMatchObject({ ok: false, added: [], error: expect.stringContaining("Weighting note.txt: Technical documents need the database update 0112_technical_documents.sql. Nothing was stored") });
      expect(await row("Weighting note.txt")).toEqual([]);
      expect(storage.objects.size).toBe(objectsBefore);
      expect(storage.removed.some((p) => p.endsWith("Weighting_note.txt"))).toBe(true);
      expect((await q("select count(*)::int n from trace where run_id = $1 and event = 'document_storage_cleanup_pending'", [run])).rows[0].n).toBe(0);
    } finally {
      await q("alter table documents drop constraint documents_kind_check");
      await q("alter table documents add constraint documents_kind_check check (kind in ('report', 'table', 'evidence', 'transcript', 'instrument', 'output', 'technical'))");
    }
    expect(await upload("Weighting note.txt", "Weights were raked to province totals.")).toMatchObject({ ok: true, added: ["Weighting note.txt"] });
    expect(await row("Weighting note.txt")).toEqual([{ kind: "technical", extracted_text: "Weights were raked to province totals.", processing_status: "ready" }]);
  });
});
