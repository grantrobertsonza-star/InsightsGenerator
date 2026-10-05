import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { syncResearchObjective } from "./runSync";

const MAX_FINDINGS_FOR_PROMPT = 120;

/**
 * Runs once a run has findings to read, one stage upstream of the decision
 * framer. Its job is to propose a research objective or hypothesis, written
 * in ordinary market-research objective form ("To determine whether..."),
 * that this project's evidence supports proposing, not to invent one from
 * nothing and not to summarise what the findings say.
 *
 * This is deliberately not the same move as generating a hypothesis before
 * data collection and then testing it against that same data (HARKing,
 * hypothesizing after results are known), which would be a real
 * methodological problem. Insights Elevator works on documents that already
 * exist, so a candidate objective here is a reverse-engineering of an
 * implicit framing grounded in what the evidence covers, not a claim that
 * the evidence confirms a hypothesis formed independently of it. That
 * distinction governs what the model is told to keep in mind, not how the
 * objective itself reads, an objective should look like a normal research
 * objective, not a hedged description of itself. A researcher's own
 * upfront objective text (if any) is weighted far more heavily than the
 * findings list, for the same reason the decision framer weights a
 * researcher's own context: their own framing is a stronger signal than a
 * pattern-match against evidence they haven't interpreted themselves yet.
 */
