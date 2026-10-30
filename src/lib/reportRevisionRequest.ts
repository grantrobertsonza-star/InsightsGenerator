/**
 * Whether the researcher's own message in this turn asks for a change to the Insights Report (SEC3,
 * security audit S2-3). The Research assistant may revise the live report narrative only when this
 * says yes; the decision is made by code from the researcher's message alone, never by the model and
 * never from anything the model read (a technical document, a variable label, an earlier reply). When
 * it says no, the revise_narrative tool is not offered to the model, and a call to it anyway is
 * answered "not applied" with nothing written.
 *
 * The rule, deliberately narrow and readable:
 *   1. The message contains an editing verb (EDIT_VERBS) that is not negated: no "don't", "do not",
 *      "never", "not" or "no need to" in the three words before it.
 *   2. The message names the report or one of its parts (REPORT_PARTS).
 *   3. The message is not a question about something else: one that starts with a question word
 *      (what, why, how, did, does, is, ...) is not a request. A request phrased as a question starts
 *      with can, could, would, will or please ("Can you shorten the summary?"), and those pass.
 *
 * Known limits, all failing closed (the change is not made; the researcher asks again more directly):
 *   - a follow-up that does not name the part ("Yes, do that", "Apply it") is not a request;
 *   - synonyms outside the lists are not recognised;
 *   - "How would you rewrite the summary?" is a question, so the model answers with suggested wording
 *     and nothing is written.
 * And one failing open: a message that names an editing verb and a report part for another purpose
 * ("Rewrite this table title, as in the report") enables the tool for that turn. The model is still
 * told to change only what was asked, and every revision is still checked against the evidence
 * (researchAssistant.applyNarrativeRevision): one stating a figure the evidence does not support is
 * refused and nothing is written.
 */

const EDIT_VERBS = [
  "revise", "rewrite", "reword", "rephrase", "redraft", "redo", "edit", "update", "change", "amend", "modify",
  "tighten", "shorten", "lengthen", "expand", "simplify", "refine", "polish", "improve", "fix", "correct",
  "replace", "soften", "strengthen", "trim", "cut", "add", "remove", "drop", "delete", "make", "apply",
];

const REPORT_PARTS = [
  "report", "narrative", "story", "storyline", "summary", "situation", "complication", "governing thought",
  "pillar", "headline", "so-what", "so what", "recommendations intro", "intro", "introduction", "caveat",
];

const QUESTION_START = /^(what|why|how|when|where|which|who|whose|whom|did|does|do|is|are|was|were|has|have|had|should|shall)\b/i;
const NEGATION = /\b(don'?t|do not|never|not|no need to)\s+(\S+\s+){0,2}$/i;

function stems(word: string): RegExp {
  // The verb and its usual forms: revise, revises, revised, revising.
  const base = word.replace(/e$/, "");
  return new RegExp(`\\b(${word}|${base}(e?s|e?d|ing))\\b`, "gi");
}

export function reportRevisionRequested(message: string): boolean {
  const text = message.replace(/[‘’]/g, "'").trim();
  if (!text) return false;
  if (QUESTION_START.test(text)) return false;
  const lower = text.toLowerCase();
  const namesPart = REPORT_PARTS.some((p) => new RegExp(`\\b${p.replace(/[-\s]/g, "[-\\s]?")}s?\\b`, "i").test(lower));
  if (!namesPart) return false;
  return EDIT_VERBS.some((verb) => {
    for (const m of lower.matchAll(stems(verb))) {
      if (!NEGATION.test(lower.slice(0, m.index))) return true;
    }
    return false;
  });
}

export const REVISION_NOT_REQUESTED =
  "not applied: the researcher did not ask to change the report in this message. Answer the researcher's question without changing the report.";

/** The line code adds under a reply when a change to the report was attempted but not requested. */
export const REVISION_NOT_REQUESTED_NOTE =
  "A change to the Insights Report was proposed while answering, and was not applied: your message did not ask to change the report. To change it, ask directly, for example \"Rewrite the executive summary to ...\".";
