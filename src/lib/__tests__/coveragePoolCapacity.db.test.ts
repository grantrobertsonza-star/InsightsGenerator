// B39-F01 (Codex): coverage read the support of the insights it cites on a second connection while
// holding the caller's, so a pool's worth of concurrent reads each held one connection and waited for
// another, and none finished. Through the actual public readers (stage facts, the evidence trail
// action, coverage), against a real disposable PostgreSQL with the application's default pool of 10.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { insertSupportedInsight } from "./helpers/supportedInsight";

vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.setConfig({ testTimeout: 60000 });

/** Resolves with the value, or rejects when it takes longer than `ms`: a wait on itself never resolves. */
const within = <T,>(ms: number, p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms))]);

describe.skipIf(!TEST_DATABASE_URL)("B39-F01 coverage reads never wait on their own pool", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let rec = "";
  let finding = "";
  beforeAll(async () => {
    delete process.env.DB_POOL_MAX;
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants(id,name) values($1,'Pool')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name,research_objective) values($1,'P','Explain churn') returning id", [tenant])).rows[0].id;
    const s = await insertSupportedInsight(db.pool, tenant, run, "Fees drive churn");
    finding = s.findingId;
    const { withTenantRead } = await import("../db");
    const { coverageFingerprint, readCoverageInputs } = await import("../objectiveCoverage");
    const inputs = await withTenantRead(tenant, async (client) => coverageFingerprint(await readCoverageInputs(client, run)));
    const v = (await db.pool.query(
      "insert into objective_validations(tenant_id,run_id,item_kind,item_order,item_text,status,conclusion,synthesized_insight_ids,inputs) values($1,$2,'objective',0,'Explain churn','resolved','Answered.',$3,$4) returning id",
      [tenant, run, [s.insightId], JSON.stringify(inputs)],
    )).rows[0].id;
    await db.pool.query("insert into objective_validation_insights(tenant_id,validation_id,synthesized_insight_id,position) values($1,$2,$3,0)", [tenant, v, s.insightId]);
    rec = (await db.pool.query(
      "insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status) values($1,$2,$3,'Cut fees','Head','n','Q1','m','high','a','b','ai_suggested','accepted') returning id",
      [tenant, run, s.insightId],
    )).rows[0].id;
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  it("a pool's worth of simultaneous stage-facts, trail and coverage reads all finish, with every connection returned", async () => {
    const { pool, withTenantRead } = await import("../db");
    expect(pool.options.max).toBe(10);
    const { loadProjectStageFacts } = await import("../projectStageFacts");
    const { loadEvidenceTrailAction } = await import("../evidenceTrailActions");
    const { loadObjectiveCoverage } = await import("../objectiveCoverage");
    const n = pool.options.max!;
    const work = [
      ...Array.from({ length: n }, () => loadProjectStageFacts(tenant, run)),
      ...Array.from({ length: n }, () => loadEvidenceTrailAction(run, rec)),
      ...Array.from({ length: n }, () => loadObjectiveCoverage(tenant, run)),
      // An unrelated request in the same queue.
      withTenantRead(tenant, async (client) => (await client.query("select 1 as ok")).rows[0].ok),
    ];
    const results = await within(30000, Promise.all(work));
    const coverage = results[2 * n] as Awaited<ReturnType<typeof loadObjectiveCoverage>>;
    expect(coverage.rows[0].support).toMatchObject({ status: "current" });
    expect(results[3 * n]).toBe(1);
    expect(results.slice(n, 2 * n).every((t) => (t as { ok: boolean }).ok)).toBe(true);
    expect({ waiting: pool.waitingCount, busy: pool.totalCount - pool.idleCount }).toEqual({ waiting: 0, busy: 0 });
  });

  it("support that changed is still reported under load, never as current", async () => {
    const { loadObjectiveCoverage } = await import("../objectiveCoverage");
    const { pool } = await import("../db");
    await db.pool.query("update findings set status = 'rejected' where id = $1", [finding]);
    const all = await within(30000, Promise.all(Array.from({ length: 12 }, () => loadObjectiveCoverage(tenant, run))));
    expect(all.every((c) => c.rows[0].support?.status === "invalid")).toBe(true);
    expect({ waiting: pool.waitingCount, busy: pool.totalCount - pool.idleCount }).toEqual({ waiting: 0, busy: 0 });
    await db.pool.query("update findings set status = 'accepted' where id = $1", [finding]);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("B39-F01 coverage reads never wait on their own pool", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