export async function generateObjectiveCandidates(
  tenantId: string,
  runId: string
): Promise<{ id: string; candidate_text: string }[]> {
  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      business_problem: string | null;
      research_objective: string | null;
      initial_research_objective: string | null;
    }>(
      "select business_problem, research_objective, initial_research_objective from runs where id = $1",
      [runId]
    );
    return result.rows[0];
  });

  if (!run) {
    throw new Error("Run not found");
  }

  const findings = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ finding_text: string; theme: string | null }>(
      "select finding_text, theme from findings where run_id = $1 order by theme nulls last limit $2",
      [runId, MAX_FINDINGS_FOR_PROMPT]
    );
    return result.rows;
  });

  if (findings.length === 0) {
    throw new Error(
      "No findings have been extracted yet for this run. The objective framer needs at least one " +
        "document's worth of extracted, generated, or coded findings to propose objective candidates against."
    );
  }

  const findingsBlock = findings.map((f) => `- [${f.theme ?? "Uncategorized"}] ${f.finding_text}`).join("\n");

  const hasProblem = Boolean(run.business_problem && run.business_problem.trim().length > 0);

  // initial_research_objective, not research_objective, is "the researcher's
  // own starting point": research_objective is a live value that gets
  // overwritten the moment any objective candidate is accepted or rejected
  // (it's kept in sync with whatever's currently accepted, joined and
  // numbered once there's more than one), while initial_research_objective
  // is a one-time snapshot taken at project creation and never touched
  // again. Using the live value here would mean a second run of this
  // framer reads its own already-numbered prior output back as though it
  // were the researcher's unprocessed starting text, and re-proposes it as
  // a new candidate, the bug this distinction exists to avoid.
  const hasUpfrontObjective = Boolean(
    run.initial_research_objective && run.initial_research_objective.trim().length > 0
  );

  const problemBlock = hasProblem
    ? `The business problem behind this project is: "${run.business_problem}".\n\n`
    : "No business problem was given for this project.\n\n";

  const upfrontBlock = hasUpfrontObjective
    ? "The researcher has already given the following as a starting objective or hypothesis for this " +
      "run (treat it as the strongest signal of what actually matters here, well above the evidence " +
      `list below):\n\n"${run.initial_research_objective}"\n\n`
    : "The researcher has not given a starting objective for this run. Propose candidates from the " +
      "evidence and business problem alone.\n\n";

  const hasAcceptedObjectives = Boolean(run.research_objective && run.research_objective.trim().length > 0);
  const alreadyAcceptedBlock = hasAcceptedObjectives
    ? "One or more objectives have already been accepted for this run: " +
      `"${run.research_objective}". Do not propose a candidate that just restates one of these; propose ` +
      "genuinely different objectives the evidence could also support.\n\n"
    : "";

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You propose the research objective or hypothesis a market research project's evidence is best " +
      "read as addressing. Write each candidate in standard market-research objective form, the way it " +
      "would appear in a research brief: \"To determine whether...\", \"To assess the relationship " +
      "between...\", \"To understand...\". Do not hedge the objective's own wording with phrases like " +
      "\"this evidence appears organized to\" or \"this evidence appears to test\", that reads as " +
      "stilted and unlike how a researcher actually writes an objective; the rationale field, not the " +
      "objective text itself, is where you name which evidence supports proposing it.\n\n" +
      "This still runs on documents that already exist rather than data not yet collected, so keep one " +
      "discipline in mind without it leaking into the wording: an objective states what the project " +
      "sets out to learn, not a finding already reached. Good: \"To determine whether price sensitivity " +
      "or service dissatisfaction is the stronger driver of member churn.\" Bad: \"Price sensitivity is " +
      "the main driver of member churn.\" The bad example states a conclusion as settled fact, which is " +
      "a finding, not an objective, and overclaims what a single evidence set can establish on its own.\n\n" +
      problemBlock +
      upfrontBlock +
      alreadyAcceptedBlock +
      "Propose three to five candidate objectives or hypotheses. For each, give a short rationale naming " +
      "which themes in the evidence support proposing it. Do not invent an objective the evidence has " +
      "nothing to do with, and do not propose two candidates that are really the same question worded " +
      "differently.",
    tool_choice: { type: "tool", name: "record_objective_candidates" },
    tools: [
      {
        name: "record_objective_candidates",
        description: "Records candidate research objectives or hypotheses this run's evidence supports proposing.",
        input_schema: {
          type: "object",
          properties: {
            candidates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  candidate_text: {
                    type: "string",
                    description: "The candidate objective or hypothesis, in standard research-brief form (e.g. \"To determine whether...\").",
                  },
                  rationale: {
                    type: "string",
                    description: "Which themes in the evidence support proposing this objective.",
                  },
                },
                required: ["candidate_text", "rationale"],
              },
            },
          },
          required: ["candidates"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here are the findings and themes extracted from this run's documents so far:\n\n${findingsBlock}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "objective_framer", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Did not return a structured objective candidate list");
  }

  const rawInput = toolUse.input as { candidates?: unknown };
  const rawCandidates = Array.isArray(rawInput.candidates) ? rawInput.candidates : [];

  const validCandidates = rawCandidates.filter(
    (c): c is { candidate_text: string; rationale: string } =>
      typeof (c as Record<string, unknown>).candidate_text === "string" &&
      ((c as Record<string, unknown>).candidate_text as string).trim().length > 0 &&
      typeof (c as Record<string, unknown>).rationale === "string" &&
      ((c as Record<string, unknown>).rationale as string).trim().length > 0
  );

  if (validCandidates.length === 0) {
    const diagnostic =
      rawCandidates.length === 0
        ? "the model returned zero candidates"
        : `the model returned ${rawCandidates.length} candidate(s), but none had both a candidate_text and a rationale`;
    throw new Error(
      `No usable objective candidates came back this time (${diagnostic}). Nothing was changed, try again.`
    );
  }

  const inserted = await withTenant(tenantId, async (client) => {
    const rows: { id: string; candidate_text: string }[] = [];

    try {
      await client.query("begin");

      // Re-running the framer replaces its previous AI-suggested
      // candidates rather than piling up duplicates. This now has to catch
      // 'accepted' rows too, not just 'pending' ones: every ai_suggested
      // candidate lands as accepted immediately (see generateObjectiveCandidates
      // in refreshObjectiveCandidates), so a candidate the researcher never
      // actually looked at is indistinguishable, by status alone, from one
      // they deliberately kept. edited = false is what actually marks "never
      // touched by a human": accepting with an edit, or any other explicit
      // action, is the signal that this specific candidate should survive a
      // regenerate. Rejected candidates are left alone either way, that's
      // its own explicit decision, not something a regenerate should undo.
      await client.query(
        `delete from objective_candidates
         where run_id = $1 and source = 'ai_suggested' and status != 'rejected' and edited = false`,
        [runId]
      );

      // The researcher's own upfront objective, if any, is carried into the
      // same list as a candidate in its own right, matched on trimmed text
      // against any existing candidate so re-running this never duplicates
      // a card that already reads the same.
      if (hasUpfrontObjective) {
        const trimmedUpfront = run.initial_research_objective!.trim();
        const existingOwn = await client.query(
          "select id from objective_candidates where run_id = $1 and trim(candidate_text) = $2",
          [runId, trimmedUpfront]
        );
        if (existingOwn.rows.length === 0) {
          const ownResult = await client.query<{ id: string; candidate_text: string }>(
            `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
             values ($1, $2, $3, $4, 'researcher_authored', 'accepted')
             returning id, candidate_text`,
            [
              tenantId,
              runId,
              run.initial_research_objective,
              "Carried over from the researcher's own starting text for this run.",
            ]
          );
          rows.push(ownResult.rows[0]);
        }
      }

      for (const candidate of validCandidates) {
        const result = await client.query<{ id: string; candidate_text: string }>(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, $4, 'ai_suggested', 'accepted')
           returning id, candidate_text`,
          [tenantId, runId, candidate.candidate_text, candidate.rationale]
        );
        rows.push(result.rows[0]);
      }

      // Everything above just landed already accepted (see the status
      // literals), so runs.research_objective needs to pick that up now,
      // not only on a later manual accept click. Still inside the same
      // transaction, so a rollback on failure undoes this with everything
      // else.
      await syncResearchObjective(client, runId);

      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }

    return rows;
  });

  return inserted;
}
