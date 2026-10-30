// Page 04 of the brand tracking dashboard, "Advertising & WOM" (Grant's design, 29 October 2026): which brands'
// advertising people say they recall when prompted, and what they have heard about each brand. The contracts are in
// claude/d2-design-2026-10-29.md, "D3e Advertising & WOM":
//   - Prompted advertising recall of brand X: the weighted count answering yes (trackerFigures.selectedCode, by code)
//     to X's prompted recall question (trackerRoles.findAdvertisingRecall) divided by the weighted count with a valid
//     answer to it, which is everyone asked about X (in the BMW pack those aware of X). "Not sure" is a substantive
//     answer (pack spec AD2, code 9): it stays in the base, is not counted as yes, and is reported as its own share
//     (excludeDk false, so the engine does not drop it as don't know). A blank (not asked) or a declared missing value
//     is outside the base. Self-reported recall, not verified exposure or media effectiveness.
//   - Word of mouth about brand X: exclusive groups among all eligible respondents (every respondent who answered X's
//     awareness question): one group per answer code of X's word of mouth question (trackerFigures.stageClaims,
//     stage word_of_mouth, single response), every code the answer list or the data has, plus "Unaware" (X's
//     awareness answer is an explicit not aware code, trackerFigures.answerSides; pack spec W1: "unaware is a sixth
//     reported state derived from blank"). Each group is its weighted count divided by the weighted count of all
//     eligible, so the groups add to 100. An awareness answer that is neither aware nor explicitly not aware (don't
//     know, refused, a code the answer list does not label: Codex D3E-F01) is unknown, never Unaware: when anyone
//     gave one, that brand is n/a with the counts. The groups are shown only when the file shows them to be exclusive
//     and complete: every respondent aware of X has a word of mouth answer and no respondent unaware of X has one
//     (read from one table of the word of mouth answer by awareness); otherwise that brand is n/a with the counts
//     that break the rule, never a silent remainder.
// Figures come from the Cross tab engine through computeCrosstab (nothing saved), with the dashboard's weight and the
// file's survey design, every answer read by its raw code. Unknown stays unknown: no recall question is "not_measured",
// two candidates "mapping_needed"; no word of mouth question "not_measured", two or no awareness question mapped
// "mapping_needed"; a brand that cannot be read is n/a with the reason. A file whose figures cannot be read throws.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { answerSides, answersOf, overviewMeasures, selectedAnswerOf, stageClaims } from "./trackerFigures";
import { notSureCodes } from "./trackerRoles";
import type { CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { AdvertisingRecall, PerBrandMeasure, RoleVariable, TrackerRecognition } from "./trackerRoles";

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

export type RecallShare = {
  code: string;
  variable: string | null;
  /** Unrounded percentage answering yes among those with a valid answer; null with `reason` when not available. */
  yes: number | null;
  /** Unrounded percentage answering not sure, kept apart; null when the question has no such answer or not available. */
  notSure: number | null;
  /** Unweighted number of valid answers (those asked about the brand). */
  base: number | null;
  reason?: string;
};

export type WomGroup = {
  /** The word of mouth answer's raw code, or "unaware" for the derived group. */
  key: string;
  label: string;
  /** Unrounded percentage of all eligible respondents. */
  share: number;
  /** Unweighted number of respondents in the group. */
  n: number | null;
};

export type BrandWom = {
  code: string;
  /** Unweighted number of all eligible respondents (those with an awareness answer for the brand). */
  base: number | null;
  groups: WomGroup[] | null;
  reason?: string;
};

export type BrandAdvertising = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** Kish effective base of the file's respondents when weighted; null unweighted or not calculated. */
  effectiveBase: number | null;
  recall: { status: "ok"; label: string; keepsNotSure: boolean; brands: RecallShare[] } | Unavailable;
  wom:
    | {
        status: "ok";
        label: string;
        /** The groups in display order (answer codes in code order, then Unaware), each with its label. */
        groups: { key: string; label: string }[];
        brands: BrandWom[];
      }
    | Unavailable;
};

