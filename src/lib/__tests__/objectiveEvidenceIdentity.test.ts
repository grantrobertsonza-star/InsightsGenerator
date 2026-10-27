// OBJ-REV-001 / OBJ-REV-002 (recovered identity overlap) - acceptance tests, Rule B (migration 0095).
//
// Release-baseline row: "Evidence remains attached to objective identity after reorder, edit and
// deletion." Frozen acceptance: "Reorder/delete candidates: evidence stays with original ID or
// becomes visibly orphaned/stale; never attaches to unrelated position."
//
// Mechanism under test: objective_evidence.objective_candidate_id / decision_candidate_id are
// `on delete set null` (migration 0081). Once nulled, rowItemKey() falls back to the positional
// key `pos:<kind>:<item_order>`, which is also the key every CURRENT item gets whenever its kind
// has no accepted candidates (the free-text fallback in loadItems / generateObjectiveValidation).
//
// The A-cases were written first as expected-fail reproductions against the pre-repair code (see
// claude/obj-rev-001-002-identity-fallback-preparation-2026-10-15.md); Rule B switched them to plain
// `it`. Fixture rows default to an UNKNOWN origin (origin_recorded false), matching 0095's
// fail-closed default; a test that needs a known origin says so explicitly.
//
// Actual code exercised: generateObjectiveValidation (objectiveValidator.ts) -> evidenceDigest ->
// listObjectiveEvidence -> fetchObjectiveEvidenceRows -> rollUp (objectiveEvidence.ts), the real
// withTenant (db.ts), and loadObjectiveEvidenceAction (objectiveEvidenceActions.ts). Controlled
// boundaries only: the `pg` driver (a read-only fake answering exactly these SELECTs), the model
// call (captures the prompt, then stops the function before any write), API-usage logging,
// Supabase client construction and Next's revalidatePath.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const TENANT = vi.hoisted(() => {
  const id = "00000000-0000-4000-8000-000000000001";
  process.env.DEFAULT_TENANT_ID = id;
  return id;
});
const RUN = "run-1";

type Row = Record<string, unknown>;
type World = {
  research_objective: string | null;
  decision_statement: string | null;
  objectiveCandidates: { id: string; candidate_text: string; source: string }[];
  decisionCandidates: { id: string; candidate_text: string; source: string }[];
  evidence: Row[];
  results: Row[];
};
let world: World;
let captured: string | null = null;

function fakeClient() {
  return {
    release: () => {},
    query: async (sql: string) => {
      const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint|select set_config)/.test(s)) return { rows: [] };
      if (s.startsWith("select research_objective, decision_statement from runs")) {
        return { rows: [{ research_objective: world.research_objective, decision_statement: world.decision_statement }] };
      }
      if (s.includes("from synthesized_insights si")) {
        return { rows: [{ id: "si-1", headline: "H", observation: "O", tension: "T", implication: "I", confidence_tier: "strong", quality_tier: "qualified" }] };
      }
      if (s.startsWith("select id, candidate_text, source from objective_candidates")) return { rows: world.objectiveCandidates };
      if (s.startsWith("select id, candidate_text, source from decision_candidates")) return { rows: world.decisionCandidates };
      if (s.startsWith("select id, source_filename, ingestion_type from documents")) return { rows: [] };
      if (s.startsWith("select id from objective_evidence where run_id = $1 and excluded = false")) return { rows: world.evidence.filter(e => !e.excluded).map(e => ({id:e.id})) };
      if (s.startsWith("select evidence_id, document_id, had_table, table_id from objective_evidence_results")) return { rows: world.results };
      if (s.startsWith("select id, item_kind, item_order, objective_candidate_id")) return { rows: world.evidence };
      if (s.includes("from objective_evidence_results")) return { rows: world.results };
      if (s.includes("from objective_evidence_generations")) return { rows: [] };
      // CE-6 (migration 0123) is not part of this fixture: its catalogue check finds no plan columns.
      if (s.includes("from information_schema.columns")) return { rows: [{ n: 0 }] };
      throw new Error(`unhandled read-only fake query: ${sql}`);
    },
  };
}

