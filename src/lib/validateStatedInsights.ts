import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";
import { applyRecordedContradictions, recordContradiction } from "./contradictionDetector";
import { verificationBasisFor, type VerificationBasis } from "./discoveryClassification";

// How many of a claim's evidence pool get shown to the model at once. A
// claim with dozens of theme-matching findings in a large run would blow
// the prompt budget and dilute the judgment if every one of them were
// included; cited findings (the report's own stated support) always make
// the cut first, same-theme findings fill the rest.
const MAX_EVIDENCE_PER_CLAIM = 40;
// How many stated_insight claims get chain-checked in one call to this
// function. Each claim is its own API call (see below), so this just
// bounds how many concurrent calls one refresh makes; anything past the
// cap is picked up on the next trigger.
const MAX_CLAIMS_PER_PASS = 40;
// Claims are checked one per API call, not batched together the way plain
// verdict judgment batches many findings into one prompt: each claim needs
// its own tailored evidence pool, and mixing several claims with several
// evidence lists in a single prompt risks the model attributing evidence
// to the wrong claim. Concurrency is how this stays fast anyway.
const CHAIN_CONCURRENCY = 4;

type StatedInsightClaim = {
  id: string;
  finding_text: string;
  theme: string | null;
  cited_support_finding_ids: unknown;
};

type EvidenceRow = {
  id: string;
  origin: "stated" | "generated" | "coded";
  finding_text: string;
  finding_kind: string | null;
  theme: string | null;
  verdict_tier: "robust" | "use_with_caution" | "not_supported" | "insufficient_information" | null;
};

type ChainVerdictTier = "robust" | "use_with_caution" | "not_supported" | "insufficient_information";

type PreparedVerdict = {
  findingId: string;
  verdictTier: ChainVerdictTier;
  rationale: string;
  statisticalChecks: Record<string, unknown>;
  corroborationLevel: "cross_source_corroborated" | "single_source" | "contradicted";
  dueCare: Record<string, unknown>;
  verificationBasis: VerificationBasis;
  /** Evidence found in direct conflict with the claim (only when the outcome is "contradicted"). */
  contradictedBy: { id: string }[];
};

const TIER_FROM_CHAIN_OUTCOME: Record<string, ChainVerdictTier> = {
  supported: "robust",
  overreach: "use_with_caution",
  contradicted: "not_supported",
  unsupported: "insufficient_information",
};

/**
 * The evidence-chain validator: the stricter, dedicated check for
 * finding_kind = 'stated_insight' claims that verifyFindings.ts
 * deliberately excludes (see the comment there). Where every other stated
 * finding gets a single model pass judging plausibility and internal
 * coherence, a stated insight -- the report's own higher-order claim --
 * gets traced to the specific findings that could actually support it and
 * judged against them directly, per the product's "Validate" path: does
 * this claim the report makes actually hold up against the evidence, not
 * just does it read plausibly.
 *
 * For each stated_insight claim, the evidence pool is the findings the
 * report itself cited as support (captured at extraction time, see
 * extractFindings.ts's supporting_indices) plus other verified findings
 * from the same run sharing its theme, up to a cap. The model is asked to
 * pick one of four outcomes:
 *
 * - supported: the evidence given actually backs the claim as stated.
 * - overreach: real evidence exists, but the claim draws a stronger or
 *   broader conclusion than that evidence actually justifies.
 * - contradicted: something in the evidence conflicts with the claim.
 * - unsupported: nothing in the evidence given addresses the claim either
 *   way.
 *
 * These map onto the exact same verdict_tier vocabulary every other
 * finding uses (robust / use_with_caution / not_supported /
 * insufficient_information) and get written into the same verdicts table,
 * just tagged with verification_method = 'chain_trace' and a due_care
 * payload recording which evidence it actually relied on. Everything
 * downstream (insight eligibility, verdict badges, exports) keeps working
 * unchanged; only the judgment behind a stated insight's verdict is more
 * rigorous.
 *
 * A claim with no evidence available yet in this run (the rest of the
 * documents or data tables haven't been processed/verified yet) is left
 * alone rather than written up as "unsupported": that would be concluding
 * something the run simply hasn't gotten around to checking yet, not a
 * real finding. It picks up a real verdict once real evidence exists and
 * this runs again, the same way the rest of this pipeline self-heals.
 */
