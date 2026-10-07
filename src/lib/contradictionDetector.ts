import type { PoolClient } from "pg";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";
import {
  CONTRADICTED_TIER,
  contradictionRationale,
  type ContradictorKind,
  type VerificationBasis,
} from "./discoveryClassification";

// Bounds one pass: each insight is its own call (the model has to hold one
// insight against the whole list of claims, and mixing several insights in
// one prompt invites attributing a conflict to the wrong one), so this caps
// how many calls a single refresh makes. Anything past it is picked up on
// the next refresh, since checked insights are marked and skipped.
const MAX_INSIGHTS_PER_PASS = 30;
const CONTRADICTION_CONCURRENCY = 3;
// How many of the report's own claims one comparison sees. Past this the
// prompt gets long enough that a real conflict is easy to miss, so the
// overflow is recorded in the trace rather than silently ignored.
const MAX_CLAIMS_PER_COMPARISON = 80;

type ClaimRow = { id: string; finding_text: string; theme: string | null };

type SynthesizedToCheck = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
};

/**
 * Forces a contradicted original down to not_supported, whatever it scored
 * before: a claim the Elevator's own evidence conflicts with does not keep a
 * favourable validity rating. Verdicts are one row per finding, so this
 * updates the existing row in place (keeping what it used to say in
 * due_care, so nothing is lost) rather than appending a second row that
 * every verdict join would then double up on. If the finding has no verdict
 * yet, one is written, and verifyFindings skips findings that already have
 * one, so the downgrade is not overwritten later.
 *
 * Idempotent: a verdict already carrying the contradiction marker is left
 * alone.
 */
export async function downgradeContradictedOriginal(
  client: PoolClient,
  args: {
    tenantId: string;
    findingId: string;
    kind: ContradictorKind;
    contradictingText: string;
    detail: string;
    /** Set when the contradictor is itself computed from data; otherwise the verdict keeps its basis. */
    basis?: VerificationBasis;
  },
): Promise<void> {
  const existing = await client.query<{
    id: string;
    verdict_tier: string;
    rationale: string;
    corroboration_level: string;
    due_care: Record<string, unknown> | null;
  }>(
    `select id, verdict_tier, rationale, corroboration_level, due_care
     from verdicts where finding_id = $1 order by created_at desc limit 1`,
    [args.findingId],
  );
  const row = existing.rows[0];

  if (
    row &&
    row.due_care &&
    typeof row.due_care === "object" &&
    "contradiction_downgrade" in row.due_care
  ) {
    return;
  }

  const marker = {
    contradiction_downgrade: {
      previous_tier: row?.verdict_tier ?? null,
      previous_corroboration_level: row?.corroboration_level ?? null,
      contradicted_by: args.kind,
    },
  };

  if (row) {
    await client.query(
      `update verdicts
       set verdict_tier = $2,
           corroboration_level = 'contradicted',
           rationale = $3,
           due_care = coalesce(due_care, '{}'::jsonb) || $4::jsonb,
           verification_basis = coalesce($5, verification_basis)
       where id = $1`,
      [
        row.id,
        CONTRADICTED_TIER,
        contradictionRationale({
          kind: args.kind,
          contradictingText: args.contradictingText,
          detail: args.detail,
          previousRationale: row.rationale,
        }),
        JSON.stringify(marker),
        args.basis ?? null,
      ],
    );
    return;
  }

  await client.query(
    `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks,
                            verification_method, corroboration_level, due_care, verification_basis)
     values ($1, $2, $3, $4, '{}', 'single_pass', 'contradicted', $5, $6)`,
    [
      args.tenantId,
      args.findingId,
      CONTRADICTED_TIER,
      contradictionRationale({
        kind: args.kind,
        contradictingText: args.contradictingText,
        detail: args.detail,
        previousRationale: null,
      }),
      JSON.stringify(marker),
      args.basis ?? "report_only",
    ],
  );
}

/** Writes one contradiction link. Safe to repeat: the unique indexes make a duplicate a no-op. */
export async function recordContradiction(
  client: PoolClient,
  args: {
    tenantId: string;
    runId: string;
    originalFindingId: string;
    kind: ContradictorKind;
    contradictorId: string;
    rationale: string;
    detectedBy: "chain_trace" | "synthesis_check";
  },
): Promise<void> {
  await client.query(
    `insert into finding_contradictions
       (tenant_id, run_id, original_finding_id, contradicting_finding_id,
        contradicting_synthesized_insight_id, rationale, detected_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict do nothing`,
    [
      args.tenantId,
      args.runId,
      args.originalFindingId,
      args.kind === "finding" ? args.contradictorId : null,
      args.kind === "synthesized_insight" ? args.contradictorId : null,
      args.rationale,
      args.detectedBy,
    ],
  );
}

