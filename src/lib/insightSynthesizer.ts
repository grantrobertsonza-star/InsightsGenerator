import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";

// Same ceiling as generateInsights' MAX_FINDINGS_FOR_INSIGHT: the pool of
// pre-insights this pass can see at once, kept to one model call's worth
// of context rather than chunked, because clustering needs every eligible
// pre-insight in view together, chunking it would make cross-theme
// triangulation impossible to see. Also the ceiling checkRunStability
// applies to its resampled pool, for the same reason: clusterPreInsights
// itself enforces no limit of its own, it trusts whichever caller builds
// its input to have already sized it to one call's worth of context.
const MAX_PRE_INSIGHTS_FOR_SYNTHESIS = 60;
// A cluster with only one member isn't triangulated against anything, so
// it doesn't get promoted this pass; its pre-insight just stays visible as
// a pre-insight, nothing is lost or deleted. Exported because a
// triangulation_count sitting right at this floor is one dropped finding
// away from losing its evidentiary basis -- the UI uses it to flag an
// insight as "thin evidence" (see SynthesizedInsightsReview.tsx), the
// first, free tier of a reproducibility check per Simoudis (2015): the
// second, more expensive tier re-runs synthesis on resamples of the
// accepted findings pool and checks whether the same insight survives.
export const MIN_CLUSTER_SIZE = 2;
const REFRAME_CONCURRENCY = 3;

// Tier-two reproducibility check constants (checkRunStability, below).
// clusterPreInsights is one call that groups a whole pool at once, so a
// resample tests every currently accepted insight simultaneously; the
// cost is a flat STABILITY_RESAMPLE_COUNT calls regardless of how many
// insights exist, not something that scales per insight.
const STABILITY_RESAMPLE_COUNT = 5;
// How much of the pool each resample randomly drops before re-clustering.
const STABILITY_DROP_FRACTION = 0.25;
// How much of an original insight's *surviving* membership (after a
// resample's drop) has to land together in one resampled cluster to count
// as "the same insight reappeared." Against surviving membership, not the
// original full membership, since a dropped member was never going to
// reappear anywhere regardless of how stable the insight is.
const STABILITY_OVERLAP_THRESHOLD = 0.5;

type EligiblePreInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  theme: string | null;
};

type RunFraming = {
  entry_point: "generate" | "validate" | null;
  decision_statement: string | null;
  research_objective: string | null;
  business_problem: string | null;
};

type Cluster = { label: string; members: EligiblePreInsight[] };

type SynthesizedCandidate = {
  cluster: Cluster;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  actionPlanStatus: "has_action" | "retained_no_action";
  materialityRationale: string;
  passesValidityGate: boolean;
  gateFailureReason: string | null;
};

// Distinguishes "the model's response couldn't be parsed into a candidate
// at all" from "it parsed fine and passed/failed the validity gate" --
// collapsing these into a single null, as the previous version did, is
// exactly what made the ~80% drop rate on the thesis run invisible: every
// unparseable response looked identical to a legitimate gate rejection.
type ReframeOutcome =
  | { ok: true; candidate: SynthesizedCandidate }
  | { ok: false; reason: string };

