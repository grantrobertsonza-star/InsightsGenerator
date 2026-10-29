// Page 02 of the brand tracking dashboard, "Moments & needs" (Grant's design, 29 October 2026): which category
// moments matter to people, then which brands come to mind for each. The figures come from the Cross tab engine
// through computeCrosstab (nothing saved), read by variable and answer code through trackerFigures.selectedShareOf,
// with the dashboard's weight (trackerDashboard.resolveDashboard: weighted by default when the file has a weight).
// The contracts are in claude/d2-design-2026-10-29.md, "D3c Moments & needs":
//   - Category relevance of a moment: the weighted share of respondents selecting that moment in the category
//     moments question (trackerRoles.findCategoryMoments) among respondents with a valid answer to it. A respondent
//     who chose "None of these" holds 0 on every moment and stays in the base; a respondent with no answer (blank or
//     a declared missing value) is outside it. The list's "None" and "Other" options are never ranked.
//   - Moment by brand recall: the weighted share of respondents whose brand recall answer for that brand and moment
//     (the moments grid's variable, e.g. cep_c06_b08) is selected, among respondents with a valid answer to it. In an
//     all-asked grid (the BMW pack) that is every eligible respondent. Not personal relevance, and no comparison
//     between cells is tested.
// Unknown stays unknown: a part the file does not have, or that cannot be told, is "not_measured" or
// "mapping_needed" with the reason, never zeros. A file whose figures cannot be read throws with the reason.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { selectedShareOf } from "./trackerFigures";
import type { CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { BrandGrid, CategoryMoments, RoleVariable } from "./trackerRoles";

/** How many moments the moment by brand recall card shows (Grant's design: "Six moments selected by highest
 * category relevance"). */
export const RECALL_MOMENTS = 6;

export type MomentRelevance = {
  /** The relevance question's variable for this moment: the moment's identity on this page. */
  variable: string;
  item: string;
  /** The moments grid's item for the same moment, or null when the grid has none. */
  gridGroup: string | null;
  /** Weighted (when weighting is on) percentage selecting, unrounded; null with `reason` when not available. */
  share: number | null;
  /** Unweighted count of valid answers. */
  base: number | null;
  reason?: string;
};

export type RecallCell = { code: string; variable: string; share: number | null; base: number | null; reason?: string };

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

export type BrandMoments = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** Kish effective base of the file's respondents when weighted; null unweighted. */
  effectiveBase: number | null;
  /** Every moment of the relevance question, highest share first (ties in the question's order). */
  relevance: ({ status: "ok"; group: string; label: string } & { moments: MomentRelevance[] }) | Unavailable;
  /** The top moments by relevance that have a brand recall question, each with every listed brand's cell by code. */
  recall:
    | {
        status: "ok";
        rows: { variable: string; item: string; gridGroup: string; relevance: number; cells: RecallCell[] }[];
        /** Moments ranked above the last row shown that have no brand recall question, by name (said, not hidden). */
        withoutRecall: string[];
      }
    | Unavailable;
};

/** A moment with a relevance figure and a brand recall question: one that can be a row of the recall card. */
const rankable = (m: MomentRelevance): m is MomentRelevance & { share: number; gridGroup: string } => m.share !== null && m.gridGroup !== null;

/**
 * The relevance ranking and the recall rows from one Cross tab result. Pure: the result, the recognised parts and
 * the dashboard's brand list in, the page's figures out. Ranking is by the unrounded share, highest first; equal
 * shares keep the question's order.
 */
