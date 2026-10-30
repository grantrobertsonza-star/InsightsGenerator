// Page 01 of the brand tracking dashboard, the "Conversion" view of the funnel card (Grant, 30 October 2026). The
// contract is in claude/d2-design-2026-10-29.md, "D3h Stage-to-stage conversion":
//   - Conversion of brand X from stage S to the next mapped stage T: the weighted count of respondents at S for X (X's
//     variable in S's question equals its selected code, trackerFigures.selectedCode, by code) who are also at T for X,
//     divided by the weighted count of respondents at S for X with a known answer to T for X.
//   - Known answer at T: the selected code or an explicit not selected code (trackerFigures.answerSides). Don't know,
//     refused, a code the answer list does not label, or any other label is unknown: outside the base, with its count
//     reported, never counted as not converting. A respondent at S with no answer at T (blank, declared missing) is
//     outside the base too, with its count. An unknown answer at S is not "at S".
//   - Computed respondent by respondent through the Cross tab engine: one table restricted to the respondents at S for
//     X by the raw code (an engine "between" filter from the code to itself, never an answer label), T's answers read
//     from it by raw code (trackerFigures.answersOf, unrounded weighted counts). Never share(T) / share(S): the two
//     agree only when everyone at T is also at S, so each brand and step also reports how many respondents are at T
//     without being at S (the non-nested count), read from a second table restricted to those at T.
//   - Small bases: the engine's own suppression rule (notes.minBase, unweighted): a base under it has no figure, with
//     the base shown. Unknown is never 0.
//   - Steps: consecutive stages of the funnel (awareness, consideration, shortlist, first choice) and of usage (usage,
//     frequent usage) that the dashboard maps to one question each. A stage claimed by two questions breaks the chain
//     ("Mapping needed"). A stage with no question at all is bridged by a step labelled as such ("Awareness to
//     Shortlist (no consideration question)"), never silently.
//   - Weighting and survey design as the dashboard's: weighted by default when the file has a weight
//     (resolveDashboard), the file's design passed to the engine (it changes no figure here, only variances).
// Nothing is saved. A file whose figures cannot be read throws with the reason.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { answerSides, answersOf, overviewMeasures, selectedAnswerOf } from "./trackerFigures";
import { conversionStageName, type ConversionCell } from "./trackerConversionDisplay";
import type { CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { FunnelStage, RoleVariable, TrackerRecognition } from "./trackerRoles";

export { CONVERSION_STAGE_NAME, conversionHeadline, rankConversion, type ConversionCell, type StepRanking, type UnknownAnswerCount } from "./trackerConversionDisplay";

/** The chains of stages a conversion is taken along, each in funnel order. Trial is not in a chain (not asked for). */
export const CONVERSION_CHAINS: readonly (readonly FunnelStage[])[] = [
  ["awareness", "consideration", "shortlist", "first_choice"],
  ["usage", "frequent_usage"],
];

const nameOf = conversionStageName;
const lower = (s: FunnelStage) => nameOf(s).toLowerCase();

export type ConversionStepPlan = {
  from: FunnelStage;
  to: FunnelStage;
  /** Stages between `from` and `to` with no question in this file (a bridged step); empty for adjacent stages. */
  bridged: FunnelStage[];
  /** "Awareness to Consideration"; a bridged step says which question is missing. */
  label: string;
};

/** A pair of adjacent stages that has no direct step, and why. */
export type SkippedStep = { from: FunnelStage; to: FunnelStage; status: "not_measured" | "mapping_needed"; reason: string };

/**
 * The steps to show from which stages are mapped to one question (`mapped`) and which are claimed by two
 * (`unresolved`). Pure. Every adjacent pair of a chain with a stage mapped or unresolved is either a step or skipped
 * with the reason. A mapped stage whose next stages have no question at all, followed by a mapped stage, gives a
 * bridged step that names the missing questions. A stage claimed by two questions is never bridged over: the
 * researcher can choose its question, and a bridge would hide that.
 */
export function conversionSteps(mapped: ReadonlySet<FunnelStage>, unresolved: ReadonlySet<FunnelStage>): { steps: ConversionStepPlan[]; skipped: SkippedStep[] } {
  const steps: ConversionStepPlan[] = [];
  const skipped: SkippedStep[] = [];
  const missing = (s: FunnelStage) => !mapped.has(s) && !unresolved.has(s);
  for (const chain of CONVERSION_CHAINS) {
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i];
      const b = chain[i + 1];
      if (mapped.has(a) && mapped.has(b)) {
        steps.push({ from: a, to: b, bridged: [], label: `${nameOf(a)} to ${nameOf(b)}` });
        continue;
      }
      if (missing(a) && missing(b)) continue;
      const contested = [a, b].filter((s) => unresolved.has(s));
      const absent = [a, b].filter(missing);
      if (contested.length > 0)
        skipped.push({ from: a, to: b, status: "mapping_needed", reason: `${nameOf(a)} to ${nameOf(b)}: two questions could be ${contested.map(lower).join(" and ")}. Choose one under Customise.` });
      else skipped.push({ from: a, to: b, status: "not_measured", reason: `${nameOf(a)} to ${nameOf(b)}: no ${absent.map(lower).join(" or ")} question was found in this file.` });
    }
    for (let i = 0; i < chain.length; i += 1) {
      if (!mapped.has(chain[i])) continue;
      let k = i + 1;
      while (k < chain.length && missing(chain[k])) k += 1;
      if (k > i + 1 && k < chain.length && mapped.has(chain[k])) {
        const bridged = chain.slice(i + 1, k);
        steps.push({ from: chain[i], to: chain[k], bridged, label: `${nameOf(chain[i])} to ${nameOf(chain[k])} (no ${bridged.map(lower).join(" or ")} question)` });
      }
    }
  }
  const order = (s: FunnelStage) => CONVERSION_CHAINS.flat().indexOf(s);
  steps.sort((x, y) => order(x.from) - order(y.from));
  return { steps, skipped };
}

