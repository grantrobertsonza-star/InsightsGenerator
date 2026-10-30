import { loadObjectiveLines, objectivesFramingLine, OBJECTIVES_ARE_CONTEXT } from "./projectObjectives";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { finishedToolInput, UnfinishedModelResultError } from "./modelToolResult";
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

type NotWrittenReason = "omitted" | "malformed" | "unsupported_figures" | "call_failed";
type NotWrittenFinding = { findingId: string; reason: NotWrittenReason };
type ChunkOutcome = { writtenIds: string[]; notWritten: NotWrittenFinding[]; failure?: string };

/**
 * What one pass did, by finding identity (EC10K-F01). `attempted` findings (at most
 * MAX_FINDINGS_FOR_INSIGHT) were each written or are in `notWritten` with the reason; `remaining` is
 * every eligible verified finding still without a pre-insight after the pass, counted live, which
 * includes the ones beyond this pass's limit. Complete only when `remaining` is 0.
 */
export type InsightPassResult = {
  /** A "validate" run with no decision confirmed yet: nothing is drafted, and that is not a gap. */
  waitingForDecision: boolean;
  attempted: number;
  written: number;
  notWritten: NotWrittenFinding[];
  remaining: number;
  failures: string[];
};

// Which verified findings are owed a pre-insight: not rejected, LATEST verdict robust or
// use_with_caution, and no pre-insight yet. One definition for the selection and the live count.
// $1 is the run.
const ELIGIBLE_FINDINGS = `from findings f
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
         and not exists (select 1 from insights i where i.finding_id = f.id)`;

