import { refreshRecommendationQuality } from "./recommendationQualityScorer";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import type { PoolClient } from "pg";
import { withTenant } from "./db";
import { loadInsightSupportOrUnchecked } from "./supportStatus";
import { mapWithConcurrency } from "./concurrency";
import { figureCheck, type FigureCheck } from "./numberTrace";
import { recommendationDecisionContextAvailable } from "./decisionContext";
import { figureCheckAvailable } from "./figureChecks";
import { DECISION_INDICES_FIELD, decisionsPromptBlock, loadDecisionItems, parseDecisionIndices, storeRecommendationDecisions, type DecisionItem } from "./recommendationDecisions";

const MAX_INSIGHTS_FOR_PROMPT = 60;

// REC-002: what one batch of a recommendation run produced. A batch whose model call throws is
// contained (containChunk) so the other batches' work and the overall outcome are still reported.
type ChunkOutcome = { writtenIds: string[]; failure?: string };

function containChunk<T>(fn: (batch: T[], chunkIndex: number) => Promise<ChunkOutcome>) {
  return async (batch: T[], chunkIndex: number): Promise<ChunkOutcome> => {
    try {
      return await fn(batch, chunkIndex);
    } catch (error) {
      return {
        writtenIds: [],
        failure: `${batch.length} insight(s) starting at index ${chunkIndex * RECOMMENDATION_CHUNK_SIZE}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };
}

/**
 * REC-002: the outcome of a recommendation run, recorded and made actionable. Before this a run
 * reported success whenever at least one recommendation was written, so batches that failed (or
 * insights the model skipped) left recommendations silently missing. Now:
 *   - every run writes a trace row (`event`) with requested / covered / missing counts and the
 *     batch failures, so the outcome is persisted, not just logged to a console;
 *   - nothing written at all -> the existing "nothing was changed, try again" error;
 *   - some written, some missing -> an error that says how many are missing and why, that the
 *     written ones are kept, and that running again covers only the rest. Retrying never
 *     duplicates: the generators only draft for insights that still have no recommendation, and
 *     insertOncePerAnchor re-checks that under a row lock at write time (repeated model indices,
 *     concurrent runs).
 * The written recommendations are committed per batch and are not rolled back.
 */
async function settleRecommendationRun(
  tenantId: string,
  runId: string,
  event: "recommendation_run" | "synthesized_recommendation_run",
  requestedIds: string[],
  outcomes: ChunkOutcome[],
): Promise<void> {
  const covered = new Set(outcomes.flatMap((o) => o.writtenIds));
  const missing = requestedIds.filter((id) => !covered.has(id));
  const failures = outcomes.map((o) => o.failure).filter((f): f is string => !!f);
  await withTenant(tenantId, async (client) => {
    await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, $3, $4)`, [
      tenantId,
      runId,
      event,
      JSON.stringify({
        requested: requestedIds.length,
        covered: requestedIds.length - missing.length,
        missing: missing.length,
        missing_ids: missing.slice(0, 100),
        failures,
        complete: missing.length === 0,
      }),
    ]);
  });
  if (covered.size === 0) {
    const detail = failures.length > 0 ? ` (${failures.join("; ")})` : "";
    throw new Error(`No usable recommendations came back this time${detail}. Nothing was changed, try again.`);
  }
  if (missing.length > 0) {
    const why = failures.length > 0 ? failures.join("; ") : "the model returned no usable recommendation for them";
    throw new Error(
      `Recommendations were written for ${requestedIds.length - missing.length} of ${requestedIds.length} insights; ` +
        `${missing.length} still have none (${why}). The ones written are kept. Run it again to generate the rest; ` +
        "insights that already have a recommendation are not repeated.",
    );
  }
}


/**
 * Numerical traceability for one drafted recommendation (numberTrace.ts), against the insight it
 * is anchored to. Timeline is not checked (dates and quarters are plans, not evidence). A figure
 * absent from the evidence may be a proposed target, so it needs review rather than blocking; a
 * conflicting figure (unit, measure, direction, or a different value for the same subject) is
 * unsupported and the recommendation is not written (the insight then counts as missing, and a
 * retry drafts it again).
 */