/**
 * Re-applies every recorded contradiction's downgrade for a run. A
 * contradiction is a fact about the evidence, not about one verdict row, so
 * when verdicts are wiped and rewritten (reverifyFindings, or a stated
 * insight re-traced) the downgrade has to follow the link rather than be
 * lost with the row it was first written to.
 */
export async function applyRecordedContradictions(
  client: PoolClient,
  tenantId: string,
  runId: string,
): Promise<void> {
  const links = await client.query<{
    original_finding_id: string;
    rationale: string;
    finding_text: string | null;
    finding_origin: string | null;
    synth_headline: string | null;
  }>(
    `select distinct on (fc.original_finding_id)
            fc.original_finding_id, fc.rationale,
            cf.finding_text, cf.origin as finding_origin,
            si.headline as synth_headline
     from finding_contradictions fc
     left join findings cf on cf.id = fc.contradicting_finding_id
     left join synthesized_insights si on si.id = fc.contradicting_synthesized_insight_id
     where fc.run_id = $1
     order by fc.original_finding_id, fc.created_at`,
    [runId],
  );
  for (const link of links.rows) {
    const isFinding = link.finding_text !== null;
    await downgradeContradictedOriginal(client, {
      tenantId,
      findingId: link.original_finding_id,
      kind: isFinding ? "finding" : "synthesized_insight",
      contradictingText:
        link.finding_text ?? link.synth_headline ?? "a net-new item",
      detail: link.rationale,
      basis:
        isFinding && link.finding_origin === "generated"
          ? "data_backed"
          : undefined,
    });
  }
}

/**
 * Compares each not-yet-checked synthesized insight against the report's
 * own claims and records any direct conflict. A synthesized insight is
 * net-new by definition; one that undercuts what the report said is a
 * correction rather than an addition, so it is linked to the claim it
 * contradicts and that claim is downgraded (see downgradeContradictedOriginal).
 *
 * The bar for "contradicts" is deliberately high: a different scope, an
 * extension, a nuance or a stronger or weaker version of a claim is not a
 * contradiction, and a false flag would wrongly mark down a report's good
 * claim. When the model is unsure it is told not to flag.
 *
 * With no stated or coded claims in the run (a data-only engagement) there
 * is nothing to contradict, so this returns without marking anything
 * checked: if claims arrive later, the insights are still due a comparison.
 */
