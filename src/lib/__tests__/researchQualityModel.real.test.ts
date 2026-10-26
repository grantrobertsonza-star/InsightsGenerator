// Research Quality Review v1: the semantic ("M") acceptance cases with the REAL model, through the
// loopback budget gateway only. Skipped unless RQ_REAL_MODEL=1 and ANTHROPIC_BASE_URL is the
// gateway (http://127.0.0.1:55017), so it can never spend by accident.
//
// Real: the model (via the gateway, which holds the key and enforces the budget), a disposable
// PostgreSQL built from all migrations, the module's orchestration, validation and view. Stand-in:
// object storage (in memory: storage is not what is measured) and the synthetic reference
// catalogue (RESEARCH_QUALITY_REFERENCE_CATALOGUE=synthetic-test, set below).
//
// This MEASURES judgement quality on synthetic fixtures (fixtures/research-quality). Each case
// records what the model concluded and whether it meets the case's acceptable outcome (meaning,
// not wording). The run fails only when the pipeline itself does not complete; disagreements are
// results, written to e2e-results/research-quality-model.json for review.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { ObservationView } from "../researchQualityView";

const ENABLED = process.env.RQ_REAL_MODEL === "1" && process.env.ANTHROPIC_BASE_URL === "http://127.0.0.1:55017" && !!TEST_DATABASE_URL;
const T = "00000000-0000-4000-8000-0000000000e1";
const FIX = path.resolve(__dirname, "../../../fixtures/research-quality");
const objects = new Map<string, Buffer>();
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: { from: () => ({ download: async (p: string) => (objects.has(p) ? { data: new Blob([new Uint8Array(objects.get(p)!)]), error: null } : { data: null, error: { message: "not found" } }) }) },
  },
}));

type Src = { file: string; roles: string[] };
type Case = {
  id: string;
  what: string;
  mode: "improve_planned" | "review_documented";
  studyType: "quantitative" | "qualitative" | "mixed" | "unclear";
  purpose: string;
  decisions?: string[];
  sources: Src[];
  clarification?: string;
  grade: (obs: ObservationView[], all: { facts: number; criteria: { criterionId: string; status: string }[] }) => { pass: boolean; detail: string };
};
const find = (obs: ObservationView[], id: string) => obs.filter((o) => o.criterionId === id);
const score = (obs: ObservationView[], id: string) => find(obs, id).map((o) => o.payload.rating.score);
const text = (o: ObservationView) => `${o.payload.assessment.reasoning} ${o.payload.implication} ${o.payload.rating.reason} ${o.payload.improvement?.currentAction ?? ""} ${o.payload.improvement?.futureAction ?? ""}`;
const NUMBER_PRESCRIPTION = /\b(at least|minimum of|increase (?:the )?sample to)\s*\d{2,}|\b\d{2,}\s+(?:more\s+)?(?:respondents|participants|interviews|completes)\b/i;
const ok = (pass: boolean, detail: string) => ({ pass, detail });

