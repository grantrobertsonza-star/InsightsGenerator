// GT-010: the file-removal confirmation names the researcher's work that removing a file takes out
// of the project's results (findings, review decisions, notes, insights whose support goes), with
// this document's counts when they could be read and in general words when they could not (unknown
// is never shown as zero). Since batch 25 removal goes to the bin, so the wording says it can be
// restored rather than "can't be undone".
// Client-safe: no database access (the counts come from documentDeletionImpact.ts).

export type DocumentDeletionImpact = {
  /** Findings extracted from or computed on this document. */
  findings: number;
  /** Of those, findings a researcher explicitly reviewed (accepted or rejected through a control). */
  reviewed: number;
  /** Of those, findings carrying a researcher note. */
  notes: number;
  /** Insights (per-finding and synthesized) that rest on those findings. */
  insights: number;
  /** Unreviewed objective and decision suggestions drawn only from this document (removed with it). */
  suggestions?: number;
  /** Accepted objectives and decisions drawn from this document (kept, marked "source document removed"). */
  objectives?: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The bin (claude/document-deletion-contract.md): removing a file archives its findings with the
 * researcher's review decisions and notes, keeps it restorable for `days` days, and only then erases
 * it. The wording says so, with this document's counts when they could be read, and in general words
 * when they could not (unknown is never shown as zero).
 */
export function deleteDocumentConfirmation(impact: DocumentDeletionImpact | null, days = 30): string {
  const tail = ` It stays in the bin for ${days} days, where you can restore it with its findings, review decisions and notes, or erase it now.`;
  if (!impact) {
    return (
      "Remove this file from the project? Its findings are archived, with any review decisions and notes on them, and insights built on " +
      "those findings will show their support as no longer valid; unreviewed objective and decision suggestions drawn only from it are removed." + tail
    );
  }
  const sentences: string[] = [];
  if (impact.findings === 0) sentences.push("No findings come from it.");
  else {
    const human: string[] = [];
    if (impact.reviewed > 0) human.push(`${plural(impact.reviewed, "review decision", "review decisions")} you made`);
    if (impact.notes > 0) human.push(plural(impact.notes, "researcher note", "researcher notes"));
    const kept = human.length > 0 ? `, with ${human.join(" and ")},` : "";
    sentences.push(`Its ${plural(impact.findings, "finding", "findings")}${kept} ${impact.findings === 1 ? "is archived and leaves" : "are archived and leave"} the project's results.`);
    if (impact.insights > 0) {
      sentences.push(`${plural(impact.insights, "insight rests", "insights rest")} on them and will show ${impact.insights === 1 ? "its" : "their"} support as no longer valid.`);
    }
  }
  if (impact.suggestions) sentences.push(`${plural(impact.suggestions, "unreviewed objective or decision suggestion", "unreviewed objective or decision suggestions")} drawn only from it ${impact.suggestions === 1 ? "is" : "are"} removed.`);
  if (impact.objectives) sentences.push(`${plural(impact.objectives, "accepted objective or decision", "accepted objectives or decisions")} drawn from it ${impact.objectives === 1 ? "is" : "are"} kept and marked as having lost a source.`);
  return `Remove this file from the project? ${sentences.join(" ")}${tail}`;
}
