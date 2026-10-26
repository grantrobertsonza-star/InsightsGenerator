// Research Quality Review v1 on a REAL PostgreSQL (disposable, all migrations) as a NON-OWNER role
// without BYPASSRLS, through the ACTUAL server actions, repository, orchestration, view and DOCX
// builder. Mocked boundaries only: the model client (a deterministic stand-in that quotes the
// document it is given), object storage (in memory), the signed-in request context, and
// next/server after() (run inline so the test can await it). The cases are the deterministic
// parts of the brief's finite suite (section 10): RQ01, RQ04, RQ10 to RQ14, the missing-migration
// guard and purge. The semantic "M" cases need the real model and are in the Windows kit.
import { afterAll, beforeAll, describe, expect, it as vitestIt, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import JSZip from "jszip";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { criteriaForKind } from "../researchQualityRules";

const A = "00000000-0000-4000-8000-0000000000a7";
const B = "00000000-0000-4000-8000-0000000000b7";
const ROLE = "ie_test_rq_app";
type Signed = { tenantId: string; userId: string; email: string };
const signedInA = (): Signed => ({ tenantId: A, userId: "20000000-0000-4000-8000-0000000000a7", email: "researcher-a@example.test" });
const objects = new Map<string, Buffer>();
const freshModel = () => ({ calls: [] as string[], cached: [] as string[], failTask: null as null | string, malformed: null as null | string, hold: null as null | { task: string; release: Promise<void> }, stringifyLists: false, cutOff: null as null | "extract" | "assess", checklist: "normal" as "normal" | "overclaim" | "fail", extract: "normal" as "normal" | "invent" | "badEnum" | "mixed", extractOnly: null as null | string, compare: null as null | "both" | "briefOnly" | "proposalOnly" | "briefOnlyAbsent" });
type ModelState = ReturnType<typeof freshModel>;
/**
 * Codex V-B19-01 (2026-10-24): the signed-in tenant, the model stand-in's switches and the queue of
 * after() work were module-wide, so a case that ran past its timeout could still set tenant B (or a
 * model switch) under the next case. Each case now runs in its own async context with its own copy
 * (`it` below); a late continuation of an earlier case keeps writing to that case's copy only. Code
 * outside any case (beforeAll fixtures) uses the shared copy.
 */
type CaseState = { current: Signed; model: ModelState; pendingAfter: Promise<unknown>[] };
const sharedState: CaseState = { current: signedInA(), model: freshModel(), pendingAfter: [] };
const caseState = new AsyncLocalStorage<CaseState>();
const state = () => caseState.getStore() ?? sharedState;
const signedIn = () => state().current;
const signInAs = (who: Signed) => { state().current = who; };
const model = new Proxy({} as ModelState, {
  get: (_t, k) => Reflect.get(state().model, k),
  set: (_t, k, v) => Reflect.set(state().model, k, v),
});
const it = Object.assign(
  (name: string, fn: () => Promise<void> | void, timeout?: number) =>
    vitestIt(name, () => caseState.run({ current: signedInA(), model: freshModel(), pendingAfter: [] }, fn), timeout),
  { skip: vitestIt.skip },
);

vi.mock("../requestContext", async () => ({
  ...(await vi.importActual<object>("../requestContext")),
  requireRequestContext: async () => ({ ...signedIn(), organisationName: "Org", role: "owner", memberships: [] }),
  requireTenantId: async () => signedIn().tenantId,
}));
vi.mock("next/server", async () => ({ ...(await vi.importActual<object>("next/server")), after: (fn: () => Promise<unknown>) => void state().pendingAfter.push(fn()) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (p: string) => (objects.has(p) ? { data: new Blob([new Uint8Array(objects.get(p)!)]), error: null } : { data: null, error: { message: "not found" } }),
      }),
    },
  },
}));
/** The JSON of a request: one line, or a cached shared part and the rest, merged (promptCache.ts). */
const jsonParts = (content: string) => Object.assign({}, ...content.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)));
vi.mock("../apiUsage", async () => ({ ...(await vi.importActual<object>("../apiUsage")), logApiUsage: async () => {} }));
// Deterministic model stand-in: extraction quotes each sentence of the passage it was sent;
// assessment answers one observation per criterion, citing facts whose topic fits.
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "stand-in-model",
  anthropic: {
    messages: {
      create: async (req: { tool_choice: { name: string }; messages: { content: string | { type: string; text: string; cache_control?: unknown }[] }[] }) => {
        const tool = req.tool_choice.name;
        const raw = req.messages[0].content;
        // A cached shared part and the rest arrive as two text blocks (promptCache.ts); recorded so
        // the test can see which calls marked a cache breakpoint.
        if (Array.isArray(raw)) model.cached.push(tool);
        const content = typeof raw === "string" ? raw : raw.map((b) => b.text).join("\n");
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
          // Codex RQ-F01: quotes the document does not contain, or values outside the enums, for every
          // proposed fact ("invent", "badEnum") or alongside the real ones ("mixed"); optionally only for
          // the document whose name contains `extractOnly`.
          const affected = model.extract !== "normal" && (!model.extractOnly || content.includes(`Document: `) && content.split("\n")[0].includes(model.extractOnly));
          if (affected && model.extract === "invent") {
            const invented = facts.map((f, i) => ({ ...f, exact_quote: `This sentence ${i + 1} was never written in the document.` }));
            return { usage, content: [{ type: "tool_use", input: { nothing_found: false, facts: invented } }] };
          }
          if (affected && model.extract === "badEnum") return { usage, content: [{ type: "tool_use", input: { nothing_found: false, facts: facts.map((f) => ({ ...f, topic: "not_a_topic" })) } }] };
          if (affected && model.extract === "mixed") {
            const extra = [1, 2].map((i) => ({ topic: "claim", phase: "planned", selection: "unstated", statement: "invented", exact_quote: `An invented passage number ${i} about the sampling frame.` }));
            return { usage, content: [{ type: "tool_use", input: { nothing_found: false, facts: [...facts, ...extra] } }] };
          }
          if (model.cutOff === "extract") return { usage, stop_reason: "max_tokens", content: [{ type: "tool_use", input: { facts: facts.slice(0, 1) } }] };
          // The live model's slip seen on 2026-10-18: the list arrives as a JSON string and the flag is left out.
          if (model.stringifyLists) return { usage, content: [{ type: "tool_use", input: { facts: JSON.stringify(facts) } }] };
          return { usage, content: [{ type: "tool_use", input: { nothing_found: facts.length === 0, facts } }] };
        }
        if (tool === "record_checklist_statuses") {
          // Checklist stand-in: an element is present when a fact of its matching topic exists, and
          // absent otherwise. "overclaim" says present everywhere without citing anything.
          const cp = jsonParts(content) as { elements: { element_id: string }[]; facts: { id: string; topic: string }[] };
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
        const payload = jsonParts(content) as { criteria: { id: string }[]; facts: { id: string; topic: string }[]; context: { decisions: { ref: number }[] } };
        const group = payload.criteria[0].id;
        if (model.hold && payload.criteria.some((c) => c.id === model.hold!.task)) await model.hold.release;
        if (model.failTask && payload.criteria.some((c) => c.id === model.failTask)) throw new Error("synthetic model outage");
        const cmpFacts = (payload as unknown as { facts: { id: string; source: string }[] }).facts;
        const firstFrom = (part: string) => cmpFacts.find((f) => f.source.includes(part))?.id;
        const observations = payload.criteria.map((c) => {
          // Codex RQ-F02: what a comparison criterion cites, on demand. Documents are told apart by
          // "brief" and "prop" in their file names.
          if (model.compare && c.id.startsWith("RQ-CMP-")) {
            const ids = (model.compare === "both" ? [firstFrom("prop"), firstFrom("brief")] : model.compare === "proposalOnly" ? [firstFrom("prop")] : [firstFrom("brief")]).filter((x): x is string => !!x);
            const absent = model.compare === "briefOnlyAbsent";
            return {
              criterion_id: c.id, fact_ids: ids, decision_refs: [], score: absent ? 0 : 3, score_reason: "stand-in comparison",
              documentation: absent ? "not_documented" : "documented", methodology: "cannot_assess", decision_fitness: [],
              reasoning: `stand-in comparison for ${c.id}`, implication: "i", uncertainty: [],
              improvement: { current_action: `Clarify ${c.id}`, future_action: null, timing: "before_decision", rationale: "stand-in" },
              clarification_questions: [],
            };
          }
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

/**
 * The two cases that make the most database round trips (a project document deleted with its review
 * history kept; an interrupted run continued) get their own budget (Codex RP0-V02). Measured: the
 * deletion case takes about 1.6 s here alone, and 7.2 s in Codex's run with four CPU workers and a SQL
 * worker beside it, over the 5 s default, while every assertion held (54/54 with a 15 s budget). A
 * loaded host slows them without changing what they check, so the budget is sized to the measured
 * loaded time with headroom; a hang still fails, at 20 s.
 */
const LOADED_HOST_BUDGET_MS = 20_000;

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
    while (state().pendingAfter.length) await state().pendingAfter.shift();
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
    model.cached = [];
    const empty = await viewOf(null);
    expect(empty.review).toBeNull();
    expect(empty.documents.map((d) => d.filename).sort()).toEqual(["brief.txt", "proposal.txt", "scan.txt"]);
    expect(model.calls).toEqual([]);
    const id = await start([{ documentId: briefDoc, roles: ["brief"] }]);
    const v = await viewOf(id);
    expect(v.review!.state).toBe("complete");
    expect(model.calls.filter((c) => c === "record_documented_facts")).toHaveLength(1);
    // Prompt caching (promptCache.ts): every assessment and checklist call sends its shared input as
    // a cached first block; extraction sends one passage and has none to share.
    expect(model.cached.length).toBeGreaterThan(0);
    expect(model.cached.filter((t) => t === "record_documented_facts")).toEqual([]);
    expect(model.cached.length).toBe(model.calls.filter((c) => c !== "record_documented_facts").length);
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
    signInAs({ tenantId: B, userId: "20000000-0000-4000-8000-0000000000b7", email: "b@example.test" });
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
    signInAs(signedInA());
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
        promptVersion: base.prompt_version, model: base.model, estimatedCostUsd: 0, actor: { userId: signedIn().userId, email: signedIn().email }, tasks: [],
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
    }, LOADED_HOST_BUDGET_MS);

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

  // Review kinds, Grant 2026-10-19: one brief, one proposal, or a proposal against its brief, each a
  // one-off review of how well the document is written. Actual actions, runner, view and DOCX.
  describe("review kinds", () => {
    const kindStart = async (kind: string, documentIds: string[]) => {
      const r = await m.actions.startResearchQualityReviewAction(runA, { requestKey: `k${Math.random().toString(36).slice(2, 12)}`, kind, sources: documentIds.map((documentId) => ({ documentId })) });
      if (!r.ok) throw new Error(r.error);
      await settle();
      return r.reviewId;
    };
    const longBrief = () =>
      // About 60,000 characters: over the older 40,000-character per-document limit.
      addDoc(A, runA, "kind-brief.txt", Buffer.from("Kind brief.\nThe decision is whether to launch a loyalty scheme next year.\n" + "We will survey existing customers about loyalty and their reasons for leaving.\n".repeat(760) + "Budget: up to R400,000.\n"));
    const proposal = () => addDoc(A, runA, "kind-proposal.txt", Buffer.from("Kind proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n"));

    it("a brief review runs only the ten brief criteria, reads the whole document, has no checklist and asks for nothing else", async () => {
      const id = await kindStart("brief", [await longBrief()]);
      const v = (await viewOf(id)).review!;
      expect(v.kind).toBe("brief");
      expect(v.manifest.criteria.map((c) => c.criterionId)).toEqual(criteriaForKind("brief"));
      expect(v.manifest.criteria.every((c) => c.status === "selected")).toBe(true);
      const s = v.manifest.sources[0];
      expect(s.roles).toEqual(["brief"]);
      expect(s.charCount).toBeGreaterThan(40_000);
      expect(s.assessedRanges.reduce((n, x) => n + (x.end - x.start), 0)).toBe(s.charCount);
      expect(v.checklists).toEqual([]);
      expect(v.checklistNote).toBeNull();
      expect(v.manifest.decisions).toEqual([]);
      expect(v.dashboards.map((d) => d.dashboardId)).toEqual(["brief"]);
      expect(new Set(v.observations.map((o) => o.criterionId))).toEqual(new Set(criteriaForKind("brief")));
      // The Word export is the dashboard and the criteria, nothing about decisions.
      const { buffer, filename } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      const text = (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
      expect(filename).toMatch(/-brief-review-\d+\.docx$/);
      expect(text).toContain("Brief review: RQ project");
      expect(text).toContain(`Research brief: ${v.dashboards[0].pct}%`);
      expect(text).not.toMatch(/Decision implications|Scored checklist|Appendix/);
    });

    it("a proposal review rates the proposal on its own; a comparison is a separate review with its own criteria", async () => {
      const prop = await proposal();
      const brief = await longBrief();
      const p = (await viewOf(await kindStart("proposal", [prop]))).review!;
      expect(p.dashboards.map((d) => d.dashboardId)).toEqual(["proposal"]);
      expect(p.manifest.sources.map((s) => s.roles)).toEqual([["proposal"]]);
      const c = (await viewOf(await kindStart("proposal_vs_brief", [prop, brief]))).review!;
      expect(c.kind).toBe("proposal_vs_brief");
      expect(c.manifest.sources.map((s) => s.roles)).toEqual([["proposal"], ["brief"]]);
      expect(c.manifest.criteria.map((x) => x.criterionId)).toEqual(criteriaForKind("proposal_vs_brief"));
      expect(c.dashboards.map((d) => d.dashboardId)).toEqual(["comparison"]);
      expect(c.dashboards[0].dimensions).toHaveLength(7);
      // Listed with their kind and documents, for the document list on screen.
      const listed = (await viewOf(null)).reviews.find((x) => x.id === c.id)!;
      expect(listed).toMatchObject({ kind: "proposal_vs_brief", sources: [{ documentId: prop, roles: ["proposal"] }, { documentId: brief, roles: ["brief"] }] });
    });

    it("RQC-6: a proposal review rates sampling twice and checks each stated margin of error by code; the export shows it", async () => {
      const text =
        "Precision proposal.\nWe will interview a sample of 500 respondents, giving a margin of error of ±2% at 95% confidence.\n" +
        "Results for the total of 1,000 interviews carry a margin of error of ±3.1%.\nSubgroups of 200 men and 300 women have a margin of error of ±6%.\n";
      const id = await kindStart("proposal", [await addDoc(A, runA, "precision-proposal.txt", Buffer.from(text))]);
      const v = (await viewOf(id)).review!;
      const selected = v.manifest.criteria.map((c) => c.criterionId);
      expect(selected).toEqual(expect.arrayContaining(["RQ-PROP-SAMPLE-SIZE", "RQ-PROP-SAMPLE-METHOD"]));
      expect(selected).not.toContain("RQ-PROP-SAMPLE");
      const method = v.dashboards[0].dimensions.find((x) => x.dimensionId === "method")!;
      expect(method.criteria.map((c) => c.criterionId)).toEqual(["RQ-PROP-METHOD", "RQ-PROP-DESIGN", "RQ-PROP-SAMPLE-SIZE", "RQ-PROP-SAMPLE-METHOD", "RQ-PROP-ANALYSIS", "RQ-PROP-LITERATURE"]);
      // Frozen with the review, from the text it assessed: one understated, one consistent, one not checked.
      expect(v.manifest.precisionChecks).toHaveLength(1);
      const checks = v.manifest.precisionChecks![0].checks;
      expect(checks.map((c) => (c.kind === "checked" ? [c.n, c.statedMargin, c.verdict] : ["not_checked", c.reason]))).toEqual([
        [500, 2, "understated"],
        [1000, 3.1, "consistent"],
        ["not_checked", "More than one sample size in the sentence (a total and subgroups, for example)."],
      ]);
      const { buffer } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      const doc = (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
      expect(doc).toContain("Margin of error, calculated (not the model&apos;s rating");
      expect(doc).toContain("n=500 at 95% gives about ±4.4 points, not ±2. ±2 would need about n=2,401.");
    });

    it("a brief review makes no margin-of-error check", async () => {
      const v = (await viewOf(await kindStart("brief", [await addDoc(A, runA, "moe-brief.txt", Buffer.from("Brief.\nA sample of 500 respondents gives a margin of error of ±2%.\n"))]))).review!;
      expect(v.manifest.precisionChecks).toBeUndefined();
    });

    it("refuses a wrong number of documents, the same document twice and an unknown kind, creating nothing", async () => {
      const before = (await q(`select count(*)::int n from research_quality_reviews where run_id = $1`, [runA])).rows[0].n;
      const prop = await proposal();
      const go = (raw: Record<string, unknown>) => m.actions.startResearchQualityReviewAction(runA, { requestKey: `k${Math.random().toString(36).slice(2, 12)}`, ...raw });
      expect(await go({ kind: "brief", sources: [{ documentId: prop }, { documentId: prop }] })).toMatchObject({ ok: false, error: "Choose one document for a brief review." });
      expect(await go({ kind: "proposal_vs_brief", sources: [{ documentId: prop }] })).toMatchObject({ ok: false, error: "Choose one proposal and one brief." });
      expect(await go({ kind: "proposal_vs_brief", sources: [{ documentId: prop }, { documentId: prop }] })).toMatchObject({ ok: false, error: /two different documents/ });
      expect(await go({ kind: "questionnaire", sources: [{ documentId: prop }] })).toMatchObject({ ok: false });
      expect((await q(`select count(*)::int n from research_quality_reviews where run_id = $1`, [runA])).rows[0].n).toBe(before);
    });
  });

  // The brief dashboard (RQC-3), Grant 2026-10-19: ten dimensions rated by the model, combined by code.
  describe("brief dashboard", () => {
    const briefDoc = (label: string) => addDoc(A, runA, `${label}.txt`, Buffer.from("Dashboard brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\n"));

    it("rates the ten brief dimensions and computes the weighted overall from them; the export shows the same", async () => {
      const id = await start([{ documentId: await briefDoc("db-brief"), roles: ["brief"] }]);
      const v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      expect(v.review!.criteriaRelease).toBe("RQC-6");
      expect(v.review!.dashboardNote).toBeNull();
      const [d] = v.review!.dashboards;
      expect(d.dashboardId).toBe("brief");
      expect(d.dimensions).toHaveLength(10);
      expect(d.dimensions.every((x) => x.state === "rated")).toBe(true);
      // Independent recount from the stored ratings: weight x score over weight x 5.
      const rating = (cid: string) => v.review!.observations.filter((o) => o.criterionId === cid && o.status !== "dismissed").map((o) => o.payload.rating.score!).sort((a, b) => a - b)[0];
      const weight = (cid: string) => (["RQ-BRIEF-PROBLEM", "RQ-BRIEF-DECISION", "RQ-BRIEF-OBJECTIVES"].includes(cid) ? 2 : 1);
      const ids = d.dimensions.map((x) => x.dimensionId);
      const points = ids.reduce((n, cid) => n + weight(cid) * rating(cid), 0);
      expect(d.pct).toBe(Math.round((points / (13 * 5)) * 100));
      // The stand-in rates the decision 3 (a decision fact is cited) and the rest 0: 6 / 65 = 9%.
      expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-DECISION")!.score).toBe(3);
      expect(d).toMatchObject({ pct: 9, band: "weak" });
      // The retired brief criteria are never selected for a new review.
      expect(v.review!.manifest.criteria.map((c) => c.criterionId)).not.toContain("RQ-BRIEF-DEADLINE");
      const { buffer } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      const text = (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
      expect(text).toContain("Research brief: 9% (Weak)");
      expect(text).toContain("Decisions to inform (counts x2): 3/5, Workable");
    });

    it("a dismissed rating leaves its dimension unrated rather than zero", async () => {
      const id = await start([{ documentId: await briefDoc("db-dismiss"), roles: ["brief"] }]);
      const before = (await viewOf(id)).review!;
      const o = before.observations.find((x) => x.criterionId === "RQ-BRIEF-PROBLEM")!;
      expect((await m.actions.recordResearchQualityEntryAction(runA, { kind: "dismiss", observationId: o.observationId, observationVersionId: o.versionId, body: null, expectedRevision: o.revision, idempotencyKey: `db-dismiss-${o.observationId}` })).ok).toBe(true);
      const [d] = (await viewOf(id)).review!.dashboards;
      expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-PROBLEM")).toMatchObject({ state: "not_rated", score: null });
      // Problem (weight 2) leaves the base: 6 / (11 x 5) = 10.9% -> 11.
      expect(d).toMatchObject({ pct: 11, ratedWeight: 11, totalWeight: 13 });
    });

    it("a proposal gets the six weighted categories, each the average of its rated criteria", async () => {
      const id = await start([{ documentId: await addDoc(A, runA, "db-proposal.txt", Buffer.from("Dashboard proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n")), roles: ["proposal"] }]);
      const v = await viewOf(id);
      const d = v.review!.dashboards.find((x) => x.dashboardId === "proposal")!;
      expect(d.dimensions.map((x) => [x.dimensionId, x.weight])).toEqual([["method", 36], ["price", 18], ["team", 14], ["management", 14], ["compliance", 9], ["innovation", 9]]);
      // Independent recount from the stored ratings.
      const rating = (cid: string) => v.review!.observations.filter((o) => o.criterionId === cid && o.status !== "dismissed").map((o) => o.payload.rating.score!).sort((a, b) => a - b)[0];
      let points = 0;
      for (const x of d.dimensions) {
        const scores = x.criteria.map((c) => rating(c.criterionId)).filter((n) => typeof n === "number");
        expect(x.score).toBeCloseTo(scores.reduce<number>((a, b) => a + b, 0) / scores.length, 10);
        points += x.weight * x.score!;
      }
      expect(d.pct).toBe(Math.round((points / (100 * 5)) * 100));
      // The stand-in rates each sampling criterion 3 (a recruitment fact is cited) and the rest 0. Under
      // RQC-6 sampling is two items, size and method: method (0+0+3+3+0+0)/6 = 1.0, so 36 x 1.0 = 36 of
      // 500 -> 7.2% -> 7%. (Under RQC-5, with one Sample item, it was (0+0+3+0+0)/5 = 0.6 and 4%.)
      expect(d.dimensions[0].score).toBeCloseTo(1, 10);
      expect(d.pct).toBe(7);
      expect(v.review!.dashboards.map((x) => x.dashboardId)).toEqual(["proposal"]); // no brief, no brief dashboard
    });

    it("a review made under an earlier criteria release shows no dashboard and says why", async () => {
      const id = await start([{ documentId: await briefDoc("db-old"), roles: ["brief"] }]);
      await q(`update research_quality_reviews set criteria_release = 'RQC-2' where id = $1`, [id]);
      const v = await viewOf(id);
      expect(v.review!.dashboards).toEqual([]);
      expect(v.review!.dashboardNote).toMatch(/criteria release RQC-2, before the dashboard/);
    });
  });

  // Codex RQ-F01 (2026-10-24): an extraction whose proposed quotes were all rejected was published
  // as a successful, empty reading, so a brief that states its decision, population and deliverables
  // was reviewed as complete, 0%, every criterion Absent, on screen and in Word, and Retry did
  // nothing. A rejected reading is now a failed step; a partly rejected one leaves absences unrated.
  describe("RQ-F01 rejected extraction is never complete negative evidence", () => {
    const realBrief = (label: string) =>
      addDoc(A, runA, `${label}.txt`, Buffer.from("Client brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\nDeliverables are a short report and a deck.\n"));
    const briefReview = async (documentId: string) => {
      const r = await m.actions.startResearchQualityReviewAction(runA, { requestKey: `k${Math.random().toString(36).slice(2, 12)}`, kind: "brief", sources: [{ documentId }] });
      if (!r.ok) throw new Error(r.error);
      await settle();
      return r.reviewId;
    };
    const docText = async (id: string) => {
      const { buffer } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      return (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    };

    it("all quotes rejected: the step fails visibly, nothing is rated Absent, Word agrees, and Retry reads the document again", async () => {
      model.extract = "invent";
      const id = await briefReview(await realBrief("rq-f01-all"));
      const v = (await viewOf(id)).review!;
      expect(v.state).toBe("failed");
      expect(v.coverage.coverageComplete).toBe(false);
      expect(v.observations.filter((o) => o.payload.rating.score === 0)).toEqual([]);
      expect(v.dashboards.every((d) => d.pct === null)).toBe(true);
      const step = v.coverage.tasks!.find((t) => t.stage === "extract")!;
      expect(step).toMatchObject({ status: "failed" });
      expect(step.error).toMatch(/none of the \d+ passages the model quoted from rq-f01-all\.txt .* could be found in the document/);
      expect(step.error).toMatch(/not read as having no content/);
      const word = await docText(id);
      expect(word).toMatch(/could be found in the document/);
      expect(word).not.toMatch(/Research brief: 0%/);
      expect(word).not.toMatch(/Absent 0\b.*Absent 0\b/); // the scale legend may name Absent once; no rating does
      // Recovery in place: the model is healthy again, Retry failed steps re-reads it.
      model.extract = "normal";
      expect(await m.actions.retryResearchQualityReviewAction(runA, id)).toMatchObject({ ok: true });
      await settle();
      const after = (await viewOf(id)).review!;
      expect(after.state).toBe("complete");
      expect(after.facts.length).toBeGreaterThanOrEqual(3);
      expect(after.unverifiedEvidence).toEqual([]);
      expect(after.dashboards[0].dimensions.find((x) => x.dimensionId === "RQ-BRIEF-DECISION")!.score).toBe(3);
    });

    it("every proposed fact with an invalid topic is the same failed step", async () => {
      model.extract = "badEnum";
      const id = await briefReview(await realBrief("rq-f01-enum"));
      const v = (await viewOf(id)).review!;
      expect(v.state).toBe("failed");
      expect(v.coverage.tasks!.find((t) => t.stage === "extract")!.error).toMatch(/none of the \d+ passages/);
      expect(v.observations).toEqual([]);
    });

    it("some quotes rejected: verified facts are used, absences are not rated, the screen and Word say why", async () => {
      model.extract = "mixed";
      const id = await briefReview(await realBrief("rq-f01-mixed"));
      const v = (await viewOf(id)).review!;
      expect(v.state).toBe("complete");
      expect(v.coverage.coverageComplete).toBe(false);
      expect(v.unverifiedEvidence).toEqual([{ filename: "rq-f01-mixed.txt", rejected: 2, kept: expect.any(Number) }]);
      expect(v.unverifiedEvidence[0].kept).toBeGreaterThanOrEqual(3);
      // Documented criteria are still rated from verified quotes; no absence is scored Absent.
      const [d] = v.dashboards;
      expect(d.dimensions.find((x) => x.dimensionId === "RQ-BRIEF-DECISION")!.score).toBe(3);
      const absences = v.observations.filter((o) => o.payload.basis === "absence_in_assessed_scope");
      expect(absences.length).toBeGreaterThan(0);
      for (const o of absences) {
        expect(o.payload.assessment.documentation).toBe("not_assessed");
        expect(o.payload.rating.score).toBeNull();
        expect(o.payload.validationNotes.join(" ")).toMatch(/could not be found in them and were left out/);
      }
      expect(d.dimensions.some((x) => x.score === 0)).toBe(false);
      for (const c of v.checklists) for (const sec of c.sections) for (const e of sec.elements) expect(e.status).not.toBe("absent");
      const word = await docText(id);
      expect(word).toContain("rq-f01-mixed.txt: 2 quoted passages the model proposed could not be found in the document and were left out.");
    });

    it("some quotes rejected in a full review: the checklist confirms no absence in that document", async () => {
      model.extract = "mixed";
      const prop = await addDoc(A, runA, "rq-f01-mixed-prop.txt", Buffer.from("Proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n"));
      const v = (await viewOf(await start([{ documentId: prop, roles: ["proposal"] }]))).review!;
      expect(v.checklists.length).toBeGreaterThan(0);
      const elements = v.checklists.flatMap((c) => c.sections.flatMap((x) => x.elements));
      expect(elements.some((e) => e.status === "present")).toBe(true);
      expect(elements.filter((e) => e.status === "absent")).toEqual([]);
      expect(elements.some((e) => e.notAssessedBecause === "not all of the document was read, so absence cannot be confirmed")).toBe(true);
    });

    it("control: a document where the model legitimately finds nothing is still a complete review with Absent ratings", async () => {
      const id = await briefReview(await addDoc(A, runA, "rq-f01-empty.txt", Buffer.from("Brief.\nTBC.\nSoon.\nOk.\n")));
      const v = (await viewOf(id)).review!;
      expect(v.state).toBe("complete");
      expect(v.coverage.coverageComplete).toBe(true);
      expect(v.unverifiedEvidence).toEqual([]);
      expect(v.observations.some((o) => o.payload.rating.score === 0 && o.payload.absenceScope === "complete")).toBe(true);
    });

    it("two documents, one rejected: the other is still assessed, and the failed one is named with its recovery", async () => {
      model.extract = "invent";
      model.extractOnly = "rq-f01-prop";
      const brief = await realBrief("rq-f01-ctrl-brief");
      const prop = await addDoc(A, runA, "rq-f01-prop.txt", Buffer.from("Proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n"));
      const id = await start([{ documentId: brief, roles: ["brief"] }, { documentId: prop, roles: ["proposal"] }]);
      const v = (await viewOf(id)).review!;
      expect(v.state).toBe("partial");
      expect(v.facts.every((f) => v.manifest.sources.find((s) => s.sourceVersionId === f.sourceVersionId)!.filename === "rq-f01-ctrl-brief.txt")).toBe(true);
      expect(v.facts.length).toBeGreaterThanOrEqual(3);
      const failed = v.coverage.tasks!.filter((t) => t.status === "failed");
      expect(failed.map((t) => t.error)).toEqual([expect.stringMatching(/quoted from rq-f01-prop\.txt/)]);
      // The brief's own absences are qualified as partial (not every document was read).
      for (const o of v.observations.filter((x) => x.payload.basis === "absence_in_assessed_scope")) expect(o.payload.absenceScope).toBe("partial");
      // The reading cannot be retried in this review (assessments already cite the brief's facts),
      // so the screen offers no retry for it; a retry call reruns nothing and changes nothing.
      const { retryableInPlace } = await import("../researchQualityPresentation");
      expect(retryableInPlace(failed[0], v.coverage.tasks!)).toBe(false);
      model.extract = "normal";
      expect(await m.actions.retryResearchQualityReviewAction(runA, id)).toMatchObject({ ok: true });
      await settle();
      const again = (await viewOf(id)).review!;
      expect(again.state).toBe("partial");
      expect(again.facts.map((f) => f.factId)).toEqual(v.facts.map((f) => f.factId));
      // A new review of the same documents, with the model healthy, reads both.
      const fresh = (await viewOf(await start([{ documentId: brief, roles: ["brief"] }, { documentId: prop, roles: ["proposal"] }]))).review!;
      expect(fresh.state).toBe("complete");
      expect(new Set(fresh.facts.map((f) => fresh.manifest.sources.find((s) => s.sourceVersionId === f.sourceVersionId)!.filename))).toEqual(new Set(["rq-f01-ctrl-brief.txt", "rq-f01-prop.txt"]));
      // Another organisation cannot retry it.
      signInAs({ tenantId: B, userId: "20000000-0000-4000-8000-0000000000b7", email: "b@example.test" });
      expect(await m.actions.retryResearchQualityReviewAction(runA, id)).toMatchObject({ ok: false });
    }, 60000);

    it("a review saved before the repair, with an all-rejected extraction published as succeeded, is qualified on screen and in Word", async () => {
      const id = await briefReview(await realBrief("rq-f01-old"));
      // Reproduce the stored state the old code wrote: the extraction succeeded with no facts and every quote dropped.
      await q(
        `update research_quality_tasks set result = jsonb_set(result, '{facts}', '[]'::jsonb), validation = '{"droppedUnverifiableQuotes": 4}'::jsonb
          where review_id = $1 and stage = 'extract'`,
        [id],
      );
      const v = (await viewOf(id)).review!;
      expect(v.unverifiedEvidence).toEqual([{ filename: "rq-f01-old.txt", rejected: 4, kept: 0 }]);
      const word = await docText(id);
      expect(word).toContain("rq-f01-old.txt: none of the 4 quoted passages the model proposed could be found in the document, so nothing was taken from it.");
    });

    // Codex V-B19-01: a case that runs past its timeout keeps going after the next case has started. Here
    // the first case leaves a continuation behind (as a timed-out case does) that, once released, signs in
    // as tenant B and breaks the model; the second case releases it, waits for it to finish, and still
    // acts as tenant A with a healthy model.
    let releaseLate: () => void = () => {};
    let lateDone: Promise<void> = Promise.resolve();
    it("isolation, part 1: a continuation outlives its case", async () => {
      const gate = new Promise<void>((r) => (releaseLate = r));
      lateDone = (async () => {
        await gate;
        signInAs({ tenantId: B, userId: "20000000-0000-4000-8000-0000000000b7", email: "b@example.test" });
        model.failTask = "RQ-B-DECISION";
        model.extract = "invent";
      })();
    });
    it("isolation, part 2: the earlier case's late tenant and model changes do not reach this case", async () => {
      releaseLate();
      await lateDone;
      expect(signedIn().tenantId).toBe(A);
      expect(model.failTask).toBeNull();
      expect(model.extract).toBe("normal");
      const id = await briefReview(await realBrief("v-b19-01-isolation"));
      expect((await viewOf(id)).review!.state).toBe("complete");
    });
  });

  // Codex RQ-F02 (2026-10-24): an unread proposal was rated 3/5 Workable on a comparison citing only
  // the brief's words. A comparison now needs quotes from both documents (or is a stated gap).
  describe("RQ-F02 comparisons rest on both documents", () => {
    const compare = async (prop: string, brief: string) => {
      const r = await m.actions.startResearchQualityReviewAction(runA, { requestKey: `k${Math.random().toString(36).slice(2, 12)}`, kind: "proposal_vs_brief", sources: [{ documentId: prop }, { documentId: brief }] });
      if (!r.ok) throw new Error(r.error);
      await settle();
      return r.reviewId;
    };
    const propDoc = (label: string) => addDoc(A, runA, `${label}-prop.txt`, Buffer.from("Proposal.\nWe will survey existing customers about the loyalty scheme decision.\nRecruitment will use the client's customer list.\n"));
    const briefDoc = (label: string) => addDoc(A, runA, `${label}-brief.txt`, Buffer.from("Project brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\n"));
    const cmp = (v: NonNullable<Awaited<ReturnType<typeof viewOf>>["review"]>) => v.observations.filter((o) => o.criterionId.startsWith("RQ-CMP-"));
    const word = async (id: string) => {
      const { buffer } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      return (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    };

    it("an unread proposal: no comparison is rated, though the model cites a true brief quote; the screen and Word agree", async () => {
      model.extract = "invent";
      model.extractOnly = "f02-unread-prop";
      model.compare = "briefOnly";
      const id = await compare(await propDoc("f02-unread"), await briefDoc("f02-unread"));
      const v = (await viewOf(id)).review!;
      expect(v.state).toBe("partial");
      expect(cmp(v).length).toBeGreaterThan(0);
      for (const o of cmp(v)) {
        expect(o.payload.rating.score).toBeNull();
        expect(o.payload.assessment.documentation).toBe("not_assessed");
        expect(o.payload.validationNotes.join(" ")).toMatch(/The proposal could not be read, so this comparison is not rated/);
      }
      expect(v.dashboards[0].pct).toBeNull();
      expect(v.oneSidedComparisons).toEqual([]);
      const text = await word(id);
      expect(text).not.toMatch(/Problem restated: 3\/5/);
      expect(text).toContain("Not completed: Reading the document");
    });

    it("an unread brief: no comparison is rated", async () => {
      model.extract = "invent";
      model.extractOnly = "f02-nobrief-brief";
      model.compare = "proposalOnly";
      const v = (await viewOf(await compare(await propDoc("f02-nobrief"), await briefDoc("f02-nobrief")))).review!;
      for (const o of cmp(v)) {
        expect(o.payload.rating.score).toBeNull();
        expect(o.payload.validationNotes.join(" ")).toMatch(/The brief could not be read/);
      }
    });

    it("both read, quotes from one document only: not rated, saying which; a stated gap in a fully read proposal is Absent", async () => {
      model.compare = "briefOnly";
      const one = (await viewOf(await compare(await propDoc("f02-one"), await briefDoc("f02-one")))).review!;
      expect(one.state).toBe("complete");
      for (const o of cmp(one)) {
        expect(o.payload.rating.score).toBeNull();
        expect(o.payload.validationNotes.join(" ")).toMatch(/needs quotes from both the proposal and the brief; this one cited only the brief/);
      }
      model.compare = "proposalOnly";
      for (const o of cmp((await viewOf(await compare(await propDoc("f02-p"), await briefDoc("f02-p")))).review!)) {
        expect(o.payload.rating.score).toBeNull();
        expect(o.payload.validationNotes.join(" ")).toMatch(/cited only the proposal/);
      }
      model.compare = "briefOnlyAbsent";
      const gap = (await viewOf(await compare(await propDoc("f02-gap"), await briefDoc("f02-gap")))).review!;
      for (const o of cmp(gap)) {
        expect(o.payload.rating.score).toBe(0);
        expect(o.payload.validationNotes.join(" ")).toMatch(/the proposal, read in full, does not: scored Absent/);
      }
      expect(gap.oneSidedComparisons).toEqual([]);
    });

    it("control: quotes from both documents are rated as before, also after a reload", async () => {
      model.compare = "both";
      const id = await compare(await propDoc("f02-both"), await briefDoc("f02-both"));
      const v = (await viewOf(id)).review!;
      for (const o of cmp(v)) {
        expect(o.payload.rating.score).toBe(3);
        expect(new Set(o.payload.statements.map((st) => v.manifest.sources.find((s) => s.sourceVersionId === st.sourceVersionId)!.roles[0]))).toEqual(new Set(["proposal", "brief"]));
      }
      expect(v.dashboards[0].pct).toBe(60);
      expect((await viewOf(id)).review!.dashboards[0].pct).toBe(60);
      expect(v.oneSidedComparisons).toEqual([]);
    });

    it("a comparison saved before the rule, rated from the brief alone, is qualified on screen and in Word; its rating is kept", async () => {
      model.compare = "both";
      const id = await compare(await propDoc("f02-old"), await briefDoc("f02-old"));
      const v = (await viewOf(id)).review!;
      const problem = v.observations.find((o) => o.criterionId === "RQ-CMP-PROBLEM")!;
      const briefVersion = v.manifest.sources.find((s) => s.roles.includes("brief"))!.sourceVersionId;
      // Reproduce what the old code stored: a 3/5 rating whose only quote is the brief's.
      await q(
        `update research_quality_observation_versions set payload = jsonb_set(payload, '{statements}', (select coalesce(jsonb_agg(st), '[]'::jsonb) from jsonb_array_elements(payload->'statements') st where st->>'sourceVersionId' = $2)) where id = $1`,
        [problem.versionId, briefVersion],
      );
      const after = (await viewOf(id)).review!;
      expect(after.oneSidedComparisons).toEqual([{ criterionId: "RQ-CMP-PROBLEM", citedOnly: "brief" }]);
      expect(after.observations.find((o) => o.criterionId === "RQ-CMP-PROBLEM")!.payload.rating.score).toBe(3);
      const text = await word(id);
      expect(text).toMatch(/One comparison rating \(Problem restated\) cites the words of only one document/);
    });
  });

  // The scored checklist (RQK-1, now RQK-2), Grant 2026-10-18: each document scored against the elements its
  // type should contain, model finds and code scores. Actual actions, runner, view and DOCX.
  describe("scored checklist", () => {
    const doc = (label: string, text: string) => addDoc(A, runA, `${label}.txt`, Buffer.from(text));
    const briefText = "Checklist brief.\nThe decision is whether to launch a loyalty scheme next year.\nWe will survey existing customers about loyalty.\n";
    const proposalText = "Checklist proposal.\nWe will survey the general public using an opt-in online panel.\nRecruitment will use a commercial panel provider.\n";

    it("scores each document against its own checklist; every number follows from the statuses shown", async () => {
      const id = await start([{ documentId: await doc("ck-brief", briefText), roles: ["brief"] }, { documentId: await doc("ck-proposal", proposalText), roles: ["proposal"] }]);
      const v = await viewOf(id);
      expect(v.review!.state).toBe("complete");
      // RQK-2: the brief is rated on the RQC-3 dimensions (its dashboard), not a checklist.
      expect(v.review!.checklists.map((c) => [c.checklistId, c.state])).toEqual([["proposal", "scored"]]);
      const c = v.review!.checklists[0];
      const statuses = c.sections.flatMap((s) => s.elements.map((e) => e.status));
      expect(statuses.every((x) => x !== null)).toBe(true);
      // Independent recount from what the screen shows.
      const assessed = statuses.filter((x) => x !== "not_assessed");
      const points = assessed.reduce((n, x) => n + (x === "present" ? 2 : x === "partial" ? 1 : 0), 0);
      expect(c.score!.assessed).toBe(assessed.length);
      expect(c.score!.pct).toBe(Math.round((points / (assessed.length * 2)) * 100));
      // Presence is always backed by a quote from the document.
      for (const s of c.sections) for (const e of s.elements) if (e.status === "present" || e.status === "partial") expect(e.quotes.length, e.elementId).toBeGreaterThan(0);
      // The proposal's sampling element was found in the proposal's own text, not the brief's.
      const pe = c.sections.flatMap((s) => s.elements).find((e) => e.elementId === "PR-SAMPLING")!;
      expect(pe.status).toBe("present");
      expect(pe.quotes.every((q) => !q.fromBrief)).toBe(true);
      expect(pe.quotes[0].quote).toMatch(/opt-in online panel|commercial panel/);
      expect(c.gaps.length).toBeGreaterThan(0);
      expect(c.gaps.findIndex((g) => !g.essential)).toBeGreaterThan(c.gaps.findLastIndex((g) => g.essential)); // essential first
      // The Word export carries the same grid and the gap recommendations.
      const { buffer } = await m.exportDocx.buildResearchQualityDocx(await m.view.loadResearchQualityView(A, runA, id), "RQ project");
      const text = (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
      expect(text).toMatch(/Scored checklist/);
      expect(text).toContain(`ck-proposal.txt: Research proposal, ${c.score!.pct}%`);
      expect(text).toMatch(/Missing or partial elements/);
      expect(text).toContain(`${c.gaps[0].label} (absent, essential)`);
    });

    it("presence claimed without quotes is not scored, so it cannot inflate the score", async () => {
      model.checklist = "overclaim";
      const id = await start([{ documentId: await doc("ck-overclaim", proposalText), roles: ["proposal"] }]);
      const c = (await viewOf(id)).review!.checklists[0];
      expect(c.state).toBe("scored");
      expect(c.score).toMatchObject({ assessed: 0, pct: null, band: null });
      expect(c.sections[0].elements[0].notAssessedBecause).toMatch(/no quoted fact/);
      expect(c.gaps).toEqual([]);
    });

    it("a failed checklist step shows no score (not zero), leaves the review partial, and retry scores it", async () => {
      model.checklist = "fail";
      const id = await start([{ documentId: await doc("ck-fail", proposalText), roles: ["proposal"] }]);
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
        const id = await start([{ documentId: await doc("ck-nomigration", proposalText), roles: ["proposal"] }]);
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
  }, LOADED_HOST_BUDGET_MS);

});
