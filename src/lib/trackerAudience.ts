// Page 05 of the brand tracking dashboard, "Audience & media" (Grant's design, 29 October 2026): who recently acquired
// the client's brand, against everyone in the category, by age group and by media use. The contracts are in
// claude/d2-design-2026-10-29.md, "D3f Audience & media":
//   - Recent acquirers of the client's brand: respondents whose answer to the client's brand's variable in the
//     question the dashboard maps to the acquisition stage (trackerFigures.stageClaims; the BMW pack's
//     "Past 12 month household acquisition", bought12_b08) is its selected code (trackerFigures.selectedCode, by
//     code). They are selected by an engine filter on that raw code, never by a label.
//   - Age profile: for each answer code of the age groups question (trackerRoles.findAgeGroups), the weighted share
//     giving it among the group's respondents with a valid answer: the recent acquirers, and all eligible
//     respondents (the category). Every answer code is kept, "Prefer not to say" included (excludeDk false); a blank
//     or declared missing value is outside the base.
//   - Media use: for each option of the media list (trackerRoles.findMediaList), the weighted share selecting it
//     among the group's respondents with a valid answer to it (selectedShareOf); "None of these" holds 0 on every
//     option and stays in the base. Media habits, not advertising effectiveness.
//   - Small bases (plan: "small bases flagged (n<50) and not inferred (n<30)"; pack spec: "flag raw n < 50, suppress
//     inference at n < 30"): smallBaseLevel. The page makes no comparison claim at any base; no difference or
//     significance is computed.
// Figures come from the Cross tab engine through computeCrosstab (nothing saved), with the dashboard's weight and the
// file's survey design: one table of all eligible respondents, then one restricted to the acquirers. Unknown stays
// unknown: a part the file does not have is "not_measured", one that two questions claim or that needs the client's
// brand is "mapping_needed", a figure that cannot be read is n/a with the reason. A file that cannot be read throws.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadWaveContext, type WaveLoadOptions } from "./trackerWaveContext";
import { answerStat, answersOf, type ShareStat, selectedAnswerOf, selectedShareOf, stageClaims } from "./trackerFigures";
import type { CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { FoundList, FoundQuestion, RoleVariable, TrackerRecognition } from "./trackerRoles";

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

/** The plan's small-base rule: below 50 flagged, below 30 descriptive only (no inference). By the unweighted count. */
export const SMALL_BASE = 50;
export const NO_INFERENCE_BASE = 30;
export function smallBaseLevel(n: number): "ok" | "small" | "very_small" {
  return n < NO_INFERENCE_BASE ? "very_small" : n < SMALL_BASE ? "small" : "ok";
}

/** A figure for the two groups compared: the recent acquirers and all eligible respondents. */
export type GroupShare = { share: number | null; base: number | null; reason?: string; stat?: ShareStat };
export type ProfileRow = { key: string; label: string; acquirers: GroupShare; category: GroupShare };

export type BrandAudience = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** Kish effective base of all eligible respondents when weighted; null unweighted or not calculated. */
  effectiveBase: number | null;
  acquirers:
    | {
        status: "ok";
        brand: { code: string; label: string };
        /** The acquisition question's wording (the BMW pack: "Past 12 month household acquisition"). */
        label: string;
        variable: string;
        /** The selected code; null when it cannot be told (see `reason`). */
        code: string | null;
        /** Unweighted number of recent acquirers; null when it cannot be told. */
        n: number | null;
        /** Kish effective base of the acquirers when weighted. */
        effectiveBase: number | null;
        level: "ok" | "small" | "very_small" | null;
        reason?: string;
      }
    | Unavailable;
  /** Unweighted number of all eligible respondents (the table's respondents). */
  categoryN: number | null;
  age: { status: "ok"; label: string; variable: string; rows: ProfileRow[] } | Unavailable;
  media: { status: "ok"; label: string; rows: ProfileRow[] } | Unavailable;
};

const unavailableOf = (found: FoundQuestion | FoundList, what: string): Unavailable =>
  found.status === "ambiguous" ? { status: "mapping_needed", reason: found.reason } : { status: "not_measured", reason: found.status === "not_found" ? found.reason : `No ${what} question.` };

