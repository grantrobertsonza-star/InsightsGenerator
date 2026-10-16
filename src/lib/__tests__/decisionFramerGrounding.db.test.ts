// Golden-thread repair (evidence synthesis grounding): the actual generateDecisionCandidates, run
// against a REAL PostgreSQL through the app's own db.ts (DATABASE_URL pointed at a disposable
// database), with only the model mocked. Generic rule: every finding reaches the model with its
// LATEST verification status, and a claim verified as not supported is labelled as a claim, not
// evidence; the shared no-invented-explanations rule is in the prompt.
// Reproduction this generalises: a report average (4.2) found not supported next to the computed
// 3.5 was summarised as "scores conflict", which the narrative then explained as different scales.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const SENTINEL = "model call captured";
const captured = vi.hoisted(() => ({ requests: [] as { system: string; messages: { content: string }[] }[] }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: async (request: { system: string; messages: { content: string }[] }) => {
        captured.requests.push(request);
        throw new Error(SENTINEL);
      },
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("decision framer evidence grounding (real database)", () => {
  let db: DisposableDb;
  let tenant = "";
  let run = "";

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url; // db.ts reads this when first imported below
    const one = async (sql: string, params: unknown[]) => (await db.pool.query(sql, params)).rows[0].id as string;
    tenant = await one(`insert into tenants (name) values ('T') returning id`, []);
    run = await one(
      `insert into runs (tenant_id, entry_point, business_problem) values ($1, 'validate', 'Decide where to invest') returning id`,
      [tenant],
    );
    const finding = (origin: string, text: string) =>
      one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, $3, $4, 'accepted', 'Satisfaction') returning id`, [
        tenant,
        run,
        origin,
        text,
      ]);
    const verdict = (findingId: string, tier: string, basis: string, at: string) =>
      db.pool.query(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method,
                               corroboration_level, due_care, verification_basis, created_at)
         values ($1, $2, $3, 'r', '{}', 'single_pass', 'single_source', '{}', $4, $5)`,
        [tenant, findingId, tier, basis, at],
      );
    await finding("generated", "Mean satisfaction is 3.5 (base 200).");
    const claim = await finding("stated", "Average satisfaction is 4.2.");
    await verdict(claim, "robust", "report_only", "2026-01-01T00:00:00Z"); // superseded
    await verdict(claim, "not_supported", "data_backed", "2026-01-02T00:00:00Z"); // latest
    const ok = await finding("stated", "Overall score is 25.");
    await verdict(ok, "robust", "data_backed", "2026-01-02T00:00:00Z");
    await finding("stated", "Advertising caused growth.");
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("labels each finding with its latest verification status and carries the grounding rule", async () => {
    const { generateDecisionCandidates } = await import("../decisionFramer");
    const { NO_INVENTED_EXPLANATIONS_RULE } = await import("../groundingRules");
    await expect(generateDecisionCandidates(tenant, run)).rejects.toThrow(SENTINEL);

    const [request] = captured.requests;
    const evidence = request.messages[0].content;
    expect(evidence).toContain("Mean satisfaction is 3.5 (base 200). [computed from the data]");
    expect(evidence).toContain("Average satisfaction is 4.2. [NOT SUPPORTED by verification: a claim, not evidence]");
    expect(evidence).toContain("Overall score is 25. [verified against the computed data]");
    expect(evidence).toContain("Advertising caused growth. [not yet verified]");
    expect(request.system).toContain(NO_INVENTED_EXPLANATIONS_RULE);
    expect(request.system).toMatch(/A finding marked NOT SUPPORTED is a claim the data did not bear out/);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("decision framer evidence grounding (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