export async function detectSynthesizedContradictions(
  tenantId: string,
  runId: string,
): Promise<void> {
  const claims = await withTenant(tenantId, async (client) => {
    const result = await client.query<ClaimRow>(
      `select id, finding_text, theme
       from findings
       where run_id = $1
         and origin in ('stated', 'coded')
         and status != 'rejected'
         and coalesce(finding_kind, '') != 'external_citation'
       order by created_at
       limit $2`,
      [runId, MAX_CLAIMS_PER_COMPARISON + 1],
    );
    return result.rows;
  });
  if (claims.length === 0) return;

  const truncated = claims.length > MAX_CLAIMS_PER_COMPARISON;
  const claimPool = claims.slice(0, MAX_CLAIMS_PER_COMPARISON);

  const toCheck = await withTenant(tenantId, async (client) => {
    const result = await client.query<SynthesizedToCheck>(
      `select id, headline, observation, tension, implication
       from synthesized_insights
       where run_id = $1 and review_status != 'rejected' and contradiction_checked_at is null
       order by created_at
       limit $2`,
      [runId, MAX_INSIGHTS_PER_PASS],
    );
    return result.rows;
  });
  if (toCheck.length === 0) return;

  const claimsBlock = claimPool
    .map(
      (c, index) =>
        `${index}. [${c.theme ?? "Uncategorized"}] ${c.finding_text}`,
    )
    .join("\n");

  type Outcome = {
    insight: SynthesizedToCheck;
    checked: boolean;
    contradictedIndices: number[];
    detail: string;
  };

  const outcomes = await mapWithConcurrency(
    toCheck,
    CONTRADICTION_CONCURRENCY,
    async (insight): Promise<Outcome> => {
      try {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system:
            "A research pipeline derived one insight from a client's data and findings. Separately, the " +
            "client's own report made the numbered claims below. Decide whether the insight DIRECTLY " +
            "CONTRADICTS any of those claims: the insight asserts something that cannot be true if the claim " +
            "is true.\n\n" +
            "These are NOT contradictions: a different scope or segment, an extension or added nuance, a " +
            "stronger or weaker version of the same claim, a different topic, or the insight simply saying " +
            "more than the claim did. A false flag wrongly marks down a good claim, so when you are unsure, " +
            "do not flag it.\n\n" +
            "Return contradicted_indices (empty if none) and, if any, one sentence in detail naming the " +
            "specific conflict. Leave detail empty when there is none.",
          tool_choice: { type: "tool", name: "record_contradictions" },
          tools: [
            {
              name: "record_contradictions",
              description:
                "Records which of the report's claims, if any, the insight directly contradicts.",
              input_schema: {
                type: "object",
                properties: {
                  contradicted_indices: {
                    type: "array",
                    items: { type: "integer" },
                  },
                  detail: { type: "string" },
                },
                required: ["contradicted_indices", "detail"],
              },
            },
          ],
          messages: [
            {
              role: "user",
              content:
                `Insight: ${insight.headline}\nObservation: ${insight.observation}\n` +
                `Tension: ${insight.tension}\nImplication: ${insight.implication}\n\n` +
                `The report's claims:\n${claimsBlock}`,
            },
          ],
        });
        await logApiUsage(
          tenantId,
          runId,
          "contradiction_check",
          response.usage,
        );

        const toolUse = response.content.find(
          (block) => block.type === "tool_use",
        );
        if (!toolUse || toolUse.type !== "tool_use") {
          return {
            insight,
            checked: false,
            contradictedIndices: [],
            detail: "",
          };
        }
        const raw = toolUse.input as {
          contradicted_indices?: unknown;
          detail?: unknown;
        };
        const indices = Array.isArray(raw.contradicted_indices)
          ? [
              ...new Set(
                raw.contradicted_indices.filter(
                  (v): v is number =>
                    typeof v === "number" &&
                    Number.isInteger(v) &&
                    v >= 0 &&
                    v < claimPool.length,
                ),
              ),
            ]
          : [];
        const detail = typeof raw.detail === "string" ? raw.detail.trim() : "";
        return { insight, checked: true, contradictedIndices: indices, detail };
      } catch {
        // Left unchecked so the next refresh retries it.
        return { insight, checked: false, contradictedIndices: [], detail: "" };
      }
    },
  );

  await withTenant(tenantId, async (client) => {
    let contradictionCount = 0;
    for (const outcome of outcomes) {
      if (!outcome.checked) continue;
      for (const index of outcome.contradictedIndices) {
        const claim = claimPool[index];
        const detail =
          outcome.detail ||
          "The insight's conclusion conflicts with this claim.";
        await recordContradiction(client, {
          tenantId,
          runId,
          originalFindingId: claim.id,
          kind: "synthesized_insight",
          contradictorId: outcome.insight.id,
          rationale: detail,
          detectedBy: "synthesis_check",
        });
        await downgradeContradictedOriginal(client, {
          tenantId,
          findingId: claim.id,
          kind: "synthesized_insight",
          contradictingText: outcome.insight.headline,
          detail,
        });
        contradictionCount++;
      }
      await client.query(
        `update synthesized_insights set contradiction_checked_at = now() where id = $1`,
        [outcome.insight.id],
      );
    }
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'contradiction_check_summary', $3)`,
      [
        tenantId,
        runId,
        JSON.stringify({
          insights_checked: outcomes.filter((o) => o.checked).length,
          insights_unchecked: outcomes.filter((o) => !o.checked).length,
          contradictions_recorded: contradictionCount,
          claims_compared: claimPool.length,
          claim_pool_truncated: truncated,
        }),
      ],
    );
  });
}

/**
 * Safe wrapper for the automatic trigger points, same contract as
 * refreshVerdicts: a failure here is logged to trace and swallowed, never
 * allowed to block whatever the researcher actually clicked.
 */
export async function refreshContradictions(
  tenantId: string,
  runId: string,
): Promise<void> {
  try {
    await detectSynthesizedContradictions(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'contradiction_check_error', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
          }),
        ],
      );
    }).catch(() => {});
  }
}
