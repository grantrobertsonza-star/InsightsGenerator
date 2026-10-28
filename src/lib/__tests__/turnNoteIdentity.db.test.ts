// Batch 60, Codex COD5K-F02: a researcher's note on a turn is written only for a turn that exists now,
// is bound to that turn's text (migration 0127), and is set aside, wording kept, when a re-read
// replaces the turn; it is never shown against different speech.
//
// Real disposable PostgreSQL with every migration, the app connected as a LOGIN, NOSUPERUSER,
// NOBYPASSRLS role so row-level security applies; the owner connection seeds and observes. The model
// is mocked to fail (no provider call is made); everything else is the real code.
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
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "no-provider",
  anthropic: { messages: { create: vi.fn(async () => { throw new Error("Provider forbidden in this test"); }) } },
}));
// The export route imports through the @/ alias, which vitest here does not resolve: map each module to
// the same file (so the mocks above apply), as the repo's other export-route tests do.
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/codingAnalysis", async () => await import("../codingAnalysis"));
vi.mock("@/lib/qualAudit", async () => await import("../qualAudit"));
vi.mock("@/lib/transcriptSetup", async () => await import("../transcriptSetup"));
vi.mock("@/lib/qualCrosstab", async () => await import("../qualCrosstab"));
vi.mock("@/lib/requestContext", async () => await import("../requestContext"));
vi.mock("@/lib/setAsideNotes", async () => await import("../setAsideNotes"));
vi.setConfig({ testTimeout: 60000 });

const ROLE = "ie_turn_note_identity_test";

