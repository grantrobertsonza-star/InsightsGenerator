import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";
import { BASIS_LABEL, findingBasis } from "./findingBasis";
import { figureCheck, type FigureCheck } from "./numberTrace";
import { figureCheckAvailable } from "./figureChecks";
import { preInsightSupportSnapshotAvailable } from "./supportStatus";

const MAX_FINDINGS_FOR_INSIGHT = 60;

// Written in chunks rather than one call for the whole eligible set, same
// reasoning as verifyFindings's chunking: a run with several dozen eligible
// findings needs a correspondingly large completion (four written fields
// per finding), and a single oversized call can run past its token budget
// and get cut off before the tool call is complete. A cut-off call used to
// mean the whole batch came back with nothing usable and the run reported
// "No usable insights came back this time" even though most findings were
// perfectly insight-able. Chunking keeps each call's expected output
// comfortably inside budget and lets the findings in earlier chunks get
// written even if a later chunk's call comes back short.
const INSIGHT_CHUNK_SIZE = 15;
// How many chunk API calls run at once.
const INSIGHT_CONCURRENCY = 3;

type VerifiedFinding = {
  id: string;
  finding_text: string;
  theme: string | null;
  verdict_tier: "robust" | "use_with_caution";
  verdict_rationale: string;
  origin?: "stated" | "generated" | "coded";
  pattern_type?: string | null;
  stated_stats?: Record<string, unknown> | null;
  /** finding_support_parts() as this pass read the finding (0103 applied), else undefined. */
  support_parts?: unknown;
};

type PreparedInsight = {
  findingId: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  figureCheck: FigureCheck;
  /** The finding's fingerprint as read for the prompt (0103); undefined when not recorded. */
  supportParts?: unknown;
};

/**
 * Generates one insight per verified finding: a headline, the observation
 * itself, the tension it creates (what's surprising, or what it complicates
 * about the existing picture), and the implication that follows from it.
 * Only findings verified as 'robust' or 'use_with_caution' are eligible;
 * 'not_supported' and 'insufficient_information' findings never reach this
 * step, an insight built on an unverified or rejected finding wouldn't be
 * traceable to anything solid.
 *
 * Mode depends on the run's entry point, per the two shapes a research
 * process actually takes here:
 *
 * "generate" (mining raw data with no existing narrative) runs the
 * ordinary pyramid: verified findings first, insight synthesized from them
 * next, and a decision proposed or refined from the insights afterward.
 * There is no decision yet when this runs, so decision_context is left
 * null, and the prompt frames tension/implication against the business
 * problem or research objective instead of a decision that doesn't exist.
 *
 * "validate" (a report that already makes claims) keeps the schema's
 * original shape: a decision is confirmed first, and every insight is
 * generated in light of it, decision_context is that decision's text. This
 * function no-ops until a decision exists for a "validate" run, it does not
 * substitute the objective or problem in decision_context's place, since
 * that would blur the two modes rather than keep them distinct.
 */