export function momentsFromResult(
  result: CrosstabResult | null,
  moments: CategoryMoments,
  grid: BrandGrid | undefined,
  brands: { code: string; label: string }[],
  variables: Map<string, RoleVariable>,
): Pick<BrandMoments, "relevance" | "recall"> {
  let relevance: BrandMoments["relevance"];
  if (moments.status === "found" && result) {
    const read = moments.items.map((it): MomentRelevance => ({ ...it, ...selectedShareOf(result, it.variable, variables.get(it.variable)) }));
    const order = new Map(moments.items.map((it, i) => [it.variable, i]));
    read.sort((a, b) => (b.share ?? -Infinity) - (a.share ?? -Infinity) || order.get(a.variable)! - order.get(b.variable)!);
    relevance = { status: "ok", group: moments.group, label: moments.label, moments: read };
  } else if (moments.status === "ambiguous") relevance = { status: "mapping_needed", reason: moments.reason };
  else relevance = { status: "not_measured", reason: moments.status === "not_found" ? moments.reason : "No figures were calculated." };

  let recall: BrandMoments["recall"];
  if (!grid || grid.items.length === 0) recall = { status: "not_measured", reason: "This file has no brand recall question for moments (\"<brand> recalled for <moment>\")." };
  else if (brands.length === 0) recall = { status: "not_measured", reason: "No brand list was found in this file, so recall cannot be shown by brand." };
  else if (relevance.status !== "ok")
    recall = { status: "mapping_needed", reason: `The moments shown are chosen by category relevance, which is not available: ${relevance.reason}` };
  else {
    const gridByGroup = new Map(grid.items.map((it) => [it.group, it]));
    const rows: Extract<BrandMoments["recall"], { status: "ok" }>["rows"] = [];
    const withoutRecall: string[] = [];
    for (const m of relevance.moments) {
      if (rows.length >= RECALL_MOMENTS) break;
      if (m.share === null) continue;
      if (!rankable(m)) {
        withoutRecall.push(m.item);
        continue;
      }
      const item = gridByGroup.get(m.gridGroup)!;
      const byCode = new Map(item.byBrand.map((b) => [b.code, b.variable]));
      rows.push({
        variable: m.variable,
        item: m.item,
        gridGroup: m.gridGroup,
        relevance: m.share,
        cells: brands.map((b): RecallCell => {
          const variable = byCode.get(b.code);
          if (!variable) return { code: b.code, variable: "", share: null, base: null, reason: "Not asked about this brand for this moment." };
          return { code: b.code, variable, ...(result ? selectedShareOf(result, variable, variables.get(variable)) : { share: null, base: null, reason: "No figures were calculated." }) };
        }),
      });
    }
    recall = rows.length > 0 ? { status: "ok", rows, withoutRecall } : { status: "mapping_needed", reason: "No moment with a relevance figure has a brand recall question." };
  }
  return { relevance, recall };
}

/** The variables one Cross tab must read: every relevance option and every recall cell of a linked moment. */
export function momentVariables(moments: CategoryMoments, grid: BrandGrid | undefined, brandCodes: Set<string>): string[] {
  if (moments.status !== "found") return [];
  const linked = new Set(moments.items.map((it) => it.gridGroup).filter((g): g is string => g !== null));
  const cells = (grid?.items ?? []).filter((it) => linked.has(it.group)).flatMap((it) => it.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => b.variable));
  return [...moments.items.map((it) => it.variable), ...cells];
}

/**
 * The Moments & needs page for one data file. Throws with the reason when the file's dictionary, set-up or table
 * cannot be read; never returns an empty page for a failure.
 */
export async function loadBrandMoments(tenantId: string, runId: string, documentId: string): Promise<BrandMoments & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const moments = view.recognition.categoryMoments;
  const grid = view.recognition.grids.find((g) => g.kind === "moments");
  const vars = momentVariables(moments, grid, new Set(dashboard.brands.map((b) => b.code)));
  let result: CrosstabResult | null = null;
  if (vars.length > 0) {
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    // Computed, not saved (computeCrosstab): opening the page adds no table to the file.
    result = (await computeCrosstab(tenantId, runId, documentId, { columnVars: [], rowItems: vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] })), weightVar, design })).result;
  }
  const { relevance, recall } = momentsFromResult(result, moments, grid, dashboard.brands, new Map(input.variables.map((v) => [v.name, v])));
  return {
    documentId,
    weighted: weightVar !== null,
    weightVar,
    effectiveBase: weightVar && result ? (result.total?.nEff ?? null) : null,
    relevance,
    recall,
    dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand },
  };
}
