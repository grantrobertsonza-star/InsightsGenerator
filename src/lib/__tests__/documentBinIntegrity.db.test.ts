// Codex System5000B (2026-10-25) bin findings, through the actual bin actions on a real disposable
// PostgreSQL built from every migration. Storage is a stand-in; nothing else is mocked.
//   SYS5B-F01  a grounding link (report claim grounded by a calculated finding) and a contradiction
//              between findings of two files survive removing both files and restoring them in either
//              order, including the order the review found losing them, a chain of re-removal, and the
//              derived discovery classification; a link to an erased file's finding is reported as lost
//   SYS5B-F02  a kept objective and decision drawn from two files keep "Source document removed" while
//              one source is erased or still in the bin; it clears only when every source is back
//   SYS5B-F03  erasing a file purges its Research quality text in the same transaction: a purge that
//              fails leaves the file in the bin and the text in place, and Erase then succeeds and purges
//   SYS5B-F04  after a re-upload of the same file, the restore refusal's advice works: the new copy can be
//              removed into the bin beside the original, and the original is restored with its note;
//              before migration 0117 that removal is refused naming the migration, with nothing changed
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { classifyFindingDiscovery } from "../discoveryClassification";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })), list: vi.fn(async () => ({ data: [], error: null })) }) } },
}));
vi.setConfig({ testTimeout: 60000 });

const T = randomUUID();

