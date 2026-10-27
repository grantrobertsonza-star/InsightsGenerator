// CE-6, the analysis plan (migration 0123; analysisPlan.ts), end to end through the actual actions, the
// actual evidence lane, the local Python engine and a real disposable PostgreSQL. Mocked boundaries only:
// the model (it writes the plan lines and is checked for what it was given), the plain-English table
// planner (crosstabAsk, itself a model call), storage (in memory), usage logging and next/cache.
//   - the plan is written with the stated methodology, and the generation records it; changing the
//     methodology afterwards is shown as "changed since"; a methodology never read is "not read", not none
//   - approval line by line at the wording shown: a stale revision is refused with nothing saved; an edit
//     makes an approved line "changed since approval"; excluding withdraws approval
//   - writing the plan again keeps approved lines (same id) and replaces unapproved automatic ones
//   - approved lines' tables move into Cross tabs with their line recorded, once; an unapproved line's
//     table stays put; committing them makes planned findings carrying their objective, alongside
//     discovered (workspace table) and stated (report) findings, in the page reader and the export
//   - before migration 0123: approval reads as unknown, approving is refused with the migration named,
//     and computed findings' routes read as unknown rather than discovered
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as XLSX from "xlsx";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/analysisPlan", async () => await import("../analysisPlan"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

const model = vi.hoisted(() => ({ systems: [] as string[], questions: [] as unknown[] }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string }; system: unknown; messages: { content: string }[] }) => {
        if (req.tool_choice.name === "submit_questions") {
          model.systems.push(JSON.stringify(req.system));
          const objective = req.messages[0].content;
          // One question per objective, named after it, so each item's lines are told apart.
          return {
            usage: {},
            stop_reason: "tool_use",
            content: [{ type: "tool_use", name: "submit_questions", input: { questions: [{
              question: `Do women buy more than men? (${objective.slice(-12)})`,
              request: "purchase by gender",
              supports_if: "Women higher",
              against_if: "Men higher",
              expectation: { kind: "comparison", answer: "Yes", groupA: "Female", groupB: "Male", direction: "higher", measure: "percent" },
            }] } }],
          };
        }
        throw new Error(`test: unexpected model call ${req.tool_choice.name}`);
      }),
    },
  },
}));
vi.mock("../crosstabAsk", () => ({
  planCrosstabFromText: vi.fn(async () => ({ summary: "purchase by gender", rows: [{ key: "purchase", vars: ["purchase"], label: "Purchase" }], columns: [{ name: "gender", label: "Gender" }], filters: [], unclear: [] })),
}));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

