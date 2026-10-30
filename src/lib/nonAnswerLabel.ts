// Whether an answer label is a non-answer (don't know, refused, not sure, not applicable, no answer, ...): the
// engine's rule (`_DK_RE` in api/parse-stats-file.py, `claude/answer-domain.md`), written once here for TypeScript
// readers of labels. It matches from the start of the label, as the engine does, and a don't-know that names its
// subject ("Don't know which brand") is an answer (Grant's decision 7, 29 October 2026). nonAnswerLabel.test.ts runs
// the engine's own pattern on the same labels, so the two cannot drift apart unnoticed.
const SEP = "[\\s_-]*";
export const NON_ANSWER_LABEL = new RegExp(
  `^((don['’‘\`]?t|do${SEP}not)${SEP}know(?!\\s+(which|what|who|whom|whose|how|where|when|whether|if|about|with|of|any)\\b)|dk\\b|refus|prefer${SEP}not${SEP}to${SEP}(say|answer)|no${SEP}response|no${SEP}answer` +
    `|not${SEP}sure|unsure|not${SEP}applicable|n/?a\\b|not${SEP}stated|unknown|missing)`,
  "i",
);

export function isNonAnswerLabel(label: string): boolean {
  return NON_ANSWER_LABEL.test(label.trim());
}
