// Page 08 of the brand tracking dashboard, "Category overview" (Grant's design, 29 October 2026): how many brands people
// hold in mind, consider and acquire, how they make category decisions, and through which channel recent acquirers
// acquired. The contracts are in claude/d2-design-2026-10-29.md, "D3g Category overview":
//   - Brand repertoire at a stage (recognised, considered, acquired): the weighted mean number of tracked brands a
//     respondent selected in the per-brand yes/no question the dashboard maps to that stage (awareness, consideration,
//     acquisition; trackerFigures.stageClaims). Only the listed brands' variables count: "Other" and "None" are outside
//     the question's brands (pack spec: "Repertoires exclude Other"). Computed as the sum over the brands of each
//     brand's weighted share selecting it (selectedShareOf, the funnel's reading) divided by 100, which equals the
//     weighted mean count per respondent exactly when every respondent in the table has a valid answer for every
//     brand (each brand's base equals the table's respondents); otherwise the figure is n/a with the reason, because
//     a respondent with a blank cannot be counted.
//   - How decisions are made and the most recent acquisition channel: each answer code's weighted share among the
//     respondents with a valid answer (trackerFigures.answersOf, by raw code). Every answer code is kept, "Other"
//     included (excludeDk false); a blank (not asked: the channel question is routed) or a declared missing value is
//     outside the base.
// Figures come from the Cross tab engine through computeCrosstab (nothing saved), with the dashboard's weight and the
// file's survey design. Unknown stays unknown: no question is "not_measured", two candidates "mapping_needed", a
// figure that cannot be read is n/a with the reason, never 0. A file whose figures cannot be read throws.
import { loadVariableDictionaryWithStatus } from "./crosstabs";
import { applySegment, computeInSegment, segmentReading, type Segment, type SegmentReading } from "./trackerSegment";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { answersOf, selectedShareOf, stageClaims, type AnswerShare } from "./trackerFigures";
import type { CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { FoundQuestion, FunnelStage, PerBrandMeasure, RoleVariable, TrackerRecognition } from "./trackerRoles";

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

/** The repertoire's stages, in the order the tile shows them. */
export const REPERTOIRE_STAGES = ["awareness", "consideration", "acquisition"] as const satisfies readonly FunnelStage[];
export type RepertoireStage = (typeof REPERTOIRE_STAGES)[number];

export type Repertoire =
  | {
      status: "ok";
      stage: RepertoireStage;
      /** The stage question's wording. */
      label: string;
      /** How many of the listed brands the question asks about. */
      brands: number;
      /** Weighted mean number of brands selected per respondent; null with `reason` when it cannot be told. */
      mean: number | null;
      /** Unweighted number of respondents. */
      base: number | null;
      reason?: string;
    }
  | ({ stage: RepertoireStage } & Unavailable);

export type Distribution = { status: "ok"; variable: string; label: string; base: number | null; answers: AnswerShare[]; reason?: string } | Unavailable;

export type CategoryOverview = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** R5: the segment these figures were computed on, with its base (trackerSegment.ts); null for all eligible. */
  segment: SegmentReading | null;
  /** Kish effective base of the file's respondents when weighted; null unweighted or not calculated. */
  effectiveBase: number | null;
  repertoire: Repertoire[];
  decisionStyle: Distribution;
  acquisitionChannel: Distribution;
};

/** The question of each repertoire stage and its listed brands' variables, or why the stage cannot be shown. */
export function repertoireParts(rec: TrackerRecognition, dashboard: ResolvedDashboard): ({ stage: RepertoireStage; measure: PerBrandMeasure; variables: string[] } | ({ stage: RepertoireStage } & Unavailable))[] {
  const listed = new Set(dashboard.brands.map((b) => b.code));
  return REPERTOIRE_STAGES.map((stage) => {
    const claims = stageClaims(rec, dashboard, stage);
    if (claims.length > 1) return { stage, status: "mapping_needed" as const, reason: `Two questions could be ${stage}: ${claims.map((c) => c.label).join(" or ")}. Choose one under Customise.` };
    if (claims.length === 0) return { stage, status: "not_measured" as const, reason: `This file has no per-brand yes/no question for ${stage}.` };
    if (listed.size === 0) return { stage, status: "not_measured" as const, reason: "No brand list was found in this file, so brands cannot be counted." };
    const variables = claims[0].byBrand.filter((b) => listed.has(b.code)).map((b) => b.variable);
    if (variables.length === 0) return { stage, status: "not_measured" as const, reason: `"${claims[0].label}" is not asked about any listed brand.` };
    return { stage, measure: claims[0], variables };
  });
}