function checkRecommendationFigures(
  rec: { action_text: string; owner_feasibility_note: string; metric: string; assumptions_and_risks: string; alternatives_considered: string },
  sources: string[],
): FigureCheck {
  return figureCheck(
    (["action_text", "owner_feasibility_note", "metric", "assumptions_and_risks", "alternatives_considered"] as const).map((field) => ({
      field,
      text: rec[field],
      sources,
    })),
    { absent: "needs_review" },
  );
}

type RecommendationFields = {
  figureCheck?: FigureCheck;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: Priority;
  assumptions_and_risks: string;
  alternatives_considered: string;
  /** CE-2: indices into the numbered decisions the prompt listed; empty when the model named none. */
  decisionIndices: number[];
};

/**
 * REC-002: writes at most one AI-suggested recommendation per anchor, safely under retries and
 * concurrent runs. For each anchor, inside the caller's transaction:
 *   1. lock the anchor row (pre-insight or synthesized insight) in this run; a missing row (deleted
 *      meanwhile, or not in this run) is skipped and stays reported as missing;
 *   2. insert only if the anchor still has no recommendation of any kind - the same rule the
 *      eligibility query uses, so a researcher's own recommendation is never duplicated or replaced.
 * decisionContext is the decision statement the caller's prompt was built from (read before the
 * model call, so a decision change committed meanwhile is not mistaken for what the model saw);
 * it is stored with each row when migration 0102 is applied (decisionContext.ts uses it).
 * The anchor lock serialises two runs drafting for the same insight, so the second one sees the
 * first one's row. Returns the anchors that now have a recommendation (written here or already
 * present), which is what the run's coverage report counts.
 */
async function insertOncePerAnchor(
  client: PoolClient,
  anchorTable: "insights" | "synthesized_insights",
  anchorColumn: "insight_id" | "synthesized_insight_id",
  tenantId: string,
  runId: string,
  rows: { anchorId: string; fields: RecommendationFields }[],
  decisionContext: string,
  decisions: DecisionItem[],
): Promise<string[]> {
  const covered: string[] = [];
  const seen = new Set<string>();
  const storeCheck = await figureCheckAvailable(client);
  const storeContext = await recommendationDecisionContextAvailable(client);
  // Locks are taken in id order so two concurrent runs over overlapping anchors cannot deadlock.
  const ordered = [...rows].sort((a, b) => (a.anchorId < b.anchorId ? -1 : a.anchorId > b.anchorId ? 1 : 0));
  for (const { anchorId, fields } of ordered) {
    if (seen.has(anchorId)) continue;
    seen.add(anchorId);
    const locked = await client.query(`select id from ${anchorTable} where id = $1 and run_id = $2 for update`, [anchorId, runId]);
    if (locked.rows.length === 0) continue;
    const inserted = await client.query<{ id: string }>(
      `insert into recommendations
         (tenant_id, run_id, ${anchorColumn}, action_text, owner_role, owner_feasibility_note, timeline,
          metric, priority, assumptions_and_risks, alternatives_considered, source, status${storeCheck ? ", figure_check" : ""}${storeContext ? ", decision_context" : ""})
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ai_suggested', 'accepted'${storeCheck ? ", $12::jsonb" : ""}${storeContext ? `, $${storeCheck ? 13 : 12}::text` : ""}
       where not exists (select 1 from recommendations r where r.${anchorColumn} = $3)
       returning id`,
      [
        tenantId,
        runId,
        anchorId,
        fields.action_text,
        fields.owner_role,
        fields.owner_feasibility_note,
        fields.timeline,
        fields.metric,
        fields.priority,
        fields.assumptions_and_risks,
        fields.alternatives_considered,
        ...(storeCheck ? [fields.figureCheck ? JSON.stringify(fields.figureCheck) : null] : []),
        ...(storeContext ? [decisionContext] : []),
      ]
    );
    // CE-2: in the same transaction, the decisions this action serves (none when a retry found it written).
    const recommendationId = inserted.rows[0]?.id;
    if (recommendationId) {
      await storeRecommendationDecisions(client, tenantId, recommendationId, fields.decisionIndices.map((i) => decisions[i]), "model");
    }
    covered.push(anchorId);
  }
  return covered;
}

