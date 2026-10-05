import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";

// Between them a brief and a proposal can run long once a literature review
// or a detailed methodology section is attached; none of that is needed to
// pull out the two things this cares about, and every extra page is a page
// the model has to read for nothing. This is generous enough to comfortably
// cover the business-problem and objective framing in each document, split
// evenly when both are present, without sending the whole thing.
const MAX_CHARS_PER_DOCUMENT = 40000;

export type ExtractedBriefFields = {
  businessProblem: string | null;
  researchObjective: string | null;
};

/**
 * Pulls a business problem (with whatever background context the client
 * gave it) and the research objective(s)/aim(s) out of the two documents
 * that typically set a project's tone before any evidence is collected:
 *
 * - a brief, written by the research buyer, stating the business problem,
 *   some background, and often a first pass at the objectives (sometimes
 *   with a suggested method).
 * - a proposal, the supplier's response to that brief: it usually reflects
 *   the same business problem and objectives back, sometimes sharpened
 *   with a bit of literature or best practice, then adds a methodology,
 *   timeline, and similar delivery detail on top.
 *
 * Either can be given alone, or both together. When both are given, the
 * brief is treated as the authoritative statement of the business problem
 * (it's the client's own problem, not the supplier's), while the proposal
 * is treated as the more considered statement of the objectives where the
 * two disagree or the proposal is more specific, since sharpening the
 * objectives against the problem is the whole point of a proposal. Neither
 * document's methodology, timeline, budget, or literature review is
 * extracted, only the business problem/context and the objective(s).
 */
export async function extractBriefFields(
  tenantId: string,
  runId: string,
  documents: {
    briefText?: string | null;
    proposalText?: string | null;
  }
): Promise<ExtractedBriefFields> {
  const briefText = documents.briefText?.trim() || null;
  const proposalText = documents.proposalText?.trim() || null;

  if (!briefText && !proposalText) {
    return { businessProblem: null, researchObjective: null };
  }

  const documentBlocks = [
    briefText
      ? `=== BRIEF (from the research buyer/client) ===\n${briefText.slice(0, MAX_CHARS_PER_DOCUMENT)}`
      : null,
    proposalText
      ? `=== PROPOSAL (the supplier's response to the brief above, if any) ===\n${proposalText.slice(0, MAX_CHARS_PER_DOCUMENT)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1536,
    system:
      "You read a market research brief and/or the supplier's proposal responding to it, and pull out " +
      "exactly two things: the business problem (why this project exists, including whatever background " +
      "or context the client gave for it) and the research objective(s) or aim(s) (what the project sets " +
      "out to learn, test, or address). One or both documents may be given.\n\n" +
      "If only a brief is given, work from it alone. If only a proposal is given, work from it alone " +
      "(a proposal usually restates the business problem and objectives from a brief you don't have " +
      "here). If both are given, treat the brief as the authoritative statement of the business problem, " +
      "it's the client's own problem to state, not the supplier's to redefine, and treat the proposal as " +
      "the more considered statement of the objectives wherever it's more specific or sharper than the " +
      "brief's, since refining the objectives against the problem is what a proposal is for. Reconcile " +
      "the two into one coherent business problem and one coherent set of objectives rather than just " +
      "picking one document over the other outright.\n\n" +
      "Do not extract either document's methodology, timeline, budget, team, or literature review, those " +
      "aren't part of either field. If there's more than one distinct objective, number them (1., 2., " +
      "...) rather than running them together into one sentence. Quote or closely paraphrase the " +
      "documents' own framing rather than writing a fresh summary. If neither document clearly states " +
      "one of these two things, return null for it rather than guessing or inventing one from context.",
    tool_choice: { type: "tool", name: "record_brief_fields" },
    tools: [
      {
        name: "record_brief_fields",
        description: "Records the business problem and research objective(s) found in a brief and/or proposal.",
        input_schema: {
          type: "object",
          properties: {
            business_problem: {
              type: ["string", "null"],
              description:
                "The business problem, with relevant background context, or null if neither document states one.",
            },
            research_objective: {
              type: ["string", "null"],
              description:
                "The research objective(s)/aim(s), numbered if there's more than one, or null if neither document states any.",
            },
          },
          required: ["business_problem", "research_objective"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here are the document(s):\n\n${documentBlocks}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "brief_intake", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { businessProblem: null, researchObjective: null };
  }

  const input = toolUse.input as { business_problem?: unknown; research_objective?: unknown };
  const businessProblem =
    typeof input.business_problem === "string" && input.business_problem.trim().length > 0
      ? input.business_problem.trim()
      : null;
  const researchObjective =
    typeof input.research_objective === "string" && input.research_objective.trim().length > 0
      ? input.research_objective.trim()
      : null;

  return { businessProblem, researchObjective };
}