/** One stage's repertoire from the table of its brands' variables. Pure. */
export function repertoireFromResult(result: CrosstabResult | null, stage: RepertoireStage, measure: PerBrandMeasure, variables: string[], roleVars: Map<string, RoleVariable>): Repertoire {
  const head = { status: "ok" as const, stage, label: measure.label, brands: variables.length };
  if (!result) return { ...head, mean: null, base: null, reason: "No figures were calculated." };
  const respondents = result.total?.n ?? null;
  let sum = 0;
  for (const variable of variables) {
    const s = selectedShareOf(result, variable, roleVars.get(variable));
    if (s.share === null) return { ...head, mean: null, base: respondents, reason: `${variable}: ${s.reason ?? "not available"}` };
    // Each brand's base must be every respondent: a respondent with a blank for one brand cannot be counted.
    if (s.base !== respondents) return { ...head, mean: null, base: respondents, reason: `Not every respondent has an answer for every brand (${variable} has ${s.base ?? 0} of ${respondents ?? 0}), so the number of brands per respondent cannot be counted.` };
    sum += s.share;
  }
  return { ...head, mean: sum / 100, base: respondents };
}

/** A single-choice question's answers by raw code (every code the answer list or the data has, in code order). Pure. */
export function distributionFromResult(result: CrosstabResult | null, found: FoundQuestion, v: RoleVariable | undefined): Distribution {
  if (found.status === "ambiguous") return { status: "mapping_needed", reason: found.reason };
  if (found.status === "not_found") return { status: "not_measured", reason: found.reason };
  const head = { status: "ok" as const, variable: found.variable, label: found.label };
  if (!result) return { ...head, base: null, answers: [], reason: "No figures were calculated." };
  const read = answersOf(result, found.variable);
  if (read.reason) return { ...head, base: null, answers: [], reason: read.reason };
  if (!read.base) return { ...head, base: read.base, answers: [], reason: "No valid answers." };
  const labels = v?.valueLabels ?? {};
  const codes = [...new Set([...Object.keys(labels), ...read.answers.map((a) => a.code)])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  // A listed answer nobody gave is 0 of the known base.
  const answers = codes.map((code) => read.answers.find((a) => a.code === code) ?? { code, label: labels[code] ?? code, share: 0, weighted: 0, n: 0 }).map((a) => ({ ...a, label: labels[a.code] ?? a.label }));
  return { ...head, base: read.base, answers };
}

/**
 * The Category overview page for one data file. Throws with the reason when the file's dictionary, set-up or a table
 * cannot be read; never returns an empty page for a failure.
 */
export async function loadCategoryOverview(tenantId: string, runId: string, documentId: string, segment: Segment | null = null): Promise<CategoryOverview & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const rec = view.recognition;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const roleVars = new Map(input.variables.map((v) => [v.name, v]));
  const applied = applySegment(segment, input.variables, rec);
  const parts = repertoireParts(rec, dashboard);
  const brandVars = parts.flatMap((p) => ("variables" in p ? p.variables : []));
  const singles = [rec.decisionStyle, rec.acquisitionChannel].flatMap((f) => (f.status === "found" ? [f.variable] : []));

  let brandTable: CrosstabResult | null = null;
  let singleTable: CrosstabResult | null = null;
  if (brandVars.length > 0 || singles.length > 0) {
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    const rowItems = (vars: string[]): CrosstabRequest["rowItems"] => vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] }));
    // Computed, not saved (computeCrosstab). The brands are read as the funnel reads them (the engine's default
    // treatment of don't know); the single-choice questions keep every answer code (excludeDk false).
    // In the segment (computeInSegment): the repertoire's "every respondent" is every respondent in the segment.
    if (brandVars.length > 0) brandTable = (await computeInSegment(tenantId, runId, documentId, { columnVars: [], rowItems: rowItems(brandVars), weightVar, design }, applied)).result;
    if (singles.length > 0) singleTable = (await computeInSegment(tenantId, runId, documentId, { columnVars: [], rowItems: rowItems(singles), weightVar, design, excludeDk: false }, applied)).result;
  }
  const repertoire = parts.map((p): Repertoire => ("variables" in p ? repertoireFromResult(brandTable, p.stage, p.measure, p.variables, roleVars) : p));
  const anyTable = brandTable ?? singleTable;
  return {
    documentId,
    weighted: weightVar !== null,
    weightVar,
    effectiveBase: weightVar && anyTable ? (anyTable.total?.nEff ?? null) : null,
    segment: segmentReading(applied, anyTable, weightVar !== null),
    repertoire,
    decisionStyle: distributionFromResult(singleTable, rec.decisionStyle, rec.decisionStyle.status === "found" ? roleVars.get(rec.decisionStyle.variable) : undefined),
    acquisitionChannel: distributionFromResult(singleTable, rec.acquisitionChannel, rec.acquisitionChannel.status === "found" ? roleVars.get(rec.acquisitionChannel.variable) : undefined),
    dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand },
  };
}
