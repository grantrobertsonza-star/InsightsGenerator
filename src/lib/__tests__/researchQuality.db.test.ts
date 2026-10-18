// Research Quality Review v1 on a REAL PostgreSQL (disposable, all migrations) as a NON-OWNER role
// without BYPASSRLS, through the ACTUAL server actions, repository, orchestration, view and DOCX
// builder. Mocked boundaries only: the model client (a deterministic stand-in that quotes the
// document it is given), object storage (in memory), the signed-in request context, and
// next/server after() (run inline so the test can await it). The cases are the deterministic
// parts of the brief's finite suite (section 10): RQ01, RQ04, RQ10 to RQ14, the missing-migration
// guard and purge. The semantic "M" cases need the real model and are in the Windows kit.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const A = "00000000-0000-4000-8000-0000000000a7";
const B = "00000000-0000-4000-8000-0000000000b7";
const ROLE = "ie_test_rq_app";
let current = { tenantId: A, userId: "20000000-0000-4000-8000-0000000000a7", email: "researcher-a@example.test" };
const objects = new Map<string, Buffer>();
const pendingAfter: Promise<unknown>[] = [];
const model = { calls: [] as string[], failTask: null as null | string, malformed: null as null | string, hold: null as null | { task: string; release: Promise<void> }, stringifyLists: false, cutOff: null as null | "extract" | "assess", checklist: "normal" as "normal" | "overclaim" | "fail" };

vi.mock("../requestContext", async () => ({
  ...(await vi.importActual<object>("../requestContext")),
  requireRequestContext: async () => ({ ...current, organisationName: "Org", role: "owner", memberships: [] }),
  requireTenantId: async () => current.tenantId,
}));
vi.mock("next/server", async () => ({ ...(await vi.importActual<object>("next/server")), after: (fn: () => Promise<unknown>) => void pendingAfter.push(fn()) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (p: string) => (objects.has(p) ? { data: new Blob([new Uint8Array(objects.get(p)!)]), error: null } : { data: null, error: { message: "not found" } }),
      }),
    },
  },
}));
vi.mock("../apiUsage", async () => ({ ...(await vi.importActual<object>("../apiUsage")), logApiUsage: async () => {} }));
// Deterministic model stand-in: extraction quotes each sentence of the passage it was sent;
// assessment answers one observation per criterion, citing facts whose topic fits.
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "stand-in-model",
  anthropic: {
    messages: {
      create: async (req: { tool_choice: { name: string }; messages: { content: string }[] }) => {
        const tool = req.tool_choice.name;
        const content = req.messages[0].content;
        model.calls.push(tool);
        const usage = { input_tokens: 1000, output_tokens: 500 };
        if (tool === "record_documented_facts") {
          const doc = /<document>\n([\s\S]*)\n<\/document>/.exec(content)![1];
          const sentences = doc.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
          const facts = sentences.map((s) => ({
            topic: /decision/i.test(s) ? "decision" : /recruit|panel/i.test(s) ? "recruitment" : /customers|public/i.test(s) ? "population" : /question|ask/i.test(s) ? "instrument_item" : "claim",
            phase: /\bwill\b/i.test(s) ? "planned" : "reported_executed",
            selection: /opt-in/i.test(s) ? "non_probability" : "unstated",
            statement: s.slice(0, 80),
            exact_quote: s,
          }));
          if (model.cutOff === "extract") return { usage, stop_reason: "max_tokens", content: [{ type: "tool_use", input: { facts: facts.slice(0, 1) } }] };
          // The live model's slip seen on 2026-10-18: the list arrives as a JSON string and the flag is left out.
          if (model.stringifyLists) return { usage, content: [{ type: "tool_use", input: { facts: JSON.stringify(facts) } }] };
          return { usage, content: [{ type: "tool_use", input: { nothing_found: facts.length === 0, facts } }] };
        }
        if (tool === "record_checklist_statuses") {
          // Checklist stand-in: an element is present when a fact of its matching topic exists, and
          // absent otherwise. "overclaim" says present everywhere without citing anything.
          const cp = JSON.parse(content) as { elements: { element_id: string }[]; facts: { id: string; topic: string }[] };
          if (model.checklist === "fail") throw new Error("synthetic checklist outage");
          const topicFor = (id: string) => (/DECISION/.test(id) ? "decision" : /POPULATION/.test(id) ? "population" : /SAMPLING|FRAME/.test(id) ? "recruitment" : null);
          const elements = cp.elements.map((e) => {
            if (model.checklist === "overclaim") return { element_id: e.element_id, status: "present", fact_ids: [], reason: "stand-in overclaim" };
            const t = topicFor(e.element_id);
            const f = t ? cp.facts.filter((x) => x.topic === t).map((x) => x.id) : [];
            return { element_id: e.element_id, status: f.length ? "present" : "absent", fact_ids: f.slice(0, 2), reason: f.length ? "stated" : "not stated" };
          });
          return { usage, content: [{ type: "tool_use", input: { elements } }] };
        }
        const payload = JSON.parse(content) as { criteria: { id: string }[]; facts: { id: string; topic: string }[]; context: { decisions: { ref: number }[] } };
        const group = payload.criteria[0].id;
        if (model.hold && payload.criteria.some((c) => c.id === model.hold!.task)) await model.hold.release;
        if (model.failTask && payload.criteria.some((c) => c.id === model.failTask)) throw new Error("synthetic model outage");
        const observations = payload.criteria.map((c) => {
          const want = c.id.includes("POPULATION") ? ["population"] : c.id.includes("DECISION") ? ["decision"] : c.id.includes("SAMPLE") ? ["recruitment"] : c.id.includes("ALIGN") ? ["population", "recruitment"] : [];
          const cited = payload.facts.filter((f) => want.includes(f.topic)).slice(0, 2).map((f) => f.id);
          return {
            criterion_id: c.id,
            fact_ids: model.malformed === c.id ? ["F999"] : cited,
            decision_refs: payload.context.decisions.length ? [0] : [],
            score: cited.length ? 3 : 0,
            score_reason: "stand-in score",
            documentation: cited.length ? (c.id.includes("ALIGN") && cited.length > 1 ? "conflicting" : "documented") : "not_documented",
            methodology: cited.length ? "concern" : "concern",
            decision_fitness: payload.context.decisions.map((d) => ({ decision_ref: d.ref, state: "qualified", reasoning: "stand-in" })),
            reasoning: `stand-in judgement for ${c.id}`,
            implication: `Generated implication for ${c.id}`,
            uncertainty: [],
            improvement: { current_action: `Clarify ${c.id} in the report`, future_action: null, timing: "before_decision", rationale: "stand-in" },
            clarification_questions: [`What does ${c.id} need?`],
          };
        });
        void group;
        if (model.cutOff === "assess") return { usage, stop_reason: "max_tokens", content: [{ type: "tool_use", input: {} }] };
        return { usage, content: [{ type: "tool_use", input: model.stringifyLists ? { observations: JSON.stringify(observations) } : { observations } }] };
      },
    },
  },
}));

