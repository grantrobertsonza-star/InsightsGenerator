"use server";

import { revalidatePath } from "next/cache";

import { withTenant } from "./db";
import { RUN_NOT_AVAILABLE, assertRunOwned, runAccessible } from "./runOwnership";
import { findingProvenanceAvailable, recordHumanReview } from "./findingProvenance";
import { loadVariableDictionary, loadVariableDictionaryWithStatus } from "./crosstabs";
import { defaultWeight } from "./starterTables";
import { runDistributionAction, type ChartSeries } from "./chartActions";
import { runNpsAction, type NpsUnavailableSegment } from "./npsActions";
import type { VariableInfo, VariableSet, VariableDictionary } from "./parseStatsFile";
import { defaultMetricForScale, summarizeSeries, type CsmMetric } from "./csmMetrics";
import {
  categoryAverage,
  categoryAverageExact,
  brandHealthFindingKey,
  matchSetMembersToBrands,
  sectionSplitsByBrandGroups,
  brandSetMembers,
  brandGroupsOverlapNote,
  normaliseBrandHealthMapping,
  type BrandSetMember,
} from "./brandHealthMetrics";
import { selectedCode } from "./trackerFigures";
import { requireTenantId } from "./requestContext";

export type { CsmMetric };



type Fail = { ok: false; error: string };

/** One score, by brand: a funnel stage, an attribute, or a category-entry-point (moment). */
export type BrandHealthScore = {
  variable: string;
  label: string;
  metric: CsmMetric;
  /** value: the display score (one decimal); exact: the same score unrounded, which the funnel ratios,
   * category average and gaps are computed from (CT5K-F01). */
  byBrand: { brand: string; value: number | null; exact?: number | null; n: number }[];
  categoryAvg: number | null;
  /** How respondents were split by brand: "brand_groups" when one question was read within each brand's group
   * (the brand variable's categories, or with a brand set each member's selected respondents, which overlap);
   * "brand_columns" when a multiple-response set gave one column per brand, which is not affected by the brand
   * source. Absent on dashboards saved in findings before brand sets existed (all were brand variable splits or
   * brand columns, not told apart). */
  brandSplit?: "brand_groups" | "brand_columns";
};

export type BrandHealthFunnelStage = BrandHealthScore & { stage: "awareness" | "consideration" | "usage" | "frequent" };

/**
 * Either a plain shared variable split by the brand variable (the simple case: one question,
 * every brand's answer in the same column), or a multi-response set with one member column per
 * brand (eg awareness_b1..awareness_b6) - the shape Grant's real brand-tracker files actually
 * use for funnel stages, opinion/attribute batteries and category-entry-point batteries alike.
 * Exactly one of the two fields is set.
 */
export type BrandHealthSource = { variable: string; metric?: CsmMetric } | { setKey: string; metric?: CsmMetric };
export type BrandHealthAttributeMapping = BrandHealthSource;

export type BrandHealthMapping = {
  /** The categorical variable whose values are the brands in the data (eg "which brand do you use most often").
   * Exactly one of brandVar and brandSet is named once the brand source is chosen. */
  brandVar: string | null;
  /** A multiple-response set with one yes/no member per brand (eg owner_b01..owner_b10, set "owner"), named as the
   * brand source instead of a brand variable (Grant, 29 October 2026). A respondent is in brand X's group when they
   * selected member X, so the groups overlap. Absent from mappings saved before 29 October 2026, read as null. */
  brandSet?: string | null;
  /** The brand this dashboard reads everything else against: with brandVar one of its category labels, with
   * brandSet one member variable's name (the brand's identity; its label is for display). */
  ourBrand: string | null;
  funnel: {
    awareness?: BrandHealthSource;
    consideration?: BrandHealthSource;
    usage?: BrandHealthSource;
    frequent?: BrandHealthSource;
  };
  attributes: BrandHealthAttributeMapping[];
  loyaltyVar: string | null;
  /** Category entry points / occasions (Ehrenberg-Bass): optional, same mechanism as attributes. */
  moments: BrandHealthAttributeMapping[];
  /** Two mapped attributes to plot ours and competitors on, for the positioning map. Null until both are picked. */
  positioning: { xVar: string | null; yVar: string | null };
};

/** A brand group without an NPS: the group's respondents, its valid answers (both unweighted, from the NPS tool) and
 * why there is no score. */
export type LoyaltyUnavailable = { brand: string; groupN: number; validAnswers: number; reason: string };

