// Page 02 of the brand tracking dashboard, "Moments & needs": the Moment reach card (Grant, 30 October 2026). How
// widely each brand is linked to the category's moments, by four measures of mental availability (the contract in
// claude/d2-design-2026-10-29.md, "D3c Moments & needs", "Moment reach", defines them and names the sources):
//   1. Moments per person: the weighted mean number of moments a respondent links to the brand.
//   2. Moment penetration: the weighted share of respondents linking the brand to at least one moment.
//   3. Moments per linker: the weighted mean number of moments among those linking it to at least one.
//      (1) = (2) / 100 x (3), on the same base.
//   4. Share of moment links: the brand's weighted links as a share of all listed brands' weighted links.
// Base (1 to 3): every eligible respondent (the file's respondents with a usable weight) with a valid answer to every
// one of the brand's moment links. A blank, a declared missing value or a don't know code (the recall table's
// reading, excludeDk true) leaves a respondent's count unknown, so they are outside that brand's base and counted
// apart (no valid link at all, or some), never counted as not linking. Unweighted base under 10: suppressed.
// Share of moment links is shown only when every listed brand's base is every eligible respondent and each brand was
// asked about the same moments (otherwise the brands' links are not counted over the same people), and withheld with
// the reason when any brand's count is unknown; never a partial sum.
// Computation through the engine (computeCrosstab, nothing saved), with the dashboard's weight and the file's design:
// one table of every link to read each link's selected code by the funnel's rule (trackerFigures.selectedAnswerOf,
// by code, never by label), then one table with a "linkCount" item per brand (the engine counts each respondent's
// selected links with those codes). No awareness filter: these are over all eligible respondents.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { selectedAnswerOf } from "./trackerFigures";
import { gridVarsOf, type Unavailable } from "./trackerAssociations";
import type { CrosstabRequest, CrosstabResult, LinkCountSummary } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { BrandGrid, RoleVariable } from "./trackerRoles";

export type BrandReach = {
  code: string;
  /** Moments per person (mean count), unrounded; null with `reason` when unknown or suppressed. */
  perPerson: number | null;
  /** Moment penetration, a percentage, unrounded. */
  penetration: number | null;
  /** Moments per linker (mean count among those linking at least one). */
  perLinker: number | null;
  /** Share of moment links, a percentage; null with `shareReason` when withheld. */
  shareOfLinks: number | null;
  /** Unweighted base: eligible respondents with a valid answer to every one of the brand's moment links. */
  base: number | null;
  /** Kish effective base when weighted; null unweighted. */
  effectiveBase: number | null;
  /** Eligible respondents left out of the base: no valid link at all, or some links unanswered. */
  noneValid: number | null;
  partlyValid: number | null;
  /** Unweighted number of respondents linking the brand to at least one moment. */
  linkers: number | null;
  /** How many moments the brand was asked about. */
  momentsAsked: number;
  reason?: string;
  perLinkerReason?: string;
  shareReason?: string;
};

export type MomentReach = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  reach:
    | {
        status: "ok";
        /** Moments in the file's moments grid. */
        moments: number;
        /** Eligible respondents (unweighted). */
        eligible: number | null;
        /** Every listed brand, in the brand list's order. */
        brands: BrandReach[];
        /** Why the share of moment links is withheld for every brand, or null when shown. */
        shareWithheld: string | null;
      }
    | Unavailable;
  dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand">;
};

/** The moments grid the card needs, or why it cannot be shown. */
export function momentReachParts(grid: BrandGrid | undefined, brands: { code: string }[]): { status: "ok"; grid: BrandGrid } | Unavailable {
  if (!grid || grid.items.length === 0) return { status: "not_measured", reason: "This file has no brand recall question for moments (\"<brand> recalled for <moment>\")." };
  if (brands.length === 0) return { status: "not_measured", reason: "No brand list was found in this file, so moment reach cannot be shown by brand." };
  return { status: "ok", grid };
}

/** Each link variable's selected code (by the funnel's rule), or the reason it cannot be told. Pure. */
export function linkCodesFromResult(result: CrosstabResult, vars: string[], variables: Map<string, RoleVariable>): { codes: string[] } | { reason: string } {
  const codes: string[] = [];
  for (const v of vars) {
    const a = selectedAnswerOf(result, v, variables.get(v));
    if (a.code === null) return { reason: `Which answer of ${v} means linked could not be told: ${a.reason ?? "unknown"}` };
    codes.push(a.code);
  }
  return { codes };
}

/**
 * The four measures of every listed brand from the engine's link counts. Pure. `summaries` maps a brand code to its
 * linkCount summary, or to the reason it was not counted.
 */
