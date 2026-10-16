// FND-001 against a REAL PostgreSQL (disposable database from supabase/migrations), through the
// app's own db.ts. Closes integration checks the mocked loader test could not: the SQL fingerprint
// function finding_support_parts() (0096), real in-place edits, real rejection and REAL cascade
// deletion of a supporting finding. Only the per-data-file settings lookups are not exercised (no
// calculated tables in this fixture; they are covered with controlled lookups in supportStatus.test.ts).
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("support status on a real database (FND-001)", () => {
  let db: DisposableDb;
  let tenant = "";
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;

  /** Drafts an insight from findings the way insightSynthesizer persists it (snapshot per link). */
  async function draft(texts: string[]): Promise<{ insight: string; findings: string[] }> {
    const findings: string[] = [];
    const pres: string[] = [];
    for (const text of texts) {
      const f = await one(
        `insert into findings (tenant_id, run_id, origin, finding_text, status, stated_stats) values ($1, $2, 'stated', $3, 'accepted', '{"value": 50}') returning id`,
        [tenant, run, text],
      );
      findings.push(f);
      pres.push(
        await one(
          `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`,
          [tenant, run, f],
        ),
      );
    }
    const insight = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count)
       values ($1, $2, $3, 'o', 't', 'i', $4, 1) returning id`,
      [tenant, run, `Insight from ${texts.join(" + ")}`, texts.length],
    );
    for (let i = 0; i < pres.length; i++) {
      await db.pool.query(
        `insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot)
         values ($1, $2, $3, finding_support_parts($4))`,
        [tenant, insight, pres[i], findings[i]],
      );
    }
    return { insight, findings };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    tenant = await one(`insert into tenants (name) values ('T') returning id`, []);
    run = await one(`insert into runs (tenant_id) values ($1) returning id`, [tenant]);
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  const statusOf = async (insight: string) => {
    const { loadInsightSupport } = await import("../supportStatus");
    return (await loadInsightSupport(tenant, run, [insight])).statusOf(insight);
  };

  it("untouched support is current", async () => {
    const { insight } = await draft(["A1", "A2"]);
    expect((await statusOf(insight)).status).toBe("current");
  });

  it("an in-place wording edit or figures rewrite (same finding id) is changed, naming the field", async () => {
    const w = await draft(["B1", "B2"]);
    await db.pool.query(`update findings set finding_text = 'B1 reworded' where id = $1`, [w.findings[0]]);
    const ws = await statusOf(w.insight);
    expect(ws.status).toBe("stale");
    expect(ws.reasons.map((r) => r.kind)).toContain("wording");

    const f = await draft(["C1", "C2"]);
    await db.pool.query(`update findings set stated_stats = '{"value": 70}' where id = $1`, [f.findings[1]]);
    expect((await statusOf(f.insight)).reasons.map((r) => r.kind)).toContain("figures");
  });

  it("a rejected source is no longer valid", async () => {
    const r = await draft(["D1", "D2"]);
    await db.pool.query(`update findings set status = 'rejected' where id = $1`, [r.findings[0]]);
    const s = await statusOf(r.insight);
    expect(s.status).toBe("invalid");
    expect(s.reasons.map((x) => x.kind)).toContain("rejected");
  });

  it("a deleted source (real cascade) is no longer valid, and the insight itself survives with its wording", async () => {
    const d = await draft(["E1", "E2"]);
    await db.pool.query(`delete from findings where id = $1`, [d.findings[0]]);
    const s = await statusOf(d.insight);
    expect(s.status).toBe("invalid");
    expect(s.reasons.map((x) => x.kind)).toContain("source_missing");
    const kept = await db.pool.query(`select headline from synthesized_insights where id = $1`, [d.insight]);
    expect(kept.rows[0].headline).toBe("Insight from E1 + E2");

    const all = await draft(["F1"]);
    await db.pool.query(`delete from findings where id = $1`, [all.findings[0]]);
    const none = await statusOf(all.insight);
    expect(none.status).toBe("invalid");
    expect(none.reasons.map((x) => x.kind)).toContain("no_sources");
  });

  it("the check never writes", async () => {
    const before = await db.pool.query(`select (select count(*) from synthesized_insights) a, (select count(*) from synthesized_insight_sources) b, (select count(*) from findings) c`);
    const { loadInsightSupport } = await import("../supportStatus");
    await loadInsightSupport(tenant, run);
    const after = await db.pool.query(`select (select count(*) from synthesized_insights) a, (select count(*) from synthesized_insight_sources) b, (select count(*) from findings) c`);
    expect(after.rows).toEqual(before.rows);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("support status on a real database (FND-001)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
