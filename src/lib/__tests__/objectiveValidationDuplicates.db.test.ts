// OBJ-REV-008: two assessments for the same objective in one model answer. Identical repeats are
// harmless and kept once; conflicting repeats cannot say which answer belongs to the item, so the
// whole answer is refused and the previous durable batch is kept (as for omitted or fractional
// indices). Real disposable PostgreSQL through generateObjectiveValidation; the model is controlled.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: async () => ({ content: [{ type: "tool_use", input: { validations: state.rows } }], usage: {} }) } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("objective validation duplicate indices (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic duplicates')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,research_objective) values($1,$2) returning id", [tenant, "1. First objective\n2. Second objective"])).rows[0].id;
    await db.pool.query("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,'Synthetic','Observed','Uncertain','Review','accepted')", [tenant, run]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  const item = (index: number, conclusion: string, status = "resolved") => ({ item_index: index, status, conclusion, insight_indices: [0] });
  const saved = async () => (await db.pool.query("select item_order,status,conclusion from objective_validations where run_id=$1 order by item_order", [run])).rows;

  it("conflicting repeats for one item are refused and keep the prior batch; identical repeats are kept once", async () => {
    const { generateObjectiveValidation } = await import("../objectiveValidator");
    state.rows = [item(0, "Prior 0"), item(1, "Prior 1")];
    await generateObjectiveValidation(tenant, run);
    const before = await saved();

    for (const rows of [
      [item(0, "Answer A"), item(0, "Answer B"), item(1, "Answer 1")],
      [item(0, "Same words", "resolved"), item(0, "Same words", "partial"), item(1, "Answer 1")],
    ]) {
      state.rows = rows;
      await expect(generateObjectiveValidation(tenant, run)).rejects.toThrow(/more than one assessment/);
      expect(await saved()).toEqual(before);
    }

    state.rows = [item(0, "Repeated identically"), item(0, "Repeated identically"), item(1, "Answer 1")];
    await generateObjectiveValidation(tenant, run);
    expect((await saved()).map((r) => r.conclusion)).toEqual(["Repeated identically", "Answer 1"]);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("objective validation duplicate indices (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