// Same chunking reasoning as verifyFindings and insightGenerator: each
// recommendation carries eight written fields, twice what an insight
// needs, so a single call covering dozens of insights at once is even
// likelier to run past its token budget and come back with nothing usable
// for the whole batch. A smaller chunk size than insightGenerator's
// reflects that heavier per-item cost.
const RECOMMENDATION_CHUNK_SIZE = 10;
// How many chunk API calls run at once.
const RECOMMENDATION_CONCURRENCY = 3;

type EligibleInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  theme: string | null;
};

type Priority = "high" | "medium" | "low";

/**
 * Closes the chain this app is built around: finding, verdict, insight,
 * decision, action. Runs once a decision is confirmed, and proposes one
 * recommendation per insight that doesn't already have one.
 *
 * A decision is required before this runs, in both entry-point modes. This
 * is the one point in the pipeline where "generate" and "validate" converge
 * on the same order: insight leads to decision in generate mode, decision
 * frames insight in validate mode, but either way an action is judged
 * against a confirmed decision, not floated free of one. If no decision has
 * been accepted yet, this is a no-op rather than an error, the same
 * reasoning generateInsights uses while it waits on a "validate" run's
 * decision; it picks up automatically once acceptDecisionCandidate runs.
 *
 * Every recommendation is deliberately concrete rather than a restated
 * insight: a named owner role, a real timeline, a metric that would show
 * whether it worked, a priority, and the trade-off reasoning (assumptions
 * and risks, alternatives considered) a stakeholder would want before
 * committing. An insight with no obvious business action still gets one,
 * framed as the most defensible next step (a follow-up study, a smaller
 * pilot, a specific data check) rather than skipped or padded with invented
 * busywork.
 */