vi.mock("pg", () => ({ Pool: class { async connect() { return fakeClient(); } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => undefined) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "claude-sonnet-5",
  anthropic: {
    messages: {
      create: vi.fn(async (args: { system: string }) => {
        captured = args.system;
        throw new Error("stop after prompt capture");
      }),
    },
  },
}));

function evidence(id: string, kind: "objective" | "decision", order: number, candidateId: string | null, itemText: string, extra: Row = {}): Row {
  return {
    id,
    item_kind: kind,
    item_order: order,
    objective_candidate_id: kind === "objective" ? candidateId : null,
    decision_candidate_id: kind === "decision" ? candidateId : null,
    item_text: itemText,
    question: `Question for ${itemText}`,
    request_text: "",
    supports_if: "",
    against_if: "",
    expectation: null,
    source: "auto",
    excluded: false,
    question_revision: 1,
    origin_candidate_id: null,
    origin_recorded: false,
    ...extra,
  };
}
const TEXT_ORIGIN = { origin_recorded: true, origin_candidate_id: null };
const candidateOrigin = (id: string) => ({ origin_recorded: true, origin_candidate_id: id });
function result(evidenceId: string, marker: string): Row {
  return {
    evidence_id: evidenceId,
    document_id: "d-1",
    dataset_name: "data.sav",
    table_id: "t-1",
    stance: "supports",
    basis: "computed",
    estimate: null,
    summary: marker,
    error: null,
    evaluated_at: "2026-10-15T00:00:00Z",
    had_table: true,
  };
}

/** The validator prompt's item lines: `{ text, evidence }` per listed objective/decision. */
async function validatorItems(): Promise<{ kind: string; text: string; evidence: string }[]> {
  captured = null;
  const { generateObjectiveValidation } = await import("../objectiveValidator");
  await expect(generateObjectiveValidation(TENANT, RUN)).rejects.toThrow("stop after prompt capture");
  const block = captured!.split("Objectives and decisions:\n")[1].split("\n\nAccepted synthesized insights")[0];
  const items: { kind: string; text: string; evidence: string }[] = [];
  for (const line of block.split("\n")) {
    const m = /^\d+\. \[(objective|decision)\] (.*)$/.exec(line);
    if (m) items.push({ kind: m[1], text: m[2], evidence: "" });
    else if (items.length > 0) items[items.length - 1].evidence += line.trim();
  }
  return items;
}

// db.ts caches its Pool on globalThis.pgPool, which survives vi.resetModules. Cleared before each
// test so this file's mocked Pool (bound to this file's fake) is the one db.ts constructs, and after
// the file so no pool bound to this fake leaks into another file sharing the worker thread.
const clearCachedPool = () => {
  delete (globalThis as { pgPool?: unknown }).pgPool;
};
afterAll(clearCachedPool);

beforeEach(() => {
  clearCachedPool();
  vi.resetModules();
  captured = null;
  world = { research_objective: null, decision_statement: null, objectiveCandidates: [], decisionCandidates: [], evidence: [], results: [] };
});

