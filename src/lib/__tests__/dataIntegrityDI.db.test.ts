// Codex DI-F01 to DI-F07 (2026-10-24), through the actual server actions and library functions on a
// real disposable PostgreSQL. Controlled: object storage (each stored file's bytes, or a download
// error), Next's cache/after() and the signed-in request (the tenant is switched to B for the
// foreign-tenant cases). The writes check run and tenant explicitly, so the owner connection used here
// exercises the same refusals the restricted application role would.
//   F01 merge: another project's or tenant's destination, and a source from another project, are
//       refused with nothing moved or removed; a clash is refused; a healthy merge moves and removes
//   F02 make findings: all table files unreadable fails and retires nothing; some unreadable keeps
//       their findings and replaces the readable ones; all readable replaces all
//   F03 checks: wrong project, foreign tenant and missing sets are refused and another project's
//       checks are untouched; a failed write is an error, not a stored result; a retry stores
//   F04 set labels: a stale or gone editor is refused with what is stored; a deliberate replacement and
//       a healthy save store; the winning wave label is what is kept
//   F05 processing status: true only when this tenant's document row changed
//   F06 rename: stale and gone refused, blank refused, healthy and deliberate replacement stored
//   F07 history note: a retired finding's history row keeps its note (Unicode); the history CSV shows
//       it; without the column, retiring a noted finding is refused and rolls back
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/csvField", async () => await import("../csvField"));
const store = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async (p: string) =>
          store.files.has(p) ? { data: { arrayBuffer: async () => Buffer.from(store.files.get(p)!) }, error: null } : { data: null, error: { message: "synthetic download failure" } },
        ),
        remove: vi.fn(async () => ({ error: null })),
        upload: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

const A = randomUUID();
const B = randomUUID();
const CSV = "term,estimate\nage,0.12\nincome,0.30\n";