/** One brand's answer at one stage, from the table of every stage variable over all respondents. */
export type StageAnswer = {
  variable: string | null;
  /** The code that means at this stage (selectedCode), or null when it cannot be told. */
  code: string | null;
  /** Unweighted number of respondents at this stage; null when it cannot be told. */
  n: number | null;
  reason?: string;
};

export type ConversionStep = ConversionStepPlan & {
  fromQuestion: { group: string; label: string };
  toQuestion: { group: string; label: string };
  /** Every listed brand, in the brand list's order. */
  cells: ConversionCell[];
};

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

export type BrandConversion = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** Kish effective base of all respondents when weighted. */
  effectiveBase: number | null;
  /** The engine's minimum unweighted base for a figure. */
  minBase: number | null;
  dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand">;
  conversion: { status: "ok"; steps: ConversionStep[]; skipped: SkippedStep[] } | Unavailable;
};

/** One brand's answer at a stage, read from the all-respondents table. Pure. */
export function stageAnswerOf(result: CrosstabResult | null, variable: string | null, v: RoleVariable | undefined): StageAnswer {
  if (!variable) return { variable: null, code: null, n: null, reason: "Not asked about this brand." };
  if (!result) return { variable, code: null, n: null, reason: "No figures were calculated." };
  const a = selectedAnswerOf(result, variable, v);
  if (a.code === null) return { variable, code: null, n: null, reason: `Which answer means selected could not be told: ${a.reason ?? "unknown"}` };
  if (a.code.trim() === "" || !Number.isFinite(Number(a.code))) return { variable, code: a.code, n: a.selectedN, reason: "The selected answer is not a numeric code, so its respondents cannot be selected by code." };
  if (a.selectedN === null) return { variable, code: a.code, n: null, reason: "The engine gave no unweighted count for the selected answer." };
  return { variable, code: a.code, n: a.selectedN };
}

/**
 * One brand's conversion from S to T. Pure. `atFromTable` is restricted to the respondents at S for the brand and has
 * T's variable as a row; `atToTable` is restricted to those at T and has S's variable as a row (for the non-nested
 * count). Either is null when it was not computed (nobody at that stage, or the stage's answer cannot be told).
 */