const CASES: Case[] = [
  {
    id: "RQ01-good-brief", what: "A complete brief alone: brief criteria mostly Workable or Strong; deadline and budget present; at least three objectives", mode: "improve_planned", studyType: "mixed",
    purpose: "Decide whether to launch a loyalty scheme", sources: [{ file: "brief-good.txt", roles: ["brief"] }],
    grade: (o) => {
      const d = score(o, "RQ-BRIEF-DEADLINE")[0], b = score(o, "RQ-BRIEF-BUDGET")[0], ob = score(o, "RQ-BRIEF-OBJECTIVES")[0], bg = score(o, "RQ-BRIEF-BACKGROUND")[0];
      return ok((d ?? 0) >= 3 && (b ?? 0) >= 3 && (ob ?? 0) >= 3 && (bg ?? 0) >= 3, `deadline ${d}, budget ${b}, objectives ${ob}, background ${bg}`);
    },
  },
  {
    id: "RQ01-weak-brief", what: "A topic-only brief: deadline and budget Absent, objectives Weak or Absent, each with an improvement", mode: "improve_planned", studyType: "unclear",
    purpose: "", sources: [{ file: "brief-weak.txt", roles: ["brief"] }],
    grade: (o) => {
      const d = score(o, "RQ-BRIEF-DEADLINE")[0], b = score(o, "RQ-BRIEF-BUDGET")[0], ob = score(o, "RQ-BRIEF-OBJECTIVES")[0];
      const improvements = o.filter((x) => (x.payload.rating.score ?? 5) < 5).every((x) => x.payload.improvement);
      return ok(d === 0 && b === 0 && (ob ?? 5) <= 1 && improvements, `deadline ${d}, budget ${b}, objectives ${ob}, every non-Strong has an improvement: ${improvements}`);
    },
  },
  {
    id: "RQ02-population-conflict", what: "Brief targets existing customers, proposal the general public: the restatement is not Strong and the drift is named, with both sources", mode: "improve_planned", studyType: "quantitative",
    purpose: "Decide whether to launch a loyalty scheme", sources: [{ file: "brief-good.txt", roles: ["brief"] }, { file: "proposal-public.txt", roles: ["proposal"] }],
    grade: (o) => {
      const r = find(o, "RQ-PROP-RESTATEMENT")[0];
      const mentions = r ? /public|existing customers|current customers|population/i.test(text(r)) : false;
      return ok(!!r && (r.payload.rating.score ?? 5) <= 3 && r.payload.comparison === "compared_with_brief" && mentions, `restatement ${r?.payload.rating.score}, comparison ${r?.payload.comparison}, names the population drift: ${mentions}`);
    },
  },
  {
    id: "RQ03-instrument-gap", what: "The questionnaire has no question on why lapsed customers stopped or on expected visit frequency: coverage not Strong, the gap named; the leading Q4 flagged", mode: "improve_planned", studyType: "quantitative",
    purpose: "Decide whether to launch a loyalty scheme", sources: [{ file: "brief-good.txt", roles: ["brief"] }, { file: "questionnaire-loyalty.txt", roles: ["questionnaire"] }],
    grade: (o) => {
      const c = find(o, "RQ-INSTR-COVERAGE")[0], w = find(o, "RQ-INSTR-WORDING")[0];
      const gap = c ? /lapsed|stopped|why|frequency|visit/i.test(text(c)) : false;
      const leading = w ? /lead|Q4|don.t you agree|best in town/i.test(text(w)) : false;
      return ok(!!c && (c.payload.rating.score ?? 5) <= 3 && gap && leading, `coverage ${c?.payload.rating.score}, gap named ${gap}, leading item flagged ${leading}`);
    },
  },
  {
    id: "RQ04-no-methodology", what: "A readable report with no methodology: selection not documented, Absent, methodology cannot assess (not a concern)", mode: "review_documented", studyType: "unclear",
    purpose: "Decide whether to launch the scheme", sources: [{ file: "report-no-method.txt", roles: ["report"] }],
    grade: (o) => {
      const s = find(o, "RQ-SAMPLE-RECRUIT")[0];
      return ok(!!s && s.payload.assessment.documentation === "not_documented" && s.payload.assessment.methodology === "cannot_assess" && s.payload.rating.score === 0, `documentation ${s?.payload.assessment.documentation}, methodology ${s?.payload.assessment.methodology}, score ${s?.payload.rating.score}`);
    },
  },
  {
    id: "RQ05-plan-vs-fieldwork", what: "Plan says probability sample, fieldwork says opt-in panel: both phases cited, the difference qualifies inference, no claim of misconduct", mode: "review_documented", studyType: "quantitative",
    purpose: "Estimate the share of households that would join", decisions: ["Estimate national demand"], sources: [{ file: "plan-probability.txt", roles: ["proposal"] }, { file: "fieldwork-optin.txt", roles: ["fieldwork"] }],
    grade: (o) => {
      const p = find(o, "RQ-PLAN-EXECUTION")[0];
      const phases = new Set(p?.payload.statements.map((s) => s.phase));
      const fraud = p ? /fraud|misconduct|dishonest|deceiv/i.test(text(p)) : true;
      const fit = p?.payload.assessment.decisionFitness.some((d) => d.state === "qualified" || d.state === "insufficient_basis");
      return ok(!!p && phases.has("planned") && phases.has("reported_executed") && !fraud && !!fit, `phases ${[...phases].join("/")}, misconduct wording ${fraud}, fitness qualified/insufficient ${fit}`);
    },
  },
  {
    id: "RQ06-causal-claim", what: "A one-off observational survey claims the campaign caused loyalty: inference concern and the decision not suitable as documented", mode: "review_documented", studyType: "quantitative",
    purpose: "Decide whether to extend the campaign nationally", decisions: ["Extend the campaign nationally"], sources: [{ file: "report-causal.txt", roles: ["report", "methodology"] }],
    grade: (o) => {
      const i = find(o, "RQ-INFERENCE-SCOPE")[0];
      const fit = i?.payload.assessment.decisionFitness.every((d) => d.state !== "suitable_as_documented");
      return ok(!!i && i.payload.assessment.methodology === "concern" && !!fit && /caus|association|correlat/i.test(text(i)), `methodology ${i?.payload.assessment.methodology}, no suitable fitness ${fit}`);
    },
  },
  {
    id: "RQ07-small-subgroup", what: "A 14-person subgroup drives a launch decision: limited basis explained, no universal sample-size prescription", mode: "review_documented", studyType: "quantitative",
    purpose: "Choose the launch province", decisions: ["Launch first in the Northern Cape"], sources: [{ file: "report-subgroup.txt", roles: ["report", "methodology"] }],
    grade: (o) => {
      const prescriptions = o.filter((x) => NUMBER_PRESCRIPTION.test(`${x.payload.improvement?.currentAction ?? ""} ${x.payload.improvement?.futureAction ?? ""}`));
      const limited = o.some((x) => x.payload.assessment.decisionFitness.some((d) => d.state === "insufficient_basis" || d.state === "qualified") && /14|small|subgroup|Northern Cape/i.test(text(x)));
      return ok(prescriptions.length === 0 && limited, `numeric prescriptions published ${prescriptions.length}, limited basis explained ${limited}`);
    },
  },
  {
    id: "RQ08-qualitative", what: "Purposive interviews: qualitative criteria applied, no survey sample-size or representativeness requirement", mode: "improve_planned", studyType: "qualitative",
    purpose: "Understand why customers lapse", sources: [{ file: "guide-qual.txt", roles: ["discussion_guide", "proposal"] }],
    grade: (o, all) => {
      const qual = all.criteria.find((c) => c.criterionId === "RQ-QUAL-PROCESS")?.status === "selected";
      const surveyRules = o.filter((x) => /representative|statistically significant|margin of error|minimum sample/i.test(`${x.payload.improvement?.currentAction ?? ""} ${x.payload.improvement?.futureAction ?? ""}`));
      return ok(qual && surveyRules.length === 0, `qualitative criteria selected ${qual}, survey-rule improvements ${surveyRules.length}`);
    },
  },
  {
    id: "RQ09-two-reports", what: "Two reports disagree on sample and fieldwork: conflict kept with both sources, no guessed reconciliation", mode: "review_documented", studyType: "quantitative",
    purpose: "Report service satisfaction", sources: [{ file: "report-a-sample.txt", roles: ["report"] }, { file: "report-b-sample.txt", roles: ["report"] }],
    grade: (o) => {
      const a = find(o, "RQ-ALIGN-CONSISTENCY")[0];
      const files = new Set(a?.payload.statements.map((s) => s.sourceVersionId));
      return ok(!!a && (a.payload.assessment.documentation === "conflicting" || /conflict|differ|inconsisten/i.test(text(a))) && files.size >= 2, `documentation ${a?.payload.assessment.documentation}, sources cited ${files.size}`);
    },
  },
  {
    id: "RQ10-clarification", what: "A researcher clarification on recruitment is used and attributed, never quoted as a document", mode: "review_documented", studyType: "qualitative",
    purpose: "Understand cancellation reasons", sources: [{ file: "interviews-two-purposes.txt", roles: ["report", "methodology"] }],
    clarification: "Recruitment: the 12 customers were chosen from all cancellations in September, two per region, not only from the account team's contacts.",
    grade: (o) => {
      const used = o.some((x) => x.payload.clarificationRefs.length > 0);
      const quoted = o.some((x) => x.payload.statements.some((s) => /two per region/i.test(s.exactQuote ?? "")));
      return ok(used && !quoted, `clarification cited ${used}, quoted as document ${quoted}`);
    },
  },
  {
    id: "CTRL-two-purposes", what: "Same interviews, two decisions: exploring reasons can be suitable or qualified; estimating prevalence is insufficient", mode: "review_documented", studyType: "qualitative",
    purpose: "Understand cancellation and size the problem", decisions: ["Understand the reasons customers cancel", "Estimate the percentage of all customers likely to cancel"],
    sources: [{ file: "interviews-two-purposes.txt", roles: ["report", "methodology"] }],
    grade: (o) => {
      const fit = o.flatMap((x) => x.payload.assessment.decisionFitness);
      const explore = fit.filter((d) => d.decisionRef === 0).map((d) => d.state);
      const prevalence = fit.filter((d) => d.decisionRef === 1).map((d) => d.state);
      return ok(explore.some((s) => s !== "insufficient_basis") && prevalence.length > 0 && prevalence.every((s) => s === "insufficient_basis" || s === "qualified") && prevalence.includes("insufficient_basis"), `explore ${[...new Set(explore)].join("/")}, prevalence ${[...new Set(prevalence)].join("/")}`);
    },
  },
  {
    id: "CTRL-standalone-proposal", what: "A proposal with no brief is assessed on its own: no literature review (Absent), restatement standalone, budget and timeline Absent", mode: "improve_planned", studyType: "qualitative",
    purpose: "Improve the store experience", sources: [{ file: "proposal-standalone.txt", roles: ["proposal"] }],
    grade: (o) => {
      const lit = score(o, "RQ-PROP-LITERATURE")[0], tl = score(o, "RQ-PROP-TIMELINE")[0], bu = score(o, "RQ-PROP-BUDGET")[0];
      const standalone = find(o, "RQ-PROP-RESTATEMENT").every((x) => x.payload.comparison === "standalone");
      return ok(lit === 0 && tl === 0 && bu === 0 && standalone, `literature ${lit}, timeline ${tl}, budget ${bu}, standalone ${standalone}`);
    },
  },
];