describe.skipIf(!TEST_DATABASE_URL)("document bin integrity (real database)", () => {
  let db: DisposableDb;
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows[0];
  const bin = async () => import("../documentBin");
  const newRun = async () => (await one("insert into runs (tenant_id, project_name) values ($1,'P') returning id", [T])).id as string;
  const doc = async (r: string, name: string, kind = "report", sha: string | null = randomUUID()) =>
    (await one(
      "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, content_sha256, ingestion_type) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [T, r, kind, name, `${T}/${r}/${randomUUID()}`, sha, kind === "table" ? "aggregated" : null],
    )).id as string;
  const finding = async (r: string, d: string, origin: string, text: string, extra: Record<string, unknown> = {}) =>
    (await one(
      "insert into findings (tenant_id, run_id, origin, finding_text, status, source_document_id, researcher_note, grounded_by_finding_id) values ($1,$2,$3,$4,'accepted',$5,$6,$7) returning id",
      [T, r, origin, text, d, extra.note ?? null, extra.groundedBy ?? null],
    )).id as string;
  const removalOf = async (d: string) => (await one("select id from document_removals where document_id = $1 and restored_at is null order by removed_at desc limit 1", [d])).id as string;
  const groundedBy = async (f: string) => (await one("select grounded_by_finding_id as g from findings where id = $1", [f]))?.g ?? null;
  const contradictions = async (a: string) => Number((await one("select count(*)::int as n from finding_contradictions where original_finding_id = $1", [a])).n);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = T;
    await db.pool.query("insert into tenants (id, name) values ($1,'T')", [T]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  /** A data file's calculated finding grounding a report's stated claim. */
  async function grounded() {
    const r = await newRun();
    const data = await doc(r, "data.csv", "table");
    const report = await doc(r, "report.docx");
    const computed = await finding(r, data, "generated", "Mean satisfaction is 20");
    const claim = await finding(r, report, "stated", "Satisfaction averages 20", { note: "Checked ✓", groundedBy: computed });
    return { r, data, report, computed, claim };
  }
  const discovery = async (computed: string) => {
    const corroborates = Number((await one("select count(*)::int as n from findings where grounded_by_finding_id = $1", [computed])).n) > 0;
    return classifyFindingDiscovery({ origin: "generated", corroboratesReportClaim: corroborates }).type;
  };

  it("SYS5B-F01: grounding survives removing both files and restoring computed-first (the failing order), and the computed finding stays validated", async () => {
    const g = await grounded();
    expect(await discovery(g.computed)).toBe("validated");
    const { removeDocumentToBin, restoreDocumentFromBin } = await bin();
    await removeDocumentToBin(T, g.r, g.data, null);
    await removeDocumentToBin(T, g.r, g.report, null);
    const first = await restoreDocumentFromBin(T, g.r, await removalOf(g.data));
    expect(first.linksWaiting).toBe(1);
    expect(first.linksLost).toBe(0);
    await restoreDocumentFromBin(T, g.r, await removalOf(g.report));
    expect(await groundedBy(g.claim)).toBe(g.computed);
    expect(await discovery(g.computed)).toBe("validated");
    expect((await one("select researcher_note from findings where id = $1", [g.claim])).researcher_note).toBe("Checked ✓");
  });

  it("SYS5B-F01: every other order keeps the link too, including removing the claim first and restoring it first", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin } = await bin();
    const orders: [("data" | "report")[], ("data" | "report")[]][] = [
      [["data", "report"], ["report", "data"]],
      [["report", "data"], ["report", "data"]],
      [["report", "data"], ["data", "report"]],
    ];
    for (const [removeOrder, restoreOrder] of orders) {
      const g = await grounded();
      for (const k of removeOrder) await removeDocumentToBin(T, g.r, g[k], null);
      for (const k of restoreOrder) await restoreDocumentFromBin(T, g.r, await removalOf(g[k]));
      expect(await groundedBy(g.claim), `${removeOrder} / ${restoreOrder}`).toBe(g.computed);
    }
  });

  it("SYS5B-F01: a link is passed on through repeated removals and restores; a link to an erased file's finding is reported as lost", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin, eraseRemovedDocument } = await bin();
    const g = await grounded();
    await removeDocumentToBin(T, g.r, g.data, null);
    await removeDocumentToBin(T, g.r, g.report, null);
    await restoreDocumentFromBin(T, g.r, await removalOf(g.data)); // link waits with the report
    await removeDocumentToBin(T, g.r, g.data, null); // and the data file goes again
    const report = await restoreDocumentFromBin(T, g.r, await removalOf(g.report));
    expect(report.linksWaiting).toBe(1); // now it waits with the data file's new removal
    expect(await groundedBy(g.claim)).toBeNull();
    await restoreDocumentFromBin(T, g.r, await removalOf(g.data));
    expect(await groundedBy(g.claim)).toBe(g.computed);

    // Erasing the file that alone holds a link says the link goes with it.
    const e = await grounded();
    await removeDocumentToBin(T, e.r, e.data, null);
    await removeDocumentToBin(T, e.r, e.report, null);
    expect(await eraseRemovedDocument(T, e.r, e.data)).toEqual({ linksRemoved: 1 });
    expect(await restoreDocumentFromBin(T, e.r, await removalOf(e.report))).toMatchObject({ linksWaiting: 0, linksLost: 0 });
    expect(await groundedBy(e.claim)).toBeNull();
    // A link passed on to a file, whose other end is erased before that file is restored, is reported
    // by the restore as lost.
    const l = await grounded();
    await removeDocumentToBin(T, l.r, l.data, null);
    await removeDocumentToBin(T, l.r, l.report, null);
    await restoreDocumentFromBin(T, l.r, await removalOf(l.data)); // the link waits with the report
    await removeDocumentToBin(T, l.r, l.data, null);
    await eraseRemovedDocument(T, l.r, l.data);
    expect(await restoreDocumentFromBin(T, l.r, await removalOf(l.report))).toMatchObject({ linksWaiting: 0, linksLost: 1 });
    expect(await groundedBy(l.claim)).toBeNull();
  });

  it("SYS5B-F01: a contradiction between findings of two files comes back in either restore order", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin } = await bin();
    for (const restoreFirst of ["a", "b"] as const) {
      const r = await newRun();
      const a = await doc(r, "a.docx");
      const b = await doc(r, "b.docx");
      const fa = await finding(r, a, "stated", "Usage rose");
      const fb = await finding(r, b, "stated", "Usage fell");
      await db.pool.query(
        "insert into finding_contradictions (tenant_id, run_id, original_finding_id, contradicting_finding_id, rationale, detected_by) values ($1,$2,$3,$4,'Opposite directions','chain_trace')",
        [T, r, fa, fb],
      );
      await removeDocumentToBin(T, r, a, null);
      await removeDocumentToBin(T, r, b, null);
      const docs = { a, b };
      const later = restoreFirst === "a" ? "b" : "a";
      await restoreDocumentFromBin(T, r, await removalOf(docs[restoreFirst]));
      expect(await contradictions(fa)).toBe(0);
      await restoreDocumentFromBin(T, r, await removalOf(docs[later]));
      expect(await contradictions(fa), `restore ${restoreFirst} first`).toBe(1);
      expect((await one("select contradicting_finding_id as c, rationale from finding_contradictions where original_finding_id = $1", [fa]))).toEqual({ c: fb, rationale: "Opposite directions" });
    }
  });

  it("B27-F01: Erase counts each link it removes once, after zero, one or several earlier removes and restores", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin } = await bin();
    const { eraseDocumentAction } = await import("../documentActions");
    for (const cycles of [0, 1, 3]) {
      // The report stays in the project; only the data file goes to the bin, so its removal holds the link.
      const g = await grounded();
      for (let i = 0; i < cycles; i++) {
        await removeDocumentToBin(T, g.r, g.data, null);
        await restoreDocumentFromBin(T, g.r, await removalOf(g.data));
        expect(await groundedBy(g.claim), `cycle ${i + 1}`).toBe(g.computed);
      }
      await removeDocumentToBin(T, g.r, g.data, null);
      expect(Number((await one("select count(*)::int as n from document_removals where document_id = $1", [g.data])).n)).toBe(cycles + 1);
      const erased = await eraseDocumentAction(g.r, g.data);
      expect(erased, `${cycles} cycles`).toEqual({ ok: true, message: "Erased. 1 link between its findings and other files' findings went with it." });
      expect(await one("select id from documents where id = $1", [g.data])).toBeUndefined();
      expect(await groundedBy(g.claim)).toBeNull();
      // History of every earlier removal is erased with the file, as before.
      expect(await one("select id from document_removals where document_id = $1", [g.data])).toBeUndefined();
    }

    // A contradiction and a grounding link, after two cycles: two links, each counted once.
    const r = await newRun();
    const a = await doc(r, "a.docx");
    const b = await doc(r, "b.docx");
    const data = await doc(r, "data.csv", "table");
    const fa = await finding(r, a, "stated", "Usage rose");
    const fb = await finding(r, b, "stated", "Usage fell");
    const computed = await finding(r, a, "generated", "Usage index 12");
    await finding(r, data, "stated", "Index is 12", { groundedBy: computed });
    await db.pool.query(
      "insert into finding_contradictions (tenant_id, run_id, original_finding_id, contradicting_finding_id, rationale, detected_by) values ($1,$2,$3,$4,'Opposite directions','chain_trace')",
      [T, r, fa, fb],
    );
    for (let i = 0; i < 2; i++) {
      await removeDocumentToBin(T, r, a, null);
      await restoreDocumentFromBin(T, r, await removalOf(a));
    }
    await removeDocumentToBin(T, r, a, null);
    expect(await eraseDocumentAction(r, a)).toEqual({ ok: true, message: "Erased. 2 links between its findings and other files' findings went with it." });

    // A claim's own grounding by another file's finding goes with the claim's file, counted once, also
    // after its other end has been removed and restored meanwhile.
    const h = await grounded();
    await removeDocumentToBin(T, h.r, h.report, null);
    await restoreDocumentFromBin(T, h.r, await removalOf(h.report));
    await removeDocumentToBin(T, h.r, h.report, null);
    await removeDocumentToBin(T, h.r, h.data, null);
    await restoreDocumentFromBin(T, h.r, await removalOf(h.data)); // the claim, and its link, wait in the bin
    expect(await eraseDocumentAction(h.r, h.report)).toMatchObject({ message: "Erased. 1 link between its findings and other files' findings went with it." });

    // Both ends in the bin: the first erase counts the link; the second, whose other end is gone, does not
    // count it again.
    const both = await grounded();
    await removeDocumentToBin(T, both.r, both.data, null);
    await removeDocumentToBin(T, both.r, both.report, null);
    expect(await eraseDocumentAction(both.r, both.report)).toMatchObject({ message: "Erased. 1 link between its findings and other files' findings went with it." });
    expect(await eraseDocumentAction(both.r, both.data)).toEqual({ ok: true, message: "Erased." });

    // Refused while the file is not in the bin, nothing changed; once removed, the erase counts the link once.
    const x = await grounded();
    await removeDocumentToBin(T, x.r, x.data, null);
    await restoreDocumentFromBin(T, x.r, await removalOf(x.data));
    expect(await eraseDocumentAction(x.r, x.data)).toMatchObject({ ok: false });
    expect(await groundedBy(x.claim)).toBe(x.computed);
    await removeDocumentToBin(T, x.r, x.data, null);
    expect(await eraseDocumentAction(x.r, x.data)).toEqual({ ok: true, message: "Erased. 1 link between its findings and other files' findings went with it." });
  });

  it("SYS5B-F02: an erased source keeps the marker when another source is restored; it clears only when every source is back", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin, eraseRemovedDocument } = await bin();
    const setup = async () => {
      const r = await newRun();
      const a = await doc(r, "a.docx");
      const b = await doc(r, "b.docx");
      const objective = (await one(
        "insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status, source_document_ids) values ($1,$2,'Understand churn','r','researcher_authored','accepted',$3) returning id",
        [T, r, [a, b]],
      )).id as string;
      const decision = (await one(
        "insert into decision_candidates (tenant_id, run_id, candidate_text, rationale, source, status, edited, source_document_ids) values ($1,$2,'Whether to reprice','r','ai_suggested','accepted',true,$3) returning id",
        [T, r, [a, b]],
      )).id as string;
      await removeDocumentToBin(T, r, a, null);
      await removeDocumentToBin(T, r, b, null);
      return { r, a, b, objective, decision };
    };
    const marked = async (table: string, id: string) => (await one(`select source_removed_at from ${table} where id = $1`, [id])).source_removed_at !== null;

    const s = await setup();
    await eraseRemovedDocument(T, s.r, s.a);
    await restoreDocumentFromBin(T, s.r, await removalOf(s.b));
    expect(await marked("objective_candidates", s.objective)).toBe(true);
    expect(await marked("decision_candidates", s.decision)).toBe(true);
    expect((await one("select candidate_text, status, source_document_ids from objective_candidates where id = $1", [s.objective]))).toEqual({ candidate_text: "Understand churn", status: "accepted", source_document_ids: [s.a, s.b] });

    // One restored, the other still in the bin: still marked; both restored, in either order: cleared.
    for (const order of [["a", "b"], ["b", "a"]] as const) {
      const t = await setup();
      await restoreDocumentFromBin(T, t.r, await removalOf(t[order[0]]));
      expect(await marked("objective_candidates", t.objective)).toBe(true);
      await restoreDocumentFromBin(T, t.r, await removalOf(t[order[1]]));
      expect(await marked("objective_candidates", t.objective)).toBe(false);
      expect(await marked("decision_candidates", t.decision)).toBe(false);
    }
  });

  it("SYS5B-F03: a purge that fails leaves the file in the bin with its text; Erase then purges and erases", async () => {
    const { removeDocumentToBin, eraseRemovedDocument, listBin } = await bin();
    const r = await newRun();
    const d = await doc(r, "methodology.docx");
    const source = (await one("insert into research_quality_sources (tenant_id, run_id, document_id, roles) values ($1,$2,$3,'{methodology}') returning id", [T, r, d])).id as string;
    const version = (await one(
      `insert into research_quality_source_versions (tenant_id, run_id, source_id, ordinal, original_document_id, filename, content_sha256, canonical_sha256, extractor, extractor_version, canonical_text, segments, char_count)
       values ($1,$2,$3,1,$4,'methodology.docx','x','y','docx_text','rq-reader@1','Private methodology text','[]',24) returning id`,
      [T, r, source, d],
    )).id as string;
    await removeDocumentToBin(T, r, d, null);
    await db.pool.query(`create or replace function test_fail_purge() returns trigger language plpgsql as $$ begin raise exception 'synthetic purge failure'; end $$`);
    await db.pool.query(`create trigger test_fail_purge before update on research_quality_source_versions for each row execute function test_fail_purge()`);
    try {
      await expect(eraseRemovedDocument(T, r, d)).rejects.toThrow(/synthetic purge failure/);
    } finally {
      await db.pool.query("drop trigger test_fail_purge on research_quality_source_versions");
    }
    // Nothing was erased: the file is still in the bin and the text is still there to purge.
    expect((await listBin(T, r)).map((i) => i.documentId)).toEqual([d]);
    expect((await one("select canonical_text, purged_at from research_quality_source_versions where id = $1", [version]))).toEqual({ canonical_text: "Private methodology text", purged_at: null });
    const { eraseDocumentAction } = await import("../documentActions");
    expect(await eraseDocumentAction(r, d)).toMatchObject({ ok: true });
    const purged = await one("select canonical_text, purged_at from research_quality_source_versions where id = $1", [version]);
    expect(purged.canonical_text).toBe("");
    expect(purged.purged_at).not.toBeNull();
    expect(await one("select id from documents where id = $1", [d])).toBeUndefined();
  });

  it("SYS5B-F04: after a re-upload, the new copy can be removed beside the original, and the original is restored with its note", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin } = await bin();
    const r = await newRun();
    const sha = randomUUID();
    const original = await doc(r, "survey.csv", "table", sha);
    const reviewed = await finding(r, original, "stated", "Reviewed claim", { note: "Keep this" });
    await removeDocumentToBin(T, r, original, null);
    const copy = await doc(r, "survey (copy).csv", "table", sha);
    const removal = await removalOf(original);
    await expect(restoreDocumentFromBin(T, r, removal)).rejects.toThrow(/Remove that copy first/);
    await removeDocumentToBin(T, r, copy, null); // refused with documents_run_kind_content_uidx before 0117
    await restoreDocumentFromBin(T, r, removal);
    expect((await one("select run_id from documents where id = $1", [original])).run_id).toBe(r);
    expect((await one("select researcher_note from findings where id = $1", [reviewed])).researcher_note).toBe("Keep this");
    expect((await one("select removed_from_run from documents where id = $1", [copy])).removed_from_run).toBe(r);
    // The copy cannot come back while the original is in the project, and the project still holds one.
    await expect(restoreDocumentFromBin(T, r, await removalOf(copy))).rejects.toThrow(/already has this file again/);
    await expect(db.pool.query("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, content_sha256, ingestion_type) values ($1,$2,'table','third.csv','p',$3,'aggregated')", [T, r, sha])).rejects.toThrow(/documents_run_kind_content_uidx/);
  });

  it("SYS5B-F04: before migration 0117, removing a second identical copy is refused with the migration named, and nothing changes", async () => {
    const { removeDocumentToBin } = await bin();
    const r = await newRun();
    const sha = randomUUID();
    const original = await doc(r, "survey.csv", "table", sha);
    await removeDocumentToBin(T, r, original, null);
    const copy = await doc(r, "survey (copy).csv", "table", sha);
    // The index as 0098 made it, which also covers the bin.
    await db.pool.query("drop index documents_run_kind_content_uidx");
    await db.pool.query("create unique index documents_run_kind_content_uidx on documents (run_id, kind, content_sha256) where content_sha256 is not null");
    try {
      await expect(removeDocumentToBin(T, r, copy, null)).rejects.toThrow(/keeping two needs database migration 0117.*nothing was changed/);
      expect((await one("select run_id, removed_at from documents where id = $1", [copy]))).toEqual({ run_id: r, removed_at: null });
    } finally {
      await db.pool.query("drop index documents_run_kind_content_uidx");
      await db.pool.query("create unique index documents_run_kind_content_uidx on documents (run_id, kind, content_sha256) where content_sha256 is not null and removed_at is null");
    }
  });
});