async function countFindingsWithoutInsight(client: Pick<PoolClient, "query">, runId: string): Promise<number> {
  const r = await client.query<{ n: number }>(`select count(*)::int as n ${ELIGIBLE_FINDINGS}`, [runId]);
  return r.rows[0]?.n ?? 0;
}

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
export async function generateInsights(tenantId: string, runId: string, options: { skip?: ReadonlySet<string> } = {}): Promise<InsightPassResult> {
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

  // A project deleted meanwhile is owed nothing.
  if (!run) return { waitingForDecision: false, attempted: 0, written: 0, notWritten: [], remaining: 0, failures: [] };

  const decisionContext = run.decision_statement;
  if (run.entry_point === "validate" && !decisionContext) {
    // Nothing to frame insights against yet; the researcher hasn't
    // confirmed a decision on the Decision brief screen. This isn't an
    // error, insight generation will pick up again automatically (via the
    // same trigger acceptDecisionCandidate calls) once one is accepted.
    return { waitingForDecision: true, attempted: 0, written: 0, notWritten: [], remaining: 0, failures: [] };
  }
  const skip = [...(options.skip ?? [])];

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
       ${ELIGIBLE_FINDINGS}
         and not (f.id = any($3::uuid[]))
       order by f.theme nulls last, f.created_at, f.id
       limit $2`,
      [runId, MAX_FINDINGS_FOR_INSIGHT, skip]
    );
    return result.rows;
  });

  const passResult = async (written: number, notWritten: NotWrittenFinding[], failures: string[]): Promise<InsightPassResult> => ({
    waitingForDecision: false,
    attempted: eligible.length,
    written,
    notWritten,
    // Counted live after the writes, with the same eligibility rule, so a finding drafted by a
    // concurrent pass counts as covered and one added meanwhile counts as remaining.
    remaining: await withTenant(tenantId, (client) => countFindingsWithoutInsight(client, runId)),
    failures,
  });
  if (eligible.length === 0) return passResult(0, [], []);

  // CE-2: the accepted objectives (or the free text), in both modes, as context only.
  const objectiveLines = await withTenant(tenantId, (client) => loadObjectiveLines(client, runId, run.research_objective));
  const framingBlock =
    run.entry_point === "validate"
      ? `This project's confirmed decision(s): "${decisionContext}". Judge each finding's tension and ` +
        "implication against these specific decision(s): does it push toward one option, complicate a " +
        "choice, or narrow which option looks safer. Where more than one decision is listed, note which " +
        "one(s) a given finding actually bears on rather than assuming it speaks to all of them.\n\n" +
        (objectivesFramingLine(objectiveLines) ? `${objectivesFramingLine(objectiveLines)} ${OBJECTIVES_ARE_CONTEXT}\n\n` : "")
      : [
          run.business_problem ? `Business problem: "${run.business_problem}"` : null,
          objectivesFramingLine(objectiveLines),
          "No decision has been made yet for this project, that comes after this step. Judge each " +
            "finding's tension and implication against the problem/objective above (or, if neither was " +
            "given, against what a stakeholder in this space would plausibly care about): what does it " +
            "complicate or clarify, and what does it point toward, without naming a specific decision " +
            "as though one had already been chosen.",
        ]
          .filter(Boolean)
          .join("\n") + "\n\n";

  // One round over the given findings, in chunks. Every finding in a chunk ends up written or in
  // notWritten with a reason (EC10K-F01): a chunk whose call fails or is unfinished (EC10K-F02)
  // puts all of its findings there as call_failed.
  const draftRound = async (findings: VerifiedFinding[]): Promise<ChunkOutcome[]> => {
    const chunks: VerifiedFinding[][] = [];
    for (let start = 0; start < findings.length; start += INSIGHT_CHUNK_SIZE) chunks.push(findings.slice(start, start + INSIGHT_CHUNK_SIZE));
    return mapWithConcurrency(chunks, INSIGHT_CONCURRENCY, async (batch, chunkIndex): Promise<ChunkOutcome> => {
      // mapWithConcurrency requires fn not to throw (see its own doc comment): an uncaught error
      // here would abort every other chunk, including ones already in flight.
      try {
        return await generateInsightsForChunk(tenantId, runId, decisionContext, framingBlock, batch);
      } catch (error) {
        return {
          writtenIds: [],
          notWritten: batch.map((f) => ({ findingId: f.id, reason: "call_failed" as const })),
          failure: `${batch.length} finding(s) starting at index ${chunkIndex * INSIGHT_CHUNK_SIZE}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });
  };

  const first = await draftRound(eligible);
  // A finished answer that left findings out (no entry for their index) or returned an entry with a
  // blank part is asked once more for just those findings, in this pass: the model covering 14 of 15
  // is an ordinary partial answer, not a reason to leave the 15th for a later trigger. A failed or
  // unfinished call is not repeated here (nothing from it is used; the next pass or the researcher's
  // retry asks again), and neither is an insight held back for an unsupported figure.
  const askAgain = new Set(first.flatMap((o) => o.notWritten.filter((n) => n.reason === "omitted" || n.reason === "malformed").map((n) => n.findingId)));
  const second = askAgain.size > 0 ? await draftRound(eligible.filter((f) => askAgain.has(f.id))) : [];
  const writtenIds = new Set([...first, ...second].flatMap((o) => o.writtenIds));
  const lastReason = new Map<string, NotWrittenReason>();
  for (const o of [...first, ...second]) for (const n of o.notWritten) lastReason.set(n.findingId, n.reason);
  const notWritten = eligible
    .filter((f) => !writtenIds.has(f.id) && lastReason.has(f.id))
    .map((f) => ({ findingId: f.id, reason: lastReason.get(f.id)! }));
  const failures = [...first, ...second].map((o) => o.failure).filter((x): x is string => !!x);

  const result = await passResult(writtenIds.size, notWritten, failures);
  if (writtenIds.size === 0 && notWritten.length > 0) {
    const detail = failures.length > 0 ? ` (${failures.join("; ")})` : "";
    throw new Error(`No usable insights came back this time${detail}. Nothing was changed, try again.`);
  }
  if (notWritten.length > 0) {
    // Some were written and some were not: recorded with every finding left out and why, so the
    // gap is observable. Those findings stay eligible for the next pass.
    await withTenant(tenantId, async (client) => {
      await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_generator_partial', $3)`, [
        tenantId,
        runId,
        JSON.stringify({ written: writtenIds.size, not_written: notWritten, remaining: result.remaining, failures }),
      ]);
    });
  }
  return result;
}

