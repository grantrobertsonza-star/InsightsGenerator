// Batch 60, Codex COD5K-F02: compatibility before migration 0127 and its back-fill. Real disposable
// PostgreSQL built from every migration before 0127; the app connected as a NOSUPERUSER, NOBYPASSRLS
// role. Before 0127 a note is still refused for a turn that does not exist and notes read by index as
// they always did; 0127 then binds each existing note to its turn's current text and moves a note
// whose turn does not exist to the set-aside table, wording and time kept, nothing deleted; applying it
// twice changes nothing.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
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

const ROLE = "ie_turn_note_migration_test";
const MIGRATION = "0127_turn_note_identity.sql";

describe.skipIf(!TEST_DATABASE_URL)("COD5K-F02 turn notes before and after migration 0127", () => {
  let db: DisposableDb;
  const A = randomUUID();
  let run = "", doc = "";
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
  const grant = async () => {
    await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
    await q(`revoke all on table tenants from ${ROLE}`);
  };

  beforeAll(async () => {
    db = await createDisposableDb(MIGRATION);
    await q("insert into tenants(id,name) values($1,'A')", [A]);
    run = (await q("insert into runs(tenant_id) values($1) returning id", [A])).rows[0].id;
    doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript','t.txt',$3) returning id", [A, run, `${A}/${randomUUID()}.txt`])).rows[0].id;
    await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,role,text) values($1,$2,$3,0,'participant','First turn words'),($1,$2,$3,1,'participant','Second turn words')", [A, run, doc]);
    await q(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${ROLE}') then create role ${ROLE} login password 'ie_test_only' nobypassrls; end if; end $$`);
    await q(`grant usage on schema public to ${ROLE}`);
    await grant();
    await q(`grant usage, select on all sequences in schema public to ${ROLE}`);
    await q(`grant execute on all functions in schema public to ${ROLE}`);
    const u = new URL(db.url);
    u.username = ROLE;
    u.password = "ie_test_only";
    process.env.DATABASE_URL = u.toString();
    currentTenant = A;
  }, 180000);
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db.drop();
  });

  it("before 0127: an existing turn is noted, a missing turn is refused, notes read by index, set-aside actions say what is needed", async () => {
    const { saveTurnNoteAction, clearOrphanTurnNoteAction } = await import("../codingAnalysisActions");
    const m = await import("../codingMeta");
    expect((await saveTurnNoteAction(run, doc, 0, "Note on the first turn", "First turn words")).ok).toBe(true);
    expect((await saveTurnNoteAction(run, doc, 5, "No such turn")).ok).toBe(false);
    expect((await saveTurnNoteAction(run, doc, 1, "Stale screen", "Old words")).ok).toBe(false);
    expect([...(await m.loadTurnNotes(A, doc))]).toEqual([[0, "Note on the first turn"]]);
    expect(await m.loadOrphanTurnNotes(A, doc)).toEqual([]);
    expect(await clearOrphanTurnNoteAction(run, doc, "turn:0")).toEqual({ ok: false, error: expect.stringContaining("migration 0127") });
  });

  it("0127 binds existing notes, moves a note on a missing turn aside with its wording and time, and is idempotent", async () => {
    // A note left by the old code on a turn that never existed, and one on turn 1.
    await q("insert into coding_turn_notes(tenant_id,document_id,segment_index,note,updated_at) values($1,$2,9,'Orphaned wording','2026-01-02T03:04:05Z'),($1,$2,1,'Second turn note',now())", [A, doc]);
    await db.apply([MIGRATION]);
    await grant();
    await db.apply([MIGRATION]);
    const rows = (await q("select segment_index, note, segment_text_hash = md5(s.text) as bound from coding_turn_notes n join coding_segments s using (document_id, segment_index) where n.document_id = $1 order by segment_index", [doc])).rows;
    expect(rows).toEqual([
      { segment_index: 0, note: "Note on the first turn", bound: true },
      { segment_index: 1, note: "Second turn note", bound: true },
    ]);
    expect((await q("select count(*)::int as n from coding_turn_notes where document_id = $1", [doc])).rows[0].n).toBe(2);
    const moved = (await q("select segment_index, note, reason, written_at, turn_text from coding_turn_note_orphans where document_id = $1", [doc])).rows;
    // Its turn does not exist, so there are no words to keep.
    expect(moved).toEqual([{ segment_index: 9, note: "Orphaned wording", reason: "turn_missing", written_at: new Date("2026-01-02T03:04:05Z"), turn_text: null }]);
    const m = await import("../codingMeta");
    expect([...(await m.loadTurnNotes(A, doc))]).toEqual([[0, "Note on the first turn"], [1, "Second turn note"]]);
    expect((await m.loadOrphanTurnNotes(A, doc)).map((o) => [o.formerIndex, o.note, o.reason])).toEqual([[9, "Orphaned wording", "turn_missing"]]);
  });
});
