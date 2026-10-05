import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { syncDecisionStatement } from "./runSync";

const MAX_FINDINGS_FOR_PROMPT = 120;
const MAX_INSIGHTS_FOR_PROMPT = 120;

type EvidenceItem = { text: string; theme: string | null };

/**
 * Runs once a run has findings to read (extracted from a report, generated
 * from a table, or coded from a transcript), and before the decision brief
 * is finalized. Two passes, deliberately kept separate rather than one call
 * asked to do both at once:
 *
 * Pass 1 grounds the work: given the business problem and research
 * objective the researcher supplied at intake (either or both may be
 * empty), plus the evidence itself, it states what the evidence actually
 * shows. This is a synthesis in the ordinary research-methodology sense,
 * not yet a decision, and it is stored on the run so a researcher can see
 * the reasoning a candidate decision is supposed to follow from.
 *
 * Pass 2 proposes decisions from that synthesis, not from the raw evidence
 * directly. A decision manufactured straight off finding-level facts tends to
 * come out shaped like a research question ("understand X") rather than a
 * genuine fork a stakeholder faces; going by way of a stated synthesis first
 * is what keeps the two stages distinct instead of collapsing into one.
 *
 * What counts as "the evidence" depends on entry_point, matching the two
 * methodological shapes agreed for this app:
 *
 * "generate" (mining raw data, no existing narrative) runs the ordinary
 * pyramid: findings are verified first, insights are synthesized from the
 * verified ones, and only then is a decision proposed. By the time this
 * function runs in generate mode, insights already exist (the run trigger
 * order guarantees this), so this reads from the insights table, each one
 * already an interpretation of a verified finding against the project's
 * objective, rather than reasoning straight off raw finding text a second
 * time. A generate-mode run with no insights yet is treated as not ready:
 * this throws rather than silently falling back to raw findings, since
 * falling back would defeat the point of the ordering.
 *
 * "validate" (a report that already makes claims) keeps the original
 * design: a decision is confirmed before insights exist for that run, so
 * there is no insights table to read from yet. This mode reads raw
 * findings directly, as it always has.
 *
 * Neither pass is told about the researcher's own upfront text as if it
 * were itself a decision, because it usually isn't one: the business
 * problem and objective are the reason this research exists and what it
 * sets out to learn, not a stakeholder's choice. A researcher who wants a
 * candidate of their own in the mix still can, via "add your own candidate"
 * on the review screen.
 */
