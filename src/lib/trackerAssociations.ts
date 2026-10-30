// Page 03 of the brand tracking dashboard, "Brand associations" (Grant's design, 29 October 2026): what respondents
// aware of each brand associate with it. The contract is in claude/d2-design-2026-10-29.md, "D3d Brand associations":
//   - Association share of brand X for attribute A: the weighted count of respondents aware of X who selected A for X
//     (the associations grid's variable, e.g. attr_a01_b08), divided by the weighted count of respondents aware of X
//     with a valid answer to A for X. Pick-any: a respondent may give A to several brands, so shares of one attribute
//     do not add up to 100 and are not agreement scores.
//   - Aware of X: the answer code that means selected (trackerFigures.selectedCode, by code) of X's variable in the
//     question the dashboard maps as awareness (trackerFigures.overviewMeasures, the same choice as page 01). Each
//     brand has its own aware base.
//   - "Don't know" stays in the base (the pack's rule, claude/tracker-packs-role-spec-2026-10-28.md, I1): a respondent
//     aware of X who answered don't know for A (the pack's per-attribute flag attr_dk_aXX) holds 0 in X's cell and is
//     counted as not associating; an answer code of the association variable itself labelled don't know is kept in
//     the base too (excludeDk false), as not selected. A blank (the pack leaves unaware respondents blank) or a
//     declared missing value is outside the base.
// Figures come from the Cross tab engine through computeCrosstab (nothing saved), with the dashboard's weight and the
// file's survey design: one table of the awareness variables (to read each brand's selected code and aware count),
// then one table per brand of its association variables restricted to that brand's aware respondents by the raw
// awareness code (a "between" filter from the code to itself, never by an answer label). Each share is read by
// trackerFigures.selectedShareOf, the reading of the funnel and of page 02.
// Unknown stays unknown: no awareness question mapped is "mapping_needed" (the base cannot be defined; never all
// respondents instead), no associations grid is "not_measured", and a cell that cannot be read is n/a with the
// reason. A file whose figures cannot be read throws with the reason.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { overviewMeasures, selectedAnswerOf, selectedShareOf } from "./trackerFigures";
import type { CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { BrandGrid, RoleVariable, TrackerRecognition } from "./trackerRoles";

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

/** One brand's aware base: who is aware, by the awareness variable's selected code. */
export type AwareBase = {
  code: string;
  /** The awareness variable for this brand, or null when awareness was not asked about it. */
  variable: string | null;
  /** The answer code that means aware, or null when it cannot be told (see `reason`). */
  awareCode: string | null;
  /** Unweighted number of respondents aware of the brand; null when it cannot be told. */
  n: number | null;
  /** Kish effective base of the aware respondents when weighted; null unweighted or not calculated. */
  effectiveBase: number | null;
  reason?: string;
};

export type AssociationCell = { code: string; variable: string; share: number | null; base: number | null; reason?: string };

export type BrandAssociations = {
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
        /** The grid's attributes in the grid's order, each with every listed brand's cell by code. */
        attributes: { group: string; item: string; cells: AssociationCell[] }[];
      }
    | Unavailable;
};

/** The associations grid and the awareness question the page needs, or why the page cannot be shown. */
export function associationParts(
  rec: TrackerRecognition,
  dashboard: ResolvedDashboard,
): { status: "ok"; grid: BrandGrid; awareness: TrackerRecognition["measures"][number] } | Unavailable {
  const grid = rec.grids.find((g) => g.kind === "associations");
  if (!grid || grid.items.length === 0) return { status: "not_measured", reason: "This file has no brand association question (\"<brand> associated with <attribute>\")." };
  if (dashboard.brands.length === 0) return { status: "not_measured", reason: "No brand list was found in this file, so associations cannot be shown by brand." };
  const { shown, unresolved } = overviewMeasures(rec, dashboard);
  if (unresolved.includes("awareness"))
    return { status: "mapping_needed", reason: "Two questions could be awareness, and each brand's association base is those aware of it. Choose the awareness question under Customise." };
  const awareness = shown.find((s) => s.stage === "awareness")?.measure;
  if (!awareness)
    return {
      status: "mapping_needed",
      reason: "No question is mapped as awareness, so the base of each brand's associations (those aware of it) cannot be defined. Choose the awareness question under Customise.",
    };
  return { status: "ok", grid, awareness };
}

/**
 * Each listed brand's aware base from the awareness table (one row item per awareness variable, all respondents).
 * Pure. A brand whose awareness was not asked, whose aware code cannot be told, or whose code is not a number (the
 * engine selects the aware respondents by numeric code) has no base, with the reason.
 */