export async function generateInsights(tenantId: string, runId: string): Promise<boolean> {
  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      entry_point: "generate" | "validate" | null;
      decision_statement: string | null;
      research_objective: string | null;
      business_problem: string | null;
    }>(
      "select entry_point, decision_statement, research_objective, business_problem from runs where id = $1",
      [runId]
    );
    return result.rows[0];
  });

  if (!run) return false;

  const decisionContext = run.decision_statement;
  if (run.entry_point === "validate" && !decisionContext) {
    // Nothing to frame insights against yet; the researcher hasn't
    // confirmed a decision on the Decision brief screen. This isn't an
    // error, insight generation will pick up again automatically (via the
    // same trigger acceptDecisionCandidate calls) once one is accepted.
    return false;
  }

  const eligible = await withTenant(tenantId, async (client) => {
    // FND-001 for pre-insights (0103): the finding's fingerprint is read with the text the prompt
    // uses, in the same statement, so the stored snapshot is what the model actually saw.
    // Eligibility, the prompt's verdict and rationale, and the snapshot all use the one LATEST
    // verdict per finding, in the order finding_support_parts() uses (created_at desc, id desc).
    // Joining every verdict let an older robust verdict qualify a finding whose latest verdict
    // refuses it (not_supported, insufficient_information), and could draft one finding twice when
    // it had several qualifying verdicts (Codex review of ffa7adc, GT-006).
    const recordSupport = await preInsightSupportSnapshotAvailable(client);
    const result = await client.query<VerifiedFinding>(
      `select f.id, f.finding_text, f.theme, v.verdict_tier, v.rationale as verdict_rationale,
              f.origin, f.pattern_type, f.stated_stats${recordSupport ? ", finding_support_parts(f.id) as support_parts" : ""}
       from findings f
       join lateral (
         select lv.verdict_tier, lv.rationale
         from verdicts lv
         where lv.finding_id = f.id
         order by lv.created_at desc, lv.id desc
         limit 1
       ) v on true
       where f.run_id = $1
         and f.status != 'rejected'
         and v.verdict_tier in ('robust', 'use_with_caution')
         and not exists (select 1 from insights i where i.finding_id = f.id)
       order by f.theme nulls last, f.created_at
       limit $2`,
      [runId, MAX_FINDINGS_FOR_INSIGHT + 1]
    );
    return result.rows;
  });

  // More than one pass worth: write this pass's share and tell the caller to come back for the rest.
  const hasMore = eligible.length > MAX_FINDINGS_FOR_INSIGHT;
  if (hasMore) eligible.length = MAX_FINDINGS_FOR_INSIGHT;
  if (eligible.length === 0) return false;

  const framingBlock =
    run.entry_point === "validate"
      ? `This project's confirmed decision(s): "${decisionContext}". Judge each finding's tension and ` +
        "implication against these specific decision(s): does it push toward one option, complicate a " +
        "choice, or narrow which option looks safer. Where more than one decision is listed, note which " +
        "one(s) a given finding actually bears on rather than assuming it speaks to all of them.\n\n"
      : [
          run.business_problem ? `Business problem: "${run.business_problem}"` : null,
          run.research_objective ? `Research objective: "${run.research_objective}"` : null,
          "No decision has been made yet for this project, that comes after this step. Judge each " +
            "finding's tension and implication against the problem/objective above (or, if neither was " +
            "given, against what a stakeholder in this space would plausibly care about): what does it " +
            "complicate or clarify, and what does it point toward, without naming a specific decision " +
            "as though one had already been chosen.",
        ]
          .filter(Boolean)
          .join("\n") + "\n\n";

  const chunks: VerifiedFinding[][] = [];
  for (let start = 0; start < eligible.length; start += INSIGHT_CHUNK_SIZE) {
    chunks.push(eligible.slice(start, start + INSIGHT_CHUNK_SIZE));
  }

  type ChunkResult = { written: number; failure?: string };

  const chunkResults = await mapWithConcurrency(chunks, INSIGHT_CONCURRENCY, async (batch, chunkIndex): Promise<ChunkResult> => {
    // mapWithConcurrency requires fn not to throw (see its own doc comment):
    // an uncaught error here would abort every other chunk's Promise.all,
    // including ones already in flight, rather than just this one chunk
    // failing. validateStatedInsights.ts gets this right already; this
    // wraps the whole chunk the same way so one rate-limited or transient
    // API error doesn't take the rest of the batch down with it.
    try {
      return await generateInsightsForChunk(tenantId, runId, decisionContext, framingBlock, batch, chunkIndex);
    } catch (error) {
      return {
        written: 0,
        failure: `${batch.length} finding(s) starting at index ${chunkIndex * INSIGHT_CHUNK_SIZE}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  });

  let totalWritten = 0;
  const chunkFailures: string[] = [];
  for (const result of chunkResults) {
    totalWritten += result.written;
    if (result.failure) chunkFailures.push(result.failure);
  }

  if (totalWritten === 0) {
    const detail = chunkFailures.length > 0 ? ` (${chunkFailures.join("; ")})` : "";
    throw new Error(`No usable insights came back this time${detail}. Nothing was changed, try again.`);
  }
  if (chunkFailures.length > 0) {
    // Some were written and some were not (a failed batch, or insights held back for unsupported
    // figures): recorded, so the gap is observable. The findings left out stay eligible for the
    // next pass.
    await withTenant(tenantId, async (client) => {
      await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_generator_partial', $3)`, [
        tenantId,
        runId,
        JSON.stringify({ written: totalWritten, failures: chunkFailures }),
      ]);
    });
  }
  return hasMore;
}

