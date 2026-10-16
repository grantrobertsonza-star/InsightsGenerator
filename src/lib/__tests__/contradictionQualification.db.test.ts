// Golden-thread repair (verdict grounding), against a REAL PostgreSQL built from the migrations.
// The actual downgradeContradictedOriginal / applyRecordedContradictions run on a real verdicts
// table. Rule under test (generic, not tied to any dataset): a synthesized insight is derived from
// the run's own findings, so it cannot overturn a verdict already reached against computed data
// (verification_basis 'data_backed'); it qualifies it. Report-only verdicts, and contradictions by
// a FINDING, still downgrade. A data-backed verdict wrongly downgraded earlier is restored.
// Reproduction this generalises: a stated "NPS is 25" matching the computed 25 (interval
// 14.4-35.6) was downgraded to not_supported because an insight called the figure uncertain.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../db", () => ({ withTenant: vi.fn() }));

type Verdict = { verdict_tier: string; corroboration_level: string; rationale: string; due_care: Record<string, unknown> };

describe.skipIf(!TEST_DATABASE_URL)("contradiction vs data-backed verdicts (real database)", () => {
  let db: DisposableDb;
  let tenant = "";
  let run = "";
  const one = async (sql: string, params: unknown[]) => (await db.pool.query(sql, params)).rows[0].id as string;

  beforeAll(async () => {
    db = await createDisposableDb();
    tenant = await one(`insert into tenants (name) values ('T') returning id`, []);
    run = await one(`insert into runs (tenant_id) values ($1) returning id`, [tenant]);
  }, 120000);
  afterAll(async () => {
    await db?.drop();
  });

  const finding = (origin: string, text: string) =>
    one(
      `insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, $3, $4, 'accepted') returning id`,
      [tenant, run, origin, text],
    );
  const verdict = async (findingId: string, tier: string, basis: string, extra: { corroboration?: string; dueCare?: object; rationale?: string } = {}) =>
    db.pool.query(
      `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method,
                             corroboration_level, due_care, verification_basis)
       values ($1, $2, $3, $4, '{}', 'single_pass', $5, $6, $7)`,
      [tenant, findingId, tier, extra.rationale ?? "Matches the computed value.", extra.corroboration ?? "cross_source_corroborated", JSON.stringify(extra.dueCare ?? {}), basis],
    );
  const read = async (findingId: string) =>
    (await db.pool.query<Verdict>(`select verdict_tier, corroboration_level, rationale, due_care from verdicts where finding_id = $1`, [findingId])).rows;

  const caution = {
    kind: "synthesized_insight" as const,
    contradictingText: "A single reading is being echoed as if it were two confirming data points",
    detail: "The insight says the figure is uncertain (wide interval) and should not be treated as a precise benchmark.",
  };

  it("a data-backed robust verdict keeps its tier and gains a visible qualification; repeating changes nothing", async () => {
    const { downgradeContradictedOriginal } = await import("../contradictionDetector");
    const id = await finding("stated", "Overall score is 25.");
    await verdict(id, "robust", "data_backed");
    const client = await db.pool.connect();
    try {
      await downgradeContradictedOriginal(client, { tenantId: tenant, findingId: id, ...caution });
      await downgradeContradictedOriginal(client, { tenantId: tenant, findingId: id, ...caution });
    } finally {
      client.release();
    }
    const rows = await read(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict_tier).toBe("robust");
    expect(rows[0].corroboration_level).toBe("cross_source_corroborated");
    expect(rows[0].rationale).toContain("Qualified by a synthesized insight");
    expect(rows[0].rationale.match(/Qualified by a synthesized insight/g)).toHaveLength(1);
    expect(rows[0].due_care).toHaveProperty("synthesized_qualification");
  });

  it("a report-only verdict is still downgraded by a synthesized insight (existing behaviour)", async () => {
    const { downgradeContradictedOriginal } = await import("../contradictionDetector");
    const id = await finding("stated", "Satisfaction averages 4.2.");
    await verdict(id, "robust", "report_only");
    const client = await db.pool.connect();
    try {
      await downgradeContradictedOriginal(client, { tenantId: tenant, findingId: id, ...caution });
    } finally {
      client.release();
    }
    expect((await read(id))[0]).toMatchObject({ verdict_tier: "not_supported", corroboration_level: "contradicted" });
  });

  it("a computed FINDING still downgrades a data-backed verdict (a real conflict in the data)", async () => {
    const { downgradeContradictedOriginal } = await import("../contradictionDetector");
    const id = await finding("stated", "Purchase is 70%.");
    await verdict(id, "robust", "data_backed");
    const client = await db.pool.connect();
    try {
      await downgradeContradictedOriginal(client, {
        tenantId: tenant,
        findingId: id,
        kind: "finding",
        contradictingText: "Purchase is 50% (base 200)",
        detail: "Different value for the same measure.",
        basis: "data_backed",
      });
    } finally {
      client.release();
    }
    expect((await read(id))[0].verdict_tier).toBe("not_supported");
  });

  it("re-applying recorded contradictions restores a data-backed verdict an earlier version wrongly downgraded", async () => {
    const { applyRecordedContradictions } = await import("../contradictionDetector");
    const id = await finding("stated", "Overall score is 25 (legacy).");
    await verdict(id, "not_supported", "data_backed", {
      corroboration: "contradicted",
      rationale: 'Contradicted by a net-new synthesized insight: "x". y (Earlier assessment: Matches the computed value.)',
      dueCare: { contradiction_downgrade: { previous_tier: "robust", previous_corroboration_level: "cross_source_corroborated", contradicted_by: "synthesized_insight" } },
    });
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication) values ($1, $2, $3, 'o', 't', 'i') returning id`,
      [tenant, run, caution.contradictingText],
    );
    await db.pool.query(
      `insert into finding_contradictions (tenant_id, run_id, original_finding_id, contradicting_synthesized_insight_id, rationale, detected_by)
       values ($1, $2, $3, $4, $5, 'synthesis_check')`,
      [tenant, run, id, si, caution.detail],
    );
    const client = await db.pool.connect();
    try {
      await applyRecordedContradictions(client, tenant, run);
      await applyRecordedContradictions(client, tenant, run);
    } finally {
      client.release();
    }
    const [v] = await read(id);
    expect(v.verdict_tier).toBe("robust");
    expect(v.corroboration_level).toBe("cross_source_corroborated");
    expect(v.rationale.startsWith("Matches the computed value.")).toBe(true);
    expect(v.rationale).toContain("Qualified by a synthesized insight");
    expect(v.due_care).toHaveProperty("reverted_contradiction_downgrade");
    expect(v.due_care).not.toHaveProperty("contradiction_downgrade");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("contradiction vs data-backed verdicts (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
