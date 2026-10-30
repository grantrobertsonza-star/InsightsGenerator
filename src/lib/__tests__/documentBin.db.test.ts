// Removing, restoring and erasing a file (claude/document-deletion-contract.md, migration 0115),
// through the actual library and actions on a real disposable PostgreSQL. Storage is controlled.
//   coverage    every table with a document_id and a run_id is either moved with the file or listed
//               as staying (a new table cannot be missed)
//   remove      findings archived with review and note; their insight, recommendation and verdict
//               go with them; a synthesized insight stays, losing that source; the file and its table
//               move to the bin; an unreviewed suggestion read only from it is removed, an accepted
//               one is marked, one read from two files stays; the bin is never a project
//   decisions   a framer suggestion drawn only from the file is removed (decision statement re-synced);
//               edited and two-file ones are marked; unknown-source, rejected and typed ones untouched
//   restore     the same rows come back under the same ids, history copies removed, mark cleared;
//               refused while the project has the same file again
//   erase       the file, its snapshot and its history copies go; stored bytes are queued
//   expiry      an item older than 30 days is erased when the bin is checked
//   empty bin   erases every removed file of this project only
//   sets        removing an output set moves its files and the set; restoring a file brings it back
//   ownership   another project's or tenant's file, removal or bin item is refused
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })), list: vi.fn(async () => ({ data: [], error: null })) }) } },
}));
vi.setConfig({ testTimeout: 60000 });

const A = randomUUID();
const B = randomUUID();