export type BrandHealthDashboard = {
  documentId: string;
  waveLabel: string | null;
  weighted: boolean;
  /** The brand source: one of brandVar and brandSet is set. */
  brandVar: string | null;
  brandSet: string | null;
  /** Our brand's display label (with a brand set, the member's brand label; its identity is ourBrandVariable). */
  ourBrand: string;
  /** With a brand set, our brand's member variable; null with a brand variable. */
  ourBrandVariable: string | null;
  /** With a brand set, each brand's member variable and label, in set order; null with a brand variable. */
  brandMembers: BrandSetMember[] | null;
  /** True when the brand groups overlap (a brand set): figures split by brand count a respondent in every brand
   * group they belong to. */
  groupsOverlap: boolean;
  /** The sentence the dashboard shows when the groups overlap; null otherwise. */
  overlapNote: string | null;
  /** Figures not shown, each with the reason (a figure that cannot be computed, or one that would assume
   * exclusive brand groups when the groups overlap). */
  withheld: { figure: string; reason: string }[];
  brands: string[];
  funnel: BrandHealthFunnelStage[];
  /**
   * ANA-BRAND-001: each stage is scored independently (its own distribution or set, by brand),
   * so there is no case-level record here of which respondents cleared one stage AND the next -
   * `pct` is the ratio of two independently-measured marginal rates (stage i's brand rate over
   * stage i-1's), not the share of stage-(i-1) respondents who also reached stage i. It reads
   * like a conversion and moves like one when the stages happen to be nested in the data, but it
   * is not computed as one, so it is not labelled "conversion" here or in the UI - see `basis`.
   */
  conversions: {
    fromStage: string;
    toStage: string;
    /** The funnel stage keys this ratio is between, so callers can name a specific, known pair
     * precisely (eg "consideration" -> "usage" is this funnel's purchase-among-those-who-
     * considered step) rather than only a generic "stage A to stage B" label. */
    fromKey: BrandHealthFunnelStage["stage"];
    toKey: BrandHealthFunnelStage["stage"];
    basis: "marginal_ratio";
    byBrand: {
      brand: string;
      /** null when `basesSimilarSize` is false - see that field's own comment for why this is a
       * suppression, not merely a display choice. */
      pct: number | null;
      /** ANA-BRAND-001: a SIZE diagnostic only, never proof of a comparable eligible population.
       * `fromN`/`toN` are now each stage's own QUESTION-ANSWERED base for this brand (the number
       * who actually answered that stage's question, not the brand's overall banner-column size -
       * see chartActions.ts's ANA-BRAND-001 fix), so a mismatch here is a real, visible signal
       * that the two stages were not asked of (or answered by) the same number of people. But
       * this app has no case-level record of WHO answered each stage (scoreByBrand/scoreBySet run
       * each stage independently - see the comment on `conversions` above), so even two near-
       * identical base sizes do not establish that the same respondents, or an equivalent eligible
       * population, sit behind both numbers: a screening question, routing/skip logic, filters, or
       * a missing-response convention that differs between the two stages' source variables can
       * all produce coincidentally similar base sizes from genuinely different populations. This
       * flag is therefore a NECESSARY-not-sufficient check (it catches the most detectable case,
       * a gross size mismatch) - false means the ratio is suppressed outright (see `pct` above);
       * true means only that size alone gives no reason to doubt it, not that comparability is
       * established. Callers must present it that way, never as "validated" or "comparable". */
      basesSimilarSize: boolean;
      fromN: number;
      toN: number;
    }[];
  }[];
  attributes: BrandHealthScore[];
  loyalty: {
    variable: string;
    label: string;
    byBrand: { brand: string; nps: number; promoters: number; detractors: number; n: number }[];
    /** Brand groups with no NPS (Codex BH-F02), each with the NPS tool's counts and the reason, shown as "Not shown"
     * rows instead of disappearing. Never a score: a suppressed group stays unavailable. Absent on a dashboard built
     * before 30 October 2026. */
    unavailable?: LoyaltyUnavailable[];
  } | null;
  moments: BrandHealthScore[];
  positioning: {
    xVariable: string;
    xLabel: string;
    yVariable: string;
    yLabel: string;
    points: { brand: string; x: number | null; y: number | null }[];
    /** "brand_groups" when either axis was read within brand groups (see BrandHealthScore.brandSplit). */
    brandSplit?: "brand_groups" | "brand_columns";
  } | null;
};

const FUNNEL_STAGES: { key: keyof BrandHealthMapping["funnel"]; stage: BrandHealthFunnelStage["stage"]; fallbackLabel: string }[] = [
  { key: "awareness", stage: "awareness", fallbackLabel: "Awareness" },
  { key: "consideration", stage: "consideration", fallbackLabel: "Consideration" },
  { key: "usage", stage: "usage", fallbackLabel: "Past-period usage" },
  { key: "frequent", stage: "frequent", fallbackLabel: "Frequent / repeat usage" },
];

/** The variables a Brand Health mapping can draw from, grouped the way the setup screen offers them. */
export async function loadBrandHealthCandidatesAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; variables: VariableInfo[]; sets: VariableSet[]; weightVar: string | null } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const dict = await loadVariableDictionary(TENANT_ID, runId, documentId);
    const usable = dict.variables.filter((v) => !v.weightLike && !v.text && v.nDistinct >= 2);
    return { ok: true, variables: usable, sets: dict.sets ?? [], weightVar: defaultWeight(dict) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The brand variable's own category labels, for the "which brand is ours" picker, read straight from the crosstab engine's variable dictionary, not run against the file. */
export async function loadBrandCategoriesAction(
  runId: string,
  documentId: string,
  brandVar: string,
  weightVar: string | null,
): Promise<{ ok: true; brands: string[] } | Fail> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const res = await runDistributionAction(runId, documentId, brandVar, weightVar, null);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, brands: res.result.series[0]?.bars.map((b) => b.label) ?? [] };
}

/**
 * The brand set's brands for the "which brand is ours" picker: each member variable (the brand's identity) with
 * its brand label (brandHealthMetrics.brandSetMembers). Refused, with the reason, when the set is not a
 * multiple-response set in this file; a failed read of the file's set-up is reported, never an empty list.
 */
export async function loadBrandSetMembersAction(
  runId: string,
  documentId: string,
  setKey: string,
): Promise<{ ok: true; members: BrandSetMember[]; setLabel: string } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const dictStatus = await loadVariableDictionaryWithStatus(TENANT_ID, runId, documentId);
    if (!dictStatus.ok) return { ok: false, error: `This file's saved set-up could not be read: ${dictStatus.error}` };
    const resolved = brandSetMembers(dictStatus.dictionary, setKey);
    if (!resolved.ok) return resolved;
    return { ok: true, members: resolved.members, setLabel: resolved.set.label || resolved.set.key };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Who is in each brand's group. With a brand variable: its categories (exclusive groups, one banner). With a brand
 * set: each member's respondents who gave its selected code (overlapping groups). The selected code is read once
 * per member, by code, through the tracker rule's owner (trackerFigures.selectedCode: a "Selected"/"Yes" answer
 * label, or code 1 of a 0/1 variable), never from a label's position.
 */