// 80 respondents (bases of 40, above the evidence lane's minimum of 30): women buy 30 of 40, men 10 of 40.
const DATA = Buffer.from(
  "id,gender,purchase\n" +
    Array.from({ length: 80 }, (_, i) => `${i + 1},${i < 40 ? "Female" : "Male"},${(i < 40 ? i < 30 : i < 50) ? "Yes" : "No"}`).join("\n") +
    "\n",
  "utf-8",
);

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("CE-6 analysis plan (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function project(methodology: string | null) {
    const run = (await q("insert into runs (tenant_id, project_name, methodology) values ($1, 'Plan', $2) returning id", [tenant, methodology]))[0].id as string;
    const objectives: string[] = [];
    for (const text of ["Understand who buys", "Size the gap by gender"]) {
      objectives.push((await q("insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status) values ($1,$2,$3,'','researcher_authored','accepted') returning id", [tenant, run, text]))[0].id);
    }
    const key = `${tenant}/${run}/${randomUUID()}-survey.csv`;
    storage.objects.set(key, DATA);
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'survey.csv', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    return { run, doc, objectives };
  }
  const actions = () => import("../objectiveEvidenceActions");
  async function load(run: string) {
    const r = await (await actions()).loadObjectiveEvidenceAction(run);
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  async function readAll(run: string) {
    const { evaluateObjectiveEvidenceAction } = await actions();
    for (let i = 0; i < 10; i++) {
      const e = await evaluateObjectiveEvidenceAction(run);
      if (!e.ok) throw new Error(e.error);
      if (e.remaining === 0) return;
    }
    throw new Error("evidence did not finish reading");
  }

  it("is written with the stated methodology, which is recorded, and a later change is shown", async () => {
    const { run } = await project("Compare women and men on purchase; the population is adults who shop online.");
    const { generateObjectiveEvidenceAction } = await actions();
    model.systems = [];
    expect(await generateObjectiveEvidenceAction(run)).toMatchObject({ ok: true, created: 2 });
    expect(model.systems).toHaveLength(2);
    for (const s of model.systems) expect(s).toContain("Compare women and men on purchase");
    const { methodologySha } = await import("../analysisPlan");
    expect(await q("select methodology_state, methodology_sha from objective_evidence_generations where run_id = $1 and is_current", [run])).toEqual([
      { methodology_state: "stated", methodology_sha: methodologySha("Compare women and men on purchase; the population is adults who shop online.") },
    ]);
    let r = await load(run);
    expect(r).toMatchObject({ planAvailable: true, planMethodologyNote: null });
    expect(r.questions.map((x) => x.approval)).toEqual(["proposed", "proposed"]);
    // The same text with other spacing and case is the same methodology.
    await q("update runs set methodology = $2 where id = $1", [run, "compare WOMEN and men on purchase;   the population is adults who shop online."]);
    expect((await load(run)).planMethodologyNote).toBeNull();
    await q("update runs set methodology = $2 where id = $1", [run, "Compare age groups."]);
    r = await load(run);
    expect(r.planMethodologyNote).toMatch(/stated methodology has changed since this plan was written/);
  });

  it("without a methodology: 'not read' is said, and the instructions carry none", async () => {
    const { run } = await project(null);
    const { generateObjectiveEvidenceAction } = await actions();
    model.systems = [];
    expect(await generateObjectiveEvidenceAction(run)).toMatchObject({ ok: true });
    for (const s of model.systems) expect(s).not.toContain("stated methodology");
    expect((await q("select methodology_state from objective_evidence_generations where run_id = $1 and is_current", [run]))[0].methodology_state).toBe("not_read");
    expect((await load(run)).planMethodologyNote).toMatch(/have not been read for a methodology yet/);
    // A finished reading that found none is "none stated", and later stating one shows as a change.
    await q("insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'methodology_extraction_done', '{\"found\":false}')", [tenant, run]);
    await generateObjectiveEvidenceAction(run);
    expect((await q("select methodology_state from objective_evidence_generations where run_id = $1 and is_current", [run]))[0].methodology_state).toBe("none_stated");
    expect((await load(run)).planMethodologyNote).toBeNull();
    await q("update runs set methodology = 'Compare regions.' where id = $1", [run]);
    expect((await load(run)).planMethodologyNote).toMatch(/A methodology has been stated since/);
  });

  it("approves line by line at the wording shown; edits, exclusion and writing again behave as a plan should", async () => {
    const { run } = await project("Compare women and men.");
    const a = await actions();
    await a.generateObjectiveEvidenceAction(run);
    let r = await load(run);
    const [first, second] = r.questions;
    // A stale revision refuses the whole call; nothing is saved, not even the valid line.
    expect(await a.setPlanLineApprovalAction(run, [{ id: second.id, expectedRevision: second.question_revision }, { id: first.id, expectedRevision: first.question_revision + 1 }], true)).toMatchObject({
      ok: false, error: expect.stringMatching(/changed since you opened it.*Nothing was saved/),
    });
    expect((await load(run)).questions.map((x) => x.approval)).toEqual(["proposed", "proposed"]);
    expect(await a.setPlanLineApprovalAction(run, "nonsense", true)).toMatchObject({ ok: false });
    expect(await a.setPlanLineApprovalAction(run, [{ id: first.id, expectedRevision: first.question_revision }], true)).toEqual({ ok: true, changed: 1 });
    // Approving again changes nothing.
    expect(await a.setPlanLineApprovalAction(run, [{ id: first.id, expectedRevision: first.question_revision }], true)).toEqual({ ok: true, changed: 0 });
    r = await load(run);
    expect(r.questions.find((x) => x.id === first.id)).toMatchObject({ approval: "approved", approved_revision: first.question_revision, approved_at: expect.any(String), source: "auto" });
    // Writing the plan again keeps the approved (unedited, automatic) line; the other item's unapproved line is replaced.
    await a.generateObjectiveEvidenceAction(run);
    r = await load(run);
    expect(r.questions.map((x) => x.id)).toContain(first.id);
    expect(r.questions.map((x) => x.id)).not.toContain(second.id);
    expect(r.questions).toHaveLength(2);
    // An edit keeps the record but makes the line "changed since approval", until approved again.
    expect(await a.editObjectiveEvidenceAction(run, first.id, { question: "Do women buy more often than men?" })).toEqual({ ok: true });
    const edited = (await load(run)).questions.find((x) => x.id === first.id)!;
    expect(edited).toMatchObject({ approval: "changed", source: "edited" });
    expect(await a.setPlanLineApprovalAction(run, [{ id: first.id, expectedRevision: edited.question_revision }], true)).toEqual({ ok: true, changed: 1 });
    expect((await load(run)).questions.find((x) => x.id === first.id)!.approval).toBe("approved");
    // Excluding withdraws approval; an excluded line cannot be approved; including it leaves it proposed.
    const other = r.questions.find((x) => x.id !== first.id)!;
    await a.setPlanLineApprovalAction(run, [{ id: other.id, expectedRevision: other.question_revision }], true);
    expect(await a.editObjectiveEvidenceAction(run, other.id, { excluded: true })).toEqual({ ok: true });
    expect((await load(run)).questions.find((x) => x.id === other.id)).toMatchObject({ approval: "proposed", excluded: true });
    expect(await a.setPlanLineApprovalAction(run, [{ id: other.id, expectedRevision: other.question_revision }], true)).toMatchObject({ ok: false, error: expect.stringMatching(/excluded line cannot be approved/) });
    await a.editObjectiveEvidenceAction(run, other.id, { excluded: false });
    expect((await load(run)).questions.find((x) => x.id === other.id)!.approval).toBe("proposed");
    // Withdrawing approval.
    expect(await a.setPlanLineApprovalAction(run, [{ id: first.id, expectedRevision: 0 }], false)).toEqual({ ok: true, changed: 1 });
    expect((await load(run)).questions.find((x) => x.id === first.id)!.approval).toBe("proposed");
    // Another project's line is not found.
    const { run: elsewhere } = await project(null);
    expect(await a.setPlanLineApprovalAction(elsewhere, [{ id: first.id, expectedRevision: 0 }], true)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });

  it("moves approved lines' tables into Cross tabs once, and their findings are planned, with their objective", async () => {
    const { run, doc } = await project("Compare women and men.");
    const a = await actions();
    await a.generateObjectiveEvidenceAction(run);
    await readAll(run);
    const lines = (await load(run)).questions;
    expect(lines.map((x) => [x.stance, x.basis, x.error])).toEqual([["supports", "computed", null], ["supports", "computed", null]]);
    const [approved, proposed] = lines;
    await a.setPlanLineApprovalAction(run, [{ id: approved.id, expectedRevision: approved.question_revision }], true);
    expect(await a.promoteApprovedPlanTablesAction(run, doc)).toEqual({ ok: true, moved: 1, alreadyInCrossTabs: 0, withoutTable: 0, approved: 1 });
    expect(await a.promoteApprovedPlanTablesAction(run, doc)).toEqual({ ok: true, moved: 0, alreadyInCrossTabs: 1, withoutTable: 0, approved: 1 });
    const tables = await q("select id, crosstab_status, plan_evidence_id, plan_line from document_tables where run_id = $1 and crosstab is not null order by table_index", [run]);
    const moved = tables.find((t) => t.plan_evidence_id === approved.id)!;
    expect(moved).toMatchObject({ crosstab_status: "draft", plan_line: { evidenceId: approved.id, revision: approved.question_revision, approvedRevision: approved.question_revision, itemKind: "objective", itemText: approved.item_text, objectiveCandidateId: approved.objective_candidate_id } });
    const proposedTable = proposed.results[0].table_id;
    expect(tables.find((t) => t.id === proposedTable)).toMatchObject({ crosstab_status: "evidence", plan_evidence_id: null });

    // A workspace table outside the plan, and a report's own claim.
    const { buildCrosstab, commitCrosstabs } = await import("../crosstabs");
    await buildCrosstab(tenant, run, doc, { columnVars: ["gender"], rowItems: [{ key: "purchase", label: "Purchase", vars: ["purchase"] }], weightVar: null });
    const committed = await commitCrosstabs(tenant, run, doc);
    expect(committed.tables).toBe(2);
    await q("insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, 'stated', 'The report says women buy more.', 'accepted')", [tenant, run]);

    const { pool } = await import("../db");
    const client = await pool.connect();
    let routes;
    try {
      await client.query("select set_config('app.current_tenant_id', $1, false)", [tenant]);
      routes = await (await import("../analysisPlan")).readFindingRoutes(client, run);
    } finally {
      client.release();
    }
    const findings = await q("select id, origin, source_table_id from findings where run_id = $1", [run]);
    const byRoute = (route: string) => findings.filter((f) => routes.get(f.id)?.route === route);
    expect(byRoute("planned").length).toBeGreaterThan(0);
    expect(byRoute("planned").every((f) => f.source_table_id === moved.id)).toBe(true);
    expect(byRoute("discovered").length).toBeGreaterThan(0);
    expect(byRoute("discovered").every((f) => f.source_table_id !== moved.id && f.origin === "generated")).toBe(true);
    expect(byRoute("stated")).toHaveLength(1);
    expect(byRoute("unknown")).toHaveLength(0);
    const planned = routes.get(byRoute("planned")[0].id)!;
    expect(planned.planLine).toMatchObject({ evidenceId: approved.id, itemText: approved.item_text });

    // The route survives the line being edited afterwards (the snapshot), and the live link goes when it is deleted.
    await a.editObjectiveEvidenceAction(run, approved.id, { question: "Reworded later" });
    await q("delete from objective_evidence where id = $1", [approved.id]);
    const after = await q("select plan_evidence_id, plan_line->>'question' as question from document_tables where id = $1", [moved.id]);
    expect(after).toEqual([{ plan_evidence_id: null, question: approved.question }]);

    // The findings export carries the route and the plan line.
    const { GET } = await import("../../app/api/runs/[id]/findings/export/route");
    const res = await GET(new Request(`http://test/api/runs/${run}/findings/export`) as never, { params: Promise.resolve({ id: run }) } as never);
    expect(res.status).toBe(200);
    const sheet = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet.Sheets.Findings);
    expect(new Set(rows.map((x) => x.Route))).toEqual(new Set(["Planned", "Discovered", "Stated"]));
    expect(rows.filter((x) => x.Route === "Planned").every((x) => x["Plan line"].startsWith(`Planned: "${approved.question}" (approved), for the objective`))).toBe(true);
    expect(rows.filter((x) => x.Route !== "Planned").every((x) => !x["Plan line"])).toBe(true);
  });

  it("refuses a file of another project, and a table that is not an evidence table", async () => {
    const { run } = await project(null);
    const { doc: foreign } = await project(null);
    const a = await actions();
    expect(await a.promoteApprovedPlanTablesAction(run, foreign)).toMatchObject({ ok: false, error: expect.stringMatching(/not found in this project/) });
    expect(await a.promoteEvidenceTableAction(run, randomUUID())).toMatchObject({ ok: false, error: expect.stringMatching(/already in Cross tabs/) });
  });

  it("before migration 0123: approval unknown, approving refused with the migration named, computed routes unknown", async () => {
    const { run, doc } = await project("Compare women and men.");
    const a = await actions();
    await a.generateObjectiveEvidenceAction(run);
    await readAll(run);
    const { buildCrosstab, commitCrosstabs } = await import("../crosstabs");
    await buildCrosstab(tenant, run, doc, { columnVars: ["gender"], rowItems: [{ key: "purchase", label: "Purchase", vars: ["purchase"] }], weightVar: null });
    await commitCrosstabs(tenant, run, doc);
    await q("alter table objective_evidence rename column approved_revision to approved_revision_moved");
    try {
      const r = await load(run);
      expect(r.planAvailable).toBe(false);
      expect(r.questions.every((x) => x.approval === "unknown")).toBe(true);
      const line = r.questions[0];
      expect(await a.setPlanLineApprovalAction(run, [{ id: line.id, expectedRevision: line.question_revision }], true)).toMatchObject({ ok: false, error: expect.stringMatching(/migration 0123_analysis_plan/) });
      expect(await a.promoteApprovedPlanTablesAction(run, doc)).toMatchObject({ ok: false, error: expect.stringMatching(/migration 0123_analysis_plan/) });
      // The single move still works, without the record.
      expect(await a.promoteEvidenceTableAction(run, line.results[0].table_id!)).toEqual({ ok: true });
      // Writing the plan again still works (no approvals to keep).
      expect(await a.generateObjectiveEvidenceAction(run)).toMatchObject({ ok: true });
      const { pool } = await import("../db");
      const client = await pool.connect();
      try {
        await client.query("select set_config('app.current_tenant_id', $1, false)", [tenant]);
        const routes = await (await import("../analysisPlan")).readFindingRoutes(client, run);
        expect([...routes.values()].every((x) => x.route === "unknown")).toBe(true);
      } finally {
        client.release();
      }
    } finally {
      await q("alter table objective_evidence rename column approved_revision_moved to approved_revision");
    }
  });
});
