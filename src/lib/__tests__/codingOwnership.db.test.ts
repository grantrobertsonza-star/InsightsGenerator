// COD500-F01 and COD500-F02 (Codex, 2026-10-24), through the actual server actions on a real
// disposable PostgreSQL, connected as a separate LOGIN, NOSUPERUSER, NOBYPASSRLS role so row-level
// security applies as it does in the app (the owner connection would bypass it and hide F01).
// The owner connection only seeds fixtures and observes.
//   F01  theme metadata and turn notes: another tenant's transcript, or this tenant's transcript under
//        another project, is refused and nothing is written; the owner's first save, an update of an
//        existing key, clearing, two fields saved at once and a failed batch (rolled back whole) work;
//        a foreign row left by the old code is reported plainly and the owner can save once it is removed
//   F02  a hand change to a turn's themes: wrong project, foreign tenant, moderator turn, missing turn,
//        obsolete code are refused with nothing changed; add and remove keep working and record this
//        project; a change waits for a new codebook version being written and is then refused
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

let currentTenant = "";
vi.mock("../requestContext", () => ({
  requireTenantId: async () => currentTenant,
  routeRequestContext: async () => ({ tenantId: currentTenant }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.setConfig({ testTimeout: 60000 });

const ROLE = "ie_coding_owner_test";

describe.skipIf(!TEST_DATABASE_URL)("COD500-F01/F02 coding writes check the transcript's project and tenant (real database, restricted role)", () => {
  let db: DisposableDb;
  const A = randomUUID();
  const B = randomUUID();
  let runA = "", runA2 = "", runB = "";
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
  const actions = async () => await import("../codingAnalysisActions");

  /** A transcript with a codebook in force (one code per name) and turns. */
  async function transcript(tenant: string, run: string, codes = ["Price", "Service"]) {
    const doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript','t.docx',$3) returning id", [tenant, run, `${tenant}/${run}/${randomUUID()}.docx`])).rows[0].id as string;
    const book = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'induced') returning id", [tenant, run, doc])).rows[0].id as string;
    const code: Record<string, string> = {};
    for (const [i, name] of codes.entries()) {
      code[name] = (await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,$3,$4,'d') returning id", [tenant, book, i, name])).rows[0].id;
    }
    const seg = (await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,role,text) values($1,$2,$3,0,'participant','It costs too much') returning id", [tenant, run, doc])).rows[0].id as string;
    const mod = (await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,role,text) values($1,$2,$3,1,'moderator','Why?') returning id", [tenant, run, doc])).rows[0].id as string;
    await q("insert into coding_assignments(tenant_id,segment_id,code_id,source) values($1,$2,$3,'model')", [tenant, seg, code.Price]);
    return { doc, book, code, seg, mod };
  }
  const meta = (doc: string) => q("select tenant_id, code_key, theme, note, keywords from coding_code_meta where document_id = $1 order by code_key", [doc]).then((r) => r.rows);
  const notes = (doc: string) => q("select tenant_id, segment_index, note from coding_turn_notes where document_id = $1 order by segment_index", [doc]).then((r) => r.rows);
  const assignments = (seg: string) => q("select code_id, source from coding_assignments where segment_id = $1 order by code_id", [seg]).then((r) => r.rows);
  const overrides = (seg: string) => q("select code_key, action, run_id, document_id from coding_assignment_overrides where segment_id = $1 order by code_key", [seg]).then((r) => r.rows);
  const as = (tenant: string) => { currentTenant = tenant; };

  beforeAll(async () => {
    db = await createDisposableDb();
    await q("insert into tenants(id,name) values($1,'A'),($2,'B')", [A, B]);
    [runA, runA2] = (await q("insert into runs(tenant_id,project_name) values($1,'A one'),($1,'A two') returning id", [A])).rows.map((r) => r.id);
    runB = (await q("insert into runs(tenant_id,project_name) values($1,'B') returning id", [B])).rows[0].id;
    await q(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${ROLE}') then create role ${ROLE} login password 'ie_test_only' nobypassrls; end if; end $$`);
    await q(`grant usage on schema public to ${ROLE}`);
    await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
    await q(`grant usage, select on all sequences in schema public to ${ROLE}`);
    await q(`grant execute on all functions in schema public to ${ROLE}`);
    await q(`revoke all on table tenants from ${ROLE}`);
    const u = new URL(db.url);
    u.username = ROLE;
    u.password = "ie_test_only";
    process.env.DATABASE_URL = u.toString();
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  describe("F01 annotations", () => {
    it("another tenant's transcript is refused for theme metadata and turn notes, and nothing is written", async () => {
      const b = await transcript(B, runB);
      const { saveCodeMetaAction, saveTurnNoteAction } = await actions();
      as(A);
      // Naming B's project or A's own project: either way the transcript is not A's.
      for (const run of [runB, runA]) {
        const m = await saveCodeMetaAction(run, b.doc, [{ name: "Price", theme: "Cost", note: "n", keywords: "k" }]);
        expect(m).toEqual({ ok: false, error: "That transcript is not in this project." });
        const n = await saveTurnNoteAction(run, b.doc, 0, "A's note");
        expect(n).toEqual({ ok: false, error: "That transcript is not in this project." });
      }
      expect(await meta(b.doc)).toEqual([]);
      expect(await notes(b.doc)).toEqual([]);
      // B, the owner, saves both keys normally afterwards.
      as(B);
      expect((await saveCodeMetaAction(runB, b.doc, [{ name: "Price", theme: "Cost", note: "", keywords: "" }])).ok).toBe(true);
      expect((await saveTurnNoteAction(runB, b.doc, 0, "B's note")).ok).toBe(true);
      expect(await meta(b.doc)).toEqual([{ tenant_id: B, code_key: "price", theme: "Cost", note: "", keywords: "" }]);
      expect(await notes(b.doc)).toEqual([{ tenant_id: B, segment_index: 0, note: "B's note" }]);
    });

    it("this tenant's transcript named under another of its projects is refused", async () => {
      const a = await transcript(A, runA);
      const { saveCodeMetaAction, saveTurnNoteAction } = await actions();
      as(A);
      expect((await saveCodeMetaAction(runA2, a.doc, [{ name: "Price", theme: "Cost", note: "", keywords: "" }])).ok).toBe(false);
      expect((await saveTurnNoteAction(runA2, a.doc, 0, "note")).ok).toBe(false);
      expect(await meta(a.doc)).toEqual([]);
      expect(await notes(a.doc)).toEqual([]);
    });

    it("first creation, an existing key updated, two fields saved at once, and a cleared note", async () => {
      const a = await transcript(A, runA);
      const { saveCodeMetaAction, saveTurnNoteAction } = await actions();
      as(A);
      expect((await saveCodeMetaAction(runA, a.doc, [{ name: "Price", theme: "Cost", note: "first", keywords: "" }])).ok).toBe(true);
      expect((await saveCodeMetaAction(runA, a.doc, [{ name: " price ", theme: "Value", note: "second", keywords: "cheap" }])).ok).toBe(true);
      // Two saves at once on one transcript (the share lock lets both through) for different codes.
      const [x, y] = await Promise.all([
        saveCodeMetaAction(runA, a.doc, [{ name: "Service", theme: "Care", note: "", keywords: "" }]),
        saveTurnNoteAction(runA, a.doc, 0, "on the turn"),
      ]);
      expect(x.ok && y.ok).toBe(true);
      expect(await meta(a.doc)).toEqual([
        { tenant_id: A, code_key: "price", theme: "Value", note: "second", keywords: "cheap" },
        { tenant_id: A, code_key: "service", theme: "Care", note: "", keywords: "" },
      ]);
      expect((await saveTurnNoteAction(runA, a.doc, 0, "   ")).ok).toBe(true);
      expect(await notes(a.doc)).toEqual([]);
      // A turn that cannot exist is refused before anything is read or written.
      expect((await saveTurnNoteAction(runA, a.doc, -1, "x")).ok).toBe(false);
    });

    it("a foreign row left by the old code is reported plainly; the batch is rolled back whole; once removed the owner saves", async () => {
      const b = await transcript(B, runB);
      // As the old code allowed: tenant A's rows naming B's transcript (seeded by the owner).
      await q("insert into coding_code_meta(tenant_id,document_id,code_key,theme,note,keywords) values($1,$2,'service','A theme','','')", [A, b.doc]);
      await q("insert into coding_turn_notes(tenant_id,document_id,segment_index,note) values($1,$2,0,'A note')", [A, b.doc]);
      const { saveCodeMetaAction, saveTurnNoteAction } = await actions();
      as(B);
      const m = await saveCodeMetaAction(runB, b.doc, [
        { name: "Price", theme: "Cost", note: "", keywords: "" },
        { name: "Service", theme: "Care", note: "", keywords: "" },
      ]);
      expect(m.ok).toBe(false);
      if (!m.ok) expect(m.error).toMatch(/holds a stored entry under the same name that this account cannot see/);
      const n = await saveTurnNoteAction(runB, b.doc, 0, "B's note");
      expect(n.ok).toBe(false);
      if (!n.ok) expect(n.error).toMatch(/cannot see/);
      // Rolled back whole: "Price" was not saved either; A's rows are untouched.
      expect(await meta(b.doc)).toEqual([{ tenant_id: A, code_key: "service", theme: "A theme", note: "", keywords: "" }]);
      expect(await notes(b.doc)).toEqual([{ tenant_id: A, segment_index: 0, note: "A note" }]);
      await q("delete from coding_code_meta where document_id = $1 and tenant_id = $2", [b.doc, A]);
      await q("delete from coding_turn_notes where document_id = $1 and tenant_id = $2", [b.doc, A]);
      expect((await saveCodeMetaAction(runB, b.doc, [{ name: "Service", theme: "Care", note: "", keywords: "" }])).ok).toBe(true);
      expect((await saveTurnNoteAction(runB, b.doc, 0, "B's note")).ok).toBe(true);
      expect((await meta(b.doc)).map((r) => [r.tenant_id, r.theme])).toEqual([[B, "Care"]]);
    });
  });

  describe("F02 coding assignments", () => {
    it("a request naming another project, or another tenant's transcript, changes nothing", async () => {
      const a = await transcript(A, runA);
      const { changeTurnCodeAction } = await actions();
      const before = { asg: await assignments(a.seg), ov: await overrides(a.seg) };
      as(A);
      for (const action of ["add", "remove"] as const) {
        const code = action === "add" ? a.code.Service : a.code.Price;
        expect(await changeTurnCodeAction(runA2, a.doc, a.seg, code, action)).toEqual({ ok: false, error: "That transcript is not in this project." });
      }
      as(B);
      expect((await changeTurnCodeAction(runB, a.doc, a.seg, a.code.Service, "add")).ok).toBe(false);
      expect((await changeTurnCodeAction(runA, a.doc, a.seg, a.code.Service, "add")).ok).toBe(false);
      expect({ asg: await assignments(a.seg), ov: await overrides(a.seg) }).toEqual(before);
    });

    it("moderator turn, missing turn and an obsolete code are refused with nothing changed", async () => {
      const a = await transcript(A, runA);
      const { changeTurnCodeAction } = await actions();
      as(A);
      expect((await changeTurnCodeAction(runA, a.doc, a.mod, a.code.Service, "add")).ok).toBe(false);
      expect((await changeTurnCodeAction(runA, a.doc, randomUUID(), a.code.Service, "add")).ok).toBe(false);
      // A new version is now in force; the old version's code is obsolete.
      const v2 = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,2,'edited') returning id", [A, runA, a.doc])).rows[0].id;
      await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,0,'Service','d')", [A, v2]);
      const r = await changeTurnCodeAction(runA, a.doc, a.seg, a.code.Service, "add");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not in the current codebook/);
      expect(await overrides(a.seg)).toEqual([]);
      expect(await assignments(a.seg)).toEqual([{ code_id: a.code.Price, source: "model" }]);
    });

    it("add and remove keep working and record this project", async () => {
      const a = await transcript(A, runA);
      const { changeTurnCodeAction } = await actions();
      as(A);
      expect((await changeTurnCodeAction(runA, a.doc, a.seg, a.code.Service, "add")).ok).toBe(true);
      expect(await overrides(a.seg)).toEqual([{ code_key: "service", action: "add", run_id: runA, document_id: a.doc }]);
      expect((await changeTurnCodeAction(runA, a.doc, a.seg, a.code.Price, "remove")).ok).toBe(true);
      expect(await overrides(a.seg)).toEqual([
        { code_key: "price", action: "remove", run_id: runA, document_id: a.doc },
        { code_key: "service", action: "add", run_id: runA, document_id: a.doc },
      ]);
      // Taking off a researcher's own theme clears its override; putting the model's back clears that one.
      expect((await changeTurnCodeAction(runA, a.doc, a.seg, a.code.Service, "remove")).ok).toBe(true);
      expect((await changeTurnCodeAction(runA, a.doc, a.seg, a.code.Price, "add")).ok).toBe(true);
      expect(await overrides(a.seg)).toEqual([]);
      expect(await assignments(a.seg)).toEqual([{ code_id: a.code.Price, source: "model" }]);
    });

    it("a change waits for a new codebook version being written, then is checked against it and refused", async () => {
      const a = await transcript(A, runA);
      const { changeTurnCodeAction } = await actions();
      const holder = new Client({ connectionString: db.url });
      await holder.connect();
      try {
        // As a new version's writer does: lock the transcript, then insert the version.
        await holder.query("begin");
        await holder.query("select id from documents where id = $1 for update", [a.doc]);
        as(A);
        const pending = changeTurnCodeAction(runA, a.doc, a.seg, a.code.Service, "add");
        await expect
          .poll(async () => (await db.pool.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%from documents where id = $1 and run_id = $2 and tenant_id = $3 for update%'")).rows[0].n, { timeout: 20000 })
          .toBe(1);
        const v2 = (await holder.query("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,2,'edited') returning id", [A, runA, a.doc])).rows[0].id;
        await holder.query("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,0,'Service','d')", [A, v2]);
        await holder.query("commit");
        const r = await pending;
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/not in the current codebook/);
        expect(await overrides(a.seg)).toEqual([]);
      } finally {
        await holder.query("rollback").catch(() => {});
        await holder.end();
      }
    });
  });
});