describe.skipIf(!TEST_DATABASE_URL)("DI-F01..F07 data integrity (real database)", () => {
  let db: DisposableDb;
  let runA = "", runA2 = "", runB = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0];
  const as = (tenant: string) => { process.env.DEFAULT_TENANT_ID = tenant; };
  const set = async (tenant: string, run: string, name = "Set", wave: string | null = null) =>
    (await one("insert into output_sets (tenant_id, run_id, name, wave_label) values ($1,$2,$3,$4) returning id", [tenant, run, name, wave])).id as string;
  /** An output file in a set; `readable` puts its bytes in storage, otherwise its download fails. */
  const file = async (tenant: string, run: string, setId: string, name: string, readable = true) => {
    const path = `${tenant}/${run}/${randomUUID()}-${name}`;
    if (readable) store.files.set(path, CSV);
    return (await one(
      "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, output_set_id, output_path) values ($1,$2,'output',$3,$4,$5,$3) returning id",
      [tenant, run, name, path, setId],
    )).id as string;
  };
  const finding = async (tenant: string, run: string, doc: string, text: string, note: string | null = null) =>
    (await one(
      "insert into findings (tenant_id, run_id, origin, finding_text, status, source_document_id, researcher_note, pattern_type) values ($1,$2,'generated',$3,'accepted',$4,$5,'level') returning id",
      [tenant, run, text, doc, note],
    )).id as string;
  const live = async (doc: string) => (await db.pool.query("select finding_text from findings where source_document_id = $1 order by finding_text", [doc])).rows.map((r) => r.finding_text);
  const actions = async () => await import("../outputSetActions");

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    await db.pool.query("insert into tenants (id, name) values ($1,'A'),($2,'B')", [A, B]);
    [runA, runA2] = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1,'A one'),($1,'A two') returning id", [A])).rows.map((r) => r.id);
    runB = (await one("insert into runs (tenant_id, project_name) values ($1,'B') returning id", [B])).id;
    as(A);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  describe("F01 merge", () => {
    it("a destination in another project or tenant, or a source from another project, is refused and nothing moves", async () => {
      as(A);
      const { mergeOutputSetsAction } = await actions();
      const from = await set(A, runA, "From");
      const doc = await file(A, runA, from, "a.csv");
      const otherProject = await set(A, runA2, "Other project");
      const otherTenant = await set(B, runB, "Other tenant");
      for (const into of [otherProject, otherTenant]) {
        const r = await mergeOutputSetsAction(runA, from, into);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/not in this project/);
      }
      const wrongSource = await set(A, runA2, "Source elsewhere");
      const into = await set(A, runA, "Into");
      expect((await mergeOutputSetsAction(runA, wrongSource, into)).ok).toBe(false);
      expect((await one("select output_set_id from documents where id = $1", [doc])).output_set_id).toBe(from);
      expect(Number((await one("select count(*) as n from output_sets where id = any($1::uuid[])", [[from, otherProject, otherTenant, wrongSource]])).n)).toBe(4);
    });

    it("a clash is refused; a healthy merge moves the files and removes the emptied set", async () => {
      as(A);
      const { mergeOutputSetsAction } = await actions();
      const x = await set(A, runA, "X");
      const y = await set(A, runA, "Y");
      await file(A, runA, x, "same.csv");
      await file(A, runA, y, "same.csv");
      expect((await mergeOutputSetsAction(runA, x, y)).ok).toBe(false);
      const p = await set(A, runA, "P");
      const q = await set(A, runA, "Q");
      const d = await file(A, runA, p, "p.csv");
      expect(await mergeOutputSetsAction(runA, p, q)).toEqual({ ok: true, moved: 1 });
      expect((await one("select output_set_id from documents where id = $1", [d])).output_set_id).toBe(q);
      expect(await one("select id from output_sets where id = $1", [p])).toBeUndefined();
    });
  });

  describe("F02 make findings with unreadable files", () => {
    it("every table file unreadable: the reading fails and no finding is retired", async () => {
      as(A);
      const { generateOutputFindingsAction } = await actions();
      const s = await set(A, runA, "Unread");
      const d = await file(A, runA, s, "gone.csv", false);
      await finding(A, runA, d, "Reviewed earlier finding");
      const r = await generateOutputFindingsAction(runA, s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/None of this set's table files could be read \(gone\.csv\)/);
      expect(await live(d)).toEqual(["Reviewed earlier finding"]);
    });

    it("some unreadable: their findings are kept, the readable file's are replaced, and the result names them", async () => {
      as(A);
      const { generateOutputFindingsAction } = await actions();
      const s = await set(A, runA, "Partly");
      const ok = await file(A, runA, s, "ok.csv");
      const bad = await file(A, runA, s, "bad.csv", false);
      await finding(A, runA, ok, "Old finding on the readable file");
      await finding(A, runA, bad, "Reviewed finding on the unreadable file");
      const r = await generateOutputFindingsAction(runA, s);
      expect(r).toMatchObject({ ok: true, saved: true, keptFrom: ["bad.csv"] });
      expect(await live(bad)).toEqual(["Reviewed finding on the unreadable file"]);
      expect(await live(ok)).not.toContain("Old finding on the readable file");
      // A later healthy reading replaces it.
      const path = (await one("select storage_path from documents where id = $1", [bad])).storage_path;
      store.files.set(path, CSV);
      expect(await generateOutputFindingsAction(runA, s)).toMatchObject({ ok: true, keptFrom: [] });
      expect(await live(bad)).not.toContain("Reviewed finding on the unreadable file");
    });
  });

  describe("F03 checks", () => {
    it("a set of another project, another tenant or none is refused, and the other project's checks are untouched", async () => {
      as(A);
      const { checkOutputSetAction } = await actions();
      const elsewhere = await set(A, runA2, "Elsewhere");
      await db.pool.query("update output_sets set checks = '{\"sentinel\":true}' where id = $1", [elsewhere]);
      const foreign = await set(B, runB, "Foreign");
      for (const id of [elsewhere, foreign, randomUUID()]) {
        const r = await checkOutputSetAction(runA, id);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/not in this project/);
      }
      expect((await one("select checks from output_sets where id = $1", [elsewhere])).checks).toEqual({ sentinel: true });
    });

    it("a failed write is an error and leaves the earlier checks; a retry stores the new ones", async () => {
      as(A);
      const { checkOutputSetAction } = await actions();
      const s = await set(A, runA, "Checked");
      await file(A, runA, s, "c.csv");
      await db.pool.query("update output_sets set checks = '{\"sentinel\":true}' where id = $1", [s]);
      await db.pool.query(`create or replace function di_checks_fault() returns trigger language plpgsql as $$
        begin if new.checks is distinct from old.checks then raise exception 'synthetic checks write fault'; end if; return new; end $$`);
      await db.pool.query("create trigger di_checks_fault before update on output_sets for each row execute function di_checks_fault()");
      try {
        const r = await checkOutputSetAction(runA, s);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/synthetic checks write fault/);
        expect((await one("select checks from output_sets where id = $1", [s])).checks).toEqual({ sentinel: true });
      } finally {
        await db.pool.query("drop trigger di_checks_fault on output_sets");
      }
      const again = await checkOutputSetAction(runA, s);
      expect(again).toMatchObject({ ok: true, saved: true });
      expect((await one("select checks from output_sets where id = $1", [s])).checks.analysedAt).toBeTruthy();
    });
  });

  describe("F04 set name and wave label", () => {
    it("a stale editor is refused with the winning values; replacing deliberately stores; the winning wave is kept otherwise", async () => {
      as(A);
      const { saveOutputSetAction } = await actions();
      const s = await set(A, runA, "Survey", "2024");
      const opened = { name: "Survey", waveLabel: "2024" };
      expect(await saveOutputSetAction(runA, s, "Survey", "2025", opened)).toEqual({ ok: true });
      const stale = await saveOutputSetAction(runA, s, "Survey", "2023", opened);
      expect(stale).toMatchObject({ ok: false, conflict: true, current: { name: "Survey", waveLabel: "2025" } });
      expect((await one("select wave_label from output_sets where id = $1", [s])).wave_label).toBe("2025");
      expect(await saveOutputSetAction(runA, s, "Survey", "2023", { name: "Survey", waveLabel: "2025" })).toEqual({ ok: true });
      expect((await one("select wave_label from output_sets where id = $1", [s])).wave_label).toBe("2023");
    });

    it("a gone, other-project or foreign set is refused and never reported as saved", async () => {
      const { saveOutputSetAction } = await actions();
      as(A);
      const elsewhere = await set(A, runA2, "Elsewhere", "w1");
      const r1 = await saveOutputSetAction(runA, elsewhere, "Renamed", "w9", { name: "Elsewhere", waveLabel: "w1" });
      expect(r1).toMatchObject({ ok: false, conflict: true, current: null });
      expect((await one("select name, wave_label from output_sets where id = $1", [elsewhere]))).toEqual({ name: "Elsewhere", wave_label: "w1" });
      expect((await saveOutputSetAction(runA, randomUUID(), "X", "", { name: "X", waveLabel: "" })).ok).toBe(false);
      as(B);
      const foreign = await set(B, runB, "B set");
      as(A);
      expect((await saveOutputSetAction(runB, foreign, "Hijack", "", { name: "B set", waveLabel: "" })).ok).toBe(false);
      expect((await one("select name from output_sets where id = $1", [foreign])).name).toBe("B set");
    });
  });

  describe("F05 processing status", () => {
    it("is true only when this tenant's document row changed", async () => {
      const { markDocumentProcessingStatus } = await import("../documentUpload");
      const s = await set(A, runA, "Status");
      const mine = await file(A, runA, s, "m.csv");
      const theirs = await file(B, runB, await set(B, runB, "B status"), "t.csv");
      expect(await markDocumentProcessingStatus(A, mine, "ready")).toBe(true);
      expect(await markDocumentProcessingStatus(A, theirs, "ready")).toBe(false);
      expect((await one("select processing_status from documents where id = $1", [theirs])).processing_status).toBeNull();
      expect(await markDocumentProcessingStatus(A, randomUUID(), "failed")).toBe(false);
      await db.pool.query("delete from documents where id = $1", [mine]);
      expect(await markDocumentProcessingStatus(A, mine, "incomplete")).toBe(false);
    });
  });

  describe("F06 rename", () => {
    it("stale, gone and blank renames are refused; a healthy rename and a deliberate replacement are stored", async () => {
      as(A);
      const { renameRun } = await import("../runActions");
      const run = (await one("insert into runs (tenant_id, project_name) values ($1,'Original') returning id", [A])).id;
      expect(await renameRun(run, "Newer name", "Original")).toEqual({ ok: true });
      const stale = await renameRun(run, "Stale name", "Original");
      expect(stale).toMatchObject({ ok: false, conflict: true, current: "Newer name" });
      expect((await one("select project_name from runs where id = $1", [run])).project_name).toBe("Newer name");
      expect(await renameRun(run, "Stale name", "Newer name")).toEqual({ ok: true });
      expect((await renameRun(run, "   ", "Stale name")).ok).toBe(false);
      expect((await renameRun(randomUUID(), "Nowhere", null)).ok).toBe(false);
      expect((await renameRun(runB, "Hijack", "B")).ok).toBe(false);
      expect((await one("select project_name from runs where id = $1", [runB])).project_name).toBe("B");
    });
  });

  describe("F07 history keeps the researcher note", () => {
    it("a retired finding's history keeps its note, shown in the history CSV", async () => {
      as(A);
      const { generateOutputFindingsAction } = await actions();
      const s = await set(A, runA, "Noted");
      const d = await file(A, runA, s, "n.csv");
      const id = await finding(A, runA, d, "Finding with a note", "Note: café ünïcode ✓");
      expect((await generateOutputFindingsAction(runA, s)).ok).toBe(true);
      expect((await one("select researcher_note from finding_history where original_finding_id = $1", [id])).researcher_note).toBe("Note: café ünïcode ✓");
      const { GET } = await import("../../app/api/runs/[id]/history/export/route");
      const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: runA }) });
      expect(res.status).toBe(200);
      const csv = await res.text();
      expect(csv.split("\r\n")[0]).toContain("Researcher note");
      expect(csv).toContain("Note: café ünïcode ✓");
    });

    it("without migration 0114, retiring a noted finding is refused and rolled back; one without a note retires", async () => {
      as(A);
      await db.pool.query("alter table finding_history drop column researcher_note");
      vi.resetModules();
      const { generateOutputFindingsAction } = await actions();
      const s = await set(A, runA, "Pre 0114");
      const d = await file(A, runA, s, "pre.csv");
      await finding(A, runA, d, "Noted, pre 0114", "keep me");
      const r = await generateOutputFindingsAction(runA, s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/migration 0114/);
      expect(await live(d)).toEqual(["Noted, pre 0114"]);
      const s2 = await set(A, runA, "Pre 0114 no note");
      const d2 = await file(A, runA, s2, "pre2.csv");
      await finding(A, runA, d2, "No note, pre 0114");
      expect((await generateOutputFindingsAction(runA, s2)).ok).toBe(true);
      expect(await live(d2)).not.toContain("No note, pre 0114");
    });
  });
});