/**
 * The funnel that turns the existing one-per-finding pre-insights (written
 * by insightGenerator.ts, kept exactly as-is, chain-of-evidence visible to
 * the researcher) into a small number of genuine, decision-ready insights.
 *
 * This exists because a 1:1 finding-to-insight ratio produces a data dump,
 * not a story: 90 findings in, 75 "insights" out, none of which required
 * the system to actually generalize across anything. The literature this
 * design is built on (DVL Smith's triangulation-before-promotion, NN/g
 * affinity diagramming, the consulting-synthesis materiality test, and
 * Simoudis 2015's definition of insight as a relation *selected* from a
 * larger set) converges on the same shape: cluster first, require more
 * than one source to agree before trusting a pattern, then reinterpret the
 * cluster around the tension underneath it, a step clustering alone never
 * does on its own.
 *
 * Three stages, two model calls:
 *
 * 1. Cluster (one call, no decision framing). Pre-insights are grouped
 *    the way affinity diagramming groups sticky notes: purely by whether
 *    their content shares an underlying pattern, same-theme repetition
 *    counts as real evidence here, not a weaker case. Decision/objective
 *    relevance deliberately does NOT gate this step: an earlier version
 *    folded "only cluster what bears on the decision" into this prompt to
 *    save a call, and on real data (a stats-heavy validate-mode run) that
 *    collapsed clustering to zero three times running, the model read
 *    relevance as an exclusion filter and excluded almost everything
 *    before it ever got to grouping. Relevance belongs downstream, in the
 *    materiality check below, not here.
 *
 * 2. Reframe and gate (one call per cluster, run in parallel, decision
 *    framing lives here instead). Each cluster of two or more pre-insights
 *    gets reinterpreted around its underlying tension or motivation, not
 *    just summarized, then checked against the six-point validity gate
 *    (evidence-grounded, non-obvious, names a tension, feels true,
 *    actionable, communicable) plus the consulting-synthesis materiality
 *    test (would the decision change if this went away). A cluster that
 *    fails the gate is simply not promoted; its pre-insights stay visible,
 *    nothing is deleted. DVL Smith's decision-anchoring and the "exit ramp
 *    for rejection" both live here now, as a post-clustering filter rather
 *    than a pre-clustering one.
 *
 * 3. Persist (deterministic, no model call). triangulation_count and
 *    source_theme_count are counted in code, not asserted by the model,
 *    same "model frames, application computes" principle the verdict and
 *    quality-scoring code already follows. confidence_tier is derived from
 *    those two counts. Every synthesized insight is linked back to its
 *    member pre-insights in synthesized_insight_sources, so the full chain
 *    (finding -> pre-insight -> synthesized insight) stays queryable.
 *
 * Eligibility is "not yet used in any synthesized insight" (checked
 * against synthesized_insight_sources), the same incremental pattern
 * generateInsights uses against the insights table. That means a pass run
 * after new pre-insights arrive only clusters the new ones, it can't
 * retroactively join a new pre-insight into an already-promoted cluster;
 * acceptable for now, and simpler and safer than recomputing (and
 * cascading away) recommendations already built on an earlier synthesis
 * pass.
 */