export async function generateDecisionCandidates(
  tenantId: string,
  runId: string
): Promise<{ id: string; candidate_text: string }[]> {
  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      business_problem: string | null;
      research_objective: string | null;
      decision_statement: string | null;
      audience: string | null;
      entry_point: "generate" | "validate" | null;
    }>(
      "select business_problem, research_objective, decision_statement, audience, entry_point from runs where id = $1",
      [runId]
    );
    return result.rows[0];
  });

  if (!run) {
    throw new Error("Run not found");
  }

  const isGenerateMode = run.entry_point === "generate";

  let evidence: EvidenceItem[];
  let evidenceKindLabel: string;

  if (isGenerateMode) {
    const insights = await withTenant(tenantId, async (client) => {
      const result = await client.query<{
        headline: string;
        observation: string;
        tension: string;
        implication: string;
        theme: string | null;
      }>(
        `select i.headline, i.observation, i.tension, i.implication, f.theme
         from insights i
         join findings f on f.id = i.finding_id
         where i.run_id = $1
         order by f.theme nulls last, i.created_at
         limit $2`,
        [runId, MAX_INSIGHTS_FOR_PROMPT]
      );
      return result.rows;
    });

    if (insights.length === 0) {
      throw new Error(
        "No insights have been generated yet for this run. In generate mode, decisions are proposed from " +
          "insights, not raw findings directly, so at least one verified finding needs to have produced an " +
          "insight before a decision can be framed. Try again once insight generation has run."
      );
    }

    evidenceKindLabel = "insights";
    evidence = insights.map((i) => ({
      theme: i.theme,
      text: `${i.headline}. Observation: ${i.observation} Tension: ${i.tension} Implication: ${i.implication}`,
    }));
  } else {
    const findings = await withTenant(tenantId, async (client) => {
      const result = await client.query<{ finding_text: string; theme: string | null }>(
        "select finding_text, theme from findings where run_id = $1 order by theme nulls last limit $2",
        [runId, MAX_FINDINGS_FOR_PROMPT]
      );
      return result.rows;
    });

    if (findings.length === 0) {
      throw new Error(
        "No findings have been extracted yet for this run. The decision framer needs at least one " +
          "document's worth of extracted, generated, or coded findings to propose decision candidates against."
      );
    }

    evidenceKindLabel = "findings";
    evidence = findings.map((f) => ({ theme: f.theme, text: f.finding_text }));
  }

  const evidenceBlock = evidence.map((e) => `- [${e.theme ?? "Uncategorized"}] ${e.text}`).join("\n");

  const hasProblem = Boolean(run.business_problem && run.business_problem.trim().length > 0);
  const hasObjective = Boolean(run.research_objective && run.research_objective.trim().length > 0);
  const audienceBlock = run.audience ? `The report's intended audience is: ${run.audience}.\n\n` : "";

  const contextBlock =
    hasProblem || hasObjective
      ? [
          "The researcher has given the following context for this project, treat it as the strongest " +
            "signal of what actually matters here, well above the evidence list on its own:",
          hasProblem ? `Business problem: "${run.business_problem}"` : null,
          hasObjective ? `Research objective: "${run.research_objective}"` : null,
        ]
          .filter(Boolean)
          .join("\n") + "\n\n"
      : "No business problem or research objective was given for this project. Work from the evidence " +
        "alone, but favour the most commercially concrete reading of it over an abstract one.\n\n";

  const synthesisIntro = isGenerateMode
    ? "You read a set of insights already generated from this project's verified findings. Each insight " +
      "names an observation, a tension, and an implication. State, in two to four sentences, what these " +
      "insights collectively point to. This is a synthesis across the insights, not a decision and not a " +
      "restatement of any single one: name the pattern across themes, note where the insights pull in " +
      "different directions if they do, and connect it to the business problem or research objective when " +
      "one was given. Hedge appropriately; do not overstate what a small or single-source set of insights " +
      "can support.\n\n"
    : "You read a set of findings extracted from a market research project's documents and state, in two " +
      "to four sentences, what the evidence actually shows. This is a finding synthesized across the " +
      "findings, not a decision and not a restatement of any single finding: name the pattern across themes, " +
      "note where the evidence is thin or mixed if it is, and connect it to the business problem or " +
      "research objective when one was given. Hedge appropriately; do not overstate what a small or " +
      "single-source set of findings can support.\n\n";

  // Pass 1: synthesize what the evidence shows, grounded in whatever
  // problem/objective context exists.
  const synthesisResponse = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: synthesisIntro + contextBlock + audienceBlock,
    tool_choice: { type: "tool", name: "record_evidence_synthesis" },
    tools: [
      {
        name: "record_evidence_synthesis",
        description: "Records a short synthesis of what the evidence shows.",
        input_schema: {
          type: "object",
          properties: {
            synthesis: {
              type: "string",
              description: "Two to four sentences on what the evidence shows, hedged appropriately.",
            },
          },
          required: ["synthesis"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is the evidence to synthesize from (${evidenceKindLabel}):\n\n${evidenceBlock}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "decision_framer_synthesis", synthesisResponse.usage);

  const synthesisToolUse = synthesisResponse.content.find((block) => block.type === "tool_use");
  const synthesisInput =
    synthesisToolUse && synthesisToolUse.type === "tool_use"
      ? (synthesisToolUse.input as { synthesis?: unknown })
      : undefined;
  const evidenceSynthesis =
    synthesisInput && typeof synthesisInput.synthesis === "string" && synthesisInput.synthesis.trim().length > 0
      ? synthesisInput.synthesis.trim()
      : null;

  // Saved regardless of what pass 2 does below: it's useful on its own, and
  // if pass 2 fails to produce anything, this is the one thing a researcher
  // gets to see for why.
  if (evidenceSynthesis) {
    await withTenant(tenantId, async (client) => {
      await client.query("update runs set evidence_synthesis = $1, updated_at = now() where id = $2", [
        evidenceSynthesis,
        runId,
      ]);
    });
  }

  const alreadyAcceptedBlock = run.decision_statement
    ? `One or more decisions have already been accepted for this run: "${run.decision_statement}". Do not ` +
      "propose a candidate that just restates one of these; propose genuinely different forks the " +
      "evidence could also inform.\n\n"
    : "";

  // Pass 2: propose decisions from the synthesis, not the raw evidence.
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You propose the business decision a market research run should be judged against, before any " +
      "verification or narrative work happens downstream. Do not summarise what the evidence found; " +
      "the question is not \"what does this report say\", it is \"given what this evidence shows, what " +
      "choice would a stakeholder plausibly be facing that this evidence bears on\". A decision names a " +
      "specific fork the client faces, with a real option on each side, not a restated topic, research " +
      "question, or a call to \"improve\" or \"understand\" something. Write it as the choice itself, a " +
      "\"whether to X or Y\" statement, not as a yes/no question addressed to the reader.\n\n" +
      "Good: \"Whether to launch the loyalty tier in Q2 or hold until after the rebrand.\" Bad: " +
      "\"Understand member attitudes to the loyalty programme.\" and equally bad: \"Should we launch " +
      "the loyalty tier in Q2?\" (that's the same fork, phrased as a question rather than named as a " +
      "decision). The first bad example is a research question, not a decision, and research questions " +
      "are exactly what the evidence synthesis below may read like; your job is to turn what it shows " +
      "into something decision-shaped, not to repeat it back or just add a question mark.\n\n" +
      contextBlock +
      audienceBlock +
      alreadyAcceptedBlock +
      `Here is what the evidence has been found to show:\n\n"${evidenceSynthesis ?? "No synthesis was available; work from the raw evidence below instead."}"\n\n` +
      "Propose three to five candidate decisions. For each, give a short rationale naming which themes " +
      "in the evidence bear on it and why a stakeholder would plausibly be facing this choice. Do not " +
      "invent a decision the evidence has nothing to say about, and do not propose two candidates that " +
      "are really the same choice worded differently.",
    tool_choice: { type: "tool", name: "record_decision_candidates" },
    tools: [
      {
        name: "record_decision_candidates",
        description: "Records candidate decision statements this run's evidence could inform.",
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
                    description:
                      "The candidate decision, phrased as a specific choice with a real option on each side, written as a \"whether to X or Y\" statement rather than a yes/no question.",
                  },
                  rationale: {
                    type: "string",
                    description:
                      "Which themes in the evidence bear on this decision, and why a stakeholder would plausibly face it.",
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
        content: `For reference, here is the underlying evidence (${evidenceKindLabel}):\n\n${evidenceBlock}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "decision_framer_candidates", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Did not return a structured decision candidate list");
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

  // Claude is forced to call the tool, but a forced call can still come
  // back with an empty or all-invalid candidates array (a terse response,
  // a truncated one, or a model that just didn't find anything worth
  // proposing this time). Bailing out here, before anything is deleted,
  // means a bad regenerate attempt never wipes out the suggestions that
  // were already sitting there; the researcher sees an error and keeps
  // what they had, rather than the list silently shrinking to nothing.
  if (validCandidates.length === 0) {
    const diagnostic =
      rawCandidates.length === 0
        ? "the model returned zero candidates"
        : `the model returned ${rawCandidates.length} candidate(s), but none had both a candidate_text and a rationale`;
    throw new Error(
      `No usable decision candidates came back this time (${diagnostic}). Nothing was changed, try again.`
    );
  }

  const inserted = await withTenant(tenantId, async (client) => {
    const rows: { id: string; candidate_text: string }[] = [];

    // Everything below runs as one transaction: the old AI suggestions are
    // only ever removed together with the new ones landing, never as a
    // separate committed step, so a failure partway through (a bad insert,
    // a dropped connection) leaves the previous suggestions intact instead
    // of deleted with nothing to replace them.
    try {
      await client.query("begin");

      // Re-running the framer replaces its previous AI-suggested
      // candidates rather than piling up duplicates. This has to catch
      // 'accepted' rows too, not just 'pending' ones: every ai_suggested
      // candidate lands as accepted immediately now (see
      // generateDecisionCandidates's insert below), so a candidate the
      // researcher never actually looked at is indistinguishable, by status
      // alone, from one they deliberately kept. edited = false is what
      // actually marks "never touched by a human": accepting with an edit,
      // or any other explicit action, is the signal that this specific
      // candidate should survive a regenerate. Rejected candidates are left
      // alone either way, that's its own explicit decision, not something a
      // regenerate should undo.
      await client.query(
        `delete from decision_candidates
         where run_id = $1 and source = 'ai_suggested' and status != 'rejected' and edited = false`,
        [runId]
      );

      for (const candidate of validCandidates) {
        const result = await client.query<{ id: string; candidate_text: string }>(
          `insert into decision_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, $4, 'ai_suggested', 'accepted')
           returning id, candidate_text`,
          [tenantId, runId, candidate.candidate_text, candidate.rationale]
        );
        rows.push(result.rows[0]);
      }

      // Every candidate above just landed already accepted (see the status
      // literal), so runs.decision_statement needs to pick that up now,
      // not only on a later manual accept click. Still inside the same
      // transaction, so a rollback on failure undoes this with everything
      // else.
      await syncDecisionStatement(client, runId);

      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }

    return rows;
  });

  return inserted;
}