describe.skipIf(!TEST_DATABASE_URL)("COD5K-F02 turn notes are bound to their turn (real database, restricted role)", () => {
  let db: DisposableDb;
  const A = randomUUID();
  const B = randomUUID();
  let runA = "", runA2 = "", runB = "";
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
  const actions = async () => await import("../codingAnalysisActions");
  const meta = async () => await import("../codingMeta");

  const TURNS = [
    "Moderator: What happened at the branch?",
    "Person: The account service failed and I waited two days for a response.",
    "Moderator: And then?",
    "Person: My second visit involved an unexpected charge on the account.",
  ];

  /** A coded transcript: stored text, a codebook with one code, and its turns as segments. */
  async function transcript(tenant: string, run: string, lines = TURNS) {
    const doc = (await q(
      "insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'transcript','t.txt',$3,$4) returning id",
      [tenant, run, `${tenant}/${run}/${randomUUID()}.txt`, lines.join("\n")],
    )).rows[0].id as string;
    const book = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'induced') returning id", [tenant, run, doc])).rows[0].id as string;
    const code = (await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,1,'Service','d') returning id", [tenant, book])).rows[0].id as string;
    const segs: string[] = [];
    for (const [i, line] of lines.entries()) {
      const [label, ...rest] = line.split(": ");
      segs.push((await q(
        "insert into coding_segments(tenant_id,run_id,document_id,segment_index,speaker,role,text) values($1,$2,$3,$4,$5,$6,$7) returning id",
        [tenant, run, doc, i, label, label === "Moderator" ? "moderator" : "participant", rest.join(": ")],
      )).rows[0].id);
    }
    return { doc, book, code, segs };
  }
  const textOf = (line: string) => line.split(": ").slice(1).join(": ");
  const notes = (doc: string) => q("select segment_index, note, segment_text_hash from coding_turn_notes where document_id = $1 order by segment_index", [doc]).then((r) => r.rows);
  const orphans = (doc: string) => q("select segment_index, note, reason from coding_turn_note_orphans where document_id = $1 order by segment_index, note", [doc]).then((r) => r.rows);
  const as = (tenant: string) => { currentTenant = tenant; };
  /** Reads the transcript again (the real resegmentTranscript); re-applying the codebook then fails
   * at the mocked model, after the new turns are committed. */
  async function reread(run: string, doc: string, lines: string[]) {
    await q("update documents set extracted_text = $2 where id = $1", [doc, lines.join("\n")]);
    const { resegmentTranscript } = await import("../extractThemes");
    await resegmentTranscript(A, run, doc, "labels", ["moderator"]).catch(() => undefined);
    return q("select segment_index, text from coding_segments where document_id = $1 order by segment_index", [doc]).then((r) => r.rows);
  }

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
  }, 180000);
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db.drop();
  });

  it("an existing turn: the note is saved bound to that turn's text, retried once, read back, cleared", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction } = await actions();
    for (let i = 0; i < 2; i++) expect(await saveTurnNoteAction(runA, t.doc, 1, " First note ", textOf(TURNS[1]))).toEqual({ ok: true });
    const [row] = await notes(t.doc);
    expect(row.note).toBe("First note");
    expect(row.segment_text_hash).toBe((await q("select md5($1::text) as h", [textOf(TURNS[1])])).rows[0].h);
    expect([...(await (await meta()).loadTurnNotes(A, t.doc))]).toEqual([[1, "First note"]]);
    expect(await saveTurnNoteAction(runA, t.doc, 1, "  ", textOf(TURNS[1]))).toEqual({ ok: true });
    expect(await notes(t.doc)).toEqual([]);
  });

  it("negative, fractional, non-number and missing turn indexes are refused visibly and nothing is written", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction } = await actions();
    for (const index of [-1, 1.5, "1" as unknown as number, 99]) {
      const reply = await saveTurnNoteAction(runA, t.doc, index, "Must refuse");
      expect(reply.ok).toBe(false);
    }
    const missing = await saveTurnNoteAction(runA, t.doc, 99, "Must refuse");
    expect(missing).toEqual({ ok: false, error: expect.stringContaining("no longer in this transcript") });
    expect(await notes(t.doc)).toEqual([]);
    expect(await orphans(t.doc)).toEqual([]);
    // A note refused for a missing turn does not appear when a turn with that index is added later.
    await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,role,text) values($1,$2,$3,99,'participant','Unrelated later speech')", [A, runA, t.doc]);
    expect((await (await meta()).loadTurnNotes(A, t.doc)).has(99)).toBe(false);
  });

  it("a screen showing older text for the turn is refused, and the note is not written onto the new words", async () => {
    as(A);
    const t = await transcript(A, runA);
    await q("update coding_segments set text = 'Changed words' where id = $1", [t.segs[1]]);
    const { saveTurnNoteAction } = await actions();
    expect(await saveTurnNoteAction(runA, t.doc, 1, "Written about the old words", textOf(TURNS[1]))).toEqual({
      ok: false,
      error: expect.stringContaining("has changed since the page was loaded"),
    });
    expect(await notes(t.doc)).toEqual([]);
  });

  it("wrong project and foreign tenant are refused for notes and for set-aside notes, with nothing changed", async () => {
    as(A);
    const a = await transcript(A, runA);
    as(B);
    const b = await transcript(B, runB);
    const { saveTurnNoteAction, clearOrphanTurnNoteAction, attachOrphanTurnNoteAction } = await actions();
    as(A);
    expect((await saveTurnNoteAction(runA2, a.doc, 1, "x", textOf(TURNS[1]))).ok).toBe(false);
    expect((await saveTurnNoteAction(runA, b.doc, 1, "x", textOf(TURNS[1]))).ok).toBe(false);
    expect((await saveTurnNoteAction(runB, b.doc, 1, "x", textOf(TURNS[1]))).ok).toBe(false);
    const orphanId = (await q("insert into coding_turn_note_orphans(tenant_id,document_id,segment_index,note,written_at,reason) values($1,$2,5,'B wording',now(),'turn_missing') returning id", [B, b.doc])).rows[0].id;
    expect((await clearOrphanTurnNoteAction(runB, b.doc, `orphan:${orphanId}`)).ok).toBe(false);
    expect((await attachOrphanTurnNoteAction(runA, a.doc, `orphan:${orphanId}`, 1, textOf(TURNS[1]))).ok).toBe(false);
    expect(await notes(a.doc)).toEqual([]);
    expect(await notes(b.doc)).toEqual([]);
    expect(await orphans(b.doc)).toEqual([{ segment_index: 5, note: "B wording", reason: "turn_missing" }]);
  });

  it("a re-read that changes a turn sets its note aside, wording kept; an unchanged turn keeps its note", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction } = await actions();
    expect((await saveTurnNoteAction(runA, t.doc, 1, "About the waiting", textOf(TURNS[1]))).ok).toBe(true);
    expect((await saveTurnNoteAction(runA, t.doc, 3, "About the charge", textOf(TURNS[3]))).ok).toBe(true);
    // The re-read keeps turn 1 as it was and puts different speech at index 3.
    const after = await reread(runA, t.doc, [TURNS[0], TURNS[1], "Moderator: Anything else?", "Person: The staff were friendly in the end."]);
    expect(after.map((r) => r.text)).toEqual([textOf(TURNS[0]), textOf(TURNS[1]), "Anything else?", "The staff were friendly in the end."]);
    const m = await meta();
    expect([...(await m.loadTurnNotes(A, t.doc))]).toEqual([[1, "About the waiting"]]);
    const set = await m.loadOrphanTurnNotes(A, t.doc);
    expect(set).toEqual([expect.objectContaining({ formerIndex: 3, note: "About the charge", reason: "turn_changed", turnText: textOf(TURNS[3]) })]);
    // The set-aside row carries the exact words of the turn the note was written on.
    expect((await q("select turn_text from coding_turn_note_orphans where document_id = $1", [t.doc])).rows).toEqual([{ turn_text: textOf(TURNS[3]) }]);
    expect(set[0].ref).toMatch(/^orphan:/);
  });

  it("a re-read with fewer turns sets the note of a vanished turn aside as missing", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction } = await actions();
    expect((await saveTurnNoteAction(runA, t.doc, 3, "About the charge", textOf(TURNS[3]))).ok).toBe(true);
    await reread(runA, t.doc, [TURNS[0], "Person: The account service failed and I waited two days for a response. My second visit involved an unexpected charge on the account."]);
    expect((await (await meta()).loadOrphanTurnNotes(A, t.doc)).map((o) => [o.formerIndex, o.note, o.reason, o.turnText])).toEqual([[3, "About the charge", "turn_missing", textOf(TURNS[3])]]);
    expect(await notes(t.doc)).toEqual([]);
  });

  it("a save racing a re-read waits for it, then refuses because the turn changed; nothing is attributed to the new speech", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction } = await actions();
    // The owner connection plays a re-read in progress: replaceSegments' lock, delete and insert.
    const writer = await db.pool.connect();
    try {
      await writer.query("begin");
      await writer.query("select id from documents where id = $1 for update", [t.doc]);
      await writer.query("delete from coding_segments where document_id = $1", [t.doc]);
      await writer.query("insert into coding_segments(tenant_id,run_id,document_id,segment_index,role,text) values($1,$2,$3,1,'participant','Entirely different later speech')", [A, runA, t.doc]);
      const pending = saveTurnNoteAction(runA, t.doc, 1, "Written about the shown turn", textOf(TURNS[1]));
      let settled = false;
      void pending.then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // waiting on the transcript lock
      await writer.query("commit");
      expect(await pending).toEqual({ ok: false, error: expect.stringContaining("has changed since the page was loaded") });
    } finally {
      writer.release();
    }
    expect(await notes(t.doc)).toEqual([]);
    // Without a screen copy of the turn (an older caller), a save of a turn deleted under it is refused.
    const writer2 = await db.pool.connect();
    try {
      await writer2.query("begin");
      await writer2.query("select id from documents where id = $1 for update", [t.doc]);
      await writer2.query("delete from coding_segments where document_id = $1", [t.doc]);
      const pending = saveTurnNoteAction(runA, t.doc, 1, "No turn any more");
      await new Promise((r) => setTimeout(r, 300));
      await writer2.query("commit");
      expect((await pending).ok).toBe(false);
    } finally {
      writer2.release();
    }
    expect(await notes(t.doc)).toEqual([]);
  });

  it("index reused: a new note on the new turn keeps the old wording set aside; attach is explicit and never overwrites", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction, attachOrphanTurnNoteAction, clearOrphanTurnNoteAction } = await actions();
    expect((await saveTurnNoteAction(runA, t.doc, 3, "Old wording", textOf(TURNS[3]))).ok).toBe(true);
    await reread(runA, t.doc, [TURNS[0], TURNS[1], TURNS[2], "Person: A completely different answer."]);
    expect((await saveTurnNoteAction(runA, t.doc, 3, "New wording", "A completely different answer.")).ok).toBe(true);
    const m = await meta();
    expect((await m.loadTurnNotes(A, t.doc)).get(3)).toBe("New wording");
    const [orphan] = await m.loadOrphanTurnNotes(A, t.doc);
    expect(orphan.note).toBe("Old wording");
    // The turn has its own note: attaching is refused and both wordings stay.
    expect(await attachOrphanTurnNoteAction(runA, t.doc, orphan.ref, 3, "A completely different answer.")).toEqual({
      ok: false,
      error: expect.stringContaining("already has a note"),
    });
    // Attach to a turn whose text the screen showed wrongly: refused.
    expect((await attachOrphanTurnNoteAction(runA, t.doc, orphan.ref, 1, "stale screen text")).ok).toBe(false);
    // Attach to turn 1 (no note): the wording moves there, bound, and is no longer set aside.
    expect((await attachOrphanTurnNoteAction(runA, t.doc, orphan.ref, 1, textOf(TURNS[1]))).ok).toBe(true);
    expect([...(await m.loadTurnNotes(A, t.doc))].sort()).toEqual([[1, "Old wording"], [3, "New wording"]]);
    expect(await m.loadOrphanTurnNotes(A, t.doc)).toEqual([]);
    // Retrying the attach after it succeeded is refused visibly, with nothing duplicated.
    expect(await attachOrphanTurnNoteAction(runA, t.doc, orphan.ref, 1, textOf(TURNS[1]))).toEqual({
      ok: false,
      error: expect.stringContaining("no longer set aside"),
    });
    // Clearing a set-aside note is explicit and also refused on retry.
    const id = (await q("insert into coding_turn_note_orphans(tenant_id,document_id,segment_index,note,written_at,reason) values($1,$2,7,'Unwanted',now(),'turn_missing') returning id", [A, t.doc])).rows[0].id;
    expect((await clearOrphanTurnNoteAction(runA, t.doc, `orphan:${id}`)).ok).toBe(true);
    expect((await clearOrphanTurnNoteAction(runA, t.doc, `orphan:${id}`)).ok).toBe(false);
    expect((await clearOrphanTurnNoteAction(runA, t.doc, "garbage")).ok).toBe(false);
  });

  it("a note row without a hash (left by older code) is not shown on the turn, and saving the turn sets it aside rather than overwriting it", async () => {
    as(A);
    const t = await transcript(A, runA);
    await q("insert into coding_turn_notes(tenant_id,document_id,segment_index,note) values($1,$2,1,'Unverified wording')", [A, t.doc]);
    const m = await meta();
    expect((await m.loadTurnNotes(A, t.doc)).has(1)).toBe(false);
    expect(await m.loadOrphanTurnNotes(A, t.doc)).toEqual([expect.objectContaining({ ref: "turn:1", formerIndex: 1, note: "Unverified wording", reason: "turn_unverified", turnText: null })]);
    const { saveTurnNoteAction } = await actions();
    expect((await saveTurnNoteAction(runA, t.doc, 1, "Fresh note", textOf(TURNS[1]))).ok).toBe(true);
    expect(await orphans(t.doc)).toEqual([{ segment_index: 1, note: "Unverified wording", reason: "turn_unverified" }]);
    expect((await m.loadTurnNotes(A, t.doc)).get(1)).toBe("Fresh note");
    // Clearing the current note does not touch the set-aside wording.
    expect((await saveTurnNoteAction(runA, t.doc, 1, "", textOf(TURNS[1]))).ok).toBe(true);
    expect(await orphans(t.doc)).toEqual([{ segment_index: 1, note: "Unverified wording", reason: "turn_unverified" }]);
  });

  it("an in-place unbound note can be attached to its own index explicitly", async () => {
    as(A);
    const t = await transcript(A, runA);
    await q("insert into coding_turn_notes(tenant_id,document_id,segment_index,note) values($1,$2,3,'Kept wording')", [A, t.doc]);
    const { attachOrphanTurnNoteAction } = await actions();
    expect((await attachOrphanTurnNoteAction(runA, t.doc, "turn:3", 3, textOf(TURNS[3]))).ok).toBe(true);
    const m = await meta();
    expect((await m.loadTurnNotes(A, t.doc)).get(3)).toBe("Kept wording");
    expect(await m.loadOrphanTurnNotes(A, t.doc)).toEqual([]);
  });

  it("a failed read of the notes is reported in the view and blocks the exports; an empty transcript stays plainly empty", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { getCodingAnalysis, codingExportBlocker } = await import("../codingAnalysis");
    const empty = (await getCodingAnalysis(A, runA)).get(t.doc)!;
    expect(empty.turnNotesError).toBeNull();
    expect(empty.orphanNotes).toEqual([]);
    expect(empty.verbatims.every((v) => v.note === "")).toBe(true);
    await q(`revoke select on coding_turn_notes from ${ROLE}`);
    try {
      const analysis = await getCodingAnalysis(A, runA);
      const failed = analysis.get(t.doc)!;
      expect(failed.turnNotesError).toContain("could not be read");
      expect(failed.orphanNotes).toBeNull();
      expect(codingExportBlocker(analysis)).toContain("the export was not made");
    } finally {
      await q(`grant select on coding_turn_notes to ${ROLE}`);
    }
    const recovered = await getCodingAnalysis(A, runA);
    expect(recovered.get(t.doc)!.turnNotesError).toBeNull();
    expect(codingExportBlocker(recovered)).toBeNull();
  });

  /** The real coding export route; returns its status and, for a workbook, the Set-aside notes sheet. */
  async function exportSetAside(run: string) {
    const { GET } = await import("../../app/api/runs/[id]/coding/export/route");
    const XLSX = await import("xlsx");
    const response = await GET(new Request("http://local/coding/export"), { params: Promise.resolve({ id: run }) });
    if (response.status !== 200) return { status: response.status, body: await response.json(), rows: null };
    const book = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: "array" });
    const ws = book.Sheets["Set-aside notes"];
    return { status: 200, body: null, rows: ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) : null };
  }
  const SET_ASIDE_HEADER = [
    "Transcript", "Turn written on", "Turn text fingerprint (md5)", "Turn text when written", "Researcher note",
    "Written by", "Written at", "Set aside at", "Why set aside",
  ];

  it("export: the Set-aside notes sheet has just its header when no note is set aside", async () => {
    as(A);
    const run = (await q("insert into runs(tenant_id,project_name) values($1,'Export empty') returning id", [A])).rows[0].id;
    await transcript(A, run);
    const out = await exportSetAside(run);
    expect(out.status).toBe(200);
    expect(out.rows).toEqual([SET_ASIDE_HEADER]);
  });

  it("export: a note set aside by a re-read is one row, wording verbatim, with its turn, fingerprint, the turn's exact old words and why", async () => {
    as(A);
    const run = (await q("insert into runs(tenant_id,project_name) values($1,'Export set aside') returning id", [A])).rows[0].id;
    const t = await transcript(A, run);
    const { saveTurnNoteAction } = await actions();
    expect((await saveTurnNoteAction(run, t.doc, 3, "About the charge, in my words", textOf(TURNS[3]))).ok).toBe(true);
    const written = (await notes(t.doc))[0];
    await reread(run, t.doc, [TURNS[0], TURNS[1], TURNS[2], "Person: Something else entirely."]);
    const stored = (await q("select written_at, orphaned_at from coding_turn_note_orphans where document_id = $1", [t.doc])).rows[0];
    const out = await exportSetAside(run);
    expect(out.status).toBe(200);
    expect(out.rows).toEqual([
      SET_ASIDE_HEADER,
      [
        "t.txt", 4, written.segment_text_hash, textOf(TURNS[3]), "About the charge, in my words", "Not recorded",
        new Date(stored.written_at).toISOString(), new Date(stored.orphaned_at).toISOString(),
        "that turn now holds different words",
      ],
    ]);
    // The note is not on the turn now at index 3 anywhere in the workbook's verbatims either.
    expect((await (await meta()).loadTurnNotes(A, t.doc)).has(3)).toBe(false);
  });

  it("export: 'Not kept' only when the turn's words were genuinely not captured", async () => {
    as(A);
    const run = (await q("insert into runs(tenant_id,project_name) values($1,'Export not kept') returning id", [A])).rows[0].id;
    const t = await transcript(A, run);
    await q("insert into coding_turn_note_orphans(tenant_id,document_id,segment_index,note,written_at,orphaned_at,reason) values($1,$2,9,'Older wording','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','turn_missing')", [A, t.doc]);
    const out = await exportSetAside(run);
    expect(out.rows).toEqual([
      SET_ASIDE_HEADER,
      ["t.txt", 10, "Not recorded", "Not kept", "Older wording", "Not recorded", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "that turn is no longer in the transcript"],
    ]);
  });

  it("export: refused, not produced without them, when set-aside notes cannot be read", async () => {
    as(A);
    const run = (await q("insert into runs(tenant_id,project_name) values($1,'Export unreadable') returning id", [A])).rows[0].id;
    await transcript(A, run);
    await q(`revoke select on coding_turn_note_orphans from ${ROLE}`);
    try {
      const out = await exportSetAside(run);
      expect(out.status).toBe(503);
      expect(out.body.error).toContain("set aside from changed turns could not be read");
    } finally {
      await q(`grant select on coding_turn_note_orphans to ${ROLE}`);
    }
    expect((await exportSetAside(run)).status).toBe(200);
  });

  it("the coding view carries current notes on turns and set-aside notes separately", async () => {
    as(A);
    const t = await transcript(A, runA);
    const { saveTurnNoteAction } = await actions();
    expect((await saveTurnNoteAction(runA, t.doc, 3, "About the charge", textOf(TURNS[3]))).ok).toBe(true);
    await reread(runA, t.doc, [TURNS[0], TURNS[1], TURNS[2], "Person: Something else entirely."]);
    const { getCodingAnalysis } = await import("../codingAnalysis");
    const view = (await getCodingAnalysis(A, runA)).get(t.doc)!;
    expect(view.verbatims.find((v) => v.index === 3)!.note).toBe("");
    expect(view.orphanNotes).toEqual([expect.objectContaining({ formerIndex: 3, note: "About the charge" })]);
  });
});