async function generateInsightsForChunk(
  tenantId: string,
  runId: string,
  decisionContext: string | null,
  framingBlock: string,
  batch: VerifiedFinding[],
  chunkIndex: number
): Promise<{ written: number; failure?: string }> {
  const findingsBlock = batch
      .map(
        (f, index) =>
          `${index}. [${f.theme ?? "Uncategorized"} · verdict: ${f.verdict_tier}${
            f.origin ? ` · basis: ${BASIS_LABEL[findingBasis({ origin: f.origin, pattern_type: f.pattern_type, stated_stats: f.stated_stats })]}` : ""
          }] ${f.finding_text}\n` +
          `   Verification note: ${f.verdict_rationale}`
      )
      .join("\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system:
        "You write one insight per verified finding from a market research project. An insight has four " +
        "parts:\n" +
        "- headline: a short, specific statement of the insight, not the finding restated.\n" +
        "- observation: what the finding actually shows, stated plainly.\n" +
        "- tension: what's surprising about it, what it complicates, or what it conflicts with elsewhere " +
        "in the picture. If there genuinely isn't one, say plainly that it confirms the expected picture " +
        "rather than inventing a tension that isn't there.\n" +
        "- implication: what follows from this, stated as a consequence, not a restatement of the tension.\n\n" +
        framingBlock +
        "Each finding carries a basis. Word the insight to match it: a 'Reading, with interval' states a level " +
        "(a share, top-two box, NPS or average) and never a difference between groups; a 'Tested, no difference' " +
        "means no reliable difference was found, so say the groups look alike on this measure without claiming " +
        "they are equal, and treat that as a result worth acting on (for example, one approach will do for all " +
        "groups); a 'Modelled, driver analysis' finding says what goes with the outcome in this survey and ranks " +
        "questions by their share of the explained variation, never claims one question causes the outcome, and " +
        "must respect any unstable rank or weak fit in the finding; a 'Tested, significant' finding may be described as a difference. Where a finding is routine " +
        "and says little, say so in the tension rather than inventing drama.\n" +
        "Cover every finding listed below by its index. Keep each part to one or two sentences; this is a " +
        "component of a larger brief, not a standalone essay.",
      tool_choice: { type: "tool", name: "record_insights" },
      tools: [
        {
          name: "record_insights",
          description: "Records one insight per finding by its index in the list.",
          input_schema: {
            type: "object",
            properties: {
              insights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer", description: "The finding's index in the numbered list." },
                    headline: { type: "string" },
                    observation: { type: "string" },
                    tension: { type: "string" },
                    implication: { type: "string" },
                  },
                  required: ["index", "headline", "observation", "tension", "implication"],
                },
              },
            },
            required: ["insights"],
          },
        },
      ],
      messages: [{ role: "user", content: `Here are the verified findings:\n\n${findingsBlock}` }],
    });

    await logApiUsage(tenantId, runId, "insight_generator", response.usage);

    const toolUse = response.content.find((block) => block.type === "tool_use");
    // The model sometimes returns a large array as a JSON string instead of
    // an array. Accept that rather than discarding a complete answer.
    let rawField: unknown = toolUse && toolUse.type === "tool_use" ? (toolUse.input as { insights?: unknown }).insights : undefined;
    if (typeof rawField === "string") {
      try {
        rawField = JSON.parse(rawField);
      } catch {
        // left as a string, reported below
      }
    }
    const rawInsights = Array.isArray(rawField) ? (rawField as Record<string, unknown>[]) : [];

    const prepared: PreparedInsight[] = [];
    let skippedIndex = 0;
    let skippedEmpty = 0;
    const skippedFigures: string[] = [];
    for (const raw of rawInsights) {
      const index = typeof raw.index === "number" ? raw.index : null;
      const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
      const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
      const tension = typeof raw.tension === "string" ? raw.tension.trim() : "";
      const implication = typeof raw.implication === "string" ? raw.implication.trim() : "";
      if (index === null || index < 0 || index >= batch.length) {
        skippedIndex += 1;
        continue;
      }
      if (!headline || !observation || !tension || !implication) {
        skippedEmpty += 1;
        continue;
      }
      // Numerical traceability (numberTrace.ts): every figure must come from this finding, its
      // verification note or the project's stated framing, in context. An unsupported figure keeps
      // the pre-insight out (the finding stays eligible for the next pass); a figure whose context
      // cannot be established is saved with a "needs review" mark.
      const f = batch[index];
      const sources = [f.finding_text, f.verdict_rationale, f.stated_stats ? JSON.stringify(f.stated_stats) : "", framingBlock];
      const check = figureCheck(
        (["headline", "observation", "tension", "implication"] as const).map((field) => ({
          field,
          text: { headline, observation, tension, implication }[field],
          sources,
        })),
      );
      if (check.status === "unsupported") {
        skippedFigures.push(...check.figures.filter((x) => x.status === "unsupported").map((x) => `${x.text}: ${x.reason}`));
        continue;
      }
      prepared.push({ findingId: f.id, headline, observation, tension, implication, figureCheck: check, supportParts: f.support_parts ?? undefined });
    }

    if (prepared.length === 0) {
      return {
        written: 0,
        failure:
          `${batch.length} finding(s) starting at index ${chunkIndex * INSIGHT_CHUNK_SIZE} ` +
          `(stop reason: ${response.stop_reason ?? "unknown"}; items returned: ${rawInsights.length}, ` +
          `bad index: ${skippedIndex}, empty field: ${skippedEmpty}, unsupported figures: ${skippedFigures.length}, ` +
          `field type: ${Array.isArray(rawField) ? "array" : typeof rawField})` +
          (skippedFigures.length > 0 ? `; ${skippedFigures.slice(0, 5).join("; ")}` : ""),
      };
    }

    await withTenant(tenantId, async (client) => {
      const storeCheck = await figureCheckAvailable(client);
      for (const insight of prepared) {
        await client.query(
          // on conflict: a concurrent generation pass on the same run could
          // race this one past the "not exists" eligibility check above for
          // the same finding_id; once insights.finding_id has a unique
          // constraint (see 0022_dedupe_insights.sql) this silently keeps
          // whichever insert won instead of throwing, rather than failing
          // the whole chunk over a race neither side could see coming.
          `insert into insights (tenant_id, run_id, finding_id, decision_context, headline, observation, tension, implication${storeCheck ? ", figure_check" : ""}${insight.supportParts !== undefined ? ", support_snapshot" : ""})
           values ($1, $2, $3, $4, $5, $6, $7, $8${storeCheck ? ", $9" : ""}${insight.supportParts !== undefined ? `, $${storeCheck ? 10 : 9}::jsonb` : ""})
           on conflict (finding_id) do nothing`,
          [
            tenantId,
            runId,
            insight.findingId,
            decisionContext,
            insight.headline,
            insight.observation,
            insight.tension,
            insight.implication,
            ...(storeCheck ? [JSON.stringify(insight.figureCheck)] : []),
            ...(insight.supportParts !== undefined ? [JSON.stringify(insight.supportParts)] : []),
          ]
        );
      }
    });

  return {
    written: prepared.length,
    ...(skippedFigures.length > 0
      ? { failure: `${skippedFigures.length} figure(s) not supported by their finding, so those insights were not written: ${skippedFigures.slice(0, 5).join("; ")}` }
      : {}),
  };
}

/**
 * Safe wrapper for every automatic trigger point, same reasoning as
 * refreshVerdicts: an insight-generation failure never blocks whatever the
 * researcher actually clicked. Returns null on success or the failure's message. Also the one this app calls from
 * acceptDecisionCandidate, since for a "validate" run that's the moment
 * generateInsights stops being a no-op.
 */
export async function refreshInsights(tenantId: string, runId: string): Promise<string | null> {
  try {
    // Wide findings can run past one pass; keep going until nothing is left (at most 8 passes).
    for (let pass = 0; pass < 8; pass++) {
      const more = await generateInsights(tenantId, runId);
      if (!more) break;
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_generator_error', $3)`,
        [tenantId, runId, JSON.stringify({ message })]
      );
    });
    // Still never thrown (automatic triggers must not fail what the researcher clicked), but
    // returned, so a caller that must know whether insights are current can tell
    // (decisionRefresh.ts: a decision change keeps its "refresh owed" marker on failure).
    return message;
  }
}