export async function generateRecommendations(tenantId: string, runId: string): Promise<void> {
  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ decision_statement: string | null; audience: string | null }>(
      "select decision_statement, audience from runs where id = $1",
      [runId]
    );
    return result.rows[0];
  });

  if (!run) return;

  if (!run.decision_statement) {
    return;
  }
  // The decisions this prompt is built from; stored with each recommendation written below.
  const decisionStatement = run.decision_statement;
  // CE-2: the same decisions, numbered, so the model can name the ones each action serves.
  const decisions = await withTenant(tenantId, (client) => loadDecisionItems(client, runId));

  const eligible = await withTenant(tenantId, async (client) => {
    const result = await client.query<EligibleInsight>(
      `select i.id, i.headline, i.observation, i.tension, i.implication, f.theme
       from insights i
       join findings f on f.id = i.finding_id
       where i.run_id = $1
         and not exists (select 1 from recommendations r where r.insight_id = i.id)
       order by f.theme nulls last, i.created_at
       limit $2`,
      [runId, MAX_INSIGHTS_FOR_PROMPT]
    );
    return result.rows;
  });

  if (eligible.length === 0) return;

  const audienceBlock = run.audience ? `The recommendation's audience is: ${run.audience}.\n\n` : "";

  type Prepared = {
    figureCheck: FigureCheck;
    insightId: string;
    action_text: string;
    owner_role: string;
    owner_feasibility_note: string;
    timeline: string;
    metric: string;
    priority: Priority;
    assumptions_and_risks: string;
    alternatives_considered: string;
    decisionIndices: number[];
  };

  const chunks: EligibleInsight[][] = [];
  for (let start = 0; start < eligible.length; start += RECOMMENDATION_CHUNK_SIZE) {
    chunks.push(eligible.slice(start, start + RECOMMENDATION_CHUNK_SIZE));
  }

  type ChunkResult = ChunkOutcome;

  const chunkResults = await mapWithConcurrency(
    chunks,
    RECOMMENDATION_CONCURRENCY,
    containChunk(async (batch, chunkIndex): Promise<ChunkResult> => {
      const insightsBlock = batch
        .map(
          (insight, index) =>
            `${index}. [${insight.theme ?? "Uncategorized"}] Headline: ${insight.headline}\n` +
            `   Observation: ${insight.observation}\n   Tension: ${insight.tension}\n   Implication: ${insight.implication}`
        )
        .join("\n");

      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        // Was 4096: a full chunk of RECOMMENDATION_CHUNK_SIZE (10) items,
        // each with 8 verbose fields, runs 4500-6500 tokens on real data,
        // which sat right at or past the old cap and silently truncated
        // most chunks (some losing every item, visible as
        // recommendation_agent_error; others just dropping whichever items
        // came after the cutoff, with no error at all). 8192 gives that
        // comfortable headroom; claude-sonnet-5 supports far more than this.
        max_tokens: 8192,
        system:
          "You turn a market research insight into a specific, ownable recommendation, given the decisions " +
          `this project has confirmed, numbered:\n${decisionsPromptBlock(decisions)}\n\nTie each recommendation ` +
          "to whichever decision(s) it actually serves rather than treating them as interchangeable, and " +
          "name them by index in decision_indices. Every recommendation must be concrete " +
          "enough to put on a task board as it stands: a named owner role, not a department; a real " +
          "timeline, not \"soon\"; a metric that would actually show whether it worked, not a restated " +
          "goal.\n\n" +
          audienceBlock +
          "For each insight, write:\n" +
          "- action_text: the specific action to take, phrased as a plain-English instruction, at most 20 " +
          "words, one sentence a stakeholder could read on a slide at a glance -- not a restated implication, " +
          "and not dense with qualifiers or statistical jargon; a nuance that doesn't fit in one short " +
          "sentence belongs in assumptions_and_risks instead.\n" +
          "- owner_role: who should own this, a role (e.g. \"Head of Member Experience\"), not a department.\n" +
          "- owner_feasibility_note: one or two sentences on why this owner and why this is feasible for " +
          "them, or what would need to be true for it to be.\n" +
          "- timeline: a concrete window (e.g. \"Within one quarter\", \"Before Q2 launch\").\n" +
          "- metric: what would show this worked, stated as something measurable.\n" +
          "- priority: high, medium, or low, relative to the other actions proposed here and how directly " +
          "it serves the confirmed decision(s).\n" +
          "- assumptions_and_risks: what this action assumes to be true, and what could go wrong.\n" +
          "- alternatives_considered: at least one other action the evidence could also support, and why " +
          "this one is preferred.\n\n" +
          "If an insight genuinely does not support a business action yet, the most defensible action is a " +
          "further step to close that gap (a follow-up study, a smaller pilot, a specific data check), " +
          "stated as plainly as any other action rather than invented busywork.\n\n" +
          "Cover every insight listed below by its index.",
        tool_choice: { type: "tool", name: "record_recommendations" },
        tools: [
          {
            name: "record_recommendations",
            description: "Records one recommended action per insight by its index in the list.",
            input_schema: {
              type: "object",
              properties: {
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "The insight's index in the numbered list." },
                      action_text: { type: "string" },
                      owner_role: { type: "string" },
                      owner_feasibility_note: { type: "string" },
                      timeline: { type: "string" },
                      metric: { type: "string" },
                      priority: { type: "string", enum: ["high", "medium", "low"] },
                      assumptions_and_risks: { type: "string" },
                      alternatives_considered: { type: "string" },
                      decision_indices: DECISION_INDICES_FIELD,
                    },
                    required: [
                      "index",
                      "action_text",
                      "owner_role",
                      "owner_feasibility_note",
                      "timeline",
                      "metric",
                      "priority",
                      "assumptions_and_risks",
                      "alternatives_considered",
                      "decision_indices",
                    ],
                  },
                },
              },
              required: ["recommendations"],
            },
          },
        ],
        messages: [{ role: "user", content: `Here are the insights:\n\n${insightsBlock}` }],
      });

      await logApiUsage(tenantId, runId, "recommendation_agent", response.usage);

      const toolUse = response.content.find((block) => block.type === "tool_use");
      const rawRecommendations =
        toolUse &&
        toolUse.type === "tool_use" &&
        Array.isArray((toolUse.input as { recommendations?: unknown }).recommendations)
          ? ((toolUse.input as { recommendations: unknown[] }).recommendations as Record<string, unknown>[])
          : [];

      const prepared: Prepared[] = [];
      const seenIndices = new Set<number>();
      const figureRefusals: string[] = [];
      for (const raw of rawRecommendations) {
        const index = typeof raw.index === "number" ? raw.index : null;
        const action_text = typeof raw.action_text === "string" ? raw.action_text.trim() : "";
        const owner_role = typeof raw.owner_role === "string" ? raw.owner_role.trim() : "";
        const owner_feasibility_note =
          typeof raw.owner_feasibility_note === "string" ? raw.owner_feasibility_note.trim() : "";
        const timeline = typeof raw.timeline === "string" ? raw.timeline.trim() : "";
        const metric = typeof raw.metric === "string" ? raw.metric.trim() : "";
        const priority: Priority | null =
          raw.priority === "high" || raw.priority === "medium" || raw.priority === "low" ? raw.priority : null;
        const assumptions_and_risks =
          typeof raw.assumptions_and_risks === "string" ? raw.assumptions_and_risks.trim() : "";
        const alternatives_considered =
          typeof raw.alternatives_considered === "string" ? raw.alternatives_considered.trim() : "";
        const decisionIndices = parseDecisionIndices(raw.decision_indices, decisions.length);

        if (index === null || !Number.isInteger(index) || index < 0 || index >= batch.length) continue;
        if (
          !action_text ||
          !owner_role ||
          !owner_feasibility_note ||
          !timeline ||
          !metric ||
          !priority ||
          !assumptions_and_risks ||
          !alternatives_considered
        ) {
          continue;
        }
        // REC-002: one recommendation per listed insight per call. The model sometimes repeats an
        // index; the first complete entry for it is kept and any repeat is dropped.
        if (seenIndices.has(index)) continue;
        seenIndices.add(index);

        const anchor = batch[index];
        const check = checkRecommendationFigures(
          { action_text, owner_feasibility_note, metric, assumptions_and_risks, alternatives_considered },
          [anchor.headline, anchor.observation, anchor.tension, anchor.implication, anchor.theme ?? ""],
        );
        if (check.status === "unsupported") {
          figureRefusals.push(...check.figures.filter((f) => f.status === "unsupported").map((f) => `${f.text}: ${f.reason}`));
          continue;
        }
        prepared.push({
          figureCheck: check,
          insightId: batch[index].id,
          action_text,
          owner_role,
          owner_feasibility_note,
          timeline,
          metric,
          priority,
          assumptions_and_risks,
          alternatives_considered,
          decisionIndices,
        });
      }

      if (prepared.length === 0) {
        return {
          writtenIds: [],
          failure:
            `${batch.length} insight(s) starting at index ${chunkIndex * RECOMMENDATION_CHUNK_SIZE} ` +
            `(stop reason: ${response.stop_reason ?? "unknown"}` +
            `${figureRefusals.length > 0 ? `; held back for figures not supported by their insight: ${figureRefusals.slice(0, 5).join("; ")}` : ""})`,
        };
      }

      const coveredIds = await withTenant(tenantId, (client) =>
        insertOncePerAnchor(client, "insights", "insight_id", tenantId, runId, prepared.map((p) => ({ anchorId: p.insightId, fields: p })), decisionStatement, decisions)
      );

      return figureRefusals.length > 0
        ? {
            writtenIds: coveredIds,
            failure: `held back for figures not supported by their insight: ${figureRefusals.slice(0, 5).join("; ")}`,
          }
        : { writtenIds: coveredIds };
    })
  );

  await settleRecommendationRun(tenantId, runId, "recommendation_run", eligible.map((i) => i.id), chunkResults);
}


type EligibleSynthesizedInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  source_headlines: string[];
};

/**
 * The actual funnel output: one recommended action per *synthesized*
 * insight rather than per pre-insight. Before this existed,
 * generateRecommendations ran one-to-one against the pre-insight table,
 * which is the auditable chain-of-evidence rung, not the real insight (see
 * insightSynthesizer.ts's doc comment) -- a run with 60 pre-insights behind
 * 16 genuine synthesized insights produced 60 recommendations instead of
 * something close to 16, most of them near-duplicates of each other from
 * the same underlying cluster.
 *
 * Only accepted synthesized insights are eligible: a rejected one isn't a
 * real insight any more as far as the researcher is concerned, so it
 * shouldn't keep spawning actions. Written with synthesized_insight_id set
 * and insight_id left null, the anchor the 0027 migration already added
 * for exactly this.
 *
 * Also excludes insights the synthesizer itself flagged
 * action_plan_status = 'retained_no_action' (Simoudis 2015's point that an
 * insight without a feasible action plan is still kept, not forced into
 * one). Those stay in the insight reserve (see the parked-insights query
 * in page.tsx) until a researcher adds a recommendation by hand or a
 * later wave's data makes one of this generator's own candidates make
 * sense.
 */
export async function generateSynthesizedRecommendations(tenantId: string, runId: string): Promise<void> {
  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ decision_statement: string | null; audience: string | null }>(
      "select decision_statement, audience from runs where id = $1",
      [runId]
    );
    return result.rows[0];
  });

  if (!run) return;
  if (!run.decision_statement) return;
  // The decisions this prompt is built from; stored with each recommendation written below.
  const decisionStatement = run.decision_statement;
  // CE-2: the same decisions, numbered, so the model can name the ones each action serves.
  const decisions = await withTenant(tenantId, (client) => loadDecisionItems(client, runId));

  const acceptedEligible = await withTenant(tenantId, async (client) => {
    const result = await client.query<EligibleSynthesizedInsight>(
      `select si.id, si.headline, si.observation, si.tension, si.implication,
              array_agg(pi.headline order by pi.created_at) as source_headlines
       from synthesized_insights si
       join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       join insights pi on pi.id = s.pre_insight_id
       where si.run_id = $1
         and si.review_status = 'accepted'
         and si.action_plan_status = 'has_action'
         and not exists (select 1 from recommendations r where r.synthesized_insight_id = si.id)
       group by si.id
       order by si.created_at
       limit $2`,
      [runId, MAX_INSIGHTS_FOR_PROMPT]
    );
    return result.rows;
  });

  // FND-001: never draft a recommendation for an insight whose support is no longer valid (a
  // supporting finding rejected or deleted since it was drafted). Changed or uncheckable support
  // is still drafted from; the recommendation inherits that status wherever it is shown or
  // exported. The insight itself, and its review decision, are left untouched.
  const support = await loadInsightSupportOrUnchecked(
    tenantId,
    runId,
    acceptedEligible.map((insight) => insight.id),
  );
  const eligible = acceptedEligible.filter((insight) => support.statusOf(insight.id).status !== "invalid");

  if (eligible.length === 0) return;

  const audienceBlock = run.audience ? `The recommendation's audience is: ${run.audience}.\n\n` : "";

  type Prepared = {
    figureCheck: FigureCheck;
    synthesizedInsightId: string;
    action_text: string;
    owner_role: string;
    owner_feasibility_note: string;
    timeline: string;
    metric: string;
    priority: Priority;
    assumptions_and_risks: string;
    alternatives_considered: string;
    decisionIndices: number[];
  };

  const chunks: EligibleSynthesizedInsight[][] = [];
  for (let start = 0; start < eligible.length; start += RECOMMENDATION_CHUNK_SIZE) {
    chunks.push(eligible.slice(start, start + RECOMMENDATION_CHUNK_SIZE));
  }

  type ChunkResult = ChunkOutcome;

  const chunkResults = await mapWithConcurrency(
    chunks,
    RECOMMENDATION_CONCURRENCY,
    containChunk(async (batch, chunkIndex): Promise<ChunkResult> => {
      const insightsBlock = batch
        .map(
          (insight, index) =>
            `${index}. Headline: ${insight.headline}\n` +
            `   Observation: ${insight.observation}\n   Tension: ${insight.tension}\n` +
            `   Implication: ${insight.implication}\n` +
            `   Chain of evidence: ${insight.source_headlines.join("; ")}`
        )
        .join("\n");

      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        // Same reasoning as generateRecommendations' identical bump: this
        // hasn't hit the wall yet only because accepted synthesized
        // insights per run has stayed under RECOMMENDATION_CHUNK_SIZE (10)
        // so far, not because the per-item cost is any smaller.
        max_tokens: 8192,
        system:
          "You turn a market research insight into a specific, ownable recommendation, given the decisions " +
          `this project has confirmed, numbered:\n${decisionsPromptBlock(decisions)}\n\nTie each recommendation ` +
          "to whichever decision(s) it actually serves rather than treating them as interchangeable, and " +
          "name them by index in decision_indices. Each insight below was already built by clustering several corroborating " +
          "pre-insights, so one recommendation should cover the whole cluster, not restate a single member " +
          "of it. Every recommendation must be concrete " +
          "enough to put on a task board as it stands: a named owner role, not a department; a real " +
          "timeline, not \"soon\"; a metric that would actually show whether it worked, not a restated " +
          "goal.\n\n" +
          audienceBlock +
          "For each insight, write:\n" +
          "- action_text: the specific action to take, phrased as a plain-English instruction, at most 20 " +
          "words, one sentence a stakeholder could read on a slide at a glance -- not a restated implication, " +
          "and not dense with qualifiers or statistical jargon; a nuance that doesn't fit in one short " +
          "sentence belongs in assumptions_and_risks instead.\n" +
          "- owner_role: who should own this, a role (e.g. \"Head of Member Experience\"), not a department.\n" +
          "- owner_feasibility_note: one or two sentences on why this owner and why this is feasible for " +
          "them, or what would need to be true for it to be.\n" +
          "- timeline: a concrete window (e.g. \"Within one quarter\", \"Before Q2 launch\").\n" +
          "- metric: what would show this worked, stated as something measurable.\n" +
          "- priority: high, medium, or low, relative to the other actions proposed here and how directly " +
          "it serves the confirmed decision(s).\n" +
          "- assumptions_and_risks: what this action assumes to be true, and what could go wrong.\n" +
          "- alternatives_considered: at least one other action the evidence could also support, and why " +
          "this one is preferred.\n\n" +
          "If an insight genuinely does not support a business action yet, the most defensible action is a " +
          "further step to close that gap (a follow-up study, a smaller pilot, a specific data check), " +
          "stated as plainly as any other action rather than invented busywork.\n\n" +
          "Cover every insight listed below by its index.",
        tool_choice: { type: "tool", name: "record_recommendations" },
        tools: [
          {
            name: "record_recommendations",
            description: "Records one recommended action per insight by its index in the list.",
            input_schema: {
              type: "object",
              properties: {
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "The insight's index in the numbered list." },
                      action_text: { type: "string" },
                      owner_role: { type: "string" },
                      owner_feasibility_note: { type: "string" },
                      timeline: { type: "string" },
                      metric: { type: "string" },
                      priority: { type: "string", enum: ["high", "medium", "low"] },
                      assumptions_and_risks: { type: "string" },
                      alternatives_considered: { type: "string" },
                      decision_indices: DECISION_INDICES_FIELD,
                    },
                    required: [
                      "index",
                      "action_text",
                      "owner_role",
                      "owner_feasibility_note",
                      "timeline",
                      "metric",
                      "priority",
                      "assumptions_and_risks",
                      "alternatives_considered",
                      "decision_indices",
                    ],
                  },
                },
              },
              required: ["recommendations"],
            },
          },
        ],
        messages: [{ role: "user", content: `Here are the insights:\n\n${insightsBlock}` }],
      });

      await logApiUsage(tenantId, runId, "synthesized_recommendation_agent", response.usage);

      const toolUse = response.content.find((block) => block.type === "tool_use");
      const rawRecommendations =
        toolUse &&
        toolUse.type === "tool_use" &&
        Array.isArray((toolUse.input as { recommendations?: unknown }).recommendations)
          ? ((toolUse.input as { recommendations: unknown[] }).recommendations as Record<string, unknown>[])
          : [];

      const prepared: Prepared[] = [];
      const seenIndices = new Set<number>();
      const figureRefusals: string[] = [];
      for (const raw of rawRecommendations) {
        const index = typeof raw.index === "number" ? raw.index : null;
        const action_text = typeof raw.action_text === "string" ? raw.action_text.trim() : "";
        const owner_role = typeof raw.owner_role === "string" ? raw.owner_role.trim() : "";
        const owner_feasibility_note =
          typeof raw.owner_feasibility_note === "string" ? raw.owner_feasibility_note.trim() : "";
        const timeline = typeof raw.timeline === "string" ? raw.timeline.trim() : "";
        const metric = typeof raw.metric === "string" ? raw.metric.trim() : "";
        const priority: Priority | null =
          raw.priority === "high" || raw.priority === "medium" || raw.priority === "low" ? raw.priority : null;
        const assumptions_and_risks =
          typeof raw.assumptions_and_risks === "string" ? raw.assumptions_and_risks.trim() : "";
        const alternatives_considered =
          typeof raw.alternatives_considered === "string" ? raw.alternatives_considered.trim() : "";
        const decisionIndices = parseDecisionIndices(raw.decision_indices, decisions.length);

        if (index === null || !Number.isInteger(index) || index < 0 || index >= batch.length) continue;
        if (
          !action_text ||
          !owner_role ||
          !owner_feasibility_note ||
          !timeline ||
          !metric ||
          !priority ||
          !assumptions_and_risks ||
          !alternatives_considered
        ) {
          continue;
        }
        // REC-002: one recommendation per listed insight per call. The model sometimes repeats an
        // index; the first complete entry for it is kept and any repeat is dropped.
        if (seenIndices.has(index)) continue;
        seenIndices.add(index);

        const anchor = batch[index];
        const check = checkRecommendationFigures(
          { action_text, owner_feasibility_note, metric, assumptions_and_risks, alternatives_considered },
          [anchor.headline, anchor.observation, anchor.tension, anchor.implication, ...anchor.source_headlines],
        );
        if (check.status === "unsupported") {
          figureRefusals.push(...check.figures.filter((f) => f.status === "unsupported").map((f) => `${f.text}: ${f.reason}`));
          continue;
        }
        prepared.push({
          figureCheck: check,
          synthesizedInsightId: batch[index].id,
          action_text,
          owner_role,
          owner_feasibility_note,
          timeline,
          metric,
          priority,
          assumptions_and_risks,
          alternatives_considered,
          decisionIndices,
        });
      }

      if (prepared.length === 0) {
        return {
          writtenIds: [],
          failure:
            `${batch.length} insight(s) starting at index ${chunkIndex * RECOMMENDATION_CHUNK_SIZE} ` +
            `(stop reason: ${response.stop_reason ?? "unknown"}` +
            `${figureRefusals.length > 0 ? `; held back for figures not supported by their insight: ${figureRefusals.slice(0, 5).join("; ")}` : ""})`,
        };
      }

      const coveredIds = await withTenant(tenantId, (client) =>
        insertOncePerAnchor(
          client,
          "synthesized_insights",
          "synthesized_insight_id",
          tenantId,
          runId,
          prepared.map((p) => ({ anchorId: p.synthesizedInsightId, fields: p })),
          decisionStatement,
          decisions,
        )
      );

      return figureRefusals.length > 0
        ? {
            writtenIds: coveredIds,
            failure: `held back for figures not supported by their insight: ${figureRefusals.slice(0, 5).join("; ")}`,
          }
        : { writtenIds: coveredIds };
    })
  );

  await settleRecommendationRun(tenantId, runId, "synthesized_recommendation_run", eligible.map((i) => i.id), chunkResults);
}

