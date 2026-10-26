import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { lockRunForContextChange, syncResearchObjective } from "./runSync";
import { parseObjectiveLines } from "./objectiveLines";
import { suggestionsNotAlreadyOnRun } from "./candidateSuggestionFilter";

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
  runId: string,
  unmatchedInsightHeadlines?: string[]
): Promise<{ id: string; candidate_text: string }[]> {
  const run = await withTenant(tenantId, async (client) => {
    await client.query("savepoint obj_framer_initial_read");
    try {
      const result = await client.query<{
        business_problem: string | null;
        research_objective: string | null;
        initial_research_objective: string | null;
        objective_candidates_seeded: boolean;
      }>(
        "select business_problem, research_objective, initial_research_objective, objective_candidates_seeded from runs where id = $1",
        [runId]
      );
      await client.query("release savepoint obj_framer_initial_read");
      return result.rows[0];
    } catch (error) {
      // Migration 0084 not applied yet: no such column. Roll back to the savepoint so this
      // transaction isn't left aborted, then read without the new column and treat every
      // run as unseeded, same as before this fix - the pre-existing (fragile) line-matching
      // check further down still runs for everyone until the migration lands.
      const message = error instanceof Error ? error.message : String(error);
      if (!/objective_candidates_seeded/.test(message)) throw error;
      await client.query("rollback to savepoint obj_framer_initial_read");
      const result = await client.query<{
        business_problem: string | null;
        research_objective: string | null;
        initial_research_objective: string | null;
      }>(
        "select business_problem, research_objective, initial_research_objective from runs where id = $1",
        [runId]
      );
      return result.rows[0] ? { ...result.rows[0], objective_candidates_seeded: false } : undefined;
    }
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

  // initial_research_objective, not research_objective (and not
  // stated_objectives_text, the current editable list the Setup UI reads
  // and writes - see runContextActions.ts and OBJ-SET-M01), is "the
  // researcher's own starting point": research_objective is a live value
  // that gets overwritten the moment any objective candidate is accepted or
  // rejected (it's kept in sync with whatever's currently accepted, joined
  // and numbered once there's more than one), while initial_research_objective
  // is write-once - set only on a run's first save (coalesce in
  // saveRunContext) and never touched again by any later add, edit, or
  // delete. Using the live value here would mean a second run of this
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

  const unmatchedBlock =
    unmatchedInsightHeadlines && unmatchedInsightHeadlines.length > 0
      ? "The accepted insights below are not covered by any objective this project has stated. Prioritise " +
        "candidate objectives that these insights would answer, and name the insight in the rationale:\n" +
        unmatchedInsightHeadlines.map((h) => `- ${h}`).join("\n") +
        "\n\n"
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
      unmatchedBlock +
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
      // Codex OBJ500-F01: the run row first, as every candidate change does (runSync.ts), so a
      // regeneration and a researcher's accept, reject or delete are serialized.
      await lockRunForContextChange(client, runId, tenantId);

      // Re-running the framer replaces its previous AI-suggested
      // candidates rather than piling up duplicates, but only the ones a
      // human has not actually decided on. A suggestion's initial status
      // here is conditional, not a fixed "everything starts accepted" (OBJ-REV-M01):
      // it's 'accepted' when generated through refreshInferredObjectives's
      // no-stated-objective path, the common case, but 'pending' whenever
      // this is called with a stated objective already in place, which
      // happens on a manual "regenerate suggestions" click
      // (objectiveCandidateActions.ts's regenerateObjectiveCandidates) or
      // from objectiveCoverageActions.ts. refreshObjectiveCandidates in
      // page.tsx, despite its name, is a no-op and does not call this
      // function at all. This used to also delete 'accepted' rows as long
      // as their text was never edited, on the theory that only an edit
      // proved a human had looked at it - but accepting a suggestion
      // without changing its wording is itself a human decision to keep it
      // exactly as suggested, and deleting it anyway on the next
      // regeneration silently discarded that decision (OBJ-REV-004).
      // 'pending' is the only status that still means "never actually
      // decided" - 'accepted' and 'rejected' are both explicit outcomes a
      // regenerate must not undo.
      await client.query(
        `delete from objective_candidates
         where run_id = $1 and source = 'ai_suggested' and status = 'pending' and edited = false`,
        [runId]
      );

      // The researcher's own upfront objective, if any, is carried into the
      // same list as a candidate in its own right, matched on trimmed text
      // against any existing candidate so re-running this never duplicates
      // a card that already reads the same.
      // OBJ-SET-001/003: whether the upfront text is "already represented" used to be
      // re-derived every single regeneration by matching its individual lines, verbatim,
      // against whatever researcher_authored candidates happen to exist RIGHT NOW. That is
      // wrong in both directions once a researcher has actually interacted with the split
      // candidates: an edit changes a line's text so it no longer matches the original
      // (reinserting the stale blob alongside the edit), and a deletion removes the
      // candidate entirely (reinserting text the researcher deliberately took out). Neither
      // edited-but-present nor deleted-and-gone means "missing" - both are exactly the
      // researcher having already dealt with that line. objective_candidates_seeded is a
      // one-way marker set the moment this run's upfront text is first split into candidate
      // rows at all (on Setup's own first save, or right here for a legacy run that predates
      // that), and it is never reset by anything that happens to those rows afterward - so
      // it is what "already represented" actually means, not a live re-check against
      // current candidate text.
      if (hasUpfrontObjective && !run.objective_candidates_seeded) {
        const upfrontLines = parseObjectiveLines(run.initial_research_objective!.trim());
        const existingOwn = await client.query<{ t: string }>(
          "select trim(candidate_text) as t from objective_candidates where run_id = $1 and source = 'researcher_authored'",
          [runId]
        );
        const existingTexts = new Set(existingOwn.rows.map((r) => r.t));
        const alreadyRepresented =
          existingTexts.has(run.initial_research_objective!.trim()) ||
          (upfrontLines.length > 0 && upfrontLines.every((line) => existingTexts.has(line)));
        if (!alreadyRepresented) {
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
        // Seeded now regardless of which branch ran above: either this run's candidates
        // already represented the upfront text (nothing to carry over), or they do now
        // (just inserted) - either way, this upfront text has had its one chance to be
        // split into candidates, and no future edit or deletion of those candidates should
        // make it reappear. Best effort: a pre-migration-0084 database has no such column
        // to set, in which case this (fragile) check simply keeps running every time, same
        // as before this fix.
        // The plain .catch(() => {}) this had was not enough on its own: once this UPDATE fails
        // (migration 0084 not applied, no such column), the whole surrounding transaction is
        // marked aborted by Postgres, and every query still to come on this same client in this
        // same transaction - the AI-suggestion insert loop and commit further down - fails with
        // "current transaction is aborted", surfacing as an outright failure of this regenerate
        // call rather than the documented "fragile check keeps running every time" degradation.
        // A SAVEPOINT gives the missing-column case somewhere valid to roll back to.
        await client.query("savepoint obj_candidates_seeded_update");
        try {
          await client.query("update runs set objective_candidates_seeded = true where id = $1", [runId]);
          await client.query("release savepoint obj_candidates_seeded_update");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/objective_candidates_seeded/.test(message)) throw error;
          await client.query("rollback to savepoint obj_candidates_seeded_update");
        }
      }

      // Inferred objectives are accepted automatically only when the
      // researcher stated none (typed, or imported from a brief/proposal).
      // Once a stated objective exists, suggestions stay pending: the
      // researcher has already said what the project is for.
      const stated = await client.query(
        "select 1 from objective_candidates where run_id = $1 and source = 'researcher_authored' and status = 'accepted' limit 1",
        [runId]
      );
      const suggestionStatus = stated.rows.length > 0 ? "pending" : "accepted";

      // A suggestion whose wording is already on the run (rejected, accepted, edited or the
      // researcher's own) is not inserted again: re-adding a rejected one would undo that
      // rejection, re-adding a kept one would duplicate it (OBJ-REV-004).
      const newSuggestions = await suggestionsNotAlreadyOnRun(client, "objective_candidates", runId, validCandidates);
      // Inside the transaction, so this rolls back the delete above: undecided suggestions stay
      // rather than being replaced by nothing, as for an unusable model answer.
      if (newSuggestions.length === 0) {
        throw new Error(
          "No new objective suggestions came back this time (every suggestion repeats wording already on this run). Nothing was changed, try again."
        );
      }
      for (const candidate of newSuggestions) {
        const result = await client.query<{ id: string; candidate_text: string }>(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, $4, 'ai_suggested', $5)
           returning id, candidate_text`,
          [tenantId, runId, candidate.candidate_text, candidate.rationale, suggestionStatus]
        );
        rows.push(result.rows[0]);
      }

      // The researcher's own carried-over text lands accepted; AI
      // suggestions now land pending and are never scored against until
      // the researcher accepts one (an objective inferred from the same
      // findings it would then judge is circular). This sync picks up the
      // researcher's own text, not only on a later manual accept click. Still inside the same
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