type BrandGroups =
  | { kind: "variable"; variable: string }
  | { kind: "set"; setKey: string; setLabel: string; members: (BrandSetMember & { selected: string; hasRespondents: boolean })[] };

async function resolveBrandSetGroups(
  runId: string,
  documentId: string,
  dict: VariableDictionary,
  setKey: string,
): Promise<Extract<BrandGroups, { kind: "set" }> | { error: string }> {
  const resolved = brandSetMembers(dict, setKey);
  if (!resolved.ok) return { error: resolved.error };
  const members: (BrandSetMember & { selected: string; hasRespondents: boolean })[] = [];
  for (const m of resolved.members) {
    // Read unweighted: only the codes, their labels and whether anyone gave the selected code are needed here, and
    // an unweighted share of exactly 0 means nobody gave it (a weighted one could also be zero weights).
    const res = await runDistributionAction(runId, documentId, m.variable, null, null, "compute");
    if (!res.ok) return { error: `The brand set member ${m.variable} (${m.brand}) could not be read: ${res.error}` };
    const bars = res.result.series[0]?.bars ?? [];
    const codes = bars.map((b) => b.rawCode).filter((c): c is string => c !== undefined);
    const valueLabels = Object.fromEntries(bars.filter((b) => b.rawCode !== undefined && b.label !== b.rawCode).map((b) => [b.rawCode as string, b.label]));
    const selected = selectedCode({ valueLabels }, codes);
    if (selected === null) {
      return { error: `Which answer of ${m.variable} (${m.brand}) means the brand was selected cannot be told from its answers, so its brand group cannot be formed.` };
    }
    // Codex BH-F02: a member nobody selected has an empty brand group. The engine refuses a banner with one group, so
    // figures split by this member are not requested; the group is reported empty instead. A suppressed share (null)
    // still has respondents.
    const selectedBar = bars.find((b) => b.rawCode === selected);
    members.push({ ...m, selected, hasRespondents: selectedBar !== undefined && selectedBar.share !== 0 });
  }
  return { kind: "set", setKey, setLabel: resolved.set.label || resolved.set.key, members };
}

/**
 * One shared question read within each brand's group. With a brand variable this is the variable's own banner,
 * as before. With a brand set, each member is its own banner (respondents who selected it against those who did
 * not) and only the selected column is kept: brand X's figure is the question's distribution among respondents who
 * selected member X, weighted by the dashboard's weight with the file's design (runDistributionAction), so a
 * respondent who selected two brands is in both figures. A brand whose group has nobody answering the question
 * has no figure (null) on a base of 0, never 0.
 */
async function scoreByBrand(
  runId: string,
  documentId: string,
  variable: string,
  label: string,
  metric: CsmMetric,
  weightVar: string | null,
  groups: BrandGroups,
): Promise<BrandHealthScore | { error: string }> {
  let byBrand: BrandHealthScore["byBrand"];
  if (groups.kind === "variable") {
    const res = await runDistributionAction(runId, documentId, variable, weightVar, groups.variable);
    if (!res.ok) return { error: res.error };
    byBrand = res.result.series.map((s: ChartSeries) => {
      const sum = summarizeSeries(s, metric);
      return { brand: s.name, value: sum.value, exact: sum.exact, n: s.n };
    });
  } else {
    byBrand = [];
    for (const m of groups.members) {
      if (!m.hasRespondents) {
        byBrand.push({ brand: m.brand, value: null, exact: null, n: 0 });
        continue;
      }
      const res = await runDistributionAction(runId, documentId, variable, weightVar, m.variable, "compute");
      if (!res.ok) return { error: res.error };
      const s = res.result.series.find((x) => x.code === m.selected);
      if (!s) {
        byBrand.push({ brand: m.brand, value: null, exact: null, n: 0 });
        continue;
      }
      const sum = summarizeSeries(s, metric);
      byBrand.push({ brand: m.brand, value: sum.value, exact: sum.exact, n: s.n });
    }
  }
  return {
    variable,
    label,
    metric,
    byBrand,
    categoryAvg: categoryAverage(byBrand),
    brandSplit: "brand_groups",
  };
}

/**
 * Scores a multi-response set where each brand has its own member column (eg
 * awareness_b1..awareness_b6) rather than one shared question split by the brand variable.
 * Matches each member to a brand by label text (matchSetMembersToBrands), then runs each
 * matched member's own plain distribution - no groupVar needed, since the brand split is
 * already baked into which column is which. A set covering fewer than the full brand list (eg
 * an attribute battery asked for only 3 of 6 brands, per the codebook) simply scores fewer
 * brands rather than failing. Not affected by the brand source: with a brand set, each column is still read
 * among everyone who answered it, not within a brand group.
 */
