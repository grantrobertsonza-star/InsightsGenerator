// OBJ-REV-005: a saved objective conclusion that drew on direct data evidence carries the
// multiple-questions qualification in its own text, so it survives outside the evidence panel (the
// objectives slide and report print the saved conclusion). A conclusion with no direct evidence is
// unchanged. Real disposable PostgreSQL through generateObjectiveValidation; the model answer and
// the evidence digest (whose own retrieval is covered in objectiveValidationIndices.db.test.ts) are
// controlled.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], withEvidence: "First objective" }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: async () => ({ content: [{ type: "tool_use", input: { validations: state.rows } }], usage: {} }) } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../objectiveEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../objectiveEvidence")>();
  // Direct evidence exists for exactly one current item, identified by its real key.
  class OneItemDigest extends Map<string, string> {
    has(key: string) { return key.toLowerCase().includes(state.withEvidence.toLowerCase()); }
    get(key: string) { return this.has(key) ? "Direct data evidence (supports): Purchase -> supports: Yes: Male 60% vs Female 40%" : undefined; }
  }
  return { ...actual, evidenceDigest: vi.fn(async () => ({ items: new OneItemDigest(), degraded: false })) };
});

describe.skipIf(!TEST_DATABASE_URL)("objective conclusion multiplicity qualification (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic qualification')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,research_objective) values($1,$2) returning id", [tenant, "1. First objective\n2. Second objective"])).rows[0].id;
    await db.pool.query("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,'Synthetic','Observed','Uncertain','Review','accepted')", [tenant, run]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });

  it("only the evidence-backed conclusion carries the note, after the word cap, and it survives regeneration", async () => {
    const { generateObjectiveValidation, DIRECT_EVIDENCE_MULTIPLICITY_NOTE } = await import("../objectiveValidator");
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    state.rows = [
      { item_index: 0, status: "resolved", conclusion: long, insight_indices: [0] },
      { item_index: 1, status: "partial", conclusion: "No direct evidence here", insight_indices: [0] },
    ];
    for (let pass = 0; pass < 2; pass++) {
      await generateObjectiveValidation(tenant, run);
      const saved = (await db.pool.query("select item_text,conclusion from objective_validations where run_id=$1 order by item_order", [run])).rows;
      expect(saved).toHaveLength(2);
      const [withEvidence, without] = saved;
      expect(withEvidence.item_text).toContain("First objective");
      expect(withEvidence.conclusion.endsWith(DIRECT_EVIDENCE_MULTIPLICITY_NOTE)).toBe(true);
      expect(withEvidence.conclusion.split(DIRECT_EVIDENCE_MULTIPLICITY_NOTE)).toHaveLength(2);
      expect(without.conclusion).toBe("No direct evidence here");
    }
    expect(DIRECT_EVIDENCE_MULTIPLICITY_NOTE).toMatch(/not corrected for the number of questions/);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("objective conclusion multiplicity qualification (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