describe("OBJ-REV-001/002 reproduced: a nulled or unlinked row attaches by position to an unrelated objective", () => {
  it("[A1] free-text objectives, first line deleted: the deleted objective's evidence must not attach to the objective now in its position", async () => {
    // Was "1. Price perception / 2. Brand awareness"; Price perception has since been removed.
    world.research_objective = "1. Brand awareness";
    world.evidence = [
      evidence("ev-price", "objective", 0, null, "Price perception", TEXT_ORIGIN),
      evidence("ev-brand", "objective", 1, null, "Brand awareness", { source: "manual", ...TEXT_ORIGIN }),
    ];
    world.results = [result("ev-price", "PRICE-EVIDENCE"), result("ev-brand", "BRAND-EVIDENCE")];
    const items = await validatorItems();
    expect(items).toEqual([expect.objectContaining({ kind: "objective", text: "Brand awareness" })]);
    expect(items[0].evidence).not.toContain("PRICE-EVIDENCE");
  });

  it("[A2] candidate deleted (id nulled by 0081) and the run falls back to free-text objectives: its researcher-edited evidence must not attach to the new first objective", async () => {
    world.research_objective = "1. Loyalty drivers";
    world.evidence = [evidence("ev-orphan", "objective", 0, null, "Price perception", { source: "manual", ...candidateOrigin("cand-price") })];
    world.results = [result("ev-orphan", "ORPHAN-EVIDENCE")];
    const items = await validatorItems();
    expect(items[0].text).toBe("Loyalty drivers");
    expect(items[0].evidence).not.toContain("ORPHAN-EVIDENCE");
  });

  it("[A2-decision] the same for a decision whose candidate was deleted", async () => {
    world.research_objective = "1. Loyalty drivers";
    world.decision_statement = "1. Expand to Gauteng";
    world.evidence = [evidence("ev-dec-orphan", "decision", 0, null, "Cut prices", { source: "manual", ...candidateOrigin("cand-cut") })];
    world.results = [result("ev-dec-orphan", "ORPHAN-DECISION-EVIDENCE")];
    const items = await validatorItems();
    const decision = items.find((i) => i.kind === "decision")!;
    expect(decision.text).toBe("Expand to Gauteng");
    expect(decision.evidence).not.toContain("ORPHAN-DECISION-EVIDENCE");
  });

  it("[A3] rollUp must not merge evidence of two different historical objectives that shared a position", async () => {
    const { rollUp } = await import("../objectiveEvidence");
    const { listObjectiveEvidence } = await import("../objectiveEvidence");
    world.evidence = [
      evidence("ev-deleted", "objective", 0, null, "Price perception", { source: "manual" }),
      evidence("ev-legacy", "objective", 0, null, "A pre-0081 objective"),
    ];
    const groups = rollUp(await listObjectiveEvidence(TENANT, RUN));
    expect(groups.map((g) => g.questions.map((q) => q.id))).toEqual([["ev-deleted"], ["ev-legacy"]]);
  });

  it("[A4] the listing the UI renders marks evidence with no current owner as orphaned (visible), and keeps it", async () => {
    world.objectiveCandidates = [{ id: "cand-Y", candidate_text: "Brand awareness", source: "researcher_authored" }];
    world.evidence = [
      evidence("ev-y", "objective", 0, "cand-Y", "Brand awareness"),
      evidence("ev-orphan", "objective", 0, null, "Price perception", { source: "manual" }),
    ];
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const res = await loadObjectiveEvidenceAction(RUN);
    if (!res.ok) throw new Error(res.error);
    const byText = Object.fromEntries(res.items.map((i) => [i.item_text, i as unknown as Row]));
    expect(byText["Price perception"]).toMatchObject({ orphaned: true });
    expect(byText["Brand awareness"]).toMatchObject({ orphaned: false });
  });
});

describe("OBJ-REV-001/002 behaviour that must be preserved (passes today)", () => {
  it("[P1] linked evidence follows its candidate id across a reorder, never the position it was generated at", async () => {
    // Y was first when its evidence was generated (item_order 0); X has since been added before it.
    world.objectiveCandidates = [
      { id: "cand-X", candidate_text: "Price perception", source: "researcher_authored" },
      { id: "cand-Y", candidate_text: "Brand awareness", source: "researcher_authored" },
    ];
    world.evidence = [evidence("ev-y", "objective", 0, "cand-Y", "Brand awareness", { source: "manual" })];
    world.results = [result("ev-y", "Y-EVIDENCE")];
    const items = await validatorItems();
    expect(items.map((i) => [i.text, i.evidence.includes("Y-EVIDENCE")])).toEqual([
      ["Price perception", false],
      ["Brand awareness", true],
    ]);
  });

  it("[P2] an unchanged free-text run keeps each objective's evidence on that objective (recorded free-text origin)", async () => {
    world.research_objective = "1. Price perception\n2. Brand awareness";
    // Rule B: free-text rows match only with an explicitly recorded free-text origin.
    world.evidence = [
      evidence("ev-0", "objective", 0, null, "Price perception", TEXT_ORIGIN),
      evidence("ev-1", "objective", 1, null, "Brand awareness", TEXT_ORIGIN),
    ];
    world.results = [result("ev-0", "PRICE-EVIDENCE"), result("ev-1", "BRAND-EVIDENCE")];
    const items = await validatorItems();
    expect(items.map((i) => [i.text, i.evidence.includes("PRICE-EVIDENCE"), i.evidence.includes("BRAND-EVIDENCE")])).toEqual([
      ["Price perception", true, false],
      ["Brand awareness", false, true],
    ]);
  });

  it("[P3] researcher-edited and excluded linked questions stay grouped under their own candidate, with wording intact", async () => {
    const { rollUp, listObjectiveEvidence } = await import("../objectiveEvidence");
    world.evidence = [
      // In the real query's order (item_kind desc, item_order, created_at).
      evidence("ev-excl", "objective", 0, "cand-Y", "Brand awareness", { excluded: true }),
      evidence("ev-x", "objective", 0, "cand-X", "Price perception"),
      evidence("ev-edit", "objective", 3, "cand-Y", "Brand awareness", { source: "manual", question: "Researcher wording" }),
    ];
    const groups = rollUp(await listObjectiveEvidence(TENANT, RUN));
    const y = groups.find((g) => g.objective_candidate_id === "cand-Y")!;
    expect(y.questions.map((q) => [q.id, q.question, q.excluded])).toEqual([
      ["ev-excl", "Question for Brand awareness", true],
      ["ev-edit", "Researcher wording", false],
    ]);
    expect(groups).toHaveLength(2);
  });
});

