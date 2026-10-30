/** What a match reports, for the note shown after it (batch 49; CB1 adds the automatic confirmations and the waves). */
export type MatchOutcome = {
  suggested: number;
  fromCodebook?: number;
  codebookUnavailable?: boolean;
  autoConfirmed?: number;
  autoUnavailable?: boolean;
  /** A codebook matched to several data files (waves): one line each, in upload order. */
  files?: DataFileMatch[];
};
export type DataFileMatch =
  | { dataDocumentId: string; filename: string; status: "matched"; suggested: number; autoConfirmed: number }
  | { dataDocumentId: string; filename: string; status: "few_names"; names: number; coded: number }
  | { dataDocumentId: string; filename: string; status: "failed"; error: string };

/**
 * The note after matching a questionnaire or codebook to a data file: the suggestions to check, the links
 * confirmed by the codebook rule (CB1: same name, and the codebook lists every code in the data), the links made
 * through the codebook (identical wording to an entry the researcher confirmed), and what a missing migration
 * held back. For a codebook matched to several files, each file's outcome, including any that failed, so a
 * partial result never reads as complete. One wording for the card and for the automatic match.
 */
export function matchOutcomeMessage(r: MatchOutcome): string {
  const parts = [`${r.suggested} links suggested. Check them before they are used.`];
  if (r.autoConfirmed && r.autoConfirmed > 0)
    parts.push(`${r.autoConfirmed} confirmed automatically: the codebook entry has the variable's name and lists every code in the data.`);
  if (r.fromCodebook && r.fromCodebook > 0)
    parts.push(`${r.fromCodebook} confirmed through the codebook: their wording is identical to a codebook entry you confirmed.`);
  if (r.autoUnavailable) parts.push("Confirming codebook entries automatically needs migration 0133, so all were left as suggestions.");
  if (r.codebookUnavailable) parts.push("Links through the codebook need migration 0125, so none were made.");
  if (r.files && r.files.length > 0) {
    const lines = r.files.map((f) =>
      f.status === "matched"
        ? `${f.filename}: ${f.autoConfirmed} confirmed, ${f.suggested} suggested`
        : f.status === "few_names"
          ? `${f.filename}: only ${f.names} of the codebook's ${f.coded} names are its variables, so it was not matched`
          : `${f.filename}: could not be matched (${f.error})`,
    );
    parts.push(`Data files: ${lines.join("; ")}.`);
  }
  return parts.join(" ");
}