async function scoreBySet(
  runId: string,
  documentId: string,
  setKey: string,
  fallbackLabel: string,
  metricOverride: CsmMetric | undefined,
  weightVar: string | null,
  dict: VariableDictionary,
  brandPool: string[],
): Promise<BrandHealthScore | { error: string }> {
  const set = dict.sets?.find((s) => s.key === setKey);
  if (!set) return { error: `Multi-response set "${setKey}" wasn't found in this file.` };
  const byName = new Map(dict.variables.map((v) => [v.name, v]));
  const matched = matchSetMembersToBrands(set, byName, brandPool);
  if (matched.length === 0) return { error: `None of "${set.label}"'s brand columns matched a brand name in this file.` };
  const metric = metricOverride ?? defaultMetricForScale(byName.get(matched[0].variable)?.nDistinct ?? 2);
  const byBrand: BrandHealthScore["byBrand"] = [];
  for (const { brand, variable } of matched) {
    const res = await runDistributionAction(runId, documentId, variable, weightVar, null);
    if (!res.ok) continue;
    const series = res.result.series[0];
    if (!series) continue;
    const sum = summarizeSeries(series, metric);
    byBrand.push({ brand, value: sum.value, exact: sum.exact, n: series.n });
  }
  return {
    variable: setKey,
    label: set.label || fallbackLabel,
    metric,
    byBrand,
    categoryAvg: categoryAverage(byBrand),
    brandSplit: "brand_columns",
  };
}

/** Scores a BrandHealthSource, dispatching to the plain-variable or multi-response-set path. */
async function scoreSource(
  runId: string,
  documentId: string,
  source: BrandHealthSource,
  fallbackLabel: string,
  defaultScalePoints: number,
  weightVar: string | null,
  groups: BrandGroups,
  byName: Map<string, VariableInfo>,
  dict: VariableDictionary,
  brandPool: string[],
): Promise<BrandHealthScore | { error: string }> {
  if ("setKey" in source) {
    return scoreBySet(runId, documentId, source.setKey, fallbackLabel, source.metric, weightVar, dict, brandPool);
  }
  const v = byName.get(source.variable);
  const metric = source.metric ?? defaultMetricForScale(v?.nDistinct ?? defaultScalePoints);
  return scoreByBrand(runId, documentId, source.variable, v?.label || fallbackLabel, metric, weightVar, groups);
}

/** Why a brand group has no NPS, from the NPS tool's counts for that group (never from rounded shares). */
function loyaltyUnavailableReason(u: Pick<NpsUnavailableSegment, "groupN" | "rawN" | "reason">): string {
  if (u.groupN === 0) return "No respondents in this brand's group.";
  if (u.reason === "suppressed") return `Suppressed for a small base: ${u.rawN} valid answer${u.rawN === 1 ? "" : "s"} in this brand's group.`;
  if (u.rawN === 0) return `None of the ${u.groupN} respondents in this brand's group gave a valid answer.`;
  return "The valid answers in this brand's group carry no weight.";
}

/**
 * NPS within each brand's group, through the NPS tool (runNpsAction), split the same way as scoreByBrand. A group the
 * NPS tool could not score (Codex BH-F02: too few valid answers, none, or no respondents in the group) is kept in
 * `unavailable` with the tool's counts and the reason, never dropped and never given a score.
 */
async function loyaltyByBrand(
  runId: string,
  documentId: string,
  variable: string,
  weightVar: string | null,
  groups: BrandGroups,
): Promise<{ byBrand: NonNullable<BrandHealthDashboard["loyalty"]>["byBrand"]; unavailable: LoyaltyUnavailable[] } | { error: string }> {
  const unavailableRow = (brand: string, u: Pick<NpsUnavailableSegment, "groupN" | "rawN" | "reason">): LoyaltyUnavailable => ({
    brand,
    groupN: u.groupN,
    validAnswers: u.rawN,
    reason: loyaltyUnavailableReason(u),
  });
  if (groups.kind === "variable") {
    const nps = await runNpsAction(runId, documentId, variable, weightVar, groups.variable);
    if (!nps.ok) return { error: nps.error };
    return {
      byBrand: (nps.result.segments ?? []).map((s) => ({ brand: s.name, nps: s.nps, promoters: s.promoters, detractors: s.detractors, n: s.n })),
      unavailable: (nps.result.unavailableSegments ?? []).map((u) => unavailableRow(u.name, u)),
    };
  }
  const byBrand: NonNullable<BrandHealthDashboard["loyalty"]>["byBrand"] = [];
  const unavailable: LoyaltyUnavailable[] = [];
  for (const m of groups.members) {
    if (!m.hasRespondents) {
      unavailable.push(unavailableRow(m.brand, { groupN: 0, rawN: 0, reason: "no_valid_answers" }));
      continue;
    }
    const nps = await runNpsAction(runId, documentId, variable, weightVar, m.variable, undefined, "compute");
    if (!nps.ok) return { error: nps.error };
    const s = (nps.result.segments ?? []).find((x) => x.code === m.selected);
    if (s) {
      byBrand.push({ brand: m.brand, nps: s.nps, promoters: s.promoters, detractors: s.detractors, n: s.n });
      continue;
    }
    // The member's selected code has no banner column when nobody gave it: the group has no respondents.
    const u = (nps.result.unavailableSegments ?? []).find((x) => x.code === m.selected) ?? { groupN: 0, rawN: 0, reason: "no_valid_answers" as const };
    unavailable.push(unavailableRow(m.brand, u));
  }
  return { byBrand, unavailable };
}

/**
 * The brand source named in a mapping, checked against the file's dictionary: a brand set must be a
 * multiple-response set of this file, and our brand (when picked) one of its members. Null when acceptable.
 */
function brandSourceRefusal(mapping: BrandHealthMapping, dict: VariableDictionary): string | null {
  if (!mapping.brandSet) return null;
  const resolved = brandSetMembers(dict, mapping.brandSet);
  if (!resolved.ok) return resolved.error;
  if (mapping.ourBrand && !resolved.members.some((m) => m.variable === mapping.ourBrand)) {
    return `Our brand (${mapping.ourBrand}) is not a member of the brand set "${resolved.set.label || resolved.set.key}".`;
  }
  return null;
}