export function reachFromSummaries(
  brands: { code: string }[],
  grid: BrandGrid,
  summaries: Map<string, LinkCountSummary | { reason: string }>,
  weighted: boolean,
): { brands: BrandReach[]; shareWithheld: string | null; eligible: number | null } {
  const out: BrandReach[] = brands.map((b) => {
    const momentsAsked = gridVarsOf(grid, b.code).length;
    const s = summaries.get(b.code);
    const empty = { code: b.code, perPerson: null, penetration: null, perLinker: null, shareOfLinks: null, base: null, effectiveBase: null, noneValid: null, partlyValid: null, linkers: null, momentsAsked };
    if (momentsAsked === 0) return { ...empty, reason: "This brand was not asked about any moment." };
    if (!s) return { ...empty, reason: "No figures were calculated." };
    if ("reason" in s) return { ...empty, reason: s.reason };
    const suppressed = s.meanExact === null;
    return {
      ...empty,
      perPerson: s.meanExact,
      penetration: s.anyPctExact,
      perLinker: s.perLinkerExact,
      base: s.n,
      effectiveBase: weighted ? s.nEff : null,
      noneValid: s.noneValid,
      partlyValid: s.partlyValid,
      linkers: s.linkers,
      ...(suppressed ? { reason: s.n === 0 ? "No respondent answered every moment for this brand." : "Suppressed for a small base." } : {}),
      ...(!suppressed && s.perLinkerExact === null ? { perLinkerReason: s.linkers === 0 ? "Nobody links this brand to a moment." : "Suppressed: fewer than 10 respondents link this brand to a moment." } : {}),
    };
  });
  const known = [...summaries.values()].filter((s): s is LinkCountSummary => !("reason" in s));
  const eligible = known.length > 0 ? known[0].eligible : null;
  let shareWithheld: string | null = null;
  const firstUnknown = out.find((b) => !summaries.has(b.code) || "reason" in (summaries.get(b.code) as object) || (summaries.get(b.code) as LinkCountSummary).linksExact === null);
  if (firstUnknown) shareWithheld = "The share of moment links needs every listed brand's links, and at least one brand's count is unknown.";
  else if (new Set(out.map((b) => b.momentsAsked)).size > 1) shareWithheld = "Brands were asked about different numbers of moments, so their links are not comparable as shares.";
  else if (known.some((s) => s.n !== s.eligible)) shareWithheld = "Some respondents did not answer every moment for every brand, so the brands' links are not counted over the same people.";
  if (shareWithheld === null) {
    const total = known.reduce((t, s) => t + (s.linksExact as number), 0);
    if (total <= 0) shareWithheld = "Nobody links any brand to a moment.";
    else for (const b of out) b.shareOfLinks = ((summaries.get(b.code) as LinkCountSummary).linksExact as number) / total * 100;
  }
  if (shareWithheld !== null) for (const b of out) b.shareReason = shareWithheld;
  return { brands: out, shareWithheld, eligible };
}

/**
 * The Moment reach card for one data file. Throws with the reason when the file's dictionary, set-up or a table
 * cannot be read; never returns empty figures for a failure.
 */
export async function loadMomentReach(tenantId: string, runId: string, documentId: string): Promise<MomentReach> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const out = { documentId, weighted: weightVar !== null, weightVar, dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand } };
  const parts = momentReachParts(view.recognition.grids.find((g) => g.kind === "moments"), dashboard.brands);
  if (parts.status !== "ok") return { ...out, reach: parts };
  const { grid } = parts;
  const variables = new Map(input.variables.map((v) => [v.name, v]));
  const varsByBrand = new Map(dashboard.brands.map((b) => [b.code, gridVarsOf(grid, b.code)]));
  const allVars = [...varsByBrand.values()].flat();
  const summaries = new Map<string, LinkCountSummary | { reason: string }>();
  if (allVars.length > 0) {
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    // Computed, not saved (computeCrosstab): opening the page adds no table to the file.
    const links = (await computeCrosstab(tenantId, runId, documentId, { columnVars: [], rowItems: allVars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] })), weightVar, design })).result;
    const items: CrosstabRequest["rowItems"] = [];
    for (const [code, vars] of varsByBrand) {
      if (vars.length === 0) continue;
      const read = linkCodesFromResult(links, vars, variables);
      if ("reason" in read) summaries.set(code, read);
      else items.push({ key: `reach:${code}`, label: code, kind: "linkCount", vars, selectedCodes: read.codes });
    }
    if (items.length > 0) {
      const counts = (await computeCrosstab(tenantId, runId, documentId, { columnVars: [], rowItems: items, weightVar, design })).result;
      for (const it of items) {
        const q = counts.questions.find((x) => x.key === it.key);
        summaries.set(it.label, q?.linkCount ?? { reason: "The engine returned no link count for this brand." });
      }
    }
  }
  const { brands, shareWithheld, eligible } = reachFromSummaries(dashboard.brands, grid, summaries, weightVar !== null);
  return { ...out, reach: { status: "ok", moments: grid.items.length, eligible, brands, shareWithheld } };
}