describe.skipIf(!ENABLED)("research quality review: real-model semantic cases", () => {
  let db: DisposableDb;
  const results: unknown[] = [];
  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query(`insert into tenants (id, name) values ($1, 'RQ model cases')`, [T]);
    process.env.DATABASE_URL = db.url;
    process.env.RESEARCH_QUALITY_REFERENCE_CATALOGUE = "synthetic-test";
    process.env.ANTHROPIC_API_KEY = "local-gateway-only-synthetic-placeholder";
  }, 180000);
  afterAll(async () => {
    const out = path.resolve("e2e-results");
    mkdirSync(out, { recursive: true });
    const summary = { agrees: results.filter((r) => (r as { pass: boolean }).pass).length, disagrees: results.filter((r) => !(r as { pass: boolean }).pass).length };
    writeFileSync(path.join(out, "research-quality-model.json"), JSON.stringify({ finishedAt: new Date().toISOString(), catalogue: "RQR-T1 (synthetic test references)", summary, cases: results }, null, 1));
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  for (const c of CASES) {
    it(c.id, async () => {
      const { prepareReview, runReview } = await import("../researchQualityReview");
      const { loadResearchQualityView } = await import("../researchQualityView");
      const { recordResearcherEntry } = await import("../researchQualityRepository");
      const run = (await db.pool.query(`insert into runs (tenant_id, project_name) values ($1, $2) returning id`, [T, c.id])).rows[0].id as string;
      const sources = [];
      for (const s of c.sources) {
        const p = `${T}/${run}/${Date.now()}-${s.file}`;
        objects.set(p, readFileSync(path.join(FIX, s.file)));
        const id = (await db.pool.query(`insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1,$2,'evidence',$3,$4) returning id`, [T, run, s.file, p])).rows[0].id;
        sources.push({ documentId: id, roles: s.roles as never });
      }
      if (c.clarification) await recordResearcherEntry(T, run, { kind: "clarification", observationId: null, observationVersionId: null, body: c.clarification, expectedRevision: null, idempotencyKey: `clar${Date.now()}`, actor: { userId: null, email: "fixture@example.test" } });
      const started = Date.now();
      const { reviewId } = await prepareReview(T, run, { requestKey: `case${Date.now()}`, mode: c.mode, studyType: c.studyType, purpose: c.purpose, sources, decisions: (c.decisions ?? []).map((text) => ({ decisionId: null, text })), objectives: [] }, { userId: null, email: "fixture@example.test" });
      await runReview(T, run, reviewId);
      const view = await loadResearchQualityView(T, run, reviewId);
      const r = view.review!;
      expect(["complete", "partial"]).toContain(r.state);
      const graded = c.grade(r.observations, { facts: r.facts.length, criteria: r.manifest.criteria });
      results.push({
        id: c.id,
        what: c.what,
        state: r.state,
        pass: graded.pass,
        detail: graded.detail,
        seconds: Math.round((Date.now() - started) / 1000),
        costUsd: r.actualCostUsd,
        facts: r.facts.length,
        failedSteps: (r.coverage.tasks ?? []).filter((t) => t.status !== "succeeded").map((t) => `${t.key}: ${t.error}`),
        scores: r.observations.map((o) => ({ criterion: o.criterionId, score: o.payload.rating.score, documentation: o.payload.assessment.documentation, methodology: o.payload.assessment.methodology, fitness: o.payload.assessment.decisionFitness.map((d) => d.state), notes: o.payload.validationNotes })),
      });
    }, 15 * 60_000);
  }
});