export async function synthesizeInsights(tenantId: string, runId: string): Promise<void> {
  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query<RunFraming>(
      "select entry_point, decision_statement, research_objective, business_problem from runs where id = $1",
      [runId]
    );
    return result.rows[0];
  });
  if (!run) return;

  if (run.entry_point === "validate" && !run.decision_statement) {
    // Same reasoning as generateInsights: nothing to anchor synthesis
    // against yet for a validate-mode run until a decision is confirmed.
    return;
  }

  // Counted separately from the capped query below so a run whose pool
  // exceeds MAX_PRE_INSIGHTS_FOR_SYNTHESIS can be told apart, in the trace
  // log, from one that genuinely only had a small pool to begin with: the
  // capped query alone can't distinguish "60 pre-insights total" from
  // "200 pre-insights, only the first 60 considered this pass."
  const totalEligibleCount = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count
       from insights i
       where i.run_id = $1
         and not exists (
           select 1 from synthesized_insight_sources s where s.pre_insight_id = i.id
         )`,
      [runId]
    );
    return Number(result.rows[0]?.count ?? "0");
  });

  const eligible = await withTenant(tenantId, async (client) => {
    const result = await client.query<EligiblePreInsight>(
      `select i.id, i.headline, i.observation, i.tension, i.implication, f.theme
       from insights i
       join findings f on f.id = i.finding_id
       where i.run_id = $1
         and not exists (
           select 1 from synthesized_insight_sources s where s.pre_insight_id = i.id
         )
       order by f.theme nulls last, i.created_at
       limit $2`,
      [runId, MAX_PRE_INSIGHTS_FOR_SYNTHESIS]
    );
    return result.rows;
  });

  if (eligible.length < MIN_CLUSTER_SIZE) return;

  const framingBlock =
    run.entry_point === "validate"
      ? `This project's confirmed decision(s): "${run.decision_statement}". Favor clusters that bear on ` +
        "these decision(s), but relevance is a tiebreaker, not a strict filter: a pre-insight that clusters " +
        "well with others but whose decision-relevance is unclear can still be grouped, the researcher " +
        "reviews what comes out of this, don't pre-reject it here.\n\n"
      : [
          run.business_problem ? `Business problem: "${run.business_problem}"` : null,
          run.research_objective ? `Research objective: "${run.research_objective}"` : null,
          "No decision exists yet for this project. Favor clusters that bear on the problem/objective " +
            "above (or, if neither was given, on what a stakeholder in this space would plausibly act on), " +
            "but relevance is a tiebreaker, not a strict filter: don't pre-reject a pre-insight from " +
            "clustering just because its relevance isn't obvious, the researcher reviews what comes out " +
            "of this.",
        ]
          .filter(Boolean)
          .join("\n") + "\n\n";

  const clusters = await clusterPreInsights(tenantId, runId, eligible);

  // Visible record of what this pass actually did with the pool, since
  // nothing else persists it: eligible.length is always <=
  // MAX_PRE_INSIGHTS_FOR_SYNTHESIS (the query above caps it), so comparing
  // it against totalEligibleCount shows whether this pass saw the whole
  // pool or only a slice of it. clusters.length vs the raw cluster count
  // the model proposed shows how many were dropped for being too small
  // after de-dup; outcomes below shows what happened to every cluster that
  // did survive that filter.
  if (clusters.length === 0) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_synthesizer_summary', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({
            total_eligible: totalEligibleCount,
            considered_this_pass: eligible.length,
            clusters_formed: 0,
            note: "The model found no cluster of 2+ corroborating pre-insights worth forming from this batch.",
          }),
        ]
      );
    });
    return;
  }

  const outcomes = await mapWithConcurrency(clusters, REFRAME_CONCURRENCY, async (cluster): Promise<ReframeOutcome> => {
    // mapWithConcurrency requires fn not to throw (see its own doc comment):
    // an uncaught error here would abort every other cluster's Promise.all,
    // including ones already in flight. reframeAndGateCluster only turns its
    // own soft-failure cases (no tool_use, missing fields) into ReframeOutcome;
    // an actual thrown error from callReframe's Anthropic API call (rate
    // limit, network error) would otherwise propagate uncaught. This wraps it
    // the same way the other three mapWithConcurrency call sites were fixed.
    try {
      return await reframeAndGateCluster(tenantId, runId, cluster, framingBlock);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

  await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_synthesizer_summary', $3)`,
      [
        tenantId,
        runId,
        JSON.stringify({
          total_eligible: totalEligibleCount,
          considered_this_pass: eligible.length,
          clusters_formed: clusters.length,
          outcomes: clusters.map((cluster, index) => {
            const outcome = outcomes[index];
            if (!outcome.ok) {
              return {
                label: cluster.label,
                member_count: cluster.members.length,
                outcome: "dropped_unusable_response",
                detail: outcome.reason,
              };
            }
            return {
              label: cluster.label,
              member_count: cluster.members.length,
              headline: outcome.candidate.headline,
              outcome: outcome.candidate.passesValidityGate ? "persisted" : "gate_failed",
              gate_failure_reason: outcome.candidate.gateFailureReason,
              materiality_rationale: outcome.candidate.materialityRationale,
            };
          }),
        }),
      ]
    );
  });

  const toPersist = outcomes
    .filter((o): o is Extract<ReframeOutcome, { ok: true }> => o.ok)
    .map((o) => o.candidate)
    .filter((c) => c.passesValidityGate);
  if (toPersist.length === 0) return;

  await withTenant(tenantId, async (client) => {
    for (const candidate of toPersist) {
      const themes = new Set(candidate.cluster.members.map((m) => m.theme).filter((t): t is string => !!t));
      const triangulationCount = candidate.cluster.members.length;
      const sourceThemeCount = themes.size;
      const confidenceTier =
        sourceThemeCount >= 2 && triangulationCount >= 3
          ? "strong"
          : sourceThemeCount >= 2 || triangulationCount >= 3
            ? "moderate"
            : "exploratory";

      const inserted = await client.query<{ id: string }>(
        `insert into synthesized_insights
           (tenant_id, run_id, decision_context, headline, observation, tension, implication,
            action_plan_status, triangulation_count, source_theme_count, materiality_rationale, confidence_tier)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          tenantId,
          runId,
          run.decision_statement,
          candidate.headline,
          candidate.observation,
          candidate.tension,
          candidate.implication,
          candidate.actionPlanStatus,
          triangulationCount,
          sourceThemeCount,
          candidate.materialityRationale,
          confidenceTier,
        ]
      );
      const synthesizedInsightId = inserted.rows[0].id;
      for (const member of candidate.cluster.members) {
        await client.query(
          `insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id)
           values ($1, $2, $3)
           on conflict do nothing`,
          [tenantId, synthesizedInsightId, member.id]
        );
      }
    }
  });
}

/**
 * The model's tool-call response for record_clusters sometimes returns the
 * `clusters` field as a JSON-encoded string (occasionally a string that
 * itself wraps another `{ clusters: [...] }` object) instead of a native
 * array, even though the tool schema declares it as an array. This parses
 * whatever shape comes back, unwrapping one level of string-encoding and one
 * level of nested { clusters: [...] } if present, and falls back to an empty
 * array rather than throwing if the payload can't be made sense of.
 */
function extractRawClusters(input: unknown): Record<string, unknown>[] {
  if (!input || typeof input !== "object") return [];
  let value: unknown = (input as { clusters?: unknown }).clusters;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (Array.isArray(value)) {
      return value as Record<string, unknown>[];
    }
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return [];
      }
      continue;
    }
    if (value && typeof value === "object" && "clusters" in (value as Record<string, unknown>)) {
      value = (value as { clusters?: unknown }).clusters;
      continue;
    }
    break;
  }

  return [];
}

async function clusterPreInsights(
  tenantId: string,
  runId: string,
  eligible: EligiblePreInsight[]
): Promise<Cluster[]> {
  const listBlock = eligible
    .map(
      (p, index) =>
        `${index}. [${p.theme ?? "Uncategorized"}] ${p.headline}\n` +
        `   Observation: ${p.observation}\n   Tension: ${p.tension}\n   Implication: ${p.implication}`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    // This is a classification judgment (which pre-insights belong
    // together), not creative writing, and used to run at the lowest
    // sampling temperature for that reason, to keep re-running synthesis on
    // the same unprocessed pool as close to reproducible as possible.
    // Models released after Claude Opus 4.6, this one included, reject any
    // temperature other than the API default (1.0) with a 400, so that
    // lever is gone; whatever run-to-run drift this introduces on a
    // judgment task is no longer something this call can damp down, which
    // is exactly why checkRunStability's resampled reproducibility check
    // below exists as a second, direct check on top of this.
    system:
      "You group pre-insights from a market research project into thematic clusters, the way affinity " +
      "diagramming groups sticky notes: items that share an underlying pattern, reason, or behavior go " +
      "together, whether or not they come from the same theme or question area, same-theme corroboration " +
      "is still real evidence, don't discount it. A cluster needs at least 2 members that genuinely " +
      "corroborate or sharpen each other, not just mention the same topic in passing.\n\n" +
      "Calibration: for a list of this size, finding zero or one cluster almost always means you were too " +
      "cautious, not that the data genuinely doesn't group. Look again, more generously, before concluding " +
      "nothing clusters; most pre-insight lists this size contain several real patterns once you allow " +
      "same-theme members to count. It's fine to leave individual outliers uncategorized, an uncategorized " +
      "pre-insight is not an error, it stays visible on its own, but across a list this size most " +
      "pre-insights should end up in some cluster, not the exception.\n\n" +
      "Cluster purely on whether the content shares a pattern, not on whether it looks decision-relevant; " +
      "relevance is judged later, after clustering, not here, so don't let that question hold a cluster " +
      "back.\n\n" +
      "Give each cluster a short label naming the pattern, not just a topic word.",
    tool_choice: { type: "tool", name: "record_clusters" },
    tools: [
      {
        name: "record_clusters",
        description: "Records the thematic clusters formed from the pre-insight list.",
        input_schema: {
          type: "object",
          properties: {
            clusters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  member_indices: { type: "array", items: { type: "integer" } },
                },
                required: ["label", "member_indices"],
              },
            },
          },
          required: ["clusters"],
        },
      },
    ],
    messages: [{ role: "user", content: `Here are the pre-insights:\n\n${listBlock}` }],
  });

  await logApiUsage(tenantId, runId, "insight_synthesizer_cluster", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  const rawClusters = extractRawClusters(toolUse && toolUse.type === "tool_use" ? toolUse.input : null);

  const claimed = new Set<number>();
  const clusters: Cluster[] = [];
  for (const raw of rawClusters) {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const indices = Array.isArray(raw.member_indices) ? raw.member_indices : [];
    if (!label) continue;
    const members: EligiblePreInsight[] = [];
    for (const index of indices) {
      if (typeof index !== "number" || index < 0 || index >= eligible.length) continue;
      // A pre-insight the model put in two clusters only counts for the
      // first; defensive, since the schema doesn't itself forbid overlap.
      if (claimed.has(index)) continue;
      claimed.add(index);
      members.push(eligible[index]);
    }
    if (members.length >= MIN_CLUSTER_SIZE) {
      clusters.push({ label, members });
    }
  }

  return clusters;
}

/**
 * One attempt at the reframe-and-gate call, isolated so reframeAndGateCluster
 * can retry it. retryNote is appended to the system prompt only on a second
 * attempt, after a first attempt left a required field empty: on real
 * data, a cluster about the report's own evidentiary quality (an overreach
 * or a self-check, rather than a substantive finding) sometimes gets a
 * perfectly good headline/observation/tension back but an empty
 * `implication`, as if the model didn't see what "a consequence" means for
 * a cluster about the report's rigor rather than about DFS usage itself.
 * Stronger prompt wording alone didn't fix this on a one-shot call (same
 * two cluster types failed identically even after the wording was added),
 * so this is a second, pointed attempt rather than hoping wording alone
 * holds across every call.
 */
async function callReframe(
  tenantId: string,
  runId: string,
  cluster: Cluster,
  framingBlock: string,
  retryNote: string | null
): Promise<{
  stopReason: string | null;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  actionPlanStatus: "has_action" | "retained_no_action";
  materialityRationale: string;
  passesValidityGate: boolean;
  gateFailureReason: string | null;
  hadToolUse: boolean;
}> {
  const membersBlock = cluster.members
    .map(
      (m, index) =>
        `${index}. [${m.theme ?? "Uncategorized"}] ${m.headline}\n` +
        `   Observation: ${m.observation}\n   Tension: ${m.tension}\n   Implication: ${m.implication}`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    // Same reasoning as the clustering call above: passes_validity_gate is
    // a verdict, not a creative choice, and used to be pinned to the lowest
    // sampling temperature for repeatability. CLAUDE_MODEL now rejects any
    // temperature but the 1.0 default (see the clustering call's comment),
    // so this runs at whatever residual non-determinism that default
    // carries.
    system:
      (retryNote ? retryNote + "\n\n" : "") +
      `You are reinterpreting a cluster of corroborating pre-insights, labeled "${cluster.label}", into one ` +
      "real insight. Clustering only organizes these pre-insights, it does not by itself explain why they " +
      "co-occur, that is your job here: name the underlying tension or motivation that connects them, don't " +
      "just summarize or concatenate what they each already say.\n\n" +
      framingBlock +
      "Write:\n" +
      "- headline: a short, specific statement of the insight.\n" +
      "- observation: what the cluster as a whole actually shows, stated plainly.\n" +
      "- tension: the underlying tension or motivation connecting the members, the thing clustering alone " +
      "doesn't surface.\n" +
      "- implication: what follows from this, as a consequence. Never leave this blank: if the " +
      "cluster is about a substantive finding, say what changes because of it; if it is instead about " +
      "the report's own evidentiary or methodological quality (an overreach, a self-check, an " +
      "unverified assumption), the implication is what that means for how much the report's other " +
      "claims can be trusted, state that instead of leaving the field empty.\n" +
      "- action_plan_status: 'has_action' if a concrete next step follows from this insight, or " +
      "'retained_no_action' if the insight is genuine and well-evidenced but no sensible action can be " +
      "hypothesized from it yet, in which case it should still be kept rather than discarded.\n" +
      "- materiality_rationale: one sentence on whether the decision or recommendation would actually " +
      "change if this insight turned out to be wrong, the test consulting synthesis calls materiality.\n" +
      "- passes_validity_gate: true only if the insight is evidence-grounded, non-obvious (not a 'duh test' " +
      "platitude), genuinely names a tension rather than just restating a fact, feels recognizably true, is " +
      "actionable or explicitly retained-no-action, and is communicable in one or two sentences. If it " +
      "fails any of these, set this false and say which in gate_failure_reason.",
    tool_choice: { type: "tool", name: "record_synthesized_insight" },
    tools: [
      {
        name: "record_synthesized_insight",
        description: "Records the reframed, gated insight for this cluster.",
        input_schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            observation: { type: "string" },
            tension: { type: "string" },
            implication: { type: "string" },
            action_plan_status: { type: "string", enum: ["has_action", "retained_no_action"] },
            materiality_rationale: { type: "string" },
            passes_validity_gate: { type: "boolean" },
            gate_failure_reason: { type: "string" },
          },
          required: [
            "headline",
            "observation",
            "tension",
            "implication",
            "action_plan_status",
            "materiality_rationale",
            "passes_validity_gate",
          ],
        },
      },
    ],
    messages: [{ role: "user", content: `Here are the cluster's members:\n\n${membersBlock}` }],
  });

  await logApiUsage(tenantId, runId, "insight_synthesizer_reframe", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  const raw = toolUse && toolUse.type === "tool_use" ? (toolUse.input as Record<string, unknown>) : null;

  return {
    stopReason: response.stop_reason ?? null,
    hadToolUse: raw !== null,
    headline: raw && typeof raw.headline === "string" ? raw.headline.trim() : "",
    observation: raw && typeof raw.observation === "string" ? raw.observation.trim() : "",
    tension: raw && typeof raw.tension === "string" ? raw.tension.trim() : "",
    implication: raw && typeof raw.implication === "string" ? raw.implication.trim() : "",
    actionPlanStatus: raw?.action_plan_status === "retained_no_action" ? "retained_no_action" : "has_action",
    materialityRationale:
      raw && typeof raw.materiality_rationale === "string" ? raw.materiality_rationale.trim() : "",
    passesValidityGate: raw?.passes_validity_gate === true,
    gateFailureReason:
      raw && typeof raw.gate_failure_reason === "string" ? raw.gate_failure_reason.trim() : null,
  };
}

function missingFieldsOf(result: {
  headline: string;
  observation: string;
  tension: string;
  implication: string;
}): string[] {
  return [
    !result.headline && "headline",
    !result.observation && "observation",
    !result.tension && "tension",
    !result.implication && "implication",
  ].filter((v): v is string => Boolean(v));
}

/**
 * Up to two attempts: the plain prompt, then, only if a required field came
 * back empty, one retry with a pointed note calling out exactly what was
 * missing last time. A cluster that still comes back incomplete after that
 * is genuinely dropped, with the full detail of both attempts' last failure
 * kept for the trace rather than a generic "unusable" label.
 */
async function reframeAndGateCluster(
  tenantId: string,
  runId: string,
  cluster: Cluster,
  framingBlock: string
): Promise<ReframeOutcome> {
  const first = await callReframe(tenantId, runId, cluster, framingBlock, null);
  const firstMissing = first.hadToolUse ? missingFieldsOf(first) : null;

  let result = first;
  let attempts = 1;

  if (!first.hadToolUse || (firstMissing && firstMissing.length > 0)) {
    const retryNote = !first.hadToolUse
      ? "Your previous attempt at this exact cluster did not return a usable tool call at all. Try again, " +
        "and make sure you call record_synthesized_insight with every required field filled in."
      : `Your previous attempt at this exact cluster left ${firstMissing!.join(" and ")} blank. Every one of ` +
        "those fields must contain real text this time, there is no case where leaving one empty is correct.";
    result = await callReframe(tenantId, runId, cluster, framingBlock, retryNote);
    attempts = 2;
  }

  if (!result.hadToolUse) {
    return {
      ok: false,
      reason:
        `no tool_use block in the response after ${attempts} attempt(s) ` +
        `(stop_reason: ${result.stopReason ?? "unknown"})`,
    };
  }

  const missing = missingFieldsOf(result);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `empty or missing field(s) after ${attempts} attempt(s): ${missing.join(", ")} ` +
        `(stop_reason: ${result.stopReason ?? "unknown"})`,
    };
  }

  return {
    ok: true,
    candidate: {
      cluster,
      headline: result.headline,
      observation: result.observation,
      tension: result.tension,
      implication: result.implication,
      actionPlanStatus: result.actionPlanStatus,
      materialityRationale: result.materialityRationale,
      passesValidityGate: result.passesValidityGate,
      gateFailureReason: result.gateFailureReason,
    },
  };
}