async function generateInsightsForChunk(
  tenantId: string,
  runId: string,
  decisionContext: string | null,
  framingBlock: string,
  batch: VerifiedFinding[],
): Promise<ChunkOutcome> {
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

    // EC10K-F02: only a finished record_insights call is used (modelToolResult.ts); a cut-off,
    // refused or other-tool answer throws here and the whole chunk counts as call_failed.
    const input = finishedToolInput(response, "record_insights", "The insight drafting");
    // The model sometimes returns a large array as a JSON string instead of
    // an array. Accept that rather than discarding a complete answer.
    let rawField: unknown = input.insights;
    if (typeof rawField === "string") {
      try {
        rawField = JSON.parse(rawField);
      } catch {
        // left as a string, refused below
      }
    }
    if (!Array.isArray(rawField)) {
      throw new UnfinishedModelResultError("malformed", "The insight drafting returned a result in the wrong shape (insights), so nothing from it was used. Try again.");
    }
    const rawInsights = rawField as unknown[];

    // EC10K-F01: every finding of the chunk is accounted for by its id. The first complete entry for an
    // index is used; an entry with a blank part, an index outside the list or a repeat does not cover
    // anything, so a finding with no complete entry is "omitted" or "malformed", never silently lost.
    const prepared: PreparedInsight[] = [];
    const reason = new Map<string, NotWrittenReason>();
    const skippedFigures: string[] = [];
    for (const item of rawInsights) {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const index = typeof raw.index === "number" && Number.isInteger(raw.index) && raw.index >= 0 && raw.index < batch.length ? raw.index : null;
      if (index === null) continue;
      const f = batch[index];
      if (prepared.some((p) => p.findingId === f.id) || reason.get(f.id) === "unsupported_figures") continue;
      const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
      const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
      const tension = typeof raw.tension === "string" ? raw.tension.trim() : "";
      const implication = typeof raw.implication === "string" ? raw.implication.trim() : "";
      if (!headline || !observation || !tension || !implication) {
        reason.set(f.id, "malformed");
        continue;
      }
      // Numerical traceability (numberTrace.ts): every figure must come from this finding, its
      // verification note or the project's stated framing, in context. An unsupported figure keeps
      // the pre-insight out (the finding stays eligible for the next pass); a figure whose context
      // cannot be established is saved with a "needs review" mark.
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
        reason.set(f.id, "unsupported_figures");
        continue;
      }
      reason.delete(f.id);
      prepared.push({ findingId: f.id, headline, observation, tension, implication, figureCheck: check, supportParts: f.support_parts ?? undefined });
    }
    for (const f of batch) {
      if (!prepared.some((p) => p.findingId === f.id) && !reason.has(f.id)) reason.set(f.id, "omitted");
    }
    const notWritten = [...reason].map(([findingId, why]) => ({ findingId, reason: why }));
    const counts = (why: NotWrittenReason) => notWritten.filter((n) => n.reason === why).length;
    const failure =
      notWritten.length > 0
        ? `${notWritten.length} of ${batch.length} finding(s) not written (left out of the answer: ${counts("omitted")}, ` +
          `blank part: ${counts("malformed")}, unsupported figures: ${counts("unsupported_figures")})` +
          (skippedFigures.length > 0 ? `; ${skippedFigures.slice(0, 5).join("; ")}` : "")
        : undefined;

    const writtenIds: string[] = [];
    if (prepared.length > 0) {
      await withTenant(tenantId, async (client) => {
        const storeCheck = await figureCheckAvailable(client);
        for (const insight of prepared) {
          const inserted = await client.query(
            // on conflict: a concurrent generation pass on the same run could
            // race this one past the "not exists" eligibility check above for
            // the same finding_id; insights.finding_id is unique (see
            // 0022_dedupe_insights.sql), so whichever insert won is kept. Only
            // a row this statement inserted counts as written here; the
            // finding is covered either way, and the pass's live count says so.
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
          if (inserted.rowCount === 1) writtenIds.push(insight.findingId);
        }
      });
    }

  return { writtenIds, notWritten, ...(failure ? { failure } : {}) };
}

