import { isCaseTableFileName, isStatsFileName } from "./statsFileName";

/**
 * Which data file Cross tabs opens, and in what state (Grant's review, 2026-10-20: open the
 * workspace directly, with the file chosen in its header, instead of a gateway page). Pure rules,
 * shared by the section and its tests. Opening never builds a table or calls the model.
 *
 * - ready: the crosstab workspace can open it (a SPSS, Stata or SAS file, or a CSV or Excel file of
 *   case-level data) and its setup is accepted, or it has none to accept.
 * - needs_setup: the same kind of file, but its setup changed or acceptance was undone; it opens
 *   once accepted, here or under Sources.
 * - aggregated: a file of tables already aggregated; it has no variable list to cross-tabulate, so
 *   it shows its own Generate findings and table preview instead of the workspace.
 * - unsupported: case-level data in a format the workspace does not read.
 * - failed: its last processing failed; it is fixed or replaced under Sources.
 */
export type CrosstabDatasetState = "ready" | "needs_setup" | "aggregated" | "unsupported" | "failed";

export function crosstabDatasetState(f: {
  filename: string;
  /** documents.ingestion_type: "raw" for case-level data. */
  ingestion: string | null;
  processingStatus: string | null;
  /** The saved data setup, if any; undefined when the file has none (it then needs no acceptance). */
  setupAccepted?: boolean;
}): CrosstabDatasetState {
  if (f.processingStatus === "failed") return "failed";
  const workspaceFile = isStatsFileName(f.filename) || (f.ingestion === "raw" && isCaseTableFileName(f.filename));
  if (!workspaceFile) return f.ingestion === "raw" ? "unsupported" : "aggregated";
  return f.setupAccepted === false ? "needs_setup" : "ready";
}

export const CROSSTAB_STATE_NOTE: Record<Exclude<CrosstabDatasetState, "ready">, string> = {
  needs_setup: "needs setup",
  aggregated: "aggregated tables",
  unsupported: "format not supported",
  failed: "processing failed",
};

/**
 * The file shown first: the one used last in this project when it is still listed, else the first
 * file the workspace can open, else the first file. Null when there are none.
 */
export function initialCrosstabDataset(datasets: readonly { id: string; state: CrosstabDatasetState }[], lastUsed: string | null): string | null {
  if (lastUsed && datasets.some((d) => d.id === lastUsed)) return lastUsed;
  return (datasets.find((d) => d.state === "ready") ?? datasets[0])?.id ?? null;
}