/**
 * Runs one Brand Health dashboard for one file: the funnel stages, the attribute battery, loyalty
 * (NPS), category entry points (moments) and a two-attribute positioning map, every brand
 * mapped through the file's own brand source (a brand variable, or a brand set whose groups overlap) rather
 * than one question per brand. Every step reuses the single-file engines (runDistributionAction, runNpsAction)
 * the other Analytics tools already run on, the same way the CSM module does.
 */
export async function buildBrandHealthDashboardAction(
  runId: string,
  documentId: string,
  sentMapping: BrandHealthMapping,
  waveLabel?: string | null,
): Promise<{ ok: true; dashboard: BrandHealthDashboard } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const parsed = normaliseBrandHealthMapping(sentMapping);
    if (!parsed.ok) return parsed;
    const mapping = parsed.mapping;
    if (!mapping.brandVar && !mapping.brandSet) {
      return { ok: false, error: "Map the brand variable first: which question in the file holds the brand values, or a multiple-response set with one member per brand." };
    }
    if (!mapping.ourBrand) return { ok: false, error: "Pick which brand is \"ours\" to compare against the rest." };

    const dictStatus = await loadVariableDictionaryWithStatus(TENANT_ID, runId, documentId);
    if (!dictStatus.ok) return { ok: false, error: `This file's saved set-up could not be read: ${dictStatus.error}` };
    const dict = dictStatus.dictionary;
    const refusal = brandSourceRefusal(mapping, dict);
    if (refusal) return { ok: false, error: refusal };
    const weightVar = defaultWeight(dict);
    const byName = new Map(dict.variables.map((v) => [v.name, v]));

    // Fetched once up front: the full brand list, both as the dashboard's fallback brand order
    // and as the pool a multi-response set's per-brand member columns are matched against.
    let groups: BrandGroups;
    let allBrands: string[];
    let ourBrand: string;
    if (mapping.brandSet) {
      const resolved = await resolveBrandSetGroups(runId, documentId, dict, mapping.brandSet);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      groups = resolved;
      allBrands = resolved.members.map((m) => m.brand);
      ourBrand = resolved.members.find((m) => m.variable === mapping.ourBrand)!.brand;
    } else {
      groups = { kind: "variable", variable: mapping.brandVar! };
      const brandListRes = await loadBrandCategoriesAction(runId, documentId, mapping.brandVar!, weightVar);
      allBrands = brandListRes.ok ? brandListRes.brands : [];
      ourBrand = mapping.ourBrand;
    }
    const withheld: BrandHealthDashboard["withheld"] = [];

    const sourceLabel = (source: BrandHealthSource, fallback: string): string =>
      "setKey" in source ? dict.sets?.find((s) => s.key === source.setKey)?.label || fallback : byName.get(source.variable)?.label || fallback;

    const funnel: BrandHealthFunnelStage[] = [];
    let brands: string[] = [];
    for (const { key, stage, fallbackLabel } of FUNNEL_STAGES) {
      const stageMap = mapping.funnel[key];
      if (!stageMap) continue;
      const scored = await scoreSource(runId, documentId, stageMap, fallbackLabel, 2, weightVar, groups, byName, dict, allBrands);
      if ("error" in scored) return { ok: false, error: scored.error };
      funnel.push({ ...scored, stage });
      if (brands.length === 0) brands = scored.byBrand.map((b) => b.brand);
    }

    const attributes: BrandHealthScore[] = [];
    for (const attr of mapping.attributes) {
      const scored = await scoreSource(runId, documentId, attr, sourceLabel(attr, "Attribute"), 5, weightVar, groups, byName, dict, allBrands);
      if ("error" in scored) {
        // An attribute that can't be tabulated is left out rather than failing the whole dashboard, and listed.
        withheld.push({ figure: sourceLabel(attr, "Attribute"), reason: scored.error });
        continue;
      }
      attributes.push(scored);
      if (brands.length === 0) brands = scored.byBrand.map((b) => b.brand);
    }

    const moments: BrandHealthScore[] = [];
    for (const m of mapping.moments) {
      const scored = await scoreSource(runId, documentId, m, sourceLabel(m, "Moment"), 2, weightVar, groups, byName, dict, allBrands);
      if ("error" in scored) {
        withheld.push({ figure: sourceLabel(m, "Moment"), reason: scored.error });
        continue;
      }
      moments.push(scored);
      if (brands.length === 0) brands = scored.byBrand.map((b) => b.brand);
    }

    let loyalty: BrandHealthDashboard["loyalty"] = null;
    if (mapping.loyaltyVar) {
      const v = byName.get(mapping.loyaltyVar);
      const nps = await loyaltyByBrand(runId, documentId, mapping.loyaltyVar, weightVar, groups);
      if ("error" in nps) {
        withheld.push({ figure: v?.label || mapping.loyaltyVar, reason: nps.error });
      } else {
        loyalty = { variable: mapping.loyaltyVar, label: v?.label || mapping.loyaltyVar, byBrand: nps.byBrand, unavailable: nps.unavailable };
        if (brands.length === 0) brands = loyalty.byBrand.map((b) => b.brand);
      }
    }

    if (brands.length === 0) brands = allBrands;

    // With overlapping brand groups, a comparison that treats the brand groups as separate samples (a test across
    // brand groups, an NPS group-versus-rest test adjusted across the groups, or brand shares meant to add up to
    // the total) would be computed on respondents counted more than once. None is computed or shown.
    if (groups.kind === "set") {
      withheld.push({
        figure: "Tests across brand groups (significance between brands, NPS brand versus the rest)",
        reason: "The brand groups overlap, so they are not separate samples; a test across them would count some respondents twice. Not computed.",
      });
    }

    // ANA-BRAND-001: this is deliberately a ratio of two independent marginal rates, not a true
    // conditional conversion (100 x sum_w(stage i-1 AND stage i) / sum_w(stage i-1)). Computing
    // the real intersection needs the two stages' selections on the SAME cases, but a funnel
    // stage here is scored on its own (scoreByBrand/scoreBySet each run their own independent
    // distribution), with no case-level join between one stage's source variable/set-member and
    // the next's kept around afterwards. Building that join generically - across both the
    // plain-shared-variable-by-brandVar shape and the per-brand multi-response-set shape, and
    // across whatever "selected" threshold each stage's own metric (mean/top1/top2/top3)
    // implies - is real new engineering, not a one-line fix, so it is left as a clearly-labelled
    // marginal ratio (basis: "marginal_ratio") rather than shipped as an intersection that cannot
    // be verified against live data from here.
    const conversions: BrandHealthDashboard["conversions"] = [];
    for (let i = 1; i < funnel.length; i++) {
      const from = funnel[i - 1];
      const to = funnel[i];
      conversions.push({
        fromStage: from.label,
        toStage: to.label,
        fromKey: from.stage,
        toKey: to.stage,
        basis: "marginal_ratio",
        byBrand: brands.map((brand) => {
          const fromEntry = from.byBrand.find((b) => b.brand === brand);
          const toEntry = to.byBrand.find((b) => b.brand === brand);
          // The ratio of the two unrounded scores, rounded once (CT5K-F01).
          const fromVal = (fromEntry?.exact !== undefined ? fromEntry.exact : fromEntry?.value) ?? null;
          const toVal = (toEntry?.exact !== undefined ? toEntry.exact : toEntry?.value) ?? null;
          // ANA-BRAND-001: each stage's own QUESTION-ANSWERED base for this brand (fixed in
          // chartActions.ts to read the row's per-column base, not the banner column's overall
          // size - the two used to be conflated, so a brand's whole sample size looked like
          // "how many answered this stage" even when only a fraction of them were actually asked).
          const fromN = fromEntry?.n ?? 0;
          const toN = toEntry?.n ?? 0;
          const rawPct = fromVal && fromVal > 0 && toVal !== null ? Math.round((toVal / fromVal) * 1000) / 10 : null;
          // A gross size mismatch (one stage's answered base under 70% of the other's) is
          // grounds to suppress the ratio outright, not merely footnote it - it usually means a
          // skip pattern, screening question, or heavy non-response narrowed who was even asked
          // the later stage, so the two percentages are not reporting on the same population at
          // all. This is the ONLY check this app can run without a case-level join between
          // stages (see `conversions`'s own comment) - it catches a gross mismatch, nothing
          // subtler, so a pass here is reported as "no size-based reason to doubt it", never as
          // "these bases are comparable" or "this ratio is validated".
          const basesSimilarSize = fromN > 0 && toN > 0 && Math.min(fromN, toN) / Math.max(fromN, toN) >= 0.7;
          const pct = basesSimilarSize ? rawPct : null;
          return { brand, pct, basesSimilarSize, fromN, toN };
        }),
      });
    }

    let positioning: BrandHealthDashboard["positioning"] = null;
    const { xVar, yVar } = mapping.positioning;
    if (xVar && yVar) {
      const findScore = async (key: string): Promise<BrandHealthScore | null> => {
        const existing = attributes.find((a) => a.variable === key) ?? moments.find((a) => a.variable === key);
        if (existing) return existing;
        if (dict.sets?.some((s) => s.key === key)) {
          const scored = await scoreBySet(runId, documentId, key, key, undefined, weightVar, dict, allBrands);
          return "error" in scored ? null : scored;
        }
        const v = byName.get(key);
        const metric = defaultMetricForScale(v?.nDistinct ?? 5);
        const scored = await scoreByBrand(runId, documentId, key, v?.label || key, metric, weightVar, groups);
        return "error" in scored ? null : scored;
      };
      const xScore = await findScore(xVar);
      const yScore = await findScore(yVar);
      if (xScore && yScore) {
        positioning = {
          xVariable: xVar,
          xLabel: xScore.label,
          yVariable: yVar,
          yLabel: yScore.label,
          brandSplit: xScore.brandSplit === "brand_groups" || yScore.brandSplit === "brand_groups" ? "brand_groups" : "brand_columns",
          points: brands.map((brand) => ({
            brand,
            x: xScore.byBrand.find((b) => b.brand === brand)?.value ?? null,
            y: yScore.byBrand.find((b) => b.brand === brand)?.value ?? null,
          })),
        };
      } else {
        withheld.push({ figure: "Positioning map", reason: "One of its two axes could not be tabulated." });
      }
    }

    return {
      ok: true,
      dashboard: {
        documentId,
        waveLabel: waveLabel ?? null,
        weighted: !!weightVar,
        brandVar: groups.kind === "variable" ? groups.variable : null,
        brandSet: groups.kind === "set" ? groups.setKey : null,
        ourBrand,
        ourBrandVariable: groups.kind === "set" ? mapping.ourBrand : null,
        brandMembers: groups.kind === "set" ? groups.members.map(({ variable, brand }) => ({ variable, brand })) : null,
        groupsOverlap: groups.kind === "set",
        overlapNote: groups.kind === "set" ? brandGroupsOverlapNote(groups.setLabel) : null,
        withheld,
        brands,
        funnel,
        conversions,
        attributes,
        loyalty,
        moments,
        positioning,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Runs the same mapping across several wave files, one dashboard per file, mirroring buildCsmWaveDashboardsAction. */
export async function buildBrandHealthWaveDashboardsAction(
  runId: string,
  files: { documentId: string; label: string }[],
  mapping: BrandHealthMapping,
): Promise<{ ok: true; dashboards: BrandHealthDashboard[] } | Fail> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const dashboards: BrandHealthDashboard[] = [];
  for (const f of files) {
    const res = await buildBrandHealthDashboardAction(runId, f.documentId, mapping, f.label);
    if (!res.ok) return res;
    dashboards.push(res.dashboard);
  }
  return { ok: true, dashboards };
}

export async function loadBrandHealthModuleAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; mapping: BrandHealthMapping | null } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const stored = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ mapping: unknown }>(
        `select mapping from brand_health_modules where run_id = $1 and document_id = $2 and tenant_id = $3 limit 1`,
        [runId, documentId, TENANT_ID],
      );
      return r.rows[0]?.mapping ?? null;
    });
    if (stored === null) return { ok: true, mapping: null };
    // A mapping saved before brand sets existed reads with brandSet null; an unreadable one is reported, never
    // replaced by an empty mapping that a later save would write over the researcher's choices.
    const parsed = normaliseBrandHealthMapping(stored);
    if (!parsed.ok) return parsed;
    return { ok: true, mapping: parsed.mapping };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveBrandHealthModuleAction(
  runId: string,
  documentId: string,
  sentMapping: BrandHealthMapping,
): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const parsed = normaliseBrandHealthMapping(sentMapping);
    if (!parsed.ok) return parsed;
    const mapping = parsed.mapping;
    // A brand set is checked against this file before it is kept: it must be a multiple-response set here, and our
    // brand one of its members. A brand variable is saved as before, unchecked here (the dashboard reports a
    // variable it cannot read when it is built).
    if (mapping.brandSet) {
      const dictStatus = await loadVariableDictionaryWithStatus(TENANT_ID, runId, documentId);
      if (!dictStatus.ok) return { ok: false, error: `This file's saved set-up could not be read, so the brand set could not be checked: ${dictStatus.error}` };
      const refusal = brandSourceRefusal(mapping, dictStatus.dictionary);
      if (refusal) return { ok: false, error: refusal };
    }
    await withTenant(TENANT_ID, async (client) => {
      await assertRunOwned(client, TENANT_ID, runId);
      // SEC1: the upsert is keyed on document_id alone, so the file must be checked as this project's
      // first; otherwise another organisation's document id would overwrite its saved mapping.
      const doc = await client.query("select 1 from documents where id = $1 and run_id = $2 and tenant_id = $3", [documentId, runId, TENANT_ID]);
      if (doc.rowCount !== 1) throw new Error("That data file is not in this project. Nothing was saved.");
      await client.query(
        `insert into brand_health_modules (tenant_id, run_id, document_id, mapping, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (document_id) do update set mapping = $4, updated_at = now()
         where brand_health_modules.tenant_id = excluded.tenant_id and brand_health_modules.run_id = excluded.run_id`,
        [TENANT_ID, runId, documentId, JSON.stringify(mapping)],
      );
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The things a Brand Health dashboard can post as findings, each committed independently, mirroring CsmFindingSection. */
export type BrandHealthFindingSection = "funnel" | "attributes" | "loyalty" | "moments" | "positioning";

function pctOf(v: number | null): string {
  return v === null ? "-" : `${v}%`;
}

/** A section's finding text, with the overlap note appended when its brand groups overlap (a brand set), so the
 * qualification travels with the wording wherever the finding is read. */
function describeBrandHealthSection(dashboard: BrandHealthDashboard, section: BrandHealthFindingSection): { text: string; theme: string } {
  const described = describeBrandHealthFigures(dashboard, section);
  if (!described.text || !groupsOverlapIn(dashboard, section) || !dashboard.overlapNote) return described;
  return { ...described, text: `${described.text} ${dashboard.overlapNote}` };
}

function groupsOverlapIn(dashboard: BrandHealthDashboard, section: BrandHealthFindingSection): boolean {
  return dashboard.groupsOverlap === true && sectionSplitsByBrandGroups(dashboard, section);
}

function describeBrandHealthFigures(dashboard: BrandHealthDashboard, section: BrandHealthFindingSection): { text: string; theme: string } {
  const base = dashboard.weighted ? "weighted" : "unweighted";
  const ours = (byBrand: { brand: string; value: number | null }[]) => byBrand.find((b) => b.brand === dashboard.ourBrand)?.value ?? null;
  const oursExact = (byBrand: BrandHealthScore["byBrand"]) => {
    const b = byBrand.find((x) => x.brand === dashboard.ourBrand);
    return (b?.exact !== undefined ? b.exact : b?.value) ?? null;
  };

  if (section === "funnel" && dashboard.funnel.length) {
    const parts = dashboard.funnel.map((f) => {
      const v = ours(f.byBrand);
      // From the unrounded score and average, rounded once (CT5K-F01).
      const vExact = oursExact(f.byBrand);
      const avgExact = categoryAverageExact(f.byBrand);
      const gap = vExact !== null && avgExact !== null ? Math.round((vExact - avgExact) * 10) / 10 : null;
      const gapText = gap === null ? "" : gap >= 0 ? ` (+${gap} vs category)` : ` (${gap} vs category)`;
      return `${f.label} ${pctOf(v)}${gapText}`;
    });
    return { text: `${dashboard.ourBrand}'s funnel (${base}): ${parts.join("; ")}.`, theme: `${dashboard.ourBrand} funnel` };
  }
  if (section === "attributes" && dashboard.attributes.length) {
    const ranked = [...dashboard.attributes].sort((a, b) => (ours(b.byBrand) ?? -Infinity) - (ours(a.byBrand) ?? -Infinity));
    const parts = ranked.map((a) => `${a.label} ${pctOf(ours(a.byBrand))}`);
    return { text: `${dashboard.ourBrand}'s attribute scores (${base}): ${parts.join("; ")}.`, theme: "Brand attributes" };
  }
  if (section === "loyalty" && dashboard.loyalty) {
    const l = dashboard.loyalty.byBrand.find((b) => b.brand === dashboard.ourBrand);
    if (l) return { text: `${dashboard.ourBrand}'s NPS is ${Math.round(l.nps)} (${Math.round(l.promoters)}% promoters, ${Math.round(l.detractors)}% detractors, n=${l.n.toLocaleString()}).`, theme: dashboard.loyalty.label };
  }
  if (section === "moments" && dashboard.moments.length) {
    const ranked = [...dashboard.moments].sort((a, b) => (ours(b.byBrand) ?? -Infinity) - (ours(a.byBrand) ?? -Infinity));
    const parts = ranked.map((m) => `${m.label} ${pctOf(ours(m.byBrand))}`);
    return { text: `${dashboard.ourBrand}'s category entry points (${base}): ${parts.join("; ")}.`, theme: "Category entry points" };
  }
  if (section === "positioning" && dashboard.positioning) {
    const p = dashboard.positioning.points.find((pt) => pt.brand === dashboard.ourBrand);
    if (p) return { text: `${dashboard.ourBrand} positions at ${pctOf(p.x)} on "${dashboard.positioning.xLabel}" and ${pctOf(p.y)} on "${dashboard.positioning.yLabel}".`, theme: "Brand positioning" };
  }
  return { text: "", theme: "" };
}

export async function addBrandHealthFindingAction(
  runId: string,
  documentId: string,
  dashboard: BrandHealthDashboard,
  section: BrandHealthFindingSection,
): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const key = brandHealthFindingKey(dashboard, section);
    if (!key) return { ok: false, error: "There is nothing in this section to post yet." };
    const { text, theme } = describeBrandHealthSection(dashboard, section);
    if (!text) return { ok: false, error: "There is nothing in this section to post yet." };
    await withTenant(TENANT_ID, async (client) => {
      await assertRunOwned(client, TENANT_ID, runId);
      const existing = await client.query<{ n: number }>(
        `select count(*)::int as n from findings
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'brand_health_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and status <> 'rejected'`,
        [runId, section, key, documentId],
      );
      const statsJson = JSON.stringify({
        source: "brand_health_tool",
        section,
        key,
        documentId,
        waveLabel: dashboard.waveLabel,
        brandVar: dashboard.brandVar,
        brandSet: dashboard.brandSet ?? null,
        ourBrand: dashboard.ourBrand,
        dashboard,
        caveats: [
          "descriptive_reading",
          // ANA-BRAND-001: a "funnel" finding embeds the whole dashboard verbatim (below), so a
          // stage-to-stage ratio this run computed (dashboard.conversions) is persisted here even
          // though describeBrandHealthSection's own finding_text never quotes it - the committed
          // finding_text was always ratio-free, this just means the raw number still rides along
          // inside stated_stats.dashboard.conversions for any future reader (an export, a
          // different view) that is not BrandHealthAnalyticsPanel.tsx and so does not render its
          // persistent on-screen caveat ("similar answered bases are not proof..."). Rather than
          // rely on one component's JSX to be the only place that caveat is ever shown, this tags
          // the finding itself whenever a ratio exists - true regardless of basesSimilarSize,
          // since even a similar-size pair is a NECESSARY-not-sufficient check, never a validated
          // comparable population (see BrandHealthDashboard['conversions'] own type comment).
          ...(section === "funnel" && dashboard.conversions.length > 0 ? ["stage_ratio_population_comparability_unverified"] : []),
          // A brand set as the brand source: this section's brand groups overlap (a respondent in two brands'
          // groups is counted in both), a qualification that must survive into insights and exports.
          ...(groupsOverlapIn(dashboard, section) ? ["brand_groups_overlap"] : []),
        ],
      });
      if ((existing.rows[0]?.n ?? 0) > 0) {
        // REP-IN-002: a theme a researcher changed by hand is kept; the tool still refreshes its
        // own text and statistics. Before migration 0094 there is no edit record to consult.
        const provenance = await findingProvenanceAvailable(client);
        const touched = await client.query<{ id: string }>(
          `update findings set finding_text = $5,
             theme = ${provenance ? "case when human_edited_fields @> array['theme'] then theme else $6 end" : "$6"},
             stated_stats = $7
           where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'brand_health_tool'
             and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
             and status <> 'rejected'
         returning id`,
          [runId, section, key, documentId, text, theme, statsJson],
        );
        await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
        return;
      }
      const revived = await client.query<{ id: string }>(
        `update findings set status = 'accepted'
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'brand_health_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and status = 'rejected'
         returning id`,
        [runId, section, key, documentId],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1, $2, 'generated', $3, $4, 'level', $5, 'quantitative', 'accepted', $6)
         returning id`,
        [TENANT_ID, runId, text, theme, statsJson, documentId],
      );
      await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, added: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeBrandHealthFindingAction(
  runId: string,
  documentId: string,
  section: BrandHealthFindingSection,
  key: string,
): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      await assertRunOwned(client, TENANT_ID, runId);
      const r = await client.query<{ id: string }>(
        `update findings set status = 'rejected'
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'brand_health_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and status <> 'rejected'
         returning id`,
        [runId, section, key, documentId],
      );
      await recordHumanReview(client, r.rows.map((row) => row.id), "tool_remove");
      return r.rowCount ?? 0;
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function brandHealthFindingStatusAction(
  runId: string,
  documentId: string,
  section: BrandHealthFindingSection,
  key: string,
): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const committed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        `select count(*)::int as n from findings
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'brand_health_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and status <> 'rejected'`,
        [runId, section, key, documentId],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
