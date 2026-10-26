"use server";

import { revalidatePath } from "next/cache";

import { withTenant } from "./db";
import { findingProvenanceAvailable, recordHumanReview } from "./findingProvenance";
import { loadVariableDictionary } from "./crosstabs";
import { defaultWeight } from "./starterTables";
import { runDistributionAction, type ChartSeries } from "./chartActions";
import { runNpsAction } from "./npsActions";
import type { VariableInfo, VariableSet, VariableDictionary } from "./parseStatsFile";
import { defaultMetricForScale, summarizeSeries, type CsmMetric } from "./csmMetrics";
import { categoryAverage, brandHealthFindingKey, matchSetMembersToBrands } from "./brandHealthMetrics";
import { requireTenantId } from "./requestContext";

export type { CsmMetric };



type Fail = { ok: false; error: string };

/** One score, by brand: a funnel stage, an attribute, or a category-entry-point (moment). */
export type BrandHealthScore = {
  variable: string;
  label: string;
  metric: CsmMetric;
  byBrand: { brand: string; value: number | null; n: number }[];
  categoryAvg: number | null;
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
  /** The categorical variable whose values are the brands in the data (eg "which brand do you use most often"). */
  brandVar: string | null;
  /** One of brandVar's category values: the brand this dashboard reads everything else against. */
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

export type BrandHealthDashboard = {
  documentId: string;
  waveLabel: string | null;
  weighted: boolean;
  brandVar: string;
  ourBrand: string;
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
  loyalty: { variable: string; label: string; byBrand: { brand: string; nps: number; promoters: number; detractors: number; n: number }[] } | null;
  moments: BrandHealthScore[];
  positioning: {
    xVariable: string;
    xLabel: string;
    yVariable: string;
    yLabel: string;
    points: { brand: string; x: number | null; y: number | null }[];
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
  await requireTenantId();
  const res = await runDistributionAction(runId, documentId, brandVar, weightVar, null);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, brands: res.result.series[0]?.bars.map((b) => b.label) ?? [] };
}

async function scoreByBrand(
  runId: string,
  documentId: string,
  variable: string,
  label: string,
  metric: CsmMetric,
  weightVar: string | null,
  brandVar: string,
): Promise<BrandHealthScore | { error: string }> {
  const res = await runDistributionAction(runId, documentId, variable, weightVar, brandVar);
  if (!res.ok) return { error: res.error };
  const byBrand = res.result.series.map((s: ChartSeries) => {
    const sum = summarizeSeries(s, metric);
    return { brand: s.name, value: sum.value, n: s.n };
  });
  return {
    variable,
    label,
    metric,
    byBrand,
    categoryAvg: categoryAverage(byBrand),
  };
}

/**
 * Scores a multi-response set where each brand has its own member column (eg
 * awareness_b1..awareness_b6) rather than one shared question split by the brand variable.
 * Matches each member to a brand by label text (matchSetMembersToBrands), then runs each
 * matched member's own plain distribution - no groupVar needed, since the brand split is
 * already baked into which column is which. A set covering fewer than the full brand list (eg
 * an attribute battery asked for only 3 of 6 brands, per the codebook) simply scores fewer
 * brands rather than failing.
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
    byBrand.push({ brand, value: sum.value, n: series.n });
  }
  return {
    variable: setKey,
    label: set.label || fallbackLabel,
    metric,
    byBrand,
    categoryAvg: categoryAverage(byBrand),
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
  brandVar: string,
  byName: Map<string, VariableInfo>,
  dict: VariableDictionary,
  brandPool: string[],
): Promise<BrandHealthScore | { error: string }> {
  if ("setKey" in source) {
    return scoreBySet(runId, documentId, source.setKey, fallbackLabel, source.metric, weightVar, dict, brandPool);
  }
  const v = byName.get(source.variable);
  const metric = source.metric ?? defaultMetricForScale(v?.nDistinct ?? defaultScalePoints);
  return scoreByBrand(runId, documentId, source.variable, v?.label || fallbackLabel, metric, weightVar, brandVar);
}

/**
 * Runs one Brand Health dashboard for one file: the funnel stages, the attribute battery, loyalty
 * (NPS), category entry points (moments) and a two-attribute positioning map, every brand
 * mapped through the file's own brand variable rather than one question per brand. Every step
 * reuses the single-file engines (runDistributionAction, runNpsAction) the other Analytics
 * tools already run on, the same way the CSM module does.
 */
export async function buildBrandHealthDashboardAction(
  runId: string,
  documentId: string,
  mapping: BrandHealthMapping,
  waveLabel?: string | null,
): Promise<{ ok: true; dashboard: BrandHealthDashboard } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    if (!mapping.brandVar) return { ok: false, error: "Map the brand variable first: which question in the file holds the brand values." };
    if (!mapping.ourBrand) return { ok: false, error: "Pick which brand is \"ours\" to compare against the rest." };

    const dict = await loadVariableDictionary(TENANT_ID, runId, documentId);
    const weightVar = defaultWeight(dict);
    const byName = new Map(dict.variables.map((v) => [v.name, v]));
    const brandVar = mapping.brandVar;

    // Fetched once up front: the full brand list, both as the dashboard's fallback brand order
    // and as the pool a multi-response set's per-brand member columns are matched against.
    const brandListRes = await loadBrandCategoriesAction(runId, documentId, brandVar, weightVar);
    const allBrands = brandListRes.ok ? brandListRes.brands : [];

    const sourceLabel = (source: BrandHealthSource, fallback: string): string =>
      "setKey" in source ? dict.sets?.find((s) => s.key === source.setKey)?.label || fallback : byName.get(source.variable)?.label || fallback;

    const funnel: BrandHealthFunnelStage[] = [];
    let brands: string[] = [];
    for (const { key, stage, fallbackLabel } of FUNNEL_STAGES) {
      const stageMap = mapping.funnel[key];
      if (!stageMap) continue;
      const scored = await scoreSource(runId, documentId, stageMap, fallbackLabel, 2, weightVar, brandVar, byName, dict, allBrands);
      if ("error" in scored) return { ok: false, error: scored.error };
      funnel.push({ ...scored, stage });
      if (brands.length === 0) brands = scored.byBrand.map((b) => b.brand);
    }

    const attributes: BrandHealthScore[] = [];
    for (const attr of mapping.attributes) {
      const scored = await scoreSource(runId, documentId, attr, sourceLabel(attr, "Attribute"), 5, weightVar, brandVar, byName, dict, allBrands);
      if ("error" in scored) continue; // skip an attribute that can't be tabulated rather than failing the whole dashboard
      attributes.push(scored);
      if (brands.length === 0) brands = scored.byBrand.map((b) => b.brand);
    }

    const moments: BrandHealthScore[] = [];
    for (const m of mapping.moments) {
      const scored = await scoreSource(runId, documentId, m, sourceLabel(m, "Moment"), 2, weightVar, brandVar, byName, dict, allBrands);
      if ("error" in scored) continue;
      moments.push(scored);
      if (brands.length === 0) brands = scored.byBrand.map((b) => b.brand);
    }

    let loyalty: BrandHealthDashboard["loyalty"] = null;
    if (mapping.loyaltyVar) {
      const nps = await runNpsAction(runId, documentId, mapping.loyaltyVar, weightVar, brandVar);
      if (nps.ok) {
        const v = byName.get(mapping.loyaltyVar);
        loyalty = {
          variable: mapping.loyaltyVar,
          label: v?.label || mapping.loyaltyVar,
          byBrand: (nps.result.segments ?? []).map((s) => ({ brand: s.name, nps: s.nps, promoters: s.promoters, detractors: s.detractors, n: s.n })),
        };
        if (brands.length === 0) brands = loyalty.byBrand.map((b) => b.brand);
      }
    }

    if (brands.length === 0) brands = allBrands;

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
          const fromVal = fromEntry?.value ?? null;
          const toVal = toEntry?.value ?? null;
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
        const scored = await scoreByBrand(runId, documentId, key, v?.label || key, metric, weightVar, brandVar);
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
          points: brands.map((brand) => ({
            brand,
            x: xScore.byBrand.find((b) => b.brand === brand)?.value ?? null,
            y: yScore.byBrand.find((b) => b.brand === brand)?.value ?? null,
          })),
        };
      }
    }

    return {
      ok: true,
      dashboard: {
        documentId,
        waveLabel: waveLabel ?? null,
        weighted: !!weightVar,
        brandVar,
        ourBrand: mapping.ourBrand,
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
  await requireTenantId();
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
  try {
    const mapping = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ mapping: BrandHealthMapping }>(
        `select mapping from brand_health_modules where run_id = $1 and document_id = $2 limit 1`,
        [runId, documentId],
      );
      return r.rows[0]?.mapping ?? null;
    });
    return { ok: true, mapping };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveBrandHealthModuleAction(
  runId: string,
  documentId: string,
  mapping: BrandHealthMapping,
): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into brand_health_modules (tenant_id, run_id, document_id, mapping, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (document_id) do update set mapping = $4, updated_at = now()`,
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

function describeBrandHealthSection(dashboard: BrandHealthDashboard, section: BrandHealthFindingSection): { text: string; theme: string } {
  const base = dashboard.weighted ? "weighted" : "unweighted";
  const ours = (byBrand: { brand: string; value: number | null }[]) => byBrand.find((b) => b.brand === dashboard.ourBrand)?.value ?? null;

  if (section === "funnel" && dashboard.funnel.length) {
    const parts = dashboard.funnel.map((f) => {
      const v = ours(f.byBrand);
      const gap = v !== null && f.categoryAvg !== null ? Math.round((v - f.categoryAvg) * 10) / 10 : null;
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