describe.skipIf(!TEST_DATABASE_URL)("research quality review (actual actions, real database, non-owner role)", () => {
  let db: DisposableDb;
  let runA: string;
  let briefDoc: string;
  let proposalDoc: string;
  let binaryDoc: string;
  let runB: string;
  type M = {
    actions: typeof import("../researchQualityActions");
    view: typeof import("../researchQualityView");
    repo: typeof import("../researchQualityRepository");
    exportDocx: typeof import("../researchQualityExport");
  };
  let m: M;
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
  const settle = async () => {
    while (pendingAfter.length) await pendingAfter.shift();
  };
  const addDoc = async (tenant: string, run: string, name: string, bytes: Buffer, kind = "evidence") => {
    const path = `${tenant}/${run}/${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`;
    objects.set(path, bytes);
    return (await q(`insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1,$2,$3,$4,$5) returning id`, [tenant, run, kind, name, path])).rows[0].id as string;
  };
  const start = async (sources: { documentId: string; roles: string[] }[], extra: Record<string, unknown> = {}) => {
    const r = await m.actions.startResearchQualityReviewAction(runA, {
      requestKey: `k${Math.random().toString(36).slice(2, 12)}`,
      mode: "improve_planned",
      studyType: "quantitative",
      purpose: "Decide whether to launch a loyalty scheme",
      sources,
      decisions: [{ decisionId: null, text: "Launch the loyalty scheme or not" }],
      objectives: [],
      ...extra,
    });
    if (!r.ok) throw new Error(r.error);
    await settle();
    return r.reviewId;
  };
  const viewOf = async (reviewId: string | null) => {
    const r = await m.actions.loadResearchQualityViewAction(runA, reviewId);
    if (!r.ok) throw new Error(r.error);
    return r.view;
  };

  beforeAll(async () => {
    db = await createDisposableDb();
    await q(`insert into tenants (id, name) values ($1, 'A'), ($2, 'B')`, [A, B]);
    runA = (await q(`insert into runs (tenant_id, project_name) values ($1, 'RQ project') returning id`, [A])).rows[0].id;
    runB = (await q(`insert into runs (tenant_id, project_name) values ($1, 'Other org') returning id`, [B])).rows[0].id;
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
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://storage.invalid";
    process.env.SUPABASE_SECRET_KEY ??= "unused";
    briefDoc = await addDoc(A, runA, "brief.txt", Buffer.from("Project brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\nDeliverables are a short report and a deck.\n"));
    proposalDoc = await addDoc(A, runA, "proposal.txt", Buffer.from("Proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n"));
    binaryDoc = await addDoc(A, runA, "scan.txt", Buffer.from([0x25, 0x50, 0x00, 0xff, 0xfe, 0x00]));
    m = {
      actions: await import("../researchQualityActions"),
      view: await import("../researchQualityView"),
      repo: await import("../researchQualityRepository"),
      exportDocx: await import("../researchQualityExport"),
    };
  }, 180000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    const { Client } = await import("pg");
    const c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    await c.query(`drop role if exists ${ROLE}`).catch(() => {});
    await c.end();
  });
  beforeEach(() => {
    current = { tenantId: A, userId: "20000000-0000-4000-8000-0000000000a7", email: "researcher-a@example.test" };
    model.failTask = null;
    model.malformed = null;
    model.hold = null;
    model.stringifyLists = false;
    model.cutOff = null;
    model.checklist = "normal";
  });

  it("guard: without migration 0105 every action refuses with a setup message before any write or model call", async () => {
    await q(`alter table research_quality_researcher_entries rename to rq_entries_hidden`);
    try {
      model.calls = [];
      const v = await m.actions.loadResearchQualityViewAction(runA, null);
      expect(v).toMatchObject({ ok: false, setup: true });
      const s = await m.actions.startResearchQualityReviewAction(runA, { requestKey: "guardguard1", mode: "improve_planned", studyType: "unclear", purpose: "", sources: [{ documentId: briefDoc, roles: ["brief"] }], decisions: [], objectives: [] });
      expect(s).toMatchObject({ ok: false });
      expect(model.calls).toEqual([]);
      expect((await q(`select count(*)::int n from research_quality_sources`)).rows[0].n).toBe(0);
    } finally {
      await q(`alter table rq_entries_hidden rename to research_quality_researcher_entries`);
    }
  });

  it("RQ01: opening the module makes no model call; a brief alone gives a scoped review where later documents are 'not yet available'", async () => {
    model.calls = [];
    const empty = await viewOf(null);
    expect(empty.review).toBeNull();
    expect(empty.documents.map((d) => d.filename).sort()).toEqual(["brief.txt", "proposal.txt", "scan.txt"]);
    expect(model.calls).toEqual([]);
    const id = await start([{ documentId: briefDoc, roles: ["brief"] }]);
    const v = await viewOf(id);
    expect(v.review!.state).toBe("complete");
    expect(model.calls.filter((c) => c === "record_documented_facts")).toHaveLength(1);
    const sample = v.review!.manifest.criteria.find((c) => c.criterionId === "RQ-SAMPLE-RECRUIT")!;
    expect(sample.status).toBe("excluded");
    expect(sample.reason).toMatch(/no plan or methodology document yet/);
    expect(v.review!.observations.some((o) => o.criterionId === "RQ-SAMPLE-RECRUIT")).toBe(false);
    // Every published quote is verbatim from the pinned snapshot.
    const text = (await q(`select canonical_text from research_quality_source_versions where id = $1`, [v.review!.manifest.sources[0].sourceVersionId])).rows[0].canonical_text as string;
    for (const o of v.review!.observations) for (const s of o.payload.statements) expect(text.slice(s.locator.start, s.locator.end)).toBe(s.exactQuote);
    // Absence with the brief read in full is "complete"; methodology can never be a concern without documentation.
    const absent = v.review!.observations.filter((o) => o.payload.basis === "absence_in_assessed_scope");
    expect(absent.length).toBeGreaterThan(0);
    for (const o of absent) expect(o.payload.assessment.methodology).toBe("cannot_assess");
    expect(v.review!.createdBy).toBe("researcher-a@example.test");
  });

  it("a repeated start with the same request key creates one review", async () => {
    const before = (await q(`select count(*)::int n from research_quality_reviews`)).rows[0].n;
    const body = { requestKey: "samekey12345", mode: "improve_planned", studyType: "unclear", purpose: "", sources: [{ documentId: briefDoc, roles: ["brief"] }], decisions: [], objectives: [] };
    const [r1, r2] = await Promise.all([m.actions.startResearchQualityReviewAction(runA, body), m.actions.startResearchQualityReviewAction(runA, body)]);
    await settle();
    expect(r1.ok && r2.ok && r1.reviewId === r2.reviewId).toBe(true);
    expect((await q(`select count(*)::int n from research_quality_reviews`)).rows[0].n).toBe(before + 1);
  });

  it("RQ04 control: an unreadable document is refused with its reason and nothing is created", async () => {
    const before = (await q(`select count(*)::int n from research_quality_reviews`)).rows[0].n;
    const r = await m.actions.startResearchQualityReviewAction(runA, { requestKey: "binarykey123", mode: "review_documented", studyType: "unclear", purpose: "", sources: [{ documentId: binaryDoc, roles: ["report"] }], decisions: [], objectives: [] });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/not UTF-8 text/);
    expect((await q(`select count(*)::int n from research_quality_reviews`)).rows[0].n).toBe(before);
  });

  it("RQ02 (deterministic part): conflicting populations keep both passages, each with its own source", async () => {
    const id = await start([{ documentId: briefDoc, roles: ["brief"] }, { documentId: proposalDoc, roles: ["proposal"] }]);
    const v = await viewOf(id);
    const align = v.review!.observations.find((o) => o.criterionId === "RQ-ALIGN-CONSISTENCY")!;
    expect(align.payload.assessment.documentation).toBe("conflicting");
    const files = new Set(align.payload.statements.map((s) => v.review!.manifest.sources.find((x) => x.sourceVersionId === s.sourceVersionId)!.filename));
    expect(files).toEqual(new Set(["brief.txt", "proposal.txt"]));
    expect(v.review!.facts.filter((f) => f.topic === "population" || f.topic === "recruitment").length).toBeGreaterThanOrEqual(2);
  });

  it("RQ10/RQ11: decisions are revision-checked, idempotent and attributed; a regenerated judgement awaits review and keeps the earlier wording", async () => {
    const first = await viewOf(null);
    const o = first.review!.observations.find((x) => x.criterionId === "RQ-BRIEF-DECISION")!;
    const accept = await m.actions.recordResearchQualityEntryAction(runA, { kind: "accept", observationId: o.observationId, observationVersionId: o.versionId, body: null, expectedRevision: o.revision, idempotencyKey: "acceptkey001" });
    expect(accept.ok).toBe(true);
    // The same click again records once.
    expect(await m.actions.recordResearchQualityEntryAction(runA, { kind: "accept", observationId: o.observationId, observationVersionId: o.versionId, body: null, expectedRevision: o.revision, idempotencyKey: "acceptkey001" })).toMatchObject({ ok: true });
    // A save naming the old revision is a visible conflict, not an overwrite.
    const stale = await m.actions.recordResearchQualityEntryAction(runA, { kind: "wording", observationId: o.observationId, observationVersionId: o.versionId, body: "Stale wording", expectedRevision: o.revision, idempotencyKey: "stalewording1" });
    expect(stale).toMatchObject({ ok: false, conflict: true });
    const wording = await m.actions.recordResearchQualityEntryAction(runA, { kind: "wording", observationId: o.observationId, observationVersionId: o.versionId, body: "Researcher wording kept", expectedRevision: o.revision + 1, idempotencyKey: "goodwording1" });
    expect(wording.ok).toBe(true);
    const clar = await m.actions.recordResearchQualityEntryAction(runA, { kind: "clarification", observationId: null, observationVersionId: null, body: "Recruitment is through the customer database, all active customers invited.", expectedRevision: null, idempotencyKey: "clarify00001" });
    expect(clar.ok).toBe(true);
    const mid = await viewOf(first.review!.id);
    expect(mid.review!.newClarifications).toBe(1);
    const accepted = mid.review!.observations.find((x) => x.observationId === o.observationId)!;
    expect(accepted).toMatchObject({ status: "accepted", decidedBy: "researcher-a@example.test" });
    expect(accepted.wording?.text).toBe("Researcher wording kept");
    expect((await q(`select count(*)::int n from research_quality_researcher_entries where idempotency_key = 'acceptkey001'`)).rows[0].n).toBe(1);

    // A new review version: same logical observation, new version, awaiting review; the earlier
    // decision and wording are history, and the clarification enters as researcher-supplied.
    const id2 = await start([{ documentId: briefDoc, roles: ["brief"] }, { documentId: proposalDoc, roles: ["proposal"] }]);
    const v2 = await viewOf(id2);
    const again = v2.review!.observations.find((x) => x.observationId === o.observationId)!;
    expect(again.status).toBe("awaiting_review");
    expect(again.wording).toBeNull();
    expect(again.previous).toMatchObject({ status: "accepted", wording: "Researcher wording kept" });
    expect(v2.review!.manifest.clarifications.map((c) => c.text)).toContain("Recruitment is through the customer database, all active customers invited.");
    expect(v2.review!.newClarifications).toBe(0);
    // The earlier review still shows its own decision.
    const old = await viewOf(first.review!.id);
    expect(old.review!.observations.find((x) => x.observationId === o.observationId)!.status).toBe("accepted");
  });

  it("RQ12: replacing a source makes dependent observations 'requires review', and identical-looking text does not inherit acceptance", async () => {
    const before = await viewOf(null);
    const src = before.documents.find((d) => d.id === briefDoc)!.source!;
    const replacement = await addDoc(A, runA, "brief.txt", Buffer.from("Project brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing and lapsed customers about loyalty.\n"));
    expect((await m.actions.replaceResearchQualitySourceAction(runA, src.sourceId, replacement)).ok).toBe(true);
    // Reading the replacement (as a new review does) creates a new version of the same logical source.
    const id = await start([{ documentId: replacement, roles: ["brief"] }]);
    const prev = await viewOf(before.review!.id);
    const briefObs = prev.review!.observations.filter((o) => o.payload.statements.some((s) => prev.review!.manifest.sources.find((x) => x.sourceVersionId === s.sourceVersionId)?.sourceId === src.sourceId));
    expect(briefObs.length).toBeGreaterThan(0);
    for (const o of briefObs) expect(o.freshness).toBe("requires_review");
    expect(prev.review!.sourceFreshness.find((f) => f.sourceId === src.sourceId)!.status).toBe("changed");
    const now = await viewOf(id);
    expect(now.review!.manifest.sources[0].sourceId).toBe(src.sourceId);
    for (const o of now.review!.observations) expect(o.status).toBe("awaiting_review");
    expect((await q(`select count(*)::int n from research_quality_source_versions where source_id = $1`, [src.sourceId])).rows[0].n).toBe(2);
  });

  it("RQ12: a late answer from an expired lease cannot publish over the current attempt", async () => {
    const reviewId = (await q(`select id from research_quality_reviews where run_id = $1 order by sequence desc limit 1`, [runA])).rows[0].id;
    const task = (await q(`insert into research_quality_tasks (tenant_id, run_id, review_id, task_key, stage, max_attempts, result) values ($1,$2,$3,'extract:late:00','extract',2,'{"input":{}}') returning id`, [A, runA, reviewId])).rows[0].id;
    const lease1 = await m.repo.claimTask(A, task, 1);
    expect(lease1).toBeTruthy();
    await q(`update research_quality_tasks set lease_expires_at = now() - interval '1 second' where id = $1`, [task]);
    const lease2 = await m.repo.claimTask(A, task, 60);
    expect(lease2).toBeTruthy();
    expect(await m.repo.publishExtraction(A, task, lease1!, { facts: [{ late: true }], dropped: 0, nothingFound: false }, { input: 1, output: 1, cost: 0 })).toBe(false);
    expect(await m.repo.publishExtraction(A, task, lease2!, { facts: [], dropped: 0, nothingFound: true }, { input: 1, output: 1, cost: 0 })).toBe(true);
    expect((await q(`select result->'facts' as f from research_quality_tasks where id = $1`, [task])).rows[0].f).toEqual([]);
    await q(`delete from research_quality_tasks where id = $1`, [task]);
  });

  it("RQ13: one failed and one malformed assessment give an honest partial review; retry reruns only those, once", async () => {
    model.failTask = "RQ-DESIGN-ALIGN";
    model.malformed = "RQ-BRIEF-DECISION";
    const id = await start([{ documentId: briefDoc, roles: ["brief"] }, { documentId: proposalDoc, roles: ["proposal"] }], { mode: "review_documented" });
    let v = await viewOf(id);
    expect(v.review!.state).toBe("partial");
    const failed = v.review!.coverage.tasks!.filter((t) => t.status === "failed").map((t) => t.key).sort();
    expect(failed).toEqual(["assess:brief", "assess:design"]);
    expect(v.review!.observations.some((o) => o.criterionId === "RQ-BRIEF-DECISION")).toBe(false);
    const versionsBefore = (await q(`select count(*)::int n from research_quality_observation_versions where review_id = $1`, [id])).rows[0].n;
    model.failTask = null;
    model.malformed = null;
    model.calls = [];
    expect((await m.actions.retryResearchQualityReviewAction(runA, id)).ok).toBe(true);
    await settle();
    expect(model.calls).toEqual(["record_quality_observations", "record_quality_observations"]);
    v = await viewOf(id);
    expect(v.review!.state).toBe("complete");
    const versionsAfter = (await q(`select count(*)::int n from research_quality_observation_versions where review_id = $1`, [id])).rows[0].n;
    expect(versionsAfter).toBeGreaterThan(versionsBefore);
    // No observation has two versions in one review.
    expect((await q(`select count(*)::int n from (select observation_id from research_quality_observation_versions where review_id = $1 group by 1 having count(*) > 1) d`, [id])).rows[0].n).toBe(0);
    // Out of attempts: a further retry does nothing.
    model.calls = [];
    await q(`update research_quality_tasks set status = 'failed' where review_id = $1 and task_key = 'assess:brief'`, [id]);
    await m.actions.retryResearchQualityReviewAction(runA, id);
    await settle();
    expect(model.calls).toEqual([]);
  });

  it("export: the DOCX carries scope, separate dimensions, qualifications, researcher wording and the dismissed appendix; no model call", async () => {
    const v = await viewOf(null);
    const o = v.review!.observations[0];
    await m.actions.recordResearchQualityEntryAction(runA, { kind: "dismiss", observationId: o.observationId, observationVersionId: o.versionId, body: null, expectedRevision: o.revision, idempotencyKey: "dismisskey01" });
    model.calls = [];
    const view = await m.view.loadResearchQualityView(A, runA, null);
    const { buffer } = await m.exportDocx.buildResearchQualityDocx(view, "RQ project");
    expect(model.calls).toEqual([]);
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    const text = xml.replace(/<[^>]+>/g, " ");
    expect(text).toMatch(/Documentation: /);
    expect(text).toMatch(/Methodology: /);
    expect(text).toMatch(/Decision fitness/);
    expect(text).toMatch(/Appendix: dismissed observations/);
    expect(text).toMatch(new RegExp(`${o.criterionId} dismissed by researcher-a@example.test`));
    expect(text).toMatch(/not a certification/);
  });

  it("RQ14: another organisation cannot read, export, start, decide or purge; nothing is disclosed or changed", async () => {
    const v = await viewOf(null);
    const o = v.review!.observations[1];
    const src = v.documents.find((d) => d.source)!.source!;
    current = { tenantId: B, userId: "20000000-0000-4000-8000-0000000000b7", email: "b@example.test" };
    model.calls = [];
    expect(await m.actions.loadResearchQualityViewAction(runA, null)).toMatchObject({ ok: false });
    expect(await m.actions.loadResearchQualityViewAction(runA, v.review!.id)).toMatchObject({ ok: false });
    expect(await m.actions.startResearchQualityReviewAction(runA, { requestKey: "crosstenant1", mode: "improve_planned", studyType: "unclear", purpose: "", sources: [{ documentId: briefDoc, roles: ["brief"] }], decisions: [], objectives: [] })).toMatchObject({ ok: false });
    expect(await m.actions.recordResearchQualityEntryAction(runA, { kind: "accept", observationId: o.observationId, observationVersionId: o.versionId, body: null, expectedRevision: o.revision, idempotencyKey: "crosstenant2" })).toMatchObject({ ok: false });
    // Even naming its own run, B cannot reach A's observation or source.
    expect(await m.actions.recordResearchQualityEntryAction(runB, { kind: "comment", observationId: o.observationId, observationVersionId: null, body: "x", expectedRevision: null, idempotencyKey: "crosstenant3" })).toMatchObject({ ok: false });
    expect(await m.actions.purgeResearchQualitySourceAction(runA, src.sourceId)).toMatchObject({ ok: false });
    expect(await m.actions.retryResearchQualityReviewAction(runA, v.review!.id)).toMatchObject({ ok: false });
    expect(model.calls).toEqual([]);
    expect((await q(`select count(*)::int n from research_quality_researcher_entries where tenant_id = $1`, [B])).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from research_quality_source_versions where source_id = $1 and purged_at is not null`, [src.sourceId])).rows[0].n).toBe(0);
    current = { tenantId: A, userId: "20000000-0000-4000-8000-0000000000a7", email: "researcher-a@example.test" };
    expect((await m.actions.loadResearchQualityViewAction(runA, null)).ok).toBe(true);
  });

  it("purge: the retained text and every copied quote from that source are removed; history stays, labelled", async () => {
    const v = await viewOf(null);
    const src = v.documents.find((d) => d.id === proposalDoc)!.source!;
    const r = await m.actions.purgeResearchQualitySourceAction(runA, src.sourceId);
    expect(r).toMatchObject({ ok: true });
    expect((await q(`select count(*)::int n from research_quality_source_versions where source_id = $1 and canonical_text <> ''`, [src.sourceId])).rows[0].n).toBe(0);
    const leaks = await q(`select count(*)::int n from research_quality_observation_versions where run_id = $1 and payload::text like '%opt-in online panel%'`, [runA]);
    expect(leaks.rows[0].n).toBe(0);
    const taskLeaks = await q(`select count(*)::int n from research_quality_tasks where run_id = $1 and result::text like '%opt-in online panel%'`, [runA]);
    expect(taskLeaks.rows[0].n).toBe(0);
    const after = await viewOf(null);
    expect(after.review!.sourceFreshness.find((f) => f.sourceId === src.sourceId)?.status ?? "purged").toBe("purged");
  });

  // Codex 2026-10-18 (d45c0a2) reproduced three lifecycle defects with actual repository calls: an
  // expired lease nobody had replaced still published; a purge that landed while an extraction was
  // in flight was undone by the late result; and an interrupted (expired, still running) task was
  // invisible to explicit retry. These cases run the same repository and runner functions.
  describe("task lifecycle: expiry, purge ordering, interrupted retry", () => {
    const usage = { input: 10, output: 5, cost: 0.25 };
    let runner: typeof import("../researchQualityReview");
    const freshReview = async (label: string) => {
      const doc = await addDoc(A, runA, `${label}.txt`, Buffer.from(`Lifecycle ${label}.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\n`));
      const reviewId = await start([{ documentId: doc, roles: ["brief"] }]);
      const src = (await q(`select id, current_version_id from research_quality_sources where run_id = $1 and document_id = $2`, [runA, doc])).rows[0];
      return { reviewId, sourceId: src.id as string, versionId: src.current_version_id as string };
    };
    const syntheticExtract = async (reviewId: string, key: string, input: unknown = {}) =>
      (await q(`insert into research_quality_tasks (tenant_id, run_id, review_id, task_key, stage, max_attempts, result) values ($1,$2,$3,$4,'extract',2,$5) returning id`, [A, runA, reviewId, key, JSON.stringify({ input })])).rows[0].id as string;
    const expire = (taskId: string) => q(`update research_quality_tasks set lease_expires_at = now() - interval '1 second' where id = $1`, [taskId]);
    const task = async (taskId: string) => (await q(`select status, attempts, max_attempts, error, result::text as result, cost_usd::float as cost, lease_token from research_quality_tasks where id = $1`, [taskId])).rows[0];
    const reviewCost = async (reviewId: string) => (await q(`select actual_cost_usd::float as c from research_quality_reviews where id = $1`, [reviewId])).rows[0].c as number;
    /** Takes an assessment task's published observations back off it and returns it to pending, as if it had never run. */
    const reopenAssessment = async (reviewId: string) => {
      const taskId = (await q(`select id from research_quality_tasks where review_id = $1 and stage = 'assess' order by task_key limit 1`, [reviewId])).rows[0].id as string;
      const saved = (await q(`select ov.payload, o.logical_key, o.anchor from research_quality_observation_versions ov join research_quality_observations o on o.id = ov.observation_id where ov.task_id = $1`, [taskId])).rows;
      expect(saved.length).toBeGreaterThan(0);
      await q(`delete from research_quality_observation_versions where task_id = $1`, [taskId]);
      await q(`update research_quality_tasks set status = 'pending', attempts = 0, lease_token = null, lease_expires_at = null where id = $1`, [taskId]);
      return { taskId, observations: saved.map((r) => ({ logicalKey: r.logical_key as string, anchor: r.anchor, payload: r.payload })) };
    };
    const versionsOf = async (taskId: string) => (await q(`select count(*)::int n from research_quality_observation_versions where task_id = $1`, [taskId])).rows[0].n as number;

    beforeAll(async () => {
      runner = await import("../researchQualityReview");
    });

    it("an expired lease nobody replaced cannot publish an extraction, an assessment or a failure; usage is still counted; the current lease publishes", async () => {
      const r = await freshReview("expiry");
      const costBefore = await reviewCost(r.reviewId);
      // Extraction, Codex's reproduction: claimed, lease run out, no other claimant.
      const ex = await syntheticExtract(r.reviewId, "extract:expired:00");
      const lease = await m.repo.claimTask(A, ex, 60);
      await expire(ex);
      expect(await m.repo.publishExtraction(A, ex, lease!, { facts: [], dropped: 0, nothingFound: true }, usage)).toBe(false);
      expect(await m.repo.failTask(A, ex, lease!, "late failure", usage)).toBe(false);
      let row = await task(ex);
      expect(row.status).toBe("running");
      expect(row.error).toBeNull();
      expect(row.cost).toBeCloseTo(0.5, 4); // both late calls were paid for
      // The same task, claimed again, publishes normally.
      const fresh = await m.repo.claimTask(A, ex, 60);
      expect(fresh).toBeTruthy();
      expect(await m.repo.publishExtraction(A, ex, fresh!, { facts: [], dropped: 0, nothingFound: true }, usage)).toBe(true);
      row = await task(ex);
      expect(row.status).toBe("succeeded");
      // Assessment: the same rule.
      const as = await reopenAssessment(r.reviewId);
      const aLease = await m.repo.claimTask(A, as.taskId, 60);
      await expire(as.taskId);
      expect(await m.repo.publishAssessment(A, runA, r.reviewId, as.taskId, aLease!, as.observations as never, {}, usage)).toBe(false);
      expect(await versionsOf(as.taskId)).toBe(0);
      expect((await task(as.taskId)).status).toBe("running");
      const aFresh = await m.repo.claimTask(A, as.taskId, 60);
      expect(await m.repo.publishAssessment(A, runA, r.reviewId, as.taskId, aFresh!, as.observations as never, {}, usage)).toBe(true);
      expect(await versionsOf(as.taskId)).toBe(as.observations.length);
      expect(await reviewCost(r.reviewId)).toBeCloseTo(costBefore + 5 * 0.25, 4);
      await q(`delete from research_quality_tasks where id = $1`, [ex]);
    });

    // Codex 2026-10-18 (35af43a): the lease was checked against now(), which PostgreSQL freezes at the
    // start of the transaction, so a publication that waited on a source lock past its lease expiry
    // still published. Each stage is held on its source lock until its lease has run out (checked
    // from another session before the lock is released), then must refuse; the control waits the
    // same way with a lease that is still live and must publish; the refused task is then reclaimed
    // and published normally.
    it("a publication whose lease runs out while it waits on a source lock is refused; a live one publishes", async () => {
      const waitingOnLock = async () => {
        for (let i = 0; i < 200; i++) {
          if ((await q(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0].n > 0) return;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error("the publication never waited on the source lock");
      };
      const holdSourceDuring = async (versionId: string, publish: () => Promise<boolean>, holdMs: number) => {
        const holder = await db.pool.connect();
        try {
          await holder.query("begin");
          await holder.query(`select 1 from research_quality_source_versions where id = $1 for update`, [versionId]);
          const pending = publish();
          await waitingOnLock();
          await new Promise((r) => setTimeout(r, holdMs));
          const before = Date.now();
          await holder.query("commit");
          return { published: await pending, releasedAt: before };
        } finally {
          holder.release();
        }
      };
      for (const stage of ["extract", "assess"] as const) {
        // Lease runs out during the wait: refused, nothing published, the task is still claimable.
        const r = await freshReview(`lock-wait-${stage}`);
        const as = stage === "assess" ? await reopenAssessment(r.reviewId) : null;
        const taskId = as ? as.taskId : await syntheticExtract(r.reviewId, `extract:lock-wait:${stage}`, { sourceIndex: 0 });
        const publishWith = (lease: string) =>
          as ? m.repo.publishAssessment(A, runA, r.reviewId, taskId, lease, as.observations as never, {}, usage) : m.repo.publishExtraction(A, taskId, lease, { facts: [], dropped: 0, nothingFound: true }, usage);
        const lease = await m.repo.claimTask(A, taskId, 60);
        await q(`update research_quality_tasks set lease_expires_at = clock_timestamp() + interval '1 second' where id = $1`, [taskId]);
        const late = await holdSourceDuring(r.versionId, () => publishWith(lease!), 1300);
        expect((await q(`select lease_expires_at < clock_timestamp() as expired from research_quality_tasks where id = $1`, [taskId])).rows[0].expired).toBe(true);
        expect(late.published, `${stage}: lease expired while waiting`).toBe(false);
        expect((await task(taskId)).status).toBe("running");
        if (as) expect(await versionsOf(taskId)).toBe(0);
        // Reclaimed after expiry, the same wait with a live lease publishes.
        const again = await m.repo.claimTask(A, taskId, 60);
        expect(again).toBeTruthy();
        const live = await holdSourceDuring(r.versionId, () => publishWith(again!), 300);
        expect(live.published, `${stage}: lease still live after waiting`).toBe(true);
        expect((await task(taskId)).status).toBe("succeeded");
        if (as) expect(await versionsOf(taskId)).toBe(as.observations.length);
        if (!as) await q(`delete from research_quality_tasks where id = $1`, [taskId]);
      }
    }, 30000);

    // Codex 2026-10-18 (37193d6): a lease checked inside the UPDATE was decided before waiting on a
    // task row another session held unchanged, and not re-checked after. Each write now locks the
    // task row first. Extraction, assessment and the failure write each wait on the task row until
    // the lease has run out and must refuse; the same wait with a live lease must record.
    it("a write whose lease runs out while it waits on the task row is refused; a live one records", async () => {
      const waitingOnLock = async () => {
        for (let i = 0; i < 200; i++) {
          if ((await q(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0].n > 0) return;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error("the write never waited on the task row");
      };
      const holdTaskDuring = async (taskId: string, write: () => Promise<boolean>, holdMs: number) => {
        const holder = await db.pool.connect();
        try {
          await holder.query("begin");
          await holder.query(`select 1 from research_quality_tasks where id = $1 for update`, [taskId]);
          const pending = write();
          await waitingOnLock();
          await new Promise((r) => setTimeout(r, holdMs));
          await holder.query("commit");
          return await pending;
        } finally {
          holder.release();
        }
      };
      for (const kind of ["extract", "assess", "fail"] as const) {
        const r = await freshReview(`task-wait-${kind}`);
        const as = kind === "assess" ? await reopenAssessment(r.reviewId) : null;
        const taskId = as ? as.taskId : await syntheticExtract(r.reviewId, `extract:task-wait:${kind}`, { sourceIndex: 0 });
        const writeWith = (lease: string) =>
          kind === "assess"
            ? m.repo.publishAssessment(A, runA, r.reviewId, taskId, lease, as!.observations as never, {}, usage)
            : kind === "extract"
              ? m.repo.publishExtraction(A, taskId, lease, { facts: [], dropped: 0, nothingFound: true }, usage)
              : m.repo.failTask(A, taskId, lease, "late failure", usage);
        const lease = await m.repo.claimTask(A, taskId, 60);
        await q(`update research_quality_tasks set lease_expires_at = clock_timestamp() + interval '1 second' where id = $1`, [taskId]);
        const costBefore = (await task(taskId)).cost;
        expect(await holdTaskDuring(taskId, () => writeWith(lease!), 1300), `${kind}: lease expired while waiting on the task row`).toBe(false);
        const after = await task(taskId);
        expect(after.status).toBe("running");
        expect(after.error).toBeNull();
        expect(after.cost).toBeCloseTo(costBefore + usage.cost, 4); // the refused call is still paid for
        if (as) expect(await versionsOf(taskId)).toBe(0);
        const again = await m.repo.claimTask(A, taskId, 60);
        expect(again).toBeTruthy();
        expect(await holdTaskDuring(taskId, () => writeWith(again!), 300), `${kind}: lease still live after waiting`).toBe(true);
        expect((await task(taskId)).status).toBe(kind === "fail" ? "failed" : "succeeded");
        if (as) expect(await versionsOf(taskId)).toBe(as.observations.length);
        if (!as) await q(`delete from research_quality_tasks where id = $1`, [taskId]);
      }
    }, 30000);

    // Codex 2026-10-18: createReview took the run FOR SHARE and later upgraded to FOR UPDATE, so two
    // concurrent starts each held the share lock and deadlocked (40P01) on the upgrade. Both starts
    // are made to arrive together by holding the run lock until both are waiting.
    it("concurrent starts: the same request key gives one review, different keys separate sequences, no deadlock", async () => {
      const base = (await q(`select * from research_quality_reviews where run_id = $1 order by sequence desc limit 1`, [runA])).rows[0];
      const input = (requestKey: string) => ({
        requestKey, parentReviewId: null, mode: base.mode, studyType: base.study_type, purpose: base.purpose, manifest: base.manifest,
        criteriaRelease: base.criteria_release, criteriaHash: base.criteria_hash, referencesRelease: base.references_release, referencesHash: base.references_hash,
        promptVersion: base.prompt_version, model: base.model, estimatedCostUsd: 0, actor: { userId: current.userId, email: current.email }, tasks: [],
      });
      const together = async (calls: (() => Promise<{ reviewId: string; created: boolean }>)[]) => {
        const holder = await db.pool.connect();
        await holder.query("begin");
        await holder.query(`select 1 from runs where id = $1 for update`, [runA]);
        const settled = Promise.allSettled(calls.map((c) => c()));
        try {
          for (let i = 0; i < 200; i++) {
            if ((await q(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0].n >= calls.length) break;
            await new Promise((r) => setTimeout(r, 20));
          }
        } finally {
          await holder.query("commit");
          holder.release();
        }
        return settled;
      };
      const same = await together([() => m.repo.createReview(A, runA, input("concurrent-same-01")), () => m.repo.createReview(A, runA, input("concurrent-same-01"))]);
      expect(same.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
      const sameIds = same.map((x) => (x as PromiseFulfilledResult<{ reviewId: string; created: boolean }>).value);
      expect(new Set(sameIds.map((v) => v.reviewId)).size).toBe(1);
      expect(sameIds.filter((v) => v.created).length).toBe(1);
      expect((await q(`select count(*)::int n from research_quality_reviews where run_id = $1 and request_key = 'concurrent-same-01'`, [runA])).rows[0].n).toBe(1);
      const distinct = await together([() => m.repo.createReview(A, runA, input("concurrent-diff-01")), () => m.repo.createReview(A, runA, input("concurrent-diff-02"))]);
      expect(distinct.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
      const seqs = (await q(`select sequence from research_quality_reviews where run_id = $1 and request_key in ('concurrent-diff-01', 'concurrent-diff-02') order by sequence`, [runA])).rows.map((x) => x.sequence);
      expect(seqs.length).toBe(2);
      expect(seqs[1]).toBe(seqs[0] + 1);
      // A sequential repeat returns the existing review; another organisation is refused and creates nothing.
      expect(await m.repo.createReview(A, runA, input("concurrent-same-01"))).toEqual({ reviewId: sameIds[0].reviewId, created: false });
      await expect(m.repo.createReview(B, runA, input("concurrent-cross-01"))).rejects.toThrow(/Unknown project/);
      expect((await q(`select count(*)::int n from research_quality_reviews where request_key = 'concurrent-cross-01'`)).rows[0].n).toBe(0);
    }, 20000);

    it("a purge that lands while work is in flight discards the late result for good; other sources keep their text", async () => {
      const keep = await freshReview("unrelated");
      const r = await freshReview("purge-race");
      // Extraction in flight when the purge lands (Codex's sequence: claim, purge, publish).
      const ex = await syntheticExtract(r.reviewId, "extract:purge:00", { sourceIndex: 0, range: { start: 0, end: 10 } });
      const lease = await m.repo.claimTask(A, ex, 60);
      await m.repo.purgeSourceText(A, runA, r.sourceId);
      const fact = { sourceVersionId: r.versionId, sourceId: r.sourceId, exactQuote: "Lifecycle purge-race.", statement: "Lifecycle purge-race." };
      expect(await m.repo.publishExtraction(A, ex, lease!, { facts: [fact], dropped: 0, nothingFound: false }, usage)).toBe(false);
      const row = await task(ex);
      expect(row.result).not.toContain("Lifecycle purge-race");
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(row.max_attempts); // a retry cannot bring it back
      expect(row.error).toMatch(/purged/);
      // Assessment in flight when the purge has landed: nothing is published.
      const as = await reopenAssessment(r.reviewId);
      const aLease = await m.repo.claimTask(A, as.taskId, 60);
      expect(await m.repo.publishAssessment(A, runA, r.reviewId, as.taskId, aLease!, as.observations as never, {}, usage)).toBe(false);
      expect(await versionsOf(as.taskId)).toBe(0);
      expect((await task(as.taskId)).status).toBe("failed");
      // Retry refuses visibly instead of reviving either.
      model.calls = [];
      const retry = await runner.retryFailedTasks(A, runA, r.reviewId);
      expect(retry.retried).toBe(0);
      expect(retry.note).toMatch(/new review version/);
      expect(model.calls).toEqual([]);
      for (const where of [`research_quality_tasks where run_id = $1 and result::text like '%Lifecycle purge-race%'`, `research_quality_observation_versions where run_id = $1 and payload::text like '%Lifecycle purge-race%'`]) {
        expect((await q(`select count(*)::int n from ${where}`, [runA])).rows[0].n).toBe(0);
      }
      const exported = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, r.reviewId), "RQ project");
      expect((await (await JSZip.loadAsync(exported.buffer)).file("word/document.xml")!.async("string"))).not.toContain("Lifecycle purge-race");
      // The unrelated source keeps its text, and its review is untouched.
      expect((await q(`select canonical_text from research_quality_source_versions where id = $1`, [keep.versionId])).rows[0].canonical_text).toContain("Lifecycle unrelated");
      expect((await viewOf(keep.reviewId)).review!.state).toBe("complete");
      await q(`delete from research_quality_tasks where id = $1`, [ex]);
    });

    it("publication and purge overlapping in either order never leave purged text behind", async () => {
      const doc = await addDoc(A, runA, "race.txt", Buffer.from("Race source.\n"));
      const { sourceId } = await m.repo.saveSourceRoles(A, runA, doc, ["brief"], null);
      const { reviewId } = await freshReview("race-host");
      const newVersion = async (i: number, quote: string) =>
        (
          await q(
            `insert into research_quality_source_versions (tenant_id, run_id, source_id, ordinal, original_document_id, filename, content_sha256, canonical_sha256, extractor, extractor_version, canonical_text, segments, char_count)
             values ($1,$2,$3,$4,$5,'race.txt',$6,$6,'plain_text','rq-reader@1',$7,'[]',$8) returning id`,
            [A, runA, sourceId, i, doc, `sha-race-${i}`, quote, quote.length],
          )
        ).rows[0].id as string;
      const waitingOnLocks = async (n: number) => {
        for (let i = 0; i < 200; i++) {
          const w = (await q(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0].n;
          if (w >= n) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`expected ${n} sessions waiting on locks`);
      };

      // Order 1, publication inside its transaction first: it has locked the source version and is
      // held (by a third session holding the task row) just before writing; the purge then queues
      // behind it. When both finish, the purge has blanked what was published.
      const quote1 = "Concurrent secret one.";
      const v1 = await newVersion(1, quote1);
      const ex1 = await syntheticExtract(reviewId, "extract:race:1");
      const lease1 = await m.repo.claimTask(A, ex1, 60);
      const holder = await db.pool.connect();
      await holder.query("begin");
      await holder.query(`select 1 from research_quality_tasks where id = $1 for update`, [ex1]);
      const publishing = m.repo.publishExtraction(A, ex1, lease1!, { facts: [{ sourceVersionId: v1, sourceId, exactQuote: quote1, statement: quote1 }], dropped: 0, nothingFound: false }, usage);
      await waitingOnLocks(1); // publication waits on the task row, holding its share lock on v1
      const purging = m.repo.purgeSourceText(A, runA, sourceId);
      await waitingOnLocks(2); // the purge waits on the publication's share lock
      await holder.query("commit");
      holder.release();
      expect(await publishing).toBe(true);
      await purging;
      expect((await task(ex1)).result).not.toContain(quote1);

      // Order 2, purge first: the publication then refuses.
      const quote2 = "Concurrent secret two.";
      const v2 = await newVersion(2, quote2);
      const ex2 = await syntheticExtract(reviewId, "extract:race:2");
      const lease2 = await m.repo.claimTask(A, ex2, 60);
      await m.repo.purgeSourceText(A, runA, sourceId);
      expect(await m.repo.publishExtraction(A, ex2, lease2!, { facts: [{ sourceVersionId: v2, sourceId, exactQuote: quote2, statement: quote2 }], dropped: 0, nothingFound: false }, usage)).toBe(false);
      expect((await task(ex2)).result).not.toContain(quote2);
      expect((await q(`select count(*)::int n from research_quality_source_versions where source_id = $1 and canonical_text <> ''`, [sourceId])).rows[0].n).toBe(0);
      await q(`delete from research_quality_tasks where id = any($1::uuid[])`, [[ex1, ex2]]);
    });

    it("explicit retry recovers interrupted work within its bounds, never steals a live lease, and repeats harmlessly", async () => {
      const r = await freshReview("interrupted");
      // A live lease is left to its attempt.
      const live = await reopenAssessment(r.reviewId);
      const liveLease = await m.repo.claimTask(A, live.taskId, 3600);
      model.calls = [];
      expect(await runner.retryFailedTasks(A, runA, r.reviewId)).toEqual({ retried: 0, note: null });
      expect((await task(live.taskId)).lease_token).toBe(liveLease);
      expect(model.calls).toEqual([]);
      // The worker died: the lease runs out with the task still marked running. Retry reruns it once.
      await expire(live.taskId);
      expect((await runner.retryFailedTasks(A, runA, r.reviewId)).retried).toBe(1);
      expect(model.calls).toEqual(["record_quality_observations"]);
      expect((await task(live.taskId)).status).toBe("succeeded");
      expect(await versionsOf(live.taskId)).toBe(live.observations.length);
      expect((await viewOf(r.reviewId)).review!.state).toBe("complete");
      // Repeating the retry does nothing.
      model.calls = [];
      expect(await runner.retryFailedTasks(A, runA, r.reviewId)).toEqual({ retried: 0, note: null });
      expect(model.calls).toEqual([]);
      // Out of attempts: explained, not stranded silently, and the review is not left "running".
      await q(`update research_quality_tasks set status = 'running', attempts = max_attempts, lease_expires_at = now() - interval '1 second' where id = $1`, [live.taskId]);
      const exhausted = await runner.retryFailedTasks(A, runA, r.reviewId);
      expect(exhausted.retried).toBe(0);
      expect(exhausted.note).toMatch(/used all of their attempts/);
      expect(model.calls).toEqual([]);
      expect((await q(`select state from research_quality_reviews where id = $1`, [r.reviewId])).rows[0].state).not.toBe("running");
      // An interrupted extraction after assessments published: the safe new-review explanation.
      const ex = (await q(`select id from research_quality_tasks where review_id = $1 and stage = 'extract' order by task_key limit 1`, [r.reviewId])).rows[0].id;
      await q(`update research_quality_tasks set status = 'running', attempts = 1, lease_expires_at = now() - interval '1 second' where id = $1`, [ex]);
      const afterPublish = await runner.retryFailedTasks(A, runA, r.reviewId);
      expect(afterPublish.retried).toBe(0);
      expect(afterPublish.note).toMatch(/Start a new review version to include it/);
      expect(model.calls).toEqual([]);
    });

    it("an interrupted extraction before any assessment published is resumed and the review completes", async () => {
      const r = await freshReview("resume");
      const extracts = (await q(`select id from research_quality_tasks where review_id = $1 and stage = 'extract'`, [r.reviewId])).rows.map((x) => x.id);
      const assesses = (await q(`select id from research_quality_tasks where review_id = $1 and stage in ('assess', 'checklist')`, [r.reviewId])).rows.map((x) => x.id);
      await q(`delete from research_quality_observation_versions where review_id = $1`, [r.reviewId]);
      await q(`update research_quality_tasks set status = 'pending', attempts = 0, lease_token = null, lease_expires_at = null where id = any($1::uuid[])`, [assesses]);
      await q(`update research_quality_tasks set status = 'running', attempts = 1, result = result - 'facts', lease_expires_at = now() - interval '1 second' where id = any($1::uuid[])`, [extracts]);
      model.calls = [];
      const retry = await runner.retryFailedTasks(A, runA, r.reviewId);
      expect(retry).toEqual({ retried: extracts.length, note: null });
      expect(model.calls.filter((c) => c === "record_documented_facts").length).toBe(extracts.length);
      const checklists = (await q(`select count(*)::int n from research_quality_tasks where review_id = $1 and stage = 'checklist'`, [r.reviewId])).rows[0].n;
      expect(model.calls.filter((c) => c === "record_quality_observations").length).toBe(assesses.length - checklists);
      expect(model.calls.filter((c) => c === "record_checklist_statuses").length).toBe(checklists);
      const v = await viewOf(r.reviewId);
      expect(v.review!.state).toBe("complete");
      expect(v.review!.observations.length).toBeGreaterThan(0);
    });
  });

  // Grant's first live review, 2026-10-18: "extraction answer is not in the required shape" on every
  // passage, and a review that stayed "running" long after. These cases reproduce both with the
  // actual actions, runner, repository and view.
  describe("live-model answers and stalled runs", () => {
    const freshDoc = async (label: string) =>
      addDoc(A, runA, `${label}.txt`, Buffer.from(`Live ${label}.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\n`));

    it("lists returned as JSON text, without the nothing-found flag, are read and the review completes", async () => {
      model.stringifyLists = true;
      const id = await start([{ documentId: await freshDoc("stringified"), roles: ["brief"] }]);
      const v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      expect(v.review!.facts.length).toBeGreaterThan(0);
      expect(v.review!.observations.length).toBeGreaterThan(0);
    });

    it("an answer cut off at the length limit is refused with that reason, and a retry completes the review", async () => {
      model.cutOff = "extract";
      const id = await start([{ documentId: await freshDoc("cutoff"), roles: ["brief"] }]);
      let v = await viewOf(id);
      expect(v.review!.state).toBe("failed");
      const failed = v.review!.coverage.tasks!.filter((t) => t.status === "failed");
      expect(failed.length).toBeGreaterThan(0);
      for (const t of failed) expect(t.error).toMatch(/cut off at the \d+-token limit/);
      model.cutOff = null;
      expect((await m.actions.retryResearchQualityReviewAction(runA, id)).ok).toBe(true);
      await settle();
      v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      // Same check for the assessment stage.
      model.cutOff = "assess";
      const id2 = await start([{ documentId: await freshDoc("cutoff-assess"), roles: ["brief"] }]);
      const v2 = await viewOf(id2);
      expect(v2.review!.coverage.tasks!.filter((t) => t.stage === "assess" && t.status === "failed").every((t) => /cut off/.test(t.error ?? ""))).toBe(true);
    });

    it("a shape the model cannot be read from names what arrived, never the content", async () => {
      const { validateExtraction } = await import("../researchQualityRules");
      const ctx = { text: "abc", range: { start: 0, end: 3 }, segments: [], sourceId: "s", sourceVersionId: "v" };
      expect(() => validateExtraction({ facts: "not json" }, ctx)).toThrow("extraction answer is not in the required shape (facts: string, nothing_found: missing)");
      expect(() => validateExtraction({}, ctx)).toThrow("(facts: missing, nothing_found: missing)");
      expect(() => validateExtraction(null, ctx)).toThrow("(received nothing)");
      expect(() => validateExtraction({ facts: [] }, ctx)).toThrow(/required shape/); // an empty list still needs the explicit flag
    });

    it("a run that stopped part-way shows as interrupted, not running, and Continue finishes it once", async () => {
      const id = await start([{ documentId: await freshDoc("interrupted"), roles: ["brief"] }]);
      // Make it look exactly like a server restart mid-run: review running, one step mid-attempt
      // with its lease run out, the rest never started, nothing touched for minutes.
      await q(`delete from research_quality_observation_versions where review_id = $1`, [id]);
      await q(`update research_quality_tasks set status = 'pending', attempts = 0, lease_token = null, lease_expires_at = null, result = result - 'facts', updated_at = now() - interval '10 minutes' where review_id = $1`, [id]);
      const one = (await q(`select id from research_quality_tasks where review_id = $1 and stage = 'extract' order by task_key limit 1`, [id])).rows[0].id;
      await q(`update research_quality_tasks set status = 'running', attempts = 1, lease_expires_at = now() - interval '5 minutes' where id = $1`, [one]);
      await q(`update research_quality_reviews set state = 'running', completed_at = null where id = $1`, [id]);
      let v = await viewOf(id);
      expect(v.review!.state).toBe("running");
      expect(v.review!.progress).toMatchObject({ done: 0, working: 0, interrupted: true });
      // A step with a live lease is work in progress, not an interruption.
      await q(`update research_quality_tasks set lease_expires_at = now() + interval '5 minutes' where id = $1`, [one]);
      expect((await viewOf(id)).review!.progress).toMatchObject({ working: 1, interrupted: false });
      await q(`update research_quality_tasks set lease_expires_at = now() - interval '5 minutes' where id = $1`, [one]);
      model.calls = [];
      expect((await m.actions.retryResearchQualityReviewAction(runA, id)).ok).toBe(true);
      await settle();
      v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      expect(v.review!.progress).toMatchObject({ interrupted: false, failed: 0 });
      expect(v.review!.progress.done).toBe(v.review!.progress.total);
      const extracts = (await q(`select count(*)::int n from research_quality_tasks where review_id = $1 and stage = 'extract'`, [id])).rows[0].n;
      expect(model.calls.filter((c) => c === "record_documented_facts").length).toBe(extracts); // each step once
      // Continuing a finished review does nothing.
      model.calls = [];
      await m.actions.retryResearchQualityReviewAction(runA, id);
      await settle();
      expect(model.calls).toEqual([]);
    });

    it("an unexpected failure outside a single step does not leave the review marked running", async () => {
      const id = await start([{ documentId: await freshDoc("crash"), roles: ["brief"] }]);
      // Remove the run limits from the stored manifest so the runner fails between steps, outside
      // the per-step error handling, as an unexpected database or code error would.
      await q(`update research_quality_tasks set status = 'pending', attempts = 0 where review_id = $1 and stage = 'extract'`, [id]);
      await q(`update research_quality_reviews set state = 'running', manifest = manifest - 'limits' where id = $1`, [id]);
      const runner = await import("../researchQualityReview");
      await expect(runner.runReview(A, runA, id)).rejects.toThrow();
      const v = await viewOf(id);
      expect(["failed", "partial"]).toContain(v.review!.state);
      expect(v.review!.progress.interrupted).toBe(false);
    });
  });

  // The scored checklist (RQK-1), Grant 2026-10-18: each document scored against the elements its
  // type should contain, model finds and code scores. Actual actions, runner, view and DOCX.
  describe("scored checklist", () => {
    const doc = (label: string, text: string) => addDoc(A, runA, `${label}.txt`, Buffer.from(text));
    const briefText = "Checklist brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\n";
    const proposalText = "Checklist proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n";

    it("scores each document against its own checklist; every number follows from the statuses shown", async () => {
      const id = await start([{ documentId: await doc("ck-brief", briefText), roles: ["brief"] }, { documentId: await doc("ck-proposal", proposalText), roles: ["proposal"] }]);
      const v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      expect(v.review!.checklists.map((c) => [c.checklistId, c.state])).toEqual([["brief", "scored"], ["proposal", "scored"]]);
      for (const c of v.review!.checklists) {
        const statuses = c.sections.flatMap((s) => s.elements.map((e) => e.status));
        expect(statuses.every((x) => x !== null)).toBe(true);
        // Independent recount from what the screen shows.
        const assessed = statuses.filter((x) => x !== "not_assessed");
        const points = assessed.reduce((n, x) => n + (x === "present" ? 2 : x === "partial" ? 1 : 0), 0);
        expect(c.score!.assessed).toBe(assessed.length);
        expect(c.score!.pct).toBe(Math.round((points / (assessed.length * 2)) * 100));
        // Presence is always backed by a quote from the document.
        for (const s of c.sections) for (const e of s.elements) if (e.status === "present" || e.status === "partial") expect(e.quotes.length, e.elementId).toBeGreaterThan(0);
      }
      const b = v.review!.checklists[0];
      const el = (id: string) => b.sections.flatMap((s) => s.elements).find((e) => e.elementId === id)!;
      expect(el("BR-DECISION")).toMatchObject({ status: "present" });
      expect(el("BR-DECISION").quotes[0].quote).toMatch(/The decision is whether/);
      expect(el("BR-BUDGET").status).toBe("absent");
      expect(b.gaps.find((g) => g.elementId === "BR-BUDGET")).toMatchObject({ essential: true, status: "absent" });
      expect(b.gaps.findIndex((g) => !g.essential)).toBeGreaterThan(b.gaps.findLastIndex((g) => g.essential)); // essential first
      // The proposal's sampling element was found in the proposal's own text, not the brief's.
      const pe = v.review!.checklists[1].sections.flatMap((s) => s.elements).find((e) => e.elementId === "PR-SAMPLING")!;
      expect(pe.status).toBe("present");
      expect(pe.quotes.every((q) => !q.fromBrief)).toBe(true);
      // The Word export carries the same grid and the gap recommendations.
      const { buffer } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      const text = (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
      expect(text).toMatch(/Scored checklist/);
      expect(text).toContain(`ck-brief.txt: Research brief, ${b.score!.pct}%`);
      expect(text).toMatch(/Missing or partial elements/);
      expect(text).toMatch(/Budget indication \(absent, essential\)/);
    });

    it("presence claimed without quotes is not scored, so it cannot inflate the score", async () => {
      model.checklist = "overclaim";
      const id = await start([{ documentId: await doc("ck-overclaim", briefText), roles: ["brief"] }]);
      const c = (await viewOf(id)).review!.checklists[0];
      expect(c.state).toBe("scored");
      expect(c.score).toMatchObject({ assessed: 0, pct: null, band: null });
      expect(c.sections[0].elements[0].notAssessedBecause).toMatch(/no quoted fact/);
      expect(c.gaps).toEqual([]);
    });

    it("a failed checklist step shows no score (not zero), leaves the review partial, and retry scores it", async () => {
      model.checklist = "fail";
      const id = await start([{ documentId: await doc("ck-fail", briefText), roles: ["brief"] }]);
      let v = await viewOf(id);
      expect(v.review!.state).toBe("partial");
      expect(v.review!.checklists[0]).toMatchObject({ state: "failed", score: null, gaps: [] });
      expect(v.review!.checklists[0].error).toMatch(/synthetic checklist outage/);
      model.checklist = "normal";
      expect((await m.actions.retryResearchQualityReviewAction(runA, id)).ok).toBe(true);
      await settle();
      v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      expect(v.review!.checklists[0].state).toBe("scored");
    });

    it("without migration 0106 a review runs as before and says which migration adds the checklist", async () => {
      await q(`alter table research_quality_tasks drop constraint research_quality_tasks_stage_check`);
      // NOT VALID: earlier tests' checklist rows stay; only new rows are held to the old rule.
      await q(`alter table research_quality_tasks add constraint research_quality_tasks_stage_check check (stage in ('extract', 'assess')) not valid`);
      try {
        const id = await start([{ documentId: await doc("ck-nomigration", briefText), roles: ["brief"] }]);
        const v = await viewOf(id);
        expect(v.review!.state).toBe("complete");
        expect(v.review!.checklists).toEqual([]);
        expect(v.review!.checklistNote).toMatch(/migration 0106/);
      } finally {
        await q(`alter table research_quality_tasks drop constraint research_quality_tasks_stage_check`);
        await q(`alter table research_quality_tasks add constraint research_quality_tasks_stage_check check (stage in ('extract', 'assess', 'checklist'))`);
      }
    });

    it("a document whose role has no checklist is reviewed without one, and the screen says why", async () => {
      const id = await start([{ documentId: await doc("ck-guide", briefText), roles: ["discussion_guide"] }], { mode: "review_documented", studyType: "qualitative" });
      const v = await viewOf(id);
      expect(v.review!.checklists).toEqual([]);
      expect(v.review!.checklistNote).toMatch(/None of the selected documents has a role with a checklist/);
    });
  });

  it("deleting the project document keeps the review history, shows the source as removed and never as current", async () => {
    const reviews = (await viewOf(null)).reviews;
    await q(`delete from documents where run_id = $1`, [runA]);
    for (const r of reviews) {
      const v = await viewOf(r.id);
      for (const f of v.review!.sourceFreshness) expect(f.status).not.toBe("current");
    }
    expect((await q(`select count(*)::int n from research_quality_reviews where run_id = $1`, [runA])).rows[0].n).toBe(reviews.length);
  });
});