/** The prompted recall shares of every listed brand from one table of the recall variables, highest yes first. Pure. */
export function recallFromResult(result: CrosstabResult | null, recall: Extract<AdvertisingRecall, { status: "found" }>, brands: { code: string }[], variables: Map<string, RoleVariable>): RecallShare[] {
  const byCode = new Map(recall.byBrand.map((b) => [b.code, b.variable]));
  const out = brands.map((b): RecallShare => {
    const variable = byCode.get(b.code) ?? null;
    if (!variable) return { code: b.code, variable: null, yes: null, notSure: null, base: null, reason: "Advertising recall was not asked about this brand." };
    if (!result) return { code: b.code, variable, yes: null, notSure: null, base: null, reason: "No figures were calculated." };
    const v = variables.get(variable);
    const yes = selectedAnswerOf(result, variable, v);
    const unsure = notSureCodes(v ?? {});
    let notSure: number | null = null;
    if (unsure.length > 0 && yes.base !== null && yes.base > 0) {
      // A not sure code nobody gave is 0 of a known base; a suppressed one is not available.
      const answers = answersOf(result, variable).answers;
      const parts = unsure.map((c) => answers.find((a) => a.code === c));
      notSure = parts.some((p) => p && p.share === null) ? null : parts.reduce((s, p) => s + (p?.share ?? 0), 0);
    }
    return { code: b.code, variable, yes: yes.share, notSure, base: yes.base, ...(yes.reason !== undefined ? { reason: yes.reason } : {}) };
  });
  // Ranked by the unrounded yes share; a brand without a figure is last, never ranked as 0. Ties keep list order.
  const order = new Map(brands.map((b, i) => [b.code, i]));
  return out.sort((a, b) => (b.yes ?? -Infinity) - (a.yes ?? -Infinity) || order.get(a.code)! - order.get(b.code)!);
}

/**
 * One brand's word of mouth groups from its table of the awareness answer and the word of mouth answer, with the
 * awareness answer as the banner. Pure. The groups are read from the total column (every eligible respondent); the
 * banner columns only check that the groups are exclusive and complete (see the file comment).
 */
