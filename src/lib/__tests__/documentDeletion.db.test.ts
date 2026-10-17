// GT-010: the "Delete document" confirmation names the reviewed work that goes with the file.
// Real disposable PostgreSQL for the counts (the same findings deleteDocument removes: by
// source_document_id, and by source_table_id on the document's tables); the message builder is pure.
// Controls: a document with no findings says so; a failed read falls back to general wording,
// never to "0".
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { deleteDocumentConfirmation } from "../documentDeletionMessage";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe("deleteDocumentConfirmation (pure)", () => {
  it("names findings, review decisions, notes and the insights whose support goes", () => {
    const text = deleteDocumentConfirmation({ findings: 3, reviewed: 2, notes: 1, insights: 2 });
    expect(text).toBe("Delete this document? This also deletes 3 findings, with 2 review decisions you made and 1 researcher note. 2 insights rest on them and will show their support as no longer valid. This can't be undone.");
  });
  it("singular wording, and nothing said that is not there", () => {
    expect(deleteDocumentConfirmation({ findings: 1, reviewed: 0, notes: 0, insights: 1 })).toBe("Delete this document? This also deletes 1 finding. 1 insight rests on them and will show its support as no longer valid. This can't be undone.");
    expect(deleteDocumentConfirmation({ findings: 0, reviewed: 0, notes: 0, insights: 0 })).toBe("Delete this document? No findings come from it. This can't be undone.");
  });
  it("unknown counts read as general wording, not zero", () => {
    const text = deleteDocumentConfirmation(null);
    expect(text).toMatch(/review decisions and researcher notes/);
    expect(text).toMatch(/no longer valid/);
    expect(text).not.toMatch(/\b0\b|No findings/);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("document deletion impact (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let doc = "";
  let empty = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
    await db.pool.query("insert into tenants(id,name) values($1,'Deletion impact')", [tenant]);
    run = await one("insert into runs(tenant_id,project_name) values($1,'Deletion') returning id", [tenant]);
    doc = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','survey.xlsx','survey.xlsx','raw') returning id", [tenant, run]);
    empty = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report','brief.docx','brief.docx') returning id", [tenant, run]);
    const table = await one("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type) values($1,$2,$3,0,'raw') returning id", [tenant, run, doc]);
    const f1 = await one("insert into findings(tenant_id,run_id,origin,finding_text,status,source_table_id,human_reviewed_at,human_review_action,researcher_note) values($1,$2,'generated','Computed one','accepted',$3,now(),'accept','Keep the uncertainty explicit') returning id", [tenant, run, table]);
    const f2 = await one("insert into findings(tenant_id,run_id,origin,finding_text,status,source_table_id,human_reviewed_at,human_review_action) values($1,$2,'generated','Computed two','rejected',$3,now(),'reject') returning id", [tenant, run, table]);
    await one("insert into findings(tenant_id,run_id,origin,finding_text,status,source_document_id,researcher_note) values($1,$2,'stated','Read from the file','accepted',$3,'   ') returning id", [tenant, run, doc]);
    const p1 = await one("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,'h','o','t','i') returning id", [tenant, run, f1]);
    const si = await one("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication) values($1,$2,'S','o','t','i') returning id", [tenant, run]);
    await db.pool.query("insert into synthesized_insight_sources(tenant_id,synthesized_insight_id,pre_insight_id) values($1,$2,$3)", [tenant, si, p1]);
    void f2;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("counts what deleting the document takes with it; a document with no findings reads as none", async () => {
    const { loadDocumentDeletionImpact, impactFor } = await import("../documentDeletionImpact");
    const result = await loadDocumentDeletionImpact(tenant, run);
    expect(result.available).toBe(true);
    // 3 findings (two on its table, one read from the file); 2 reviewed; 1 note (a blank note is not one);
    // 1 pre-insight and 1 synthesized insight rest on them.
    expect(impactFor(result, doc)).toEqual({ findings: 3, reviewed: 2, notes: 1, insights: 2 });
    expect(impactFor(result, empty)).toEqual({ findings: 0, reviewed: 0, notes: 0, insights: 0 });
    expect(deleteDocumentConfirmation(impactFor(result, doc))).toMatch(/3 findings, with 2 review decisions you made and 1 researcher note\. 2 insights rest on them/);
  });

  it("a failed read is unavailable, and the confirmation falls back to general wording", async () => {
    const { loadDocumentDeletionImpact, impactFor } = await import("../documentDeletionImpact");
    await db.pool.query("alter table findings rename to findings_away");
    try {
      const result = await loadDocumentDeletionImpact(tenant, run);
      expect(result.available).toBe(false);
      expect(impactFor(result, doc)).toBeNull();
      expect(deleteDocumentConfirmation(impactFor(result, doc))).toBe(deleteDocumentConfirmation(null));
    } finally {
      await db.pool.query("alter table findings_away rename to findings");
    }
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("document deletion impact (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