export async function validateStatedInsights(tenantId: string, runId: string): Promise<void> {
  const claims = await withTenant(tenantId, async (client) => {
    const result = await client.query<StatedInsightClaim>(
      `select f.id, f.finding_text, f.theme, f.cited_support_finding_ids
       from findings f
       where f.run_id = $1 and f.finding_kind = 'stated_insight' and f.status != 'rejected'
         and not exists (select 1 from verdicts v where v.finding_id = f.id)
       order by f.created_at
       limit $2`,
      [runId, MAX_CLAIMS_PER_PASS]
    );
    return result.rows;
  });

  if (claims.length === 0) return;

  const results = await mapWithConcurrency(claims, CHAIN_CONCURRENCY, async (claim): Promise<PreparedVerdict | null> => {
    try {
      return await chainCheckOneClaim(tenantId, runId, claim);
    } catch (error) {
      // One claim's API hiccup shouldn't take down the whole pass (and
      // mapWithConcurrency's contract requires fn not to throw); leave it
      // unverified so the next refresh retries it, same self-healing
      // pattern as the rest of this pipeline.
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'validate_stated_insight_claim_error', $3)`,
          [
            tenantId,
            runId,
            JSON.stringify({ findingId: claim.id, message: error instanceof Error ? error.message : String(error) }),
          ]
        );
      });
      return null;
    }
  });

  const prepared = results.filter((r): r is PreparedVerdict => r !== null);
  if (prepared.length === 0) return;

  await withTenant(tenantId, async (client) => {
    for (const verdict of prepared) {
      await client.query(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks,
                                verification_method, corroboration_level, due_care, verification_basis)
         values ($1, $2, $3, $4, $5, 'chain_trace', $6, $7, $8)`,
        [
          tenantId,
          verdict.findingId,
          verdict.verdictTier,
          verdict.rationale,
          JSON.stringify(verdict.statisticalChecks),
          verdict.corroborationLevel,
          JSON.stringify(verdict.dueCare),
          verdict.verificationBasis,
        ]
      );
      // A claim the check found in direct conflict with other evidence gets
      // that conflict recorded against each piece of conflicting evidence,
      // so the UI and the report can say what contradicted it, and so the
      // downgrade survives the verdict row being rewritten later.
      for (const contradictor of verdict.contradictedBy) {
        await recordContradiction(client, {
          tenantId,
          runId,
          originalFindingId: verdict.findingId,
          kind: "finding",
          contradictorId: contradictor.id,
          rationale: verdict.rationale,
          detectedBy: "chain_trace",
        });
      }
    }
    // Also re-applies any contradiction recorded earlier (by the synthesis
    // check) to a claim whose verdict was just rewritten.
    await applyRecordedContradictions(client, tenantId, runId);
  });
}