/** How many passes one automatic refresh makes before it reports what is left (60 findings a pass). */
export const MAX_AUTOMATIC_INSIGHT_PASSES = 8;

/**
 * Safe wrapper for every automatic trigger point, same reasoning as
 * refreshVerdicts: an insight-generation failure never blocks whatever the
 * researcher actually clicked. Also the one this app calls from
 * acceptDecisionCandidate, since for a "validate" run that's the moment
 * generateInsights stops being a no-op.
 *
 * Returns null only when every eligible verified finding has a pre-insight (or a "validate" run is
 * still waiting for its decision); otherwise the reason, recorded in the trace (EC10K-F01). Before,
 * it returned null whenever no pass threw: findings a pass left out, and the ones beyond its pass
 * limit (481 to 500 of 500), were never reported. Passes continue while each one writes something;
 * a finding a pass could not write is not offered again in this refresh, so later passes reach the
 * rest, and it stays eligible for the next refresh or retry, which never duplicates (one pre-insight
 * per finding).
 */
export async function refreshInsights(tenantId: string, runId: string): Promise<string | null> {
  try {
    const skip = new Set<string>();
    let last: InsightPassResult | null = null;
    let passes = 0;
    while (passes < MAX_AUTOMATIC_INSIGHT_PASSES) {
      passes += 1;
      last = await generateInsights(tenantId, runId, { skip });
      if (last.waitingForDecision || last.remaining === 0) return null;
      for (const n of last.notWritten) skip.add(n.findingId);
      if (last.written === 0) break;
    }
    const remaining = last?.remaining ?? 0;
    const notWritten = [...skip].length;
    const message =
      `${remaining} verified finding(s) still have no insight after ${passes} pass(es)` +
      (notWritten > 0 ? `; ${notWritten} could not be written this time (${(last?.failures ?? []).slice(0, 3).join("; ") || "see the generation log"})` : "") +
      (remaining > notWritten ? `; ${remaining - notWritten} were not reached within the pass limit` : "") +
      ". The insights written are kept; running it again drafts only the rest.";
    await withTenant(tenantId, async (client) => {
      await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'insight_generator_incomplete', $3)`, [
        tenantId,
        runId,
        JSON.stringify({ message, remaining, passes, not_written: notWritten }),
      ]);
    });
    return message;
  } catch (error) {
    // A pass that wrote nothing throws; the count of what is still owed is added when it can be read.
    const gap = await loadInsightCoverageGap(tenantId, runId);
    const owed = gap.uncovered !== null && gap.uncovered > 0 ? ` ${gap.uncovered} verified finding(s) still have no insight.` : "";
    const message = (error instanceof Error ? error.message : String(error)) + owed;
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

/**
 * Whether every eligible verified finding has a pre-insight, counted now (EC10K-F01): the screen's
 * statement of incomplete coverage. `uncovered` is null when the count could not be read (shown as
 * not known, never as complete); a "validate" run without a decision yet is not a gap.
 */
export async function loadInsightCoverageGap(
  tenantId: string,
  runId: string,
): Promise<{ uncovered: number | null; waitingForDecision: boolean; error: string | null }> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const run = await client.query<{ entry_point: string | null; decision_statement: string | null }>("select entry_point, decision_statement from runs where id = $1", [runId]);
      const r = run.rows[0];
      if (!r) throw new Error("Project not found");
      if (r.entry_point === "validate" && !r.decision_statement) return { uncovered: 0, waitingForDecision: true, error: null };
      return { uncovered: await countFindingsWithoutInsight(client, runId), waitingForDecision: false, error: null };
    });
  } catch (error) {
    return { uncovered: null, waitingForDecision: false, error: error instanceof Error ? error.message : String(error) };
  }
}
