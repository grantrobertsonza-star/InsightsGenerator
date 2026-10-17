// GT-010: the "Delete document" confirmation. It said only "Delete this document and any findings
// extracted from it? This can't be undone." while deleting the file also removes the researcher's
// review decisions and notes on those findings, and leaves every insight built on them "Support no
// longer valid". The confirmation now names that work, with this document's counts when they
// could be read, and in general words when they could not (unknown is never shown as zero).
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
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function deleteDocumentConfirmation(impact: DocumentDeletionImpact | null): string {
  const tail = " This can't be undone.";
  if (!impact) {
    return (
      "Delete this document? Its findings are deleted with it, together with any review decisions and researcher notes on them, " +
      "and insights built on those findings will show their support as no longer valid." + tail
    );
  }
  if (impact.findings === 0) return `Delete this document? No findings come from it.${tail}`;
  const parts = [plural(impact.findings, "finding", "findings")];
  const human: string[] = [];
  if (impact.reviewed > 0) human.push(`${plural(impact.reviewed, "review decision", "review decisions")} you made`);
  if (impact.notes > 0) human.push(plural(impact.notes, "researcher note", "researcher notes"));
  const lost = human.length > 0 ? `${parts[0]}, with ${human.join(" and ")}` : parts[0];
  const downstream = impact.insights > 0
    ? ` ${plural(impact.insights, "insight rests", "insights rest")} on them and will show ${impact.insights === 1 ? "its" : "their"} support as no longer valid.`
    : "";
  return `Delete this document? This also deletes ${lost}.${downstream}${tail}`;
}