export function awareBasesFromResult(result: CrosstabResult | null, awareness: TrackerRecognition["measures"][number], brands: { code: string }[], variables: Map<string, RoleVariable>): AwareBase[] {
  const byCode = new Map(awareness.byBrand.map((b) => [b.code, b.variable]));
  return brands.map((b): AwareBase => {
    const variable = byCode.get(b.code) ?? null;
    if (!variable) return { code: b.code, variable: null, awareCode: null, n: null, effectiveBase: null, reason: "Awareness was not asked about this brand, so its aware base cannot be defined." };
    if (!result) return { code: b.code, variable, awareCode: null, n: null, effectiveBase: null, reason: "No figures were calculated." };
    const a = selectedAnswerOf(result, variable, variables.get(variable));
    if (a.code === null) return { code: b.code, variable, awareCode: null, n: null, effectiveBase: null, reason: `Which awareness answer means aware could not be told: ${a.reason ?? "unknown"}` };
    if (!Number.isFinite(Number(a.code)) || a.code.trim() === "")
      return { code: b.code, variable, awareCode: a.code, n: a.selectedN, effectiveBase: null, reason: "The awareness answer is not a numeric code, so the aware respondents cannot be selected by code." };
    if (a.selectedN === null) return { code: b.code, variable, awareCode: a.code, n: null, effectiveBase: null, reason: "The engine gave no unweighted count for the aware answer." };
    return { code: b.code, variable, awareCode: a.code, n: a.selectedN, effectiveBase: null };
  });
}

/** A brand's association cells, one per attribute of the grid, from that brand's aware-only table. Pure. */
export function associationCellsFromResult(
  result: CrosstabResult | null,
  grid: BrandGrid,
  base: AwareBase,
  variables: Map<string, RoleVariable>,
): AssociationCell[] {
  return grid.items.map((it): AssociationCell => {
    const variable = it.byBrand.find((b) => b.code === base.code)?.variable;
    if (!variable) return { code: base.code, variable: "", share: null, base: null, reason: "Not asked about this brand for this attribute." };
    if (base.reason) return { code: base.code, variable, share: null, base: null, reason: base.reason };
    if (base.n === 0) return { code: base.code, variable, share: null, base: 0, reason: "No respondent is aware of this brand." };
    if (!result) return { code: base.code, variable, share: null, base: null, reason: "No figures were calculated." };
    return { code: base.code, variable, ...selectedShareOf(result, variable, variables.get(variable)) };
  });
}

/** How many brand tables are computed at once (each is one engine request). */
const BRANDS_AT_ONCE = 4;

/**
 * The Brand associations page for one data file. Throws with the reason when the file's dictionary, set-up or a
 * table cannot be read; never returns an empty page for a failure.
 */
export async function loadBrandAssociations(tenantId: string, runId: string, documentId: string): Promise<BrandAssociations & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const out = { documentId, weighted: weightVar !== null, weightVar, dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand } };
  const parts = associationParts(view.recognition, dashboard);
  if (parts.status !== "ok") return { ...out, profile: parts };
  const { grid, awareness } = parts;
  const variables = new Map(input.variables.map((v) => [v.name, v]));
  const brandCodes = new Set(dashboard.brands.map((b) => b.code));
  const awareVars = awareness.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => b.variable);

  let bases = awareBasesFromResult(null, awareness, dashboard.brands, variables);
  const tables = new Map<string, CrosstabResult>();
  if (awareVars.length > 0) {
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    const rowItems = (vars: string[]): CrosstabRequest["rowItems"] => vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] }));
    // Computed, not saved (computeCrosstab): opening the page adds no table to the file.
    const awareTable = (await computeCrosstab(tenantId, runId, documentId, { columnVars: [], rowItems: rowItems(awareVars), weightVar, design })).result;
    bases = awareBasesFromResult(awareTable, awareness, dashboard.brands, variables);
    const todo = bases
      .filter((b) => !b.reason && b.n !== null && b.n > 0)
      .map((b) => ({ base: b, vars: grid.items.map((it) => it.byBrand.find((x) => x.code === b.code)?.variable).filter((v): v is string => !!v) }))
      .filter((t) => t.vars.length > 0);
    for (let i = 0; i < todo.length; i += BRANDS_AT_ONCE) {
      await Promise.all(
        todo.slice(i, i + BRANDS_AT_ONCE).map(async ({ base, vars }) => {
          const code = Number(base.awareCode);
          const result = (
            await computeCrosstab(tenantId, runId, documentId, {
              columnVars: [],
              rowItems: rowItems(vars),
              weightVar,
              design,
              // Don't know stays in the base (the pack's rule); blanks and declared missing values stay outside.
              excludeDk: false,
              // Aware of this brand, by the raw awareness code (from the code to itself), never by its label.
              filters: [{ variable: base.variable!, op: "between", min: code, max: code }],
            })
          ).result;
          tables.set(base.code, result);
          base.effectiveBase = weightVar ? (result.total?.nEff ?? null) : null;
        }),
      );
    }
  }
  const attributes = grid.items.map((it) => ({ group: it.group, item: it.item, cells: [] as AssociationCell[] }));
  for (const base of bases) {
    const cells = associationCellsFromResult(tables.get(base.code) ?? null, grid, base, variables);
    cells.forEach((c, i) => attributes[i].cells.push(c));
  }
  return { ...out, profile: { status: "ok", awareness: { group: awareness.group, label: awareness.label }, bases, attributes } };
}
