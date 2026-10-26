import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: async () => ({ content: [{ type: "tool_use", input: { validations: state.rows } }], usage: {} }) } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("objective validation index persistence", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const role = `ie_audit_${randomUUID().replaceAll("-", "")}`;
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic index controls')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,research_objective) values($1,$2) returning id", [tenant, "1. First objective\n2. Second objective"])).rows[0].id;
    await db.pool.query("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,'Synthetic','Observed','Uncertain','Review','accepted')", [tenant, run]);
    await db.pool.query(`create role ${role} login nosuperuser nobypassrls; grant usage on schema public to ${role}; grant select on runs,synthesized_insights,objective_candidates,decision_candidates,objective_evidence,objective_evidence_results,document_tables,objective_evidence_generations to ${role}; grant select,insert,update,delete on objective_validations to ${role}; grant usage,select on all sequences in schema public to ${role}`);
    const url = new URL(db.url); url.username = role; url.password = ""; process.env.DATABASE_URL = url.toString();
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); const admin = new Client({connectionString:TEST_DATABASE_URL}); await admin.connect(); try { await admin.query(`drop role ${role}`); } finally { await admin.end(); } });
  const item = (index: number, conclusion = `Conclusion ${index}`) => ({ item_index: index, status: "resolved", conclusion, insight_indices: [0] });
  const saved = async () => (await db.pool.query("select item_order,item_text,conclusion from objective_validations where run_id=$1 order by item_order", [run])).rows;
  it("valid coverage attaches by integral index; malformed incomplete retries preserve the prior durable batch", async () => {
    const { generateObjectiveValidation } = await import("../objectiveValidator");
    state.rows = [item(1), item(0)];
    await generateObjectiveValidation(tenant, run);
    const before = await saved();
    expect(before.map(r => r.conclusion)).toEqual(["Conclusion 0", "Conclusion 1"]);
    for (const rows of [[item(0.5), item(1.5)], [item(0), item(0)], [item(0)], [item(0), item(2)]]) {
      state.rows = rows;
      await expect(generateObjectiveValidation(tenant, run)).rejects.toThrow();
      expect(await saved()).toEqual(before);
    }
    state.rows = [item(0), item(1), item(99), item(-1)];
    await generateObjectiveValidation(tenant, run);
    expect(await saved()).toEqual(before);
  });
  it("real nonowner evidence retrieval failure persists degraded qualification and recovers without duplicate validations", async () => {
    const { generateObjectiveValidation } = await import("../objectiveValidator");
    const { withTenantRead } = await import("../db");
    const reload = () => withTenantRead(tenant, async client => (await client.query("select evidence_digest_degraded from objective_validations where run_id=$1",[run])).rows);
    state.rows = [item(0), item(1)];
    await db.pool.query(`revoke select on objective_evidence from ${role}`);
    await generateObjectiveValidation(tenant,run);
    expect(await reload()).toMatchObject([{evidence_digest_degraded:true},{evidence_digest_degraded:true}]);
    expect((await db.pool.query("select evidence_digest_degraded from objective_validations where run_id=$1",[run])).rows).toEqual([{evidence_digest_degraded:true},{evidence_digest_degraded:true}]);
    await db.pool.query(`grant select on objective_evidence to ${role}`);
    await generateObjectiveValidation(tenant,run);
    expect(await reload()).toMatchObject([{evidence_digest_degraded:false},{evidence_digest_degraded:false}]);
    expect(await saved()).toHaveLength(2);
  });
  it("removing the actual accepted-insight prerequisite clears obsolete coverage", async () => {
    await db.pool.query("update synthesized_insights set review_status='rejected' where run_id=$1", [run]);
    const { generateObjectiveValidation } = await import("../objectiveValidator");
    await expect(generateObjectiveValidation(tenant, run)).rejects.toThrow("No accepted synthesized insights");
    expect(await saved()).toEqual([]);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("objective validation index persistence", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
