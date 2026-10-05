import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";

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
};

type PreparedInsight = {
  findingId: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
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
export async function generateInsights(tenantId: string, runId: string): Promise<void> {
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

  if (!run) return;

  const decisionContext = run.decision_statement;
  if (run.entry_point === "validate" && !decisionContext) {
    // Nothing to frame insights against yet; the researcher hasn't
    // confirmed a decision on the Decision brief screen. This isn't an
    // error, insight generation will pick up again automatically (via the
    // same trigger acceptDecisionCandidate calls) once one is accepted.
    return;
  }

  const eligible = await withTenant(tenantId, async (client) => {
    const result = await client.query<VerifiedFinding>(
      `select f.id, f.finding_text, f.theme, v.verdict_tier, v.rationale as verdict_rationale
       from findings f
       join verdicts v on v.finding_id = f.id
       where f.run_id = $1
         and f.status != 'rejected'
         and v.verdict_tier in ('robust', 'use_with_caution')
         and not exists (select 1 from insights i where i.finding_id = f.id)
       order by f.theme nulls last, f.created_at
       limit $2`,
      [runId, MAX_FINDINGS_FOR_INSIGHT]
    );
    return result.rows;
  });

  if (eligible.length === 0) return;

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
          `${index}. [${f.theme ?? "Uncategorized"} · verdict: ${f.verdict_tier}] ${f.finding_text}\n` +
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
    const rawInsights =
      toolUse && toolUse.type === "tool_use" && Array.isArray((toolUse.input as { insights?: unknown }).insights)
        ? ((toolUse.input as { insights: unknown[] }).insights as Record<string, unknown>[])
        : [];

    const prepared: PreparedInsight[] = [];
    for (const raw of rawInsights) {
      const index = typeof raw.index === "number" ? raw.index : null;
      const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
      const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
      const tension = typeof raw.tension === "string" ? raw.tension.trim() : "";
      const implication = typeof raw.implication === "string" ? raw.implication.trim() : "";
      if (index === null || index < 0 || index >= batch.length) continue;
      if (!headline || !observation || !tension || !implication) continue;
      prepared.push({ findingId: batch[index].id, headline, observation, tension, implication });
    }

    if (prepared.length === 0) {
      return {
        written: 0,
        failure: `${batch.length} finding(s) starting at index ${chunkIndex * INSIGHT_CHUNK_SIZE} (stop reason: ${response.stop_reason ?? "unknown"})`,
      };
    }

    await withTenant(tenantId, async (client) => {
      for (const insight of prepared) {
        await client.query(
          // on conflict: a concurrent generation pass on the same run could
          // race this one past the "not exists" eligibility check above for
          // the same finding_id; once insights.finding_id has a unique
          // constraint (see 0022_dedupe_insights.sql) this silently keeps
          // whichever insert won instead of throwing, rather than failing
          // the whole chunk over a race neither side could see coming.
          `insert into insights (tenant_id, run_id, finding_id, decision_context, headline, observation, tension, implication)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
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
          ]
        );
      }
    });

  return { written: prepared.length };
}

/**
 * Safe wrapper for every automatic trigger point, same reasoning as
 * refreshVerdicts: an insight-generation failure never blocks whatever the
 * researcher actually clicked. Also the one this app calls from
 * acceptDecisionCandidate, since for a "validate" run that's the moment
 * generateInsights stops being a no-op.
 */
export async function refreshInsights(tenantId: string, runId: string): Promise<void> {
  try {
    await generateInsights(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_generator_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}