/** The chain check for exactly one stated_insight claim; see doc comment above. */
async function chainCheckOneClaim(
  tenantId: string,
  runId: string,
  claim: StatedInsightClaim
): Promise<PreparedVerdict | null> {
  const citedIds = Array.isArray(claim.cited_support_finding_ids)
    ? claim.cited_support_finding_ids.filter((v): v is string => typeof v === "string")
    : [];

  const evidencePool = await withTenant(tenantId, async (client) => {
    const result = await client.query<EvidenceRow>(
      `select f.id, f.origin, f.finding_text, f.finding_kind, f.theme, v.verdict_tier
       from findings f
       join verdicts v on v.finding_id = f.id
       where f.run_id = $1 and f.finding_kind != 'stated_insight' and f.status != 'rejected'
       order by
         case when f.id = any($2::uuid[]) then 0 else 1 end,
         case when f.theme is not distinct from $3 then 0 else 1 end,
         f.created_at
       limit $4`,
      [runId, citedIds, claim.theme, MAX_EVIDENCE_PER_CLAIM]
    );
    return result.rows;
  });

  // Nothing to check this claim against yet; wait for real evidence rather
  // than concluding "unsupported" prematurely (see doc comment above).
  if (evidencePool.length === 0) return null;

  const evidenceBlock = evidencePool
    .map((row, index) => {
      const citedTag = citedIds.includes(row.id) ? " [CITED BY REPORT]" : "";
      return `${index}.${citedTag} [${row.theme ?? "Uncategorized"} · verdict: ${row.verdict_tier ?? "unverified"}] ${row.finding_text}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    // This is the exact case the user flagged: a chain-trace verdict on
    // the report's own claim should come back the same way whenever this
    // runs against the same evidence, not drift between runs. This used to
    // pin the lowest sampling temperature for that reason; models released
    // after Claude Opus 4.6 (this one included) reject any temperature
    // besides the 1.0 default with a 400, so that's gone and this verdict
    // now carries whatever run-to-run drift the default temperature
    // produces.
    system:
      "A market research report makes an interpretive claim (a 'stated insight'): a higher-order " +
      "statement like ranking what matters most, tying findings together, or declaring what a pattern " +
      "means. Your job is to check that specific claim against a list of other, already-verified " +
      "findings from the same project, not to judge whether the claim merely reads as plausible.\n\n" +
      "Some evidence items are marked [CITED BY REPORT]: the report itself pointed to these as support " +
      "for this claim. The rest are other verified findings from the project that may or may not bear " +
      "on it. Decide one of:\n" +
      "- supported: the evidence given actually backs the claim as stated, at the strength it's stated.\n" +
      "- overreach: real evidence exists and points the right direction, but the claim concludes more " +
      "than that evidence justifies (a broader generalization, a stronger causal claim, a ranking the " +
      "evidence doesn't actually establish).\n" +
      "- contradicted: something in the evidence conflicts with the claim.\n" +
      "- unsupported: nothing in the evidence given actually addresses this claim either way.\n\n" +
      "Give relied_indices: the indices of the evidence items you actually used to reach your judgment " +
      "(can be empty for 'unsupported'). When, and only when, the outcome is 'contradicted', also give " +
      "contradicting_indices: the indices of the evidence items that directly conflict with the claim " +
      "(leave it empty for every other outcome). Give a specific rationale naming what the evidence does or " +
      "doesn't establish, not a restatement of the category definition. Do not treat the claim as " +
      "correct just because it is stated confidently or because the report itself cited support for it; " +
      "cited support still has to actually hold up.",
    tool_choice: { type: "tool", name: "record_chain_verdict" },
    tools: [
      {
        name: "record_chain_verdict",
        description: "Records the evidence-chain judgment for this one stated-insight claim.",
        input_schema: {
          type: "object",
          properties: {
            outcome: { type: "string", enum: ["supported", "overreach", "contradicted", "unsupported"] },
            rationale: { type: "string" },
            relied_indices: { type: "array", items: { type: "integer" } },
            contradicting_indices: { type: "array", items: { type: "integer" } },
          },
          required: ["outcome", "rationale", "relied_indices", "contradicting_indices"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Claim: ${claim.finding_text}\n\nEvidence available:\n${evidenceBlock}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "validate_stated_insight", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;

  const raw = toolUse.input as {
    outcome?: unknown;
    rationale?: unknown;
    relied_indices?: unknown;
    contradicting_indices?: unknown;
  };
  const outcome = typeof raw.outcome === "string" ? raw.outcome : null;
  const rationale = typeof raw.rationale === "string" && raw.rationale.trim() ? raw.rationale.trim() : null;
  if (!outcome || !TIER_FROM_CHAIN_OUTCOME[outcome] || !rationale) return null;

  const reliedIndices = Array.isArray(raw.relied_indices)
    ? raw.relied_indices.filter(
        (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < evidencePool.length
      )
    : [];
  const reliedIds = [...new Set(reliedIndices.map((i) => evidencePool[i].id))];

  // Only a "contradicted" outcome carries conflicting evidence; any
  // contradicting_indices the model volunteers alongside another outcome is
  // ignored rather than trusted, since that combination is incoherent.
  const contradictingIndices =
    outcome === "contradicted" && Array.isArray(raw.contradicting_indices)
      ? raw.contradicting_indices.filter(
          (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < evidencePool.length
        )
      : [];
  const contradictedBy = [...new Set(contradictingIndices.map((i) => evidencePool[i].id))].map((id) => ({ id }));

  const verdictTier = TIER_FROM_CHAIN_OUTCOME[outcome];
  const corroborationLevel: PreparedVerdict["corroborationLevel"] =
    verdictTier === "not_supported" ? "contradicted" : reliedIds.length > 1 ? "cross_source_corroborated" : "single_source";

  return {
    findingId: claim.id,
    verdictTier,
    rationale,
    statisticalChecks: {},
    corroborationLevel,
    dueCare: {
      chain_trace: true,
      evidence_pool_size: evidencePool.length,
      cited_finding_ids: citedIds,
      relied_finding_ids: reliedIds,
      ...(contradictedBy.length > 0 ? { contradicting_finding_ids: contradictedBy.map((c) => c.id) } : {}),
    },
    // data_backed only when the check actually leaned on a computed finding;
    // a chain traced purely against other report claims is still the
    // report's own wording checking itself.
    verificationBasis: verificationBasisFor({
      origin: "stated",
      groundedByComputedFinding: false,
      reliedOnComputedEvidence: [...reliedIds, ...contradictedBy.map((c) => c.id)].some(
        (id) => evidencePool.find((row) => row.id === id)?.origin === "generated"
      ),
    }),
    contradictedBy,
  };
}

/**
 * Safe wrapper for every automatic trigger point, same contract as
 * refreshVerdicts: a failure here (an API hiccup) should never block
 * whatever the researcher actually clicked, so it's logged to trace and
 * swallowed rather than thrown.
 */
export async function refreshStatedInsightValidations(tenantId: string, runId: string): Promise<void> {
  try {
    await validateStatedInsights(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'validate_stated_insights_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}
