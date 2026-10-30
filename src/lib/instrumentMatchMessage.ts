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

/**
 * Codex E1-F04 and E1R-F01: what Read again reports after it withdrew automatic codebook confirmations whose answer
 * list or name changed and checked them again through `matchCodebookToDataFiles`.
 *
 * `files` is the matcher's own per-file outcome for each data file (wave) that held a withdrawn confirmation, in
 * upload order. A file the matcher reports "matched" was checked again; `reconfirmed` counts the withdrawn links
 * that fit again there (an ordinary non-fit stays a suggestion and is not an error). A file reported "failed" (the
 * check could not run) or "few_names" (the codebook no longer describes it) was NOT checked: its links stay
 * suggestions, and the outcome is "failed" so it never reads as a completed check.
 *
 * "done": every such file was checked. "failed": at least one was not; `error` names each one, and `files` keeps
 * the successful waves' results. A whole-call failure (the matcher threw) is "failed" with no `files`.
 */
export type AutomaticRecheck =
  | { withdrawn: number; status: "done"; reconfirmed: number; files?: DataFileMatch[] }
  | { withdrawn: number; status: "failed"; error: string; reconfirmed?: number; files?: DataFileMatch[] };

const unchecked = (f: DataFileMatch) =>
  f.status === "failed"
    ? `${f.filename} (${f.error})`
    : f.status === "few_names"
      ? `${f.filename} (only ${f.names} of the codebook's ${f.coded} names are its variables, so it was not matched)`
      : f.filename;

/** The sentence Read again adds about the automatic confirmations it withdrew. One wording for the card. */
export function automaticRecheckMessage(c: AutomaticRecheck | undefined): string {
  if (!c) return "";
  const n = `${c.withdrawn} automatic link${c.withdrawn === 1 ? "" : "s"}`;
  const fit = (k: number) => `${k} still ${k === 1 ? "fits and is" : "fit and are"} confirmed`;
  if (c.status === "done") {
    const where = c.files && c.files.length > 0 ? ` (${c.files.map((f) => f.filename).join(", ")})` : "";
    return ` ${n} whose answer list changed ${c.withdrawn === 1 ? "was" : "were"} checked again against every wave ${c.withdrawn === 1 ? "it was" : "they were"} on${where}: ${fit(c.reconfirmed)}; the rest are suggestions to review.`;
  }
  const files = c.files ?? [];
  const checked = files.filter((f) => f.status === "matched");
  const notChecked = files.filter((f) => f.status !== "matched");
  if (notChecked.length === 0) {
    // The check as a whole could not run: nothing was checked again.
    return ` ${n} whose answer list changed could not be checked again (${c.error}), so ${c.withdrawn === 1 ? "it is a suggestion" : "they are suggestions"} until you match the codebook again.`;
  }
  const retry = notChecked.some((f) => f.status === "failed")
    ? ` To retry, choose ${notChecked.filter((f) => f.status === "failed").length === 1 ? "that wave" : "each of those waves"} under Data file and press Match again.`
    : "";
  const done = checked.length > 0
    ? ` Checked again on ${checked.map((f) => f.filename).join(", ")}: ${fit(c.reconfirmed ?? 0)}.`
    : "";
  return ` ${n} whose answer list changed ${notChecked.length === files.length ? "could not be checked again on any wave" : "could not be checked again on every wave"}. Not checked: ${notChecked.map(unchecked).join("; ")}; their links stay suggestions until they are checked.${done}${retry}`;
}