/**
 * Safe wrapper for every automatic trigger point, same reasoning as
 * refreshVerdicts and refreshInsights: a recommendation-generation failure
 * never blocks whatever the researcher actually clicked.
 *
 * Runs both recommendation generators. generateRecommendations (the
 * original, per-pre-insight) is kept running so the full 1:1 list stays
 * populated, additive alongside the synthesized-insight-level one, the
 * same "add, don't replace" pattern as pre-insights vs synthesized
 * insights themselves. The two are wrapped separately so a failure in one
 * never blocks the other.
 */
export async function refreshRecommendations(tenantId: string, runId: string): Promise<string[]> {
  // Failures are logged and returned, never thrown (see refreshInsights for why both).
  const failures: string[] = [];
  try {
    await generateRecommendations(tenantId, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(message);
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'recommendation_agent_error', $3)`,
        [tenantId, runId, JSON.stringify({ message })]
      );
    });
  }

  try {
    await generateSynthesizedRecommendations(tenantId, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(message);
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'synthesized_recommendation_agent_error', $3)`,
        [tenantId, runId, JSON.stringify({ message })]
      );
    });
  }

  // Quality control for what was just generated, and for the objective list
  // it serves. Both are no-ops when nothing needs scoring, and neither can
  // fail the step that called this.
  await refreshRecommendationQuality(tenantId, runId);
  await refreshObjectiveQuality(tenantId, runId);
  return failures;
}