export function conversionCellOf(
  code: string,
  from: StageAnswer,
  to: StageAnswer,
  atFromTable: CrosstabResult | null,
  atToTable: CrosstabResult | null,
  variables: Map<string, RoleVariable>,
  minBase: number,
): ConversionCell {
  const cell: ConversionCell = {
    code,
    fromVariable: from.variable,
    toVariable: to.variable,
    conversion: null,
    base: null,
    weightedBase: null,
    weightedConverted: null,
    atFrom: from.reason ? null : from.n,
    converted: null,
    unknownAtTo: [],
    noAnswerAtTo: null,
    nonNested: null,
    suppressed: false,
  };
  // The non-nested count: everyone at T minus those at T who are also at S. Nobody at T is a known 0.
  if (!to.reason && !from.reason && to.n !== null) {
    if (to.n === 0) cell.nonNested = 0;
    else if (atToTable && from.variable) {
      const back = answersOf(atToTable, from.variable);
      const atBoth = back.answers.find((x) => x.code === from.code)?.n ?? (back.reason ? null : 0);
      if (atBoth !== null && Number.isFinite(atToTable.total?.n)) cell.nonNested = atToTable.total.n - atBoth;
    }
  }
  if (from.reason) return { ...cell, reason: `${from.reason} (the earlier stage)` };
  if (to.reason && !to.variable) return { ...cell, reason: `${to.reason} (the later stage)` };
  if (from.n === 0) return { ...cell, base: 0, reason: "Nobody is at the earlier stage for this brand." };
  if (!atFromTable || !to.variable) return { ...cell, reason: to.reason ? `${to.reason} (the later stage)` : "No figures were calculated." };
  const read = answersOf(atFromTable, to.variable);
  if (read.reason) return { ...cell, reason: read.reason };
  const sides = answerSides(variables.get(to.variable) ?? {}, read.answers.map((x) => x.code));
  if (!sides) return { ...cell, reason: "Which answer of the later stage means selected could not be told from its codes and labels." };
  if (to.code !== null && sides.selected !== to.code) return { ...cell, reason: "The later stage's selected answer reads differently among those at the earlier stage, so it is not compared." };
  const known = new Set([sides.selected, ...sides.notSelected]);
  const unknownCodes = new Map(sides.unknown.map((u) => [u.code, u]));
  let base = 0;
  let wBase = 0;
  let converted = 0;
  let wConverted = 0;
  let answered = 0;
  for (const a of read.answers) {
    if (a.n === null || a.weighted === null) return { ...cell, reason: "The engine gave no count for an answer of the later stage." };
    answered += a.n;
    if (known.has(a.code)) {
      base += a.n;
      wBase += a.weighted;
      if (a.code === sides.selected) {
        converted += a.n;
        wConverted += a.weighted;
      }
    } else if (a.n > 0) {
      const u = unknownCodes.get(a.code);
      cell.unknownAtTo.push({ code: a.code, label: u?.label ?? null, kind: u?.kind ?? "unlabelled", n: a.n });
    }
  }
  const out: ConversionCell = {
    ...cell,
    base,
    converted,
    noAnswerAtTo: from.n === null ? null : from.n - answered,
    weightedBase: wBase,
    weightedConverted: wConverted,
  };
  if (base === 0) return { ...out, reason: "Nobody at the earlier stage has a known answer at the later stage." };
  if (base < minBase) return { ...out, weightedBase: null, weightedConverted: null, suppressed: true, reason: `Suppressed for a small base: ${base} respondents, under the minimum of ${minBase}.` };
  if (!(wBase > 0)) return { ...out, reason: "The weighted base is zero." };
  return { ...out, conversion: (100 * wConverted) / wBase };
}

// ---- Loading ------------------------------------------------------------------------------------------------------

/** How many brand tables are computed at once (each is one engine request). */
const TABLES_AT_ONCE = 4;

type MeasureOf = TrackerRecognition["measures"][number];

/**
 * The Conversion view for one data file. Throws with the reason when the file's dictionary, set-up or a table cannot
 * be read; never returns empty figures for a failure.
 */