/**
 * Safe wrapper for every automatic trigger point, same pattern as
 * refreshInsights and refreshInsightQuality: a synthesis failure never
 * blocks whatever the researcher actually clicked.
 */
export async function refreshSynthesizedInsights(tenantId: string, runId: string): Promise<void> {
  try {
    await synthesizeInsights(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_synthesizer_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}

/**
 * Fisher-Yates shuffle, then drop the first dropFraction of the result --
 * a plain, auditable way to get a random subset without pulling in a
 * dependency for something this small. Pure; doesn't mutate items.
 */
function sampleWithDrop<T>(items: T[], dropFraction: number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const dropCount = Math.floor(shuffled.length * dropFraction);
  return shuffled.slice(dropCount);
}

/**
 * The tier-two reproducibility check (see the doc's "Reproducibility
 * check" section, and the free tier-one "thin evidence" badge this file's
 * MIN_CLUSTER_SIZE comment already covers): does a synthesized insight
 * reappear if synthesis is re-run on a resampled slice of the same
 * underlying pre-insight pool, Simoudis's (2015) "stable" and
 * "reproducible" insight properties, tested directly rather than just
 * inferred from triangulation_count.
 *
 * Deliberately a per-run check, not a per-insight one: clusterPreInsights
 * already groups a whole pool in one call, so one resample's clusters can
 * be checked against every currently accepted insight's membership at
 * once. That keeps the cost flat at STABILITY_RESAMPLE_COUNT calls no
 * matter how many insights this run has, rather than scaling with their
 * number the way a leave-one-out-per-insight version would.
 *
 * The pool is every pre-insight this run has ever produced, not just
 * those currently linked to an accepted synthesized insight: the question
 * is whether the same evidence re-clusters the same way, and the original
 * synthesis pass could draw on the whole pool, not only what it happened
 * to promote.
 *
 * A resample that drops enough of a thin insight's own membership that
 * fewer than MIN_CLUSTER_SIZE of it survive can't test that insight at
 * all; that resample is skipped for that insight rather than counted as a
 * failure, which is why this tracks a testable count alongside a
 * reappeared count instead of a flat fraction of STABILITY_RESAMPLE_COUNT.
 * Matching a resample's cluster back to an original insight is membership
 * overlap, not headline similarity: clusterPreInsights runs at
 * temperature 0 specifically so the same pool groups the same way run to
 * run, but a large model keeps some residual drift even then, so a
 * resample's result is part genuine resampling signal, part ordinary
 * model noise, the two aren't perfectly separable, which is a property of
 * the check worth knowing about rather than a precision this function can
 * promise away.
 *
 * Never called automatically, not from regenerate, not from synthesis,
 * not from export -- only from the explicit "Check stability" action (see
 * checkStability in synthesizedInsightActions.ts). Overwrites whatever an
 * earlier check run left on each currently accepted insight, same "lock
 * in, recompute only when asked" shape the narrative report already uses.
 * Insights rejected after an earlier check keep whatever stale numbers
 * they had; they're not shown anywhere review_status = 'accepted' isn't
 * already filtering for.
 */
export async function checkRunStability(tenantId: string, runId: string): Promise<void> {
  const pool = await withTenant(tenantId, async (client) => {
    const result = await client.query<EligiblePreInsight>(
      `select i.id, i.headline, i.observation, i.tension, i.implication, f.theme
       from insights i
       join findings f on f.id = i.finding_id
       where i.run_id = $1`,
      [runId]
    );
    return result.rows;
  });

  if (pool.length < MIN_CLUSTER_SIZE) {
    return;
  }

  const acceptedInsights = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ id: string; member_ids: string[] }>(
      `select si.id, array_agg(s.pre_insight_id) as member_ids
       from synthesized_insights si
       join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       where si.run_id = $1 and si.review_status = 'accepted'
       group by si.id`,
      [runId]
    );
    return result.rows.map((row) => ({ id: row.id, memberIds: new Set(row.member_ids) }));
  });

  if (acceptedInsights.length === 0) {
    return;
  }

  const testable = new Map<string, number>(acceptedInsights.map((i) => [i.id, 0]));
  const reappeared = new Map<string, number>(acceptedInsights.map((i) => [i.id, 0]));
  const resampleSummaries: Array<Record<string, unknown>> = [];

  for (let resampleIndex = 0; resampleIndex < STABILITY_RESAMPLE_COUNT; resampleIndex++) {
    // clusterPreInsights is built to see the whole pool it's given in one
    // model call (see this file's MAX_PRE_INSIGHTS_FOR_SYNTHESIS comment);
    // the real synthesis pass enforces that with its own `limit` clause,
    // but this pool query deliberately has none, since the stability check
    // wants every pre-insight this run has ever produced as its sampling
    // frame. Once that frame is bigger than one model call can cluster in
    // its 4096-token reply, every resample's clusterPreInsights call fails
    // identically (truncated tool-call JSON), which looks like "every
    // insight is unstable" when it's really just an oversized prompt. So
    // the same cap applies here, after dropping, not instead of dropping.
    const droppedPool = sampleWithDrop(pool, STABILITY_DROP_FRACTION);
    const sampledPool =
      droppedPool.length > MAX_PRE_INSIGHTS_FOR_SYNTHESIS
        ? droppedPool.slice(0, MAX_PRE_INSIGHTS_FOR_SYNTHESIS)
        : droppedPool;
    const sampledIds = new Set(sampledPool.map((p) => p.id));

    let clusters: Cluster[];
    try {
      clusters = await clusterPreInsights(tenantId, runId, sampledPool);
    } catch (error) {
      // A failed resample contributes no evidence either way for any
      // insight; it's logged, not silently dropped, but doesn't move
      // either counter.
      resampleSummaries.push({
        resample: resampleIndex,
        pool_size: sampledPool.length,
        pool_size_before_cap: droppedPool.length,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const perInsightOutcome: Record<string, string> = {};

    for (const insight of acceptedInsights) {
      const survivingMembers = [...insight.memberIds].filter((id) => sampledIds.has(id));
      if (survivingMembers.length < MIN_CLUSTER_SIZE) {
        perInsightOutcome[insight.id] = "untestable_too_much_dropped";
        continue;
      }

      testable.set(insight.id, (testable.get(insight.id) ?? 0) + 1);

      let bestOverlap = 0;
      let bestLabel: string | null = null;
      for (const cluster of clusters) {
        const clusterIds = new Set(cluster.members.map((m) => m.id));
        const intersectionCount = survivingMembers.filter((id) => clusterIds.has(id)).length;
        const overlap = intersectionCount / survivingMembers.length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestLabel = cluster.label;
        }
      }

      if (bestOverlap >= STABILITY_OVERLAP_THRESHOLD) {
        reappeared.set(insight.id, (reappeared.get(insight.id) ?? 0) + 1);
        perInsightOutcome[insight.id] = `reappeared (overlap ${bestOverlap.toFixed(2)}, matched "${bestLabel}")`;
      } else {
        perInsightOutcome[insight.id] = `did_not_reappear (best overlap ${bestOverlap.toFixed(2)})`;
      }
    }

    resampleSummaries.push({
      resample: resampleIndex,
      pool_size: sampledPool.length,
      pool_size_before_cap: droppedPool.length,
      clusters_formed: clusters.length,
      outcomes: perInsightOutcome,
    });
  }

  await withTenant(tenantId, async (client) => {
    for (const insight of acceptedInsights) {
      await client.query(
        `update synthesized_insights
         set stability_testable_count = $1, stability_reappeared_count = $2, stability_checked_at = now()
         where id = $3`,
        [testable.get(insight.id) ?? 0, reappeared.get(insight.id) ?? 0, insight.id]
      );
    }
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_stability_check', $3)`,
      [
        tenantId,
        runId,
        JSON.stringify({
          pool_size: pool.length,
          accepted_insight_count: acceptedInsights.length,
          resample_count: STABILITY_RESAMPLE_COUNT,
          drop_fraction: STABILITY_DROP_FRACTION,
          overlap_threshold: STABILITY_OVERLAP_THRESHOLD,
          resamples: resampleSummaries,
        }),
      ]
    );
  });
}