export function womFromResult(result: CrosstabResult, code: string, awareVar: string, womVar: string, variables: Map<string, RoleVariable>): BrandWom {
  const aware = answersOf(result, awareVar);
  const wom = answersOf(result, womVar);
  if (aware.reason || wom.reason) return { code, base: null, groups: null, reason: aware.reason ?? wom.reason };
  // Codex D3E-F01: aware, unaware and unknown are each told from the answer list (trackerFigures.answerSides), never
  // "unaware" for every code that is not the aware one. A respondent whose awareness is unknown (don't know, refused,
  // a code the list does not label) is neither aware nor unaware, so the exclusive groups cannot be formed.
  const sides = answerSides(variables.get(awareVar) ?? {}, aware.answers.map((a) => a.code));
  if (sides === null) return { code, base: aware.base, groups: null, reason: "Which awareness answer means aware could not be told from its codes and labels." };
  const awareCode = sides.selected;
  if (aware.base === null || aware.base !== result.total.n)
    return { code, base: aware.base, groups: null, reason: `${result.total.n - (aware.base ?? 0)} respondents have no awareness answer for this brand, so all eligible respondents cannot be split into exclusive groups.` };
  const unknownGiven = sides.unknown
    .map((u) => ({ ...u, n: aware.answers.find((a) => a.code === u.code)?.n ?? null, weighted: aware.answers.find((a) => a.code === u.code)?.weighted ?? null }))
    // A listed code nobody gave changes nothing; a code without counts is not known to be empty.
    .filter((u) => u.n === null || u.n > 0 || (u.weighted ?? 0) > 0);
  if (unknownGiven.length > 0) {
    const describe = (u: (typeof unknownGiven)[number]) =>
      `${u.kind === "unlabelled" ? `code ${u.code}, which the answer list does not label` : `"${u.label}" (code ${u.code})`}: ${u.n ?? "an unknown number of"} respondents`;
    const total = unknownGiven.every((u) => u.n !== null) ? `${unknownGiven.reduce((s, u) => s + (u.n ?? 0), 0)} respondents` : "Some respondents";
    return {
      code,
      base: aware.base,
      groups: null,
      reason: `${total} gave an awareness answer that is neither aware nor unaware (${unknownGiven.map(describe).join("; ")}). They cannot be counted as Unaware, so the exclusive groups are not shown.`,
    };
  }
  const totalW = aware.answers.reduce((s, a) => s + (a.weighted ?? NaN), 0);
  if (!Number.isFinite(totalW) || totalW <= 0) return { code, base: aware.base, groups: null, reason: "The engine gave no weighted counts for the awareness answers." };
  // The banner columns, by awareness code: every aware respondent answered word of mouth; no unaware one did. Every
  // banner column is aware or unaware here (unknown answers were refused above); a column of any other code is not
  // expected and is refused rather than counted on either side.
  const womBase = result.questions.find((q) => q.key === womVar)!.rows.find((r) => r.isBase && !r.isEffBase)!;
  let awareNoAnswer = 0;
  let unawareWithAnswer = 0;
  let otherColumn: string | null = null;
  result.columns.forEach((c, k) => {
    if (c.var !== awareVar) return;
    const answered = womBase.count[k] ?? 0;
    if (c.rawCode === awareCode) awareNoAnswer += c.n - answered;
    else if (c.rawCode !== undefined && sides.notSelected.includes(c.rawCode)) unawareWithAnswer += answered;
    else if (c.n > 0) otherColumn = c.rawCode ?? c.name;
  });
  if (otherColumn !== null)
    return { code, base: aware.base, groups: null, reason: `The table has an awareness group (${otherColumn}) that is neither aware nor unaware, so the exclusive groups are not shown.` };
  if (awareNoAnswer > 0 || unawareWithAnswer > 0)
    return {
      code,
      base: aware.base,
      groups: null,
      reason: `The groups are not exclusive in this file: ${awareNoAnswer} respondents aware of the brand have no word of mouth answer and ${unawareWithAnswer} not aware of it have one.`,
    };
  const labels = variables.get(womVar)?.valueLabels ?? {};
  const codes = [...new Set([...Object.keys(labels), ...wom.answers.map((a) => a.code)])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const groups: WomGroup[] = codes.map((c) => {
    const a = wom.answers.find((x) => x.code === c);
    // A listed answer nobody gave is 0 of a known base: the base is every eligible respondent.
    return { key: c, label: labels[c] ?? a?.label ?? c, share: (100 * (a?.weighted ?? 0)) / totalW, n: a ? a.n : 0 };
  });
  const unaware = aware.answers.filter((a) => sides.notSelected.includes(a.code));
  groups.push({ key: "unaware", label: "Unaware", share: (100 * unaware.reduce((s, a) => s + (a.weighted ?? 0), 0)) / totalW, n: unaware.reduce((s, a) => s + (a.n ?? 0), 0) });
  return { code, base: aware.base, groups };
}

/** The word of mouth question and the awareness question the card needs, or why it cannot be shown. */
export function womParts(rec: TrackerRecognition, dashboard: ResolvedDashboard): { status: "ok"; wom: PerBrandMeasure; awareness: PerBrandMeasure } | Unavailable {
  const claims = stageClaims(rec, dashboard, "word_of_mouth", "single");
  if (claims.length === 0) return { status: "not_measured", reason: "This file has no word of mouth question asked about each brand with an answer list (positive, negative, ...)." };
  if (claims.length > 1) return { status: "mapping_needed", reason: `Two questions could be word of mouth (${claims.map((c) => c.label).join(" or ")}). Choose one under Customise.` };
  if (dashboard.brands.length === 0) return { status: "not_measured", reason: "No brand list was found in this file, so word of mouth cannot be shown by brand." };
  const { shown, unresolved } = overviewMeasures(rec, dashboard);
  if (unresolved.includes("awareness")) return { status: "mapping_needed", reason: "Two questions could be awareness, and the Unaware group comes from it. Choose the awareness question under Customise." };
  const awareness = shown.find((s) => s.stage === "awareness")?.measure;
  if (!awareness) return { status: "mapping_needed", reason: "No question is mapped as awareness, so the Unaware group cannot be told. Choose the awareness question under Customise." };
  return { status: "ok", wom: claims[0], awareness };
}

/** How many brand tables are computed at once (each is one engine request). */
const BRANDS_AT_ONCE = 4;

/**
 * The Advertising & WOM page for one data file. Throws with the reason when the file's dictionary, set-up or a table
 * cannot be read; never returns an empty page for a failure.
 */
export async function loadBrandAdvertising(tenantId: string, runId: string, documentId: string): Promise<BrandAdvertising & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const rec = view.recognition;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const variables = new Map(input.variables.map((v) => [v.name, v]));
  const brandCodes = new Set(dashboard.brands.map((b) => b.code));
  const recallQ = rec.advertisingRecall;
  const parts = womParts(rec, dashboard);
  const recallVars = recallQ.status === "found" ? recallQ.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => b.variable) : [];
  const womPairs =
    parts.status === "ok"
      ? dashboard.brands
          .map((b) => ({ code: b.code, aware: parts.awareness.byBrand.find((x) => x.code === b.code)?.variable, wom: parts.wom.byBrand.find((x) => x.code === b.code)?.variable }))
          .filter((p): p is { code: string; aware: string; wom: string } => !!p.aware && !!p.wom)
      : [];

  let recallTable: CrosstabResult | null = null;
  const womTables = new Map<string, CrosstabResult>();
  if (recallVars.length > 0 || womPairs.length > 0) {
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    const rowItems = (vars: string[]): CrosstabRequest["rowItems"] => vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] }));
    // Computed, not saved (computeCrosstab). excludeDk false: "not sure" and any don't know answer of the word of
    // mouth list are answers in their own right here, kept in the base.
    if (recallVars.length > 0) recallTable = (await computeCrosstab(tenantId, runId, documentId, { columnVars: [], rowItems: rowItems(recallVars), weightVar, design, excludeDk: false })).result;
    for (let i = 0; i < womPairs.length; i += BRANDS_AT_ONCE) {
      await Promise.all(
        womPairs.slice(i, i + BRANDS_AT_ONCE).map(async (p) => {
          const result = (await computeCrosstab(tenantId, runId, documentId, { columnVars: [p.aware], rowItems: rowItems([p.aware, p.wom]), weightVar, design, excludeDk: false })).result;
          womTables.set(p.code, result);
        }),
      );
    }
  }

  const recall: BrandAdvertising["recall"] =
    recallQ.status === "found"
      ? dashboard.brands.length === 0
        ? { status: "not_measured", reason: "No brand list was found in this file, so advertising recall cannot be shown by brand." }
        : { status: "ok", label: recallQ.label, keepsNotSure: recallQ.keepsNotSure, brands: recallFromResult(recallTable, recallQ, dashboard.brands, variables) }
      : recallQ.status === "ambiguous"
        ? { status: "mapping_needed", reason: recallQ.reason }
        : { status: "not_measured", reason: recallQ.reason };

  let wom: BrandAdvertising["wom"];
  if (parts.status !== "ok") wom = parts;
  else {
    const brands = dashboard.brands.map((b): BrandWom => {
      const pair = womPairs.find((p) => p.code === b.code);
      if (!pair) return { code: b.code, base: null, groups: null, reason: "Word of mouth or awareness was not asked about this brand." };
      return womFromResult(womTables.get(b.code)!, b.code, pair.aware, pair.wom, variables);
    });
    // Display order of the groups: every answer code any brand's list has, in code order, then Unaware.
    const seen = new Map<string, string>();
    for (const b of brands) for (const g of b.groups ?? []) if (g.key !== "unaware" && !seen.has(g.key)) seen.set(g.key, g.label);
    const groups = [...[...seen.entries()].sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)).map(([key, label]) => ({ key, label })), ...(brands.some((b) => b.groups) ? [{ key: "unaware", label: "Unaware" }] : [])];
    wom = { status: "ok", label: parts.wom.label, groups, brands };
  }
  const anyTable = recallTable ?? womTables.values().next().value ?? null;
  return {
    documentId,
    weighted: weightVar !== null,
    weightVar,
    effectiveBase: weightVar && anyTable ? (anyTable.total?.nEff ?? null) : null,
    recall,
    wom,
    dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand },
  };
}