export async function loadBrandConversion(tenantId: string, runId: string, documentId: string): Promise<BrandConversion> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const out = { documentId, weighted: weightVar !== null, weightVar, effectiveBase: null as number | null, minBase: null as number | null, dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand } };
  if (dashboard.brands.length === 0) return { ...out, conversion: { status: "not_measured", reason: "No brand list was found in this file, so conversion cannot be shown by brand." } };
  const { shown, unresolved } = overviewMeasures(view.recognition, dashboard);
  const measureOf = new Map<FunnelStage, MeasureOf>(shown.map((s) => [s.stage, s.measure]));
  const plan = conversionSteps(new Set(measureOf.keys()), new Set(unresolved));
  if (plan.steps.length === 0) return { ...out, conversion: { status: "ok", steps: [], skipped: plan.skipped } };

  const variables = new Map(input.variables.map((v) => [v.name, v]));
  const brandCodes = dashboard.brands.map((b) => b.code);
  const stages = [...new Set(plan.steps.flatMap((s) => [s.from, s.to]))];
  const varOf = (stage: FunnelStage, code: string) => measureOf.get(stage)?.byBrand.find((b) => b.code === code)?.variable ?? null;
  const allVars = stages.flatMap((s) => brandCodes.map((c) => varOf(s, c)).filter((v): v is string => !!v));

  const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
  if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
  if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
  const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
  const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
  const rowItems = (vars: string[]): CrosstabRequest["rowItems"] => vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] }));
  // Every answer code kept (excludeDk false): unknown answers are classified by answerSides, not dropped by the engine.
  const request = (vars: string[], filter?: { variable: string; code: string }): CrosstabRequest => ({
    columnVars: [],
    rowItems: rowItems(vars),
    weightVar,
    design,
    excludeDk: false,
    ...(filter ? { filters: [{ variable: filter.variable, op: "between" as const, min: Number(filter.code), max: Number(filter.code) }] } : {}),
  });

  // Computed, not saved (computeCrosstab): opening the view adds no table to the file.
  const all = allVars.length > 0 ? (await computeCrosstab(tenantId, runId, documentId, request(allVars))).result : null;
  const minBase = all?.notes?.minBase ?? null;
  if (all && (minBase === null || !Number.isFinite(minBase))) throw new Error("The engine did not report its minimum base, so small bases could not be told.");
  out.minBase = minBase;
  out.effectiveBase = weightVar && all ? (all.total?.nEff ?? null) : null;
  const answer = new Map<string, StageAnswer>();
  const key = (stage: FunnelStage, code: string) => `${stage}|${code}`;
  for (const stage of stages) for (const code of brandCodes) {
    const v = varOf(stage, code);
    answer.set(key(stage, code), stageAnswerOf(all, v, v ? variables.get(v) : undefined));
  }

  // One table per brand and stage Z with someone at Z: restricted to those at Z, holding the later stage of every step
  // from Z (its conversion) and the earlier stage of every step to Z (its non-nested count).
  const jobs: { stage: FunnelStage; code: string; vars: string[] }[] = [];
  for (const code of brandCodes) for (const stage of stages) {
    const a = answer.get(key(stage, code))!;
    if (a.reason || !a.n) continue;
    const vars = [
      ...plan.steps.filter((s) => s.from === stage).map((s) => varOf(s.to, code)),
      ...plan.steps.filter((s) => s.to === stage).map((s) => varOf(s.from, code)),
    ].filter((v): v is string => !!v);
    if (vars.length > 0) jobs.push({ stage, code, vars: [...new Set(vars)] });
  }
  const tables = new Map<string, CrosstabResult>();
  for (let i = 0; i < jobs.length; i += TABLES_AT_ONCE) {
    await Promise.all(
      jobs.slice(i, i + TABLES_AT_ONCE).map(async (j) => {
        const a = answer.get(key(j.stage, j.code))!;
        tables.set(key(j.stage, j.code), (await computeCrosstab(tenantId, runId, documentId, request(j.vars, { variable: a.variable!, code: a.code! }))).result);
      }),
    );
  }

  const steps: ConversionStep[] = plan.steps.map((s) => ({
    ...s,
    fromQuestion: { group: measureOf.get(s.from)!.group, label: measureOf.get(s.from)!.label },
    toQuestion: { group: measureOf.get(s.to)!.group, label: measureOf.get(s.to)!.label },
    cells: brandCodes.map((code) =>
      conversionCellOf(code, answer.get(key(s.from, code))!, answer.get(key(s.to, code))!, tables.get(key(s.from, code)) ?? null, tables.get(key(s.to, code)) ?? null, variables, minBase ?? Infinity),
    ),
  }));
  return { ...out, conversion: { status: "ok", steps, skipped: plan.skipped } };
}