/** The acquisition question and the client's brand's variable in it, or why the acquirers cannot be told. */
export function acquirerParts(rec: TrackerRecognition, dashboard: ResolvedDashboard): { status: "ok"; brand: { code: string; label: string }; label: string; variable: string } | Unavailable {
  const claims = stageClaims(rec, dashboard, "acquisition");
  if (claims.length === 0) return { status: "not_measured", reason: "This file has no question asking which brands each respondent recently acquired, so the brand's recent acquirers cannot be told." };
  if (claims.length > 1) return { status: "mapping_needed", reason: `Two questions could be recent acquisition (${claims.map((c) => c.label).join(" or ")}). Choose one under Customise.` };
  const focal = dashboard.focalBrand;
  if (!focal) return { status: "mapping_needed", reason: "Choose your brand (the Brand chip) to see its recent acquirers." };
  const variable = claims[0].byBrand.find((b) => b.code === focal.code)?.variable;
  if (!variable) return { status: "not_measured", reason: `"${claims[0].label}" was not asked about ${focal.label}.` };
  return { status: "ok", brand: { code: focal.code, label: focal.label }, label: claims[0].label, variable };
}

/** One answer-coded profile (age groups) for both groups, by raw code in code order. Pure. */
export function ageRowsFromResults(category: CrosstabResult, acquirers: CrosstabResult | null, variable: string, v: RoleVariable | undefined, acquirersMissing: string | null): ProfileRow[] {
  const all = answersOf(category, variable);
  const sub = acquirers ? answersOf(acquirers, variable) : null;
  const labels = v?.valueLabels ?? {};
  const codes = [...new Set([...Object.keys(labels), ...all.answers.map((a) => a.code), ...(sub?.answers.map((a) => a.code) ?? [])])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const read = (r: ReturnType<typeof answersOf> | null, code: string, missing: string | null): GroupShare => {
    if (!r) return { share: null, base: null, reason: missing ?? "No figures were calculated." };
    if (r.reason) return { share: null, base: null, reason: r.reason };
    if (!r.base) return { share: null, base: r.base ?? null, reason: "No valid answers." };
    const a = r.answers.find((x) => x.code === code);
    // An answer on the list that nobody in the group gave is 0 of a known base; a suppressed one is not available.
    if (a && a.share === null) return { share: null, base: r.base, reason: "Suppressed for a small base." };
    const stat = answerStat(r.answers, code);
    return { share: a ? (a.share as number) : 0, base: r.base, ...(stat ? { stat } : {}) };
  };
  return codes.map((code) => ({ key: code, label: labels[code] ?? all.answers.find((a) => a.code === code)?.label ?? code, acquirers: read(sub, code, acquirersMissing), category: read(all, code, null) }));
}

/** The media options for both groups, ordered by the category's share (highest first, n/a last). Pure. */
export function mediaRowsFromResults(category: CrosstabResult, acquirers: CrosstabResult | null, list: Extract<FoundList, { status: "found" }>, variables: Map<string, RoleVariable>, acquirersMissing: string | null): ProfileRow[] {
  const rows = list.options.map((o): ProfileRow => ({
    key: o.variable,
    label: o.label,
    category: selectedShareOf(category, o.variable, variables.get(o.variable)),
    acquirers: acquirers ? selectedShareOf(acquirers, o.variable, variables.get(o.variable)) : { share: null, base: null, reason: acquirersMissing ?? "No figures were calculated." },
  }));
  const order = new Map(list.options.map((o, i) => [o.variable, i]));
  return rows.sort((a, b) => (b.category.share ?? -Infinity) - (a.category.share ?? -Infinity) || order.get(a.key)! - order.get(b.key)!);
}

/**
 * The Audience & media page for one data file. Throws with the reason when the file's dictionary, set-up or a table
 * cannot be read; never returns an empty page for a failure.
 */
export async function loadBrandAudience(tenantId: string, runId: string, documentId: string, opts: WaveLoadOptions = {}): Promise<BrandAudience & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }> {
  // The wave's resolved dashboard and role input, when the caller already read them (trackerWaveChange.ts).
  const { view, input } = opts.ctx ?? (await loadWaveContext(tenantId, runId, documentId));
  const dashboard = view.dashboard;
  const rec = view.recognition;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const variables = new Map(input.variables.map((v) => [v.name, v]));
  const parts = acquirerParts(rec, dashboard);
  const ageVar = rec.ageGroups.status === "found" ? rec.ageGroups.variable : null;
  const media = rec.mediaUse.status === "found" ? rec.mediaUse : null;
  const profileVars = [...(ageVar ? [ageVar] : []), ...(media?.options.map((o) => o.variable) ?? [])];
  const out = { documentId, weighted: weightVar !== null, weightVar, dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand } };

  let category: CrosstabResult | null = null;
  let sub: CrosstabResult | null = null;
  let acquirers: BrandAudience["acquirers"] = parts.status === "ok" ? { ...parts, code: null, n: null, effectiveBase: null, level: null } : parts;
  if (profileVars.length > 0 || parts.status === "ok") {
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    const rowItems = (vars: string[]): CrosstabRequest["rowItems"] => vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] }));
    const request = (vars: string[]): CrosstabRequest => ({ columnVars: [], rowItems: rowItems(vars), weightVar, design, excludeDk: false });
    // Computed, not saved (computeCrosstab). All eligible respondents first, with the acquisition answer to read the
    // acquirers' code and count.
    category = (await computeCrosstab(tenantId, runId, documentId, request([...(parts.status === "ok" ? [parts.variable] : []), ...profileVars]))).result;
    if (parts.status === "ok") {
      const a = selectedAnswerOf(category, parts.variable, variables.get(parts.variable));
      if (a.code === null) acquirers = { ...parts, code: null, n: null, effectiveBase: null, level: null, reason: `Which answer means acquired could not be told: ${a.reason ?? "unknown"}` };
      else if (a.code.trim() === "" || !Number.isFinite(Number(a.code))) acquirers = { ...parts, code: a.code, n: a.selectedN, effectiveBase: null, level: null, reason: "The acquisition answer is not a numeric code, so the acquirers cannot be selected by code." };
      else if (a.selectedN === null) acquirers = { ...parts, code: a.code, n: null, effectiveBase: null, level: null, reason: "The engine gave no unweighted count for the acquisition answer." };
      else {
        acquirers = { ...parts, code: a.code, n: a.selectedN, effectiveBase: null, level: smallBaseLevel(a.selectedN), ...(a.selectedN === 0 ? { reason: `No respondent in this file is a recent acquirer of ${parts.brand.label}.` } : {}) };
        if (a.selectedN > 0 && profileVars.length > 0) {
          const code = Number(a.code);
          // Recent acquirers of the client's brand, by the raw acquisition code (from the code to itself), never by its label.
          sub = (await computeCrosstab(tenantId, runId, documentId, { ...request(profileVars), filters: [{ variable: parts.variable, op: "between", min: code, max: code }] })).result;
          acquirers.effectiveBase = weightVar ? (sub.total?.nEff ?? null) : null;
        }
      }
    }
  }
  const missing = acquirers.status === "ok" ? (acquirers.reason ?? null) : acquirers.reason;
  const age: BrandAudience["age"] =
    rec.ageGroups.status !== "found" ? unavailableOf(rec.ageGroups, "age groups") : { status: "ok", label: rec.ageGroups.label, variable: rec.ageGroups.variable, rows: ageRowsFromResults(category!, sub, rec.ageGroups.variable, variables.get(rec.ageGroups.variable), missing) };
  const mediaOut: BrandAudience["media"] = !media ? unavailableOf(rec.mediaUse, "media use") : { status: "ok", label: media.label, rows: mediaRowsFromResults(category!, sub, media, variables, missing) };
  return {
    ...out,
    effectiveBase: weightVar && category ? (category.total?.nEff ?? null) : null,
    categoryN: category?.total?.n ?? null,
    acquirers,
    age,
    media: mediaOut,
  };
}
