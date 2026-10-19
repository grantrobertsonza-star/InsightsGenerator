// Set Objectives' "Fill in from a brief or proposal" (Grant 2026-10-19): briefs and proposals are
// imported under Import data, and Set Objectives only chooses which imported one(s) to fill blank
// fields from. Real database, the actual saveRunContext action; the model-backed field extraction
// is the external boundary and is controlled here.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const intake = vi.hoisted(() => ({ calls: [] as { briefText?: string | null; proposalText?: string | null }[] }));
vi.mock("../briefIntake", () => ({
  extractBriefFields: vi.fn(async (_t: string, _r: string, docs: { briefText?: string | null; proposalText?: string | null }) => {
    intake.calls.push(docs);
    return { businessProblem: `Problem from: ${docs.briefText ?? docs.proposalText}`, researchObjective: "Objective from the brief" };
  }),
}));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("Set Objectives fills blank fields from an imported brief (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string, brief: string, foreign: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic intake')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
    const doc = async (r: string, text: string) =>
      (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'evidence','brief.docx',$3,$4) returning id", [tenant, r, `${tenant}/${r}/brief.docx`, text])).rows[0].id as string;
    brief = await doc(run, "Imported brief text");
    foreign = await doc(other, "Another project's brief");
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    intake.calls.length = 0;
  });
  const save = async (runId: string, fields: Record<string, string>) => {
    const { saveRunContext } = await import("../runContextActions");
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    await saveRunContext(runId, form);
    return (await db.pool.query("select business_problem, stated_objectives_text from runs where id=$1", [runId])).rows[0];
  };

  it("an ordinary save with nothing chosen calls no extraction", async () => {
    await save(run, { businessProblem: "", researchObjective: "", audience: "" });
    expect(intake.calls).toEqual([]);
  });

  it("a chosen imported brief fills only the blank fields; typed text wins", async () => {
    const row = await save(run, { businessProblem: "Typed problem", researchObjective: "", audience: "", briefDocumentId: brief });
    expect(intake.calls).toEqual([{ briefText: "Imported brief text", proposalText: null }]);
    expect(row.business_problem).toBe("Typed problem");
    expect(row.stated_objectives_text).toContain("Objective from the brief");
  });

  it("a document from another project is refused, and what was typed is still saved", async () => {
    const row = await save(run, { businessProblem: "Kept problem", researchObjective: "", audience: "", briefDocumentId: foreign });
    expect(intake.calls).toEqual([]);
    expect(row.business_problem).toBe("Kept problem");
    const trace = (await db.pool.query("select detail from trace where run_id=$1 and event='brief_intake_error' order by id desc limit 1", [run])).rows[0];
    expect(trace.detail.message).toMatch(/not in this project/);
  });
});