async function listing() {
  const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
  const res = await loadObjectiveEvidenceAction(RUN);
  if (!res.ok) throw new Error(res.error);
  return res;
}

describe("OBJ-REV-001/002 Rule B: ambiguous and missing references never attach", () => {
  for (const kind of ["objective", "decision"] as const) {
    const setText = (text: string) => {
      if (kind === "objective") world.research_objective = text;
      else {
        world.research_objective = "1. Loyalty drivers";
        world.decision_statement = text;
      }
    };

    it(`[A0-${kind}] a deleted candidate's evidence with IDENTICAL wording and position to the new free-text ${kind} stays orphaned`, async () => {
      setText("1. Brand awareness");
      world.evidence = [evidence("ev-del", kind, 0, null, "Brand awareness", { source: "edited", ...candidateOrigin("cand-gone") })];
      world.results = [result("ev-del", "DELETED-CANDIDATE-EVIDENCE")];
      const items = await validatorItems();
      expect(items.find((i) => i.kind === kind)!.evidence).not.toContain("DELETED-CANDIDATE-EVIDENCE");
      vi.resetModules();
      const res = await listing();
      expect(res.items).toEqual([expect.objectContaining({ key: `deleted:${kind}:cand-gone`, identity: "deleted", orphaned: true })]);
    });

    it(`[A0-unknown-${kind}] unknown-origin evidence with IDENTICAL wording and position to the current free-text ${kind} stays orphaned`, async () => {
      setText("1. Brand awareness");
      world.evidence = [evidence("ev-unk", kind, 0, null, "Brand awareness", { source: "manual" })];
      world.results = [result("ev-unk", "UNKNOWN-ORIGIN-EVIDENCE")];
      const items = await validatorItems();
      expect(items.find((i) => i.kind === kind)!.evidence).not.toContain("UNKNOWN-ORIGIN-EVIDENCE");
      vi.resetModules();
      const res = await listing();
      expect(res.items).toEqual([expect.objectContaining({ key: "unknown:ev-unk", identity: "unknown", orphaned: true })]);
    });
  }

  it("[A6] evidence linked to a candidate that exists but is no longer accepted is orphaned and absent from the validator", async () => {
    world.objectiveCandidates = [{ id: "cand-Y", candidate_text: "Brand awareness", source: "researcher_authored" }];
    world.evidence = [
      evidence("ev-rejected", "objective", 0, "cand-R", "Price perception", candidateOrigin("cand-R")),
      evidence("ev-y", "objective", 1, "cand-Y", "Brand awareness", candidateOrigin("cand-Y")),
    ];
    world.results = [result("ev-rejected", "REJECTED-EVIDENCE"), result("ev-y", "Y-EVIDENCE")];
    const items = await validatorItems();
    expect(items.map((i) => [i.text, i.evidence.includes("REJECTED-EVIDENCE"), i.evidence.includes("Y-EVIDENCE")])).toEqual([["Brand awareness", false, true]]);
    vi.resetModules();
    const res = await listing();
    expect(Object.fromEntries(res.items.map((i) => [i.key, [i.identity, i.orphaned]]))).toEqual({
      "id:cand-R": ["linked", true],
      "id:cand-Y": ["linked", false],
    });
  });

  it("[A7] a reordered or reworded free-text line orphans its evidence rather than reassigning it", async () => {
    world.research_objective = "1. Brand awareness levels\n2. Price perception";
    world.evidence = [
      evidence("ev-price", "objective", 0, null, "Price perception", TEXT_ORIGIN), // moved to position 1
      evidence("ev-brand", "objective", 1, null, "Brand awareness", TEXT_ORIGIN), // reworded
    ];
    world.results = [result("ev-price", "PRICE-EVIDENCE"), result("ev-brand", "BRAND-EVIDENCE")];
    const items = await validatorItems();
    expect(items.every((i) => !i.evidence.includes("PRICE-EVIDENCE") && !i.evidence.includes("BRAND-EVIDENCE"))).toBe(true);
    vi.resetModules();
    expect((await listing()).items.every((i) => i.orphaned)).toBe(true);
  });

  it("[A8] a researcher-edited orphan keeps its wording, source and exclusion and is listed (not dropped)", async () => {
    world.objectiveCandidates = [{ id: "cand-Y", candidate_text: "Brand awareness", source: "researcher_authored" }];
    world.evidence = [
      evidence("ev-edited", "objective", 0, null, "Price perception", { source: "edited", question: "Researcher wording", excluded: true, ...candidateOrigin("cand-gone") }),
    ];
    const res = await listing();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ orphaned: true, identity: "deleted" });
    expect(res.items[0].questions[0]).toMatchObject({ question: "Researcher wording", source: "edited", excluded: true, origin_candidate_id: "cand-gone", origin_recorded: true });
  });

  it("[A10] unknown-origin rows sharing text and position keep distinct, stable keys and never merge", async () => {
    world.evidence = [
      evidence("ev-u1", "objective", 0, null, "Same text", { source: "manual" }),
      evidence("ev-u2", "objective", 0, null, "Same text", { source: "manual" }),
    ];
    const first = (await listing()).items.map((i) => i.key);
    vi.resetModules();
    const second = (await listing()).items.map((i) => i.key);
    expect(first).toEqual(["unknown:ev-u1", "unknown:ev-u2"]);
    expect(second).toEqual(first);
  });

  it("[A11] contradictory link/origin data fails closed (orphaned, never matched)", async () => {
    world.objectiveCandidates = [{ id: "cand-Y", candidate_text: "Brand awareness", source: "researcher_authored" }];
    world.evidence = [
      evidence("ev-mismatch", "objective", 0, "cand-Y", "Brand awareness", candidateOrigin("cand-OTHER")),
      evidence("ev-textlinked", "objective", 0, "cand-Y", "Brand awareness", TEXT_ORIGIN),
      evidence("ev-wrongkind", "objective", 0, null, "Brand awareness", { decision_candidate_id: "dec-1", ...TEXT_ORIGIN }),
      evidence("ev-unrecorded-origin", "objective", 0, null, "Brand awareness", { origin_candidate_id: "cand-Y", origin_recorded: false }),
    ];
    world.results = [result("ev-mismatch", "CONFLICT-EVIDENCE")];
    const res = await listing();
    expect(res.items.map((i) => [i.key, i.identity, i.orphaned])).toEqual([
      ["conflict:ev-mismatch", "conflict", true],
      ["conflict:ev-textlinked", "conflict", true],
      ["conflict:ev-wrongkind", "conflict", true],
      ["conflict:ev-unrecorded-origin", "conflict", true],
    ]);
    vi.resetModules();
    const items = await validatorItems();
    expect(items[0].evidence).not.toContain("CONFLICT-EVIDENCE");
  });

  it("[A12] a recorded free-text row matches a long current line by its stored 40-word cap", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const { capWords } = await import("../text");
    world.research_objective = `1. ${long}`;
    world.evidence = [evidence("ev-long", "objective", 0, null, capWords(long, 40), TEXT_ORIGIN)];
    world.results = [result("ev-long", "LONG-EVIDENCE")];
    const items = await validatorItems();
    expect(items[0].evidence).toContain("LONG-EVIDENCE");
  });
});
