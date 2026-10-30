// Model usage outside projects (migration 0109, tenant_api_usage), against a real disposable
// PostgreSQL: a recorded call is summed for the last 30 days with its cache tokens and cost; older
// rows and another organisation's rows are left out (the read is tenant scoped); a failed write is
// logged with its figures rather than lost silently; a database without the table says it needs the
// migration rather than showing no usage.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("usage outside projects (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const other = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    await db.pool.query("insert into tenants(id,name) values($1,'Usage'),($2,'Other')", [tenant, other]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("records calls and sums the last 30 days for this organisation only, with cache tokens and cost", async () => {
    const { logTenantApiUsage, loadTenantUsageOutsideProjects, costOfUsage } = await import("../apiUsage");
    await logTenantApiUsage(tenant, "general_assistant", { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 });
    await logTenantApiUsage(tenant, "general_assistant", { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 1000 });
    await logTenantApiUsage(other, "general_assistant", { input_tokens: 9999, output_tokens: 9999 });
    await logTenantApiUsage(tenant, "general_assistant", { input_tokens: 7777, output_tokens: 7777 });
    await db.pool.query("update tenant_api_usage set created_at = now() - interval '40 days' where input_tokens = 7777");
    const r = await loadTenantUsageOutsideProjects(tenant);
    expect(r).toEqual({
      ok: true,
      summary: { calls: 2, inputTokens: 150, outputTokens: 30, cacheWriteTokens: 1000, cacheReadTokens: 1000, costUsd: costOfUsage({ input: 150, output: 30, cacheWrite: 1000, cacheRead: 1000 }) },
    });
    // Reference: (150 + 1000 * 1.25 + 1000 * 0.1) * $2 / 1M = $0.0030, plus 30 * $10 / 1M = $0.0003: $0.0033.
    expect((r as { summary: { costUsd: number } }).summary.costUsd).toBeCloseTo(0.0033, 6);
  });

  it("a failed write is logged with its figures; a missing table is a migration message, not zero usage", async () => {
    const { logTenantApiUsage, loadTenantUsageOutsideProjects } = await import("../apiUsage");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await db.pool.query("alter table tenant_api_usage rename to tenant_api_usage_away");
    try {
      await logTenantApiUsage(tenant, "general_assistant", { input_tokens: 5, output_tokens: 1 });
      const logged = JSON.parse(String(info.mock.calls[0][0]));
      expect(logged).toMatchObject({ event: "api_usage_not_recorded", agent: "general_assistant", tenant_id: tenant, input_tokens: 5, output_tokens: 1 });
      expect(await loadTenantUsageOutsideProjects(tenant)).toEqual({ ok: false, error: "This needs migration 0109 applied first." });
    } finally {
      await db.pool.query("alter table tenant_api_usage_away rename to tenant_api_usage");
      info.mockRestore();
    }
    expect((await loadTenantUsageOutsideProjects(tenant)).ok).toBe(true);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("usage outside projects (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
