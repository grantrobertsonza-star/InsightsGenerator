// CE-2 (evidence chain, 26 October 2026): insight generation sees the project's accepted objectives in
// both modes, as context and not a filter. Before, a project with a confirmed decision ("validate") gave
// the insight prompt no objective at all, and one without a decision gave only the free-text objective.
// The actual generator against a real disposable PostgreSQL; the model is the mocked boundary and the
// test reads the system prompt it was sent.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const model = vi.hoisted(() => ({ systems: [] as string[] }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system: string }) => {
        model.systems.push(req.system);
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", input: { insights: [] } }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("CE-2 insight prompts carry the accepted objectives", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic framing')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  const id = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const project = async (entry: "validate" | "generate", decision: string | null, objectives: string[], freeText: string | null) => {
    const run = await id("insert into runs(tenant_id,project_name,entry_point,decision_statement,research_objective) values($1,'R',$2,$3,$4) returning id", [tenant, entry, decision, freeText]);
    for (const o of objectives) await db.pool.query("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'r','researcher_authored','accepted')", [tenant, run, o]);
    const f = await id("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated','Fees are the top reason for leaving','accepted') returning id", [tenant, run]);
    await db.pool.query(
      `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level)
       values ($1, $2, 'robust', 'Matches.', '{}', 'single_pass', 'single_source')`,
      [tenant, f],
    );
    return run;
  };
  const prompt = async (run: string) => {
    model.systems = [];
    // The mocked model returns no insights, which the generator reports as an error: only the prompt it sent is read here.
    await (await import("../insightGenerator")).generateInsights(tenant, run).catch(() => {});
    return model.systems.join("\n");
  };

  it("a project with a confirmed decision gets its accepted objectives, as context", async () => {
    const run = await project("validate", "Whether to cut fees", ["Understand why members leave", "Size switching intent"], null);
    const p = await prompt(run);
    expect(p).toContain("This project's research objectives: (1) Understand why members leave; (2) Size switching intent.");
    expect(p).toContain("not as a filter");
  });

  it("a project with no decision gets the accepted objectives in place of the free text, and the free text when none is accepted", async () => {
    const accepted = await project("generate", null, ["Understand why members leave"], "An older free-text objective");
    const p = await prompt(accepted);
    expect(p).toContain("This project's research objectives: (1) Understand why members leave.");
    expect(p).not.toContain("An older free-text objective");
    const free = await project("generate", null, [], "1. Understand churn\n2. Size intent");
    expect(await prompt(free)).toContain("This project's research objectives: (1) Understand churn; (2) Size intent.");
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-2 insight prompts carry the accepted objectives", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
