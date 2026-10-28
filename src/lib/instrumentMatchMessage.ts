/** What a match reports, for the note shown after it (batch 49). */
export type MatchOutcome = { suggested: number; fromCodebook?: number; codebookUnavailable?: boolean };

/**
 * The note after matching a questionnaire or codebook to a data file: the suggestions to check, the
 * links made through the codebook (identical wording to an entry the researcher confirmed), and, before
 * migration 0125, that none could be. One wording for the card and for the automatic first match.
 */
export function matchOutcomeMessage(r: MatchOutcome): string {
  const parts = [`${r.suggested} links suggested. Check them before they are used.`];
  if (r.fromCodebook && r.fromCodebook > 0)
    parts.push(`${r.fromCodebook} confirmed through the codebook: their wording is identical to a codebook entry you confirmed.`);
  if (r.codebookUnavailable) parts.push("Links through the codebook need migration 0125, so none were made.");
  return parts.join(" ");
}
