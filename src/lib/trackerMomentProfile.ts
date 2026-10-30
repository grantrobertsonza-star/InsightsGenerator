// Page 02 of the brand tracking dashboard, "Moments & needs": the Moment profile view of the moment by brand card
// (Grant, 30 October 2026). For each listed brand, among the respondents aware of that brand, the share who link the
// brand to each moment (cue-specific recall), across every moment of the file's moments grid, so the shapes of
// brands' profiles can be compared. The contract is in claude/d2-design-2026-10-29.md, "D3c Moments & needs",
// "Moment profile":
//   - Profile value of brand X at moment M: the weighted count of respondents aware of X whose recall link for X at M
//     (the moments grid's variable, e.g. cep_c06_b08) is the selected code, divided by the weighted count of
//     respondents aware of X with a valid answer to that link.
//   - Aware of X: the aware-base rule of page 03, owned by trackerAssociations (awarenessForBases,
//     awareBrandTables): X's variable in the question the dashboard maps as awareness equals its selected code,
//     selected by an engine filter on the raw code. Each brand has its own base. No second aware-base rule here.
//   - Missing data as the recall table reads the same variables: a blank or a declared missing value is outside that
//     cell's base; an answer code of the link variable labelled don't know is outside the base too (the engine's
//     default, `excludeDk` true, as loadBrandMoments). The BMW pack's recall links have no don't know answer.
//   - Pick-any: a respondent may link several brands to a moment and a brand to several moments, so a brand's values
//     across moments do not add up to 100 and are not a share of the brand's mentions.
//   - Small bases: the engine's rule (an unweighted base under 10 is suppressed), shown n/a with the base.
// Unknown stays unknown: no awareness question mapped (or two) is "mapping_needed" (never all respondents instead), no
// moments grid or no brand list "not_measured", and a cell that cannot be read is n/a with the reason, never 0. A file
// whose figures cannot be read throws with the reason. Computed when asked, nothing saved.
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { associationCellsFromResult, awareBrandTables, awarenessForBases, gridVarsOf, type AssociationCell, type AwareBase, type Unavailable } from "./trackerAssociations";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { BrandGrid, TrackerRecognition } from "./trackerRoles";

/** One brand's value at one moment: unrounded weighted (when weighting is on) percentage, null with the reason. */
export type ProfileCell = AssociationCell;

export type MomentProfile = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  profile:
    | {
        status: "ok";
        /** The awareness question the bases come from. */
        awareness: { group: string; label: string };
        /** Every listed brand's aware base, in the brand list's order. */
        bases: AwareBase[];
        /** Every moment of the moments grid, in the grid's order (the screen orders them by category relevance), each
         * with every listed brand's cell by code. `group` is the moment's identity (the grid item's group). */
        moments: { group: string; item: string; cells: ProfileCell[] }[];
      }
    | Unavailable;
  dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand">;
};

/** The moments grid and the awareness question the profile needs, or why it cannot be shown. */
export function momentProfileParts(
  rec: TrackerRecognition,
  dashboard: ResolvedDashboard,
): { status: "ok"; grid: BrandGrid; awareness: TrackerRecognition["measures"][number] } | Unavailable {
  const grid = rec.grids.find((g) => g.kind === "moments");
  if (!grid || grid.items.length === 0) return { status: "not_measured", reason: "This file has no brand recall question for moments (\"<brand> recalled for <moment>\")." };
  if (dashboard.brands.length === 0) return { status: "not_measured", reason: "No brand list was found in this file, so a moment profile cannot be shown by brand." };
  const aw = awarenessForBases(rec, dashboard, "moment profile");
  return aw.status === "ok" ? { status: "ok", grid, awareness: aw.awareness } : aw;
}

/**
 * The Moment profile for one data file. Throws with the reason when the file's dictionary, set-up or a table cannot be
 * read; never returns an empty profile for a failure.
 */
export async function loadMomentProfile(tenantId: string, runId: string, documentId: string): Promise<MomentProfile> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const out = { documentId, weighted: weightVar !== null, weightVar, dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand } };
  const parts = momentProfileParts(view.recognition, dashboard);
  if (parts.status !== "ok") return { ...out, profile: parts };
  const { grid, awareness } = parts;
  const variables = new Map(input.variables.map((v) => [v.name, v]));
  // The recall table's missing-data reading (excludeDk true): blanks, declared missing and don't know codes outside.
  const { bases, tables } = await awareBrandTables(tenantId, runId, documentId, { awareness, brands: dashboard.brands, variables, weightVar, varsOf: (code) => gridVarsOf(grid, code), excludeDk: true });
  const moments = grid.items.map((it) => ({ group: it.group, item: it.item, cells: [] as ProfileCell[] }));
  for (const base of bases) {
    associationCellsFromResult(tables.get(base.code) ?? null, grid, base, variables, "moment").forEach((c, i) => moments[i].cells.push(c));
  }
  return { ...out, profile: { status: "ok", awareness: { group: awareness.group, label: awareness.label }, bases, moments } };
}
