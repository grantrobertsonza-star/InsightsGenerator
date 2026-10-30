// "Edit in Build table" (Grant, 29 October 2026: "i would not have to do it all from scratch, just change what i
// wanted for that wave"): a saved table's request, read back into the builder's choices for the file now open.
// Variables (and multiple-response sets, "set:<key>") that file does not hold are left out and named, never kept as
// choices the engine would reject. The weight and survey design are not taken from the table: they are the open
// file's own settings (Data setup), as for any table built on it.
import type { Correction, CrosstabFilter, CrosstabGroup, CrosstabNet, CrosstabRequest, CrosstabRowItem } from "./parseStatsFile";

export type BuilderChoices = {
  columnVars: string[];
  rowItems: CrosstabRowItem[];
  nets: CrosstabNet[];
  filters: CrosstabFilter[];
  columnGroups: Record<string, CrosstabGroup[]>;
  correction: Correction;
  excludeDk: boolean;
  meanRows: boolean;
  layerVariable: string;
  /** Names the open file does not hold, left out. */
  missing: string[];
};

export function builderChoicesFrom(request: CrosstabRequest, has: (name: string) => boolean): BuilderChoices {
  const missing = new Set<string>();
  const keep = (n: string) => {
    if (has(n)) return true;
    missing.add(n.startsWith("set:") ? n.slice(4) : n);
    return false;
  };
  const columnVars = request.columnVars.filter(keep);
  const netRows = request.rowItems.filter((r) => r.kind === "nets");
  const rowItems = request.rowItems.filter((r) => r.kind !== "nets" && r.vars.length > 0 && r.vars.every(keep));
  const nets = netRows.flatMap((r) => r.nets ?? []).filter((n) => n.vars.length > 0 && n.vars.every(keep));
  const filters = (request.filters ?? []).filter((f) => keep(f.variable));
  const columnGroups = Object.fromEntries(Object.entries(request.columnGroups ?? {}).filter(([k]) => columnVars.includes(k)));
  const layerVariable = request.layerVariable && keep(request.layerVariable) ? request.layerVariable : "";
  return {
    columnVars,
    rowItems,
    nets,
    filters,
    columnGroups,
    correction: request.correction ?? "fdr",
    excludeDk: request.excludeDk !== false,
    meanRows: request.meanRows === true,
    layerVariable,
    missing: [...missing],
  };
}
