import { describe, it, expect, vi } from "vitest";

// The detector module imports the Anthropic client and the pooled database
// connection at the top level. Neither is exercised here (these tests hand
// it a fake client), so both are stubbed rather than constructed for real.
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../db", () => ({ withTenant: vi.fn() }));

import {
  downgradeContradictedOriginal,
  recordContradiction,
} from "../contradictionDetector";

type Call = { sql: string; params: unknown[] };

function fakeClient(existingVerdict: Record<string, unknown> | null) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("from verdicts where finding_id")) {
        return { rows: existingVerdict ? [existingVerdict] : [] };
      }
      return { rows: [] };
    },
  };
  return { client: client as never, calls };
}

const baseArgs = {
  tenantId: "tenant-1",
  findingId: "finding-1",
  kind: "finding" as const,
  contradictingText: "Usage fell 12% among 18-24s.",
  detail: "The report claimed growth in every segment.",
};

describe("downgradeContradictedOriginal", () => {
  it("forces an existing favourable verdict down to not_supported, in place, whatever it was before", async () => {
    const { client, calls } = fakeClient({
      id: "verdict-1",
      verdict_tier: "robust",
      rationale: "Looked coherent.",
      corroboration_level: "single_source",
      due_care: {},
    });
    await downgradeContradictedOriginal(client, baseArgs);

    const update = calls.find((c) =>
      c.sql.trim().startsWith("update verdicts"),
    );
    expect(update).toBeDefined();
    // Updated in place (one row per finding), not appended as a second row.
    expect(calls.some((c) => c.sql.includes("insert into verdicts"))).toBe(
      false,
    );
    expect(update!.params[0]).toBe("verdict-1");
    expect(update!.params[1]).toBe("not_supported");
    expect(String(update!.params[2])).toContain(
      "Contradicted by a net-new finding",
    );
    expect(String(update!.params[2])).toContain("Looked coherent.");
    // What it used to say is kept, not lost.
    const marker = JSON.parse(String(update!.params[3]));
    expect(marker.contradiction_downgrade.previous_tier).toBe("robust");
  });

  it("downgrades even a claim that was only 'use with caution'", async () => {
    const { client, calls } = fakeClient({
      id: "verdict-2",
      verdict_tier: "use_with_caution",
      rationale: "Mild caveat.",
      corroboration_level: "cross_source_corroborated",
      due_care: {},
    });
    await downgradeContradictedOriginal(client, baseArgs);
    const update = calls.find((c) =>
      c.sql.trim().startsWith("update verdicts"),
    );
    expect(update!.params[1]).toBe("not_supported");
  });

  it("writes a not_supported verdict when the claim has none yet, so later verification cannot overwrite it", async () => {
    const { client, calls } = fakeClient(null);
    await downgradeContradictedOriginal(client, baseArgs);

    const insert = calls.find((c) => c.sql.includes("insert into verdicts"));
    expect(insert).toBeDefined();
    expect(insert!.params[2]).toBe("not_supported");
    expect(calls.some((c) => c.sql.trim().startsWith("update verdicts"))).toBe(
      false,
    );
  });

  it("is idempotent: a verdict already carrying the contradiction marker is left alone", async () => {
    const { client, calls } = fakeClient({
      id: "verdict-3",
      verdict_tier: "not_supported",
      rationale: "Already downgraded.",
      corroboration_level: "contradicted",
      due_care: { contradiction_downgrade: { previous_tier: "robust" } },
    });
    await downgradeContradictedOriginal(client, baseArgs);
    expect(calls.some((c) => c.sql.trim().startsWith("update verdicts"))).toBe(
      false,
    );
    expect(calls.some((c) => c.sql.includes("insert into verdicts"))).toBe(
      false,
    );
  });

  it("marks the verdict data-backed only when the contradictor is itself computed from data", async () => {
    const withBasis = fakeClient({
      id: "v",
      verdict_tier: "robust",
      rationale: "x",
      corroboration_level: "single_source",
      due_care: {},
    });
    await downgradeContradictedOriginal(withBasis.client, {
      ...baseArgs,
      basis: "data_backed",
    });
    expect(
      withBasis.calls.find((c) => c.sql.trim().startsWith("update verdicts"))!
        .params[4],
    ).toBe("data_backed");

    const withoutBasis = fakeClient({
      id: "v",
      verdict_tier: "robust",
      rationale: "x",
      corroboration_level: "single_source",
      due_care: {},
    });
    await downgradeContradictedOriginal(withoutBasis.client, baseArgs);
    // null means "keep whatever basis the verdict already had".
    expect(
      withoutBasis.calls.find((c) =>
        c.sql.trim().startsWith("update verdicts"),
      )!.params[4],
    ).toBeNull();
  });
});

describe("recordContradiction", () => {
  it("links a net-new finding as the contradictor", async () => {
    const { client, calls } = fakeClient(null);
    await recordContradiction(client, {
      tenantId: "t",
      runId: "r",
      originalFindingId: "orig",
      kind: "finding",
      contradictorId: "contra",
      rationale: "because",
      detectedBy: "chain_trace",
    });
    const insert = calls[0];
    expect(insert.sql).toContain("on conflict do nothing");
    expect(insert.params).toEqual([
      "t",
      "r",
      "orig",
      "contra",
      null,
      "because",
      "chain_trace",
    ]);
  });

  it("links a synthesized insight as the contradictor, in its own column", async () => {
    const { client, calls } = fakeClient(null);
    await recordContradiction(client, {
      tenantId: "t",
      runId: "r",
      originalFindingId: "orig",
      kind: "synthesized_insight",
      contradictorId: "insight-9",
      rationale: "because",
      detectedBy: "synthesis_check",
    });
    expect(calls[0].params).toEqual([
      "t",
      "r",
      "orig",
      null,
      "insight-9",
      "because",
      "synthesis_check",
    ]);
  });
});