describe.skipIf(!TEST_DATABASE_URL)("the document bin (real database)", () => {
  let db: DisposableDb;
  let run = "", other = "", runB = "";
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await one(sql, p)).n);
  const bin = async () => import("../documentBin");

  /** A report with two findings (one reviewed with a note, built into an insight, a recommendation and a synthesized insight), a data table and objectives read from it. */
  async function project(tenant = A, r = run) {
    const doc = (await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, content_sha256) values ($1,$2,'report',$3,$4,$5) returning id", [tenant, r, "report.docx", `${tenant}/${r}/${randomUUID()}.docx`, randomUUID()])).id as string;
    const other = (await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1,$2,'evidence','brief.docx',$3) returning id", [tenant, r, `${tenant}/${r}/${randomUUID()}.docx`])).id as string;
    const table = (await one("insert into document_tables (tenant_id, run_id, document_id, table_index, headers, rows, ingestion_type) values ($1,$2,$3,0,'[]','[]','aggregated') returning id", [tenant, r, doc])).id as string;
    const f1 = (await one(
      "insert into findings (tenant_id, run_id, origin, finding_text, status, source_document_id, researcher_note, human_reviewed_at, human_review_action) values ($1,$2,'stated','Reviewed finding','accepted',$3,'My note ✓',now(),'accept') returning id",
      [tenant, r, doc],
    )).id as string;
    const f2 = (await one("insert into findings (tenant_id, run_id, origin, finding_text, status, source_table_id) values ($1,$2,'generated','Table finding','accepted',$3) returning id", [tenant, r, table])).id as string;
    await db.pool.query(
      "insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, verification_method, corroboration_level) values ($1,$2,'robust','r','single_pass','single_source')",
      [tenant, f1],
    );
    const ins = (await one("insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1,$2,$3,'Insight','o','t','i') returning id", [tenant, r, f1])).id as string;
    const rec = (await one(
      "insert into recommendations (tenant_id, run_id, insight_id, action_text, owner_role, owner_feasibility_note, timeline, metric, priority, assumptions_and_risks, alternatives_considered, source, status) values ($1,$2,$3,'Act','o','n','t','m','high','a','b','ai_suggested','accepted') returning id",
      [tenant, r, ins],
    )).id as string;
    const si = (await one(
      "insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status) values ($1,$2,'Synth','o','t','i',1,1,'accepted') returning id",
      [tenant, r],
    )).id as string;
    await db.pool.query("insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1,$2,$3)", [tenant, si, ins]);
    const cand = async (text: string, status: string, sources: string[]) =>
      (await one(
        "insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status, source_document_ids) values ($1,$2,$3,'r','researcher_authored',$4,$5) returning id",
        [tenant, r, `${text} ${randomUUID().slice(0, 8)}`, status, sources],
      )).id as string;
    const pendingOnly = await cand("Pending from the report", "pending", [doc]);
    const accepted = await cand("Accepted from the report", "accepted", [doc]);
    const pendingTwo = await cand("Pending from two files", "pending", [doc, other]);
    return { doc, other, table, f1, f2, ins, rec, si, pendingOnly, accepted, pendingTwo };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = A;
    await db.pool.query("insert into tenants (id, name) values ($1,'A'),($2,'B')", [A, B]);
    [run, other] = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1,'Project'),($1,'Other') returning id", [A])).rows.map((r) => r.id);
    runB = (await one("insert into runs (tenant_id, project_name) values ($1,'B') returning id", [B])).id;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("every table with a document and a run is moved with the file or listed as staying", async () => {
    const { MOVED_WITH_DOCUMENT, NOT_MOVED_WITH_DOCUMENT } = await bin();
    const tables = (
      await db.pool.query(
        `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'document_id'
         intersect select table_name from information_schema.columns where table_schema = 'public' and column_name = 'run_id'`,
      )
    ).rows.map((r) => r.table_name as string);
    const known = new Set<string>([...MOVED_WITH_DOCUMENT, ...NOT_MOVED_WITH_DOCUMENT]);
    expect(tables.filter((t) => !known.has(t)).sort()).toEqual([]);
  });

  it("remove, then restore: the same rows come back under the same ids", async () => {
    const p = await project();
    const { removeDocumentToBin, restoreDocumentFromBin, listBin } = await bin();
    const { counts } = await removeDocumentToBin(A, run, p.doc, null);
    expect(counts).toMatchObject({ findings: 2, reviewed: 1, notes: 1, suggestionsRemoved: 1, objectivesMarked: 1 });
    expect(await n("select count(*) as n from findings where id = any($1::uuid[])", [[p.f1, p.f2]])).toBe(0);
    expect(await n("select count(*) as n from insights where id = $1", [p.ins])).toBe(0);
    expect(await n("select count(*) as n from recommendations where id = $1", [p.rec])).toBe(0);
    const hist = await one("select researcher_note, archived_reason, human_review_action from finding_history where original_finding_id = $1", [p.f1]);
    expect(hist).toMatchObject({ researcher_note: "My note ✓", archived_reason: "source_removed", human_review_action: "accept" });
    expect(await one("select headline from synthesized_insights where id = $1", [p.si])).toEqual({ headline: "Synth" });
    expect(await n("select count(*) as n from synthesized_insight_sources where synthesized_insight_id = $1", [p.si])).toBe(0);
    const binRun = (await one("select id from runs where bin_of = $1", [run])).id;
    expect((await one("select run_id, removed_from_run from documents where id = $1", [p.doc]))).toEqual({ run_id: binRun, removed_from_run: run });
    expect((await one("select run_id from document_tables where id = $1", [p.table])).run_id).toBe(binRun);
    expect(await n("select count(*) as n from documents where run_id = $1 and id = $2", [run, p.doc])).toBe(0);
    expect(await one("select id from objective_candidates where id = $1", [p.pendingOnly])).toBeUndefined();
    expect((await one("select source_removed_at from objective_candidates where id = $1", [p.accepted])).source_removed_at).not.toBeNull();
    expect(await one("select id from objective_candidates where id = $1", [p.pendingTwo])).toBeTruthy();
    // The bin is never a project.
    const { runBelongsToTenant } = await vi.importActual<typeof import("../requestContext")>("../requestContext");
    expect(await runBelongsToTenant(A, binRun)).toBe(false);
    expect(await runBelongsToTenant(A, run)).toBe(true);
    const { listProjects } = await import("../projectList");
    expect((await listProjects(A)).map((x) => x.id)).not.toContain(binRun);

    const items = await listBin(A, run);
    expect(items.map((i) => i.documentId)).toContain(p.doc);
    const item = items.find((i) => i.documentId === p.doc)!;
    expect(new Date(item.expiresAt).getTime() - new Date(item.removedAt).getTime()).toBe(30 * 86400000);
    expect(await restoreDocumentFromBin(A, run, item.removalId)).toEqual({ findings: 2, linksWaiting: 0, linksLost: 0 });
    expect(await one("select finding_text, researcher_note, human_review_action from findings where id = $1", [p.f1])).toEqual({ finding_text: "Reviewed finding", researcher_note: "My note ✓", human_review_action: "accept" });
    expect(await n("select count(*) as n from findings where id = $1", [p.f2])).toBe(1);
    expect(await n("select count(*) as n from insights where id = $1", [p.ins])).toBe(1);
    expect(await n("select count(*) as n from recommendations where id = $1", [p.rec])).toBe(1);
    expect(await n("select count(*) as n from verdicts where finding_id = $1", [p.f1])).toBe(1);
    expect(await n("select count(*) as n from synthesized_insight_sources where synthesized_insight_id = $1 and pre_insight_id = $2", [p.si, p.ins])).toBe(1);
    expect(await n("select count(*) as n from finding_history where original_finding_id = any($1::uuid[])", [[p.f1, p.f2]])).toBe(0);
    expect((await one("select run_id from documents where id = $1", [p.doc])).run_id).toBe(run);
    expect((await one("select run_id from document_tables where id = $1", [p.table])).run_id).toBe(run);
    expect((await one("select source_removed_at from objective_candidates where id = $1", [p.accepted])).source_removed_at).toBeNull();
    expect(await listBin(A, run)).toEqual(expect.not.arrayContaining([expect.objectContaining({ documentId: p.doc })]));
    await expect(restoreDocumentFromBin(A, run, item.removalId)).rejects.toThrow(/no longer in the bin/);
  });

  it("decisions: a framer suggestion drawn only from the file is removed and the decision statement follows; kept, edited, two-file and unknown-source decisions stay; restore clears the mark", async () => {
    const r = (await one("insert into runs (tenant_id, project_name) values ($1,'Decisions') returning id", [A])).id as string;
    const p = await project(A, r);
    const dec = async (text: string, source: string, status: string, edited: boolean, sources: string[] | null) =>
      (await one(
        "insert into decision_candidates (tenant_id, run_id, candidate_text, rationale, source, status, edited, source_document_ids) values ($1,$2,$3,'r',$4,$5,$6,$7) returning id",
        [A, r, text, source, status, edited, sources],
      )).id as string;
    const onlyThis = await dec("Whether to reprice", "ai_suggested", "accepted", false, [p.doc]);
    const edited = await dec("Whether to relaunch", "ai_suggested", "accepted", true, [p.doc]);
    const twoFiles = await dec("Whether to expand", "ai_suggested", "accepted", false, [p.doc, p.other]);
    const unknown = await dec("Whether to exit", "ai_suggested", "accepted", false, null);
    const rejected = await dec("Whether to merge", "ai_suggested", "rejected", false, [p.doc]);
    const typed = await dec("Whether to hire", "researcher_authored", "accepted", false, null);
    const { syncDecisionStatement } = await import("../runSync");
    const c = await db.pool.connect();
    try { await syncDecisionStatement(c, r); } finally { c.release(); }
    expect((await one("select decision_statement from runs where id = $1", [r])).decision_statement).toMatch(/reprice/);

    const { counts } = await (await bin()).removeDocumentToBin(A, r, p.doc, null);
    // The objectives (pendingOnly) and the decision (onlyThis) drawn only from the file.
    expect(counts.suggestionsRemoved).toBe(2);
    // The accepted objective plus the edited and two-file decisions.
    expect(counts.objectivesMarked).toBe(3);
    expect(await one("select id from decision_candidates where id = $1", [onlyThis])).toBeUndefined();
    const marked = async (id: string) => (await one("select source_removed_at from decision_candidates where id = $1", [id])).source_removed_at;
    expect(await marked(edited)).not.toBeNull();
    expect(await marked(twoFiles)).not.toBeNull();
    expect(await marked(unknown)).toBeNull();
    expect(await marked(rejected)).toBeNull();
    expect(await marked(typed)).toBeNull();
    const statement = (await one("select decision_statement from runs where id = $1", [r])).decision_statement as string;
    expect(statement).not.toMatch(/reprice/);
    expect(statement).toMatch(/relaunch/);

    const removalId = (await one("select id from document_removals where document_id = $1", [p.doc])).id;
    await (await bin()).restoreDocumentFromBin(A, r, removalId);
    expect(await marked(edited)).toBeNull();
    expect(await marked(twoFiles)).toBeNull();
    // Not put back: reading the file again makes it again (contract).
    expect(await one("select id from decision_candidates where id = $1", [onlyThis])).toBeUndefined();
  });

  it("Empty bin erases every removed file in this project only, and says how many", async () => {
    const r = (await one("insert into runs (tenant_id, project_name) values ($1,'Empty') returning id", [A])).id as string;
    const keep = (await one("insert into runs (tenant_id, project_name) values ($1,'Keep') returning id", [A])).id as string;
    const a = await project(A, r);
    const b = await project(A, r);
    const elsewhere = await project(A, keep);
    const { removeDocumentToBin } = await bin();
    for (const d of [a.doc, b.doc]) await removeDocumentToBin(A, r, d, null);
    await removeDocumentToBin(A, keep, elsewhere.doc, null);
    const { emptyBinAction } = await import("../documentActions");
    expect(await emptyBinAction(r)).toEqual({ ok: true, message: "Erased 2 files." });
    expect(await n("select count(*)::int as n from documents where id = any($1::uuid[])", [[a.doc, b.doc]])).toBe(0);
    expect(await n("select count(*)::int as n from documents where id = $1", [elsewhere.doc])).toBe(1);
    expect(await emptyBinAction(r)).toEqual({ ok: true, message: "Erased 0 files." });
  });

  it("restore is refused while the project has the same file again", async () => {
    const p = await project();
    const { removeDocumentToBin, restoreDocumentFromBin } = await bin();
    const { removalId } = await removeDocumentToBin(A, run, p.doc, null);
    const sha = (await one("select content_sha256 from documents where id = $1", [p.doc])).content_sha256;
    await db.pool.query("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, content_sha256) values ($1,$2,'report','report again.docx','x/y.docx',$3)", [A, run, sha]);
    await expect(restoreDocumentFromBin(A, run, removalId)).rejects.toThrow(/already has this file again \(report again\.docx\)/);
    expect(await n("select count(*) as n from findings where id = $1", [p.f1])).toBe(0);
  });

  it("erase removes the file, its snapshot and its history copies, and queues its stored bytes", async () => {
    const p = await project();
    const { removeDocumentToBin, eraseRemovedDocument } = await bin();
    await removeDocumentToBin(A, run, p.doc, null);
    await eraseRemovedDocument(A, run, p.doc);
    expect(await one("select id from documents where id = $1", [p.doc])).toBeUndefined();
    expect(await one("select id from document_tables where id = $1", [p.table])).toBeUndefined();
    expect(await n("select count(*) as n from document_removals where document_id = $1", [p.doc])).toBe(0);
    expect(await n("select count(*) as n from finding_history where original_finding_id = any($1::uuid[])", [[p.f1, p.f2]])).toBe(0);
    expect(await n("select count(*) as n from insight_history where original_finding_id = $1", [p.f1])).toBe(0);
    expect(await n("select count(*) as n from trace where run_id = $1 and event = 'document_erased' and detail->>'documentId' = $2", [run, p.doc])).toBe(1);
    // The synthesized insight keeps its wording.
    expect(await one("select headline from synthesized_insights where id = $1", [p.si])).toEqual({ headline: "Synth" });
  });

  it("CE-4: a brief passage stays while its file is in the bin and is erased with the file", async () => {
    const p = await project();
    const objective = (await one("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Grow share','r','researcher_authored','accepted') returning id", [A, run])).id;
    await db.pool.query("insert into brief_passages(tenant_id,run_id,field,objective_candidate_id,document_id,document_role,quote,verified) values($1,$2,'objective',$3,$4,'brief','We want to grow share.',true)", [A, run, objective, p.doc]);
    const { removeDocumentToBin, eraseRemovedDocument } = await bin();
    await removeDocumentToBin(A, run, p.doc, null);
    expect(await n("select count(*) as n from brief_passages where document_id = $1", [p.doc])).toBe(1);
    await eraseRemovedDocument(A, run, p.doc);
    expect(await n("select count(*) as n from brief_passages where objective_candidate_id = $1", [objective])).toBe(0);
  });

  it("an item older than 30 days is erased when the bin is checked; a newer one stays", async () => {
    const p = await project();
    const q = await project();
    const { removeDocumentToBin, eraseExpiredBinItems, listBin } = await bin();
    await removeDocumentToBin(A, run, p.doc, null);
    await removeDocumentToBin(A, run, q.doc, null);
    await db.pool.query("update document_removals set removed_at = now() - interval '31 days' where document_id = $1", [p.doc]);
    expect(await eraseExpiredBinItems(A, run)).toBe(1);
    expect(await one("select id from documents where id = $1", [p.doc])).toBeUndefined();
    expect((await listBin(A, run)).map((i) => i.documentId)).toContain(q.doc);
  });

  it("removing an output set moves its files and the set; restoring a file brings the set back", async () => {
    const { removeOutputSetToBin, restoreDocumentFromBin, listBin } = await bin();
    const set = (await one("insert into output_sets (tenant_id, run_id, name) values ($1,$2,'Models') returning id", [A, run])).id;
    const d = (await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, output_set_id) values ($1,$2,'output','m.csv','p/m.csv',$3) returning id", [A, run, set])).id;
    expect(await removeOutputSetToBin(A, run, set, null)).toBe(1);
    const binRun = (await one("select id from runs where bin_of = $1", [run])).id;
    expect((await one("select run_id from output_sets where id = $1", [set])).run_id).toBe(binRun);
    const item = (await listBin(A, run)).find((i) => i.documentId === d)!;
    await restoreDocumentFromBin(A, run, item.removalId);
    expect((await one("select run_id from output_sets where id = $1", [set])).run_id).toBe(run);
    expect((await one("select run_id, output_set_id from documents where id = $1", [d]))).toEqual({ run_id: run, output_set_id: set });
  });

  it("another project's or tenant's file, removal or bin item is refused and nothing changes", async () => {
    const p = await project();
    const pb = await project(B, runB);
    const { removeDocumentToBin, restoreDocumentFromBin, eraseRemovedDocument } = await bin();
    await expect(removeDocumentToBin(A, other, p.doc, null)).rejects.toThrow(/not in this project/);
    await expect(removeDocumentToBin(A, run, pb.doc, null)).rejects.toThrow();
    const { removalId } = await removeDocumentToBin(A, run, p.doc, null);
    await expect(restoreDocumentFromBin(A, other, removalId)).rejects.toThrow();
    await expect(eraseRemovedDocument(A, other, p.doc)).rejects.toThrow();
    await expect(removeDocumentToBin(A, run, p.doc, null)).rejects.toThrow(/already have been removed/);
    expect((await one("select removed_from_run from documents where id = $1", [p.doc])).removed_from_run).toBe(run);
    expect(await n("select count(*) as n from findings where id = $1", [pb.f1])).toBe(1);
  });
});
