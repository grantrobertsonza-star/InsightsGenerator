// Indicator Analytics (D6): the loader of the single-indicator dashboard. It reads the project's Indicator data
// files through their owner (src/lib/indicatorData.ts listIndicatorFiles, loadIndicatorSeriesRead: one snapshot,
// identity by stored series key, stale reads refused) and returns every figure and line the screen shows, from the
// rules in indicatorAnalyticsFigures.ts. The screen formats nothing numeric itself. Contract:
// claude/indicator-analytics.md.
import {
  listIndicatorFiles,
  loadIndicatorSeriesRead,
  type IndicatorArea,
  type IndicatorLayout,
  type IndicatorReadCoverage,
  type IndicatorSeriesSummary,
} from "./indicatorData";
import { areaName, breakdownChoices, breakdownText, indicatorKeyOf, indicatorNameOf, indicatorOptions, isPercentUnit, sourceText, unitText, type IndicatorOption } from "./indicatorDisplay";
import {
  MAX_TREND_PANELS,
  SUGGESTED_AREA_RULE,
  SUGGESTED_TREND_RULE,
  breakdownFilterName,
  comparisonFor,
  definitionLines,
  fileReadiness,
  headlineFigures,
  observedTrend,
  periodPosition,
  providerLines,
  recordedDecimals,
  seriesAttributesOf,
  seriesNeedsReview,
  suggestedArea,
  suggestedTrendAreas,
  viewSummary,
  withheldPeriods,
  type Comparison,
  type DefinitionLine,
  type FileReadiness,
  type Headline,
  type ObservedPoint,
  type Provider,
  type SeriesChoice,
  type ViewSummary,
} from "./indicatorAnalyticsFigures";

export type IndicatorWorkspace =
  | { state: "unavailable"; message: string }
  | { state: "ready"; files: FileReadiness[]; providers: { provider: Provider | null; text: string }[]; withObservations: number };

/** The project's Indicator data files with their readiness, and what is loaded per provider. */
export async function loadIndicatorWorkspace(tenantId: string, runId: string): Promise<IndicatorWorkspace> {
  const listed = await listIndicatorFiles(tenantId, runId);
  if (listed.state === "unavailable") return listed;
  const files = listed.files.map(fileReadiness);
  return { state: "ready", files, providers: providerLines(files), withObservations: files.filter((f) => f.state === "observations_ready").length };
}

/** The screen's choice. Null means "not chosen yet": the loader suggests, and says how it chose. */
export type IndicatorAnalyticsRequest = {
  documentId: string;
  /** The read the screen was showing; null on first load. A newer read answers stale. */
  readId: string | null;
  seriesKey: string | null;
  /** The area; null for the suggested one. An area the file does not state is { code: null }. */
  area: { code: string | null } | null;
  from: string | null;
  to: string | null;
  comparePeriod: string | null;
  /** The small multiples' areas; null for the suggested ones. */
  trendAreas: (string | null)[] | null;
};

export type TrendPanel = { areaCode: string | null; name: string; points: ObservedPoint[]; withheld: string[] };

export type IndicatorAnalyticsReady = {
  state: "ready";
  readId: string;
  documentId: string;
  fileName: string;
  layout: IndicatorLayout;
  lastFailure: { failure: string; failedAt: string } | null;
  filters: {
    indicators: IndicatorOption[];
    indicatorKey: string;
    breakdowns: { dimension: string; name: string; values: { code: string; label: string }[]; code: string }[];
    seriesChoices: SeriesChoice[];
    areas: { code: string | null; name: string; withheldOnly: boolean }[];
    area: { code: string | null; name: string };
    /** Set when the area was chosen automatically: the rule, in words. */
    areaRule: string | null;
    /** Every stated period of the series (all areas), in order: the period range and comparison choices. */
    periods: string[];
    from: string | null;
    to: string | null;
    comparePeriod: string | null;
  };
  series: { key: string; name: string; indicatorCode: string | null; unit: string; percent: boolean; chosenText: string; fixedText: string };
  /** Calendar span of the series' observed periods in the range (every panel shares it); null when not calendar periods. */
  axis: { min: number; max: number } | null;
  /** Value axis: 0 to 100 for a percentage on that scale, else from 0 (or the lowest negative) to the highest value. */
  valueAxis: { min: number; max: number };
  overview: { headline: Headline; trend: ObservedPoint[]; withheld: string[]; summary: ViewSummary };
  compare: (Comparison & { selected: ObservedPoint | null }) | null;
  trends: { rule: string | null; panels: TrendPanel[] };
  definition: DefinitionLine[];
  sourceLine: string;
  coverage: IndicatorReadCoverage;
};

export type IndicatorAnalyticsView =
  | { state: "unavailable"; message: string }
  | { state: "not_read" }
  | { state: "failed"; failure: string }
  | { state: "stale"; message: string }
  | { state: "series_not_found"; message: string }
  | { state: "invalid"; message: string }
  | { state: "definitions_only"; fileName: string; readId: string }
  | { state: "needs_review"; readId: string; fileName: string; message: string; seriesKey: string; seriesChoices: SeriesChoice[]; indicators: IndicatorOption[] }
  | IndicatorAnalyticsReady;

function valueAxisOf(values: number[], percent: boolean): { min: number; max: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  if (percent && lo >= 0 && hi <= 100) return { min: 0, max: 100 };
  // A round top a little above the highest value, so the highest point is not on the frame.
  const nice = (x: number) => {
    if (x === 0) return 0;
    const step = 10 ** Math.floor(Math.log10(Math.abs(x)));
    return Math.sign(x) * Math.ceil(Math.abs(x) / step) * step;
  };
  return { min: lo < 0 ? nice(lo) : 0, max: hi > 0 ? nice(hi) : 1 };
}

/** The full dashboard for one request. Every figure is computed here or in indicatorAnalyticsFigures.ts. */
export async function loadIndicatorAnalytics(tenantId: string, runId: string, request: IndicatorAnalyticsRequest): Promise<IndicatorAnalyticsView> {
  if (request.from !== null && request.to !== null && request.from > request.to) return { state: "invalid", message: `The period range starts after it ends (${request.from} to ${request.to}). Choose the range again.` };
  if (request.trendAreas !== null && request.trendAreas.length > MAX_TREND_PANELS) return { state: "invalid", message: `Choose at most ${MAX_TREND_PANELS} areas for the trends.` };
  const read = await loadIndicatorSeriesRead(tenantId, runId, request.documentId, { readId: request.readId, seriesKey: request.seriesKey });
  if (read.state === "failed") return { state: "failed", failure: read.failure };
  if (read.state !== "ready") return read;
  if (read.layout === "oecd_notes" || !read.seriesKey) return { state: "definitions_only", fileName: read.fileName, readId: read.readId };
  const s = read.series.find((x) => x.key === read.seriesKey)!;
  const seriesChoices: SeriesChoice[] = read.series.map((x) => ({ key: x.key, indicatorKey: indicatorKeyOf(x), codes: Object.fromEntries(x.breakdowns.map((b) => [b.dimension, b.code])) }));
  const indicators = indicatorOptions(read.series);
  const attributes = seriesAttributesOf(read.provenance, s.key);
  const review = seriesNeedsReview(attributes);
  if (review) return { state: "needs_review", readId: read.readId, fileName: read.fileName, message: review, seriesKey: s.key, seriesChoices, indicators };

  const statuses = (read.provenance.statuses ?? {}) as Record<string, string | null>;
  const decimals = recordedDecimals(attributes);
  const range = { from: request.from, to: request.to };
  const obs = read.observations;
  const areaCode = request.area ? request.area.code : suggestedArea(obs);
  if (request.area && !s.areaCodes.includes(request.area.code)) {
    // Never another area in its place: the chosen area is not in this series (a different window, say).
    return { state: "invalid", message: `${areaName(request.area.code, read.areas)} has no observation in this series. Choose another area, or the series it was chosen in.` };
  }
  const trend = observedTrend(obs, areaCode, s, range, decimals, statuses);
  const headline = headlineFigures(trend, s);
  const withheld = withheldPeriods(read.provenance, s, areaCode, range);
  const after = headline.latest ? withheld.filter((p) => p > headline.latest!.period) : withheld;
  const name = areaName(areaCode, read.areas);
  const periods = [...new Set(obs.map((o) => o.period).filter((p): p is string => p !== null))].sort();
  const comparePeriod = request.comparePeriod ?? headline.latest?.period ?? periods.at(-1) ?? null;
  if (request.comparePeriod !== null && !periods.includes(request.comparePeriod)) return { state: "invalid", message: `No area has an observation for ${request.comparePeriod} in this series.` };
  const compare = comparePeriod
    ? { ...comparisonFor(obs, comparePeriod, s, read.areas, read.provenance, areaCode, decimals, statuses), selected: observedTrend(obs, areaCode, s, { from: comparePeriod, to: comparePeriod }, decimals, statuses)[0] ?? null }
    : null;
  const panelAreas = request.trendAreas ?? suggestedTrendAreas(obs, areaCode, headline.latest?.period ?? null, s);
  const unknownPanel = panelAreas.find((a) => !s.areaCodes.includes(a));
  if (unknownPanel !== undefined) return { state: "invalid", message: `${areaName(unknownPanel, read.areas)} has no observation in this series; remove it from the trends.` };
  const panels: TrendPanel[] = panelAreas.map((a) => ({ areaCode: a, name: areaName(a, read.areas), points: observedTrend(obs, a, s, range, decimals, statuses), withheld: withheldPeriods(read.provenance, s, a, range) }));

  // One calendar span for every chart of the view: the series' periods within the range, all areas.
  const positions = periods.filter((p) => (range.from === null || p >= range.from) && (range.to === null || p <= range.to)).map(periodPosition);
  const known = positions.filter((x): x is number => x !== null);
  const calendar = known.length > 0 && known.length === positions.length;
  const choices = breakdownChoices(read.series, indicatorKeyOf(s));
  const varying = new Set(choices.map((c) => c.dimension));
  const shownValues = [...trend, ...panels.flatMap((x) => x.points), ...(compare?.rows ?? [])].map((p) => p.value);

  return {
    state: "ready",
    readId: read.readId,
    documentId: request.documentId,
    fileName: read.fileName,
    layout: read.layout,
    lastFailure: read.lastFailure,
    filters: {
      indicators,
      indicatorKey: indicatorKeyOf(s),
      breakdowns: choices.map((c) => ({ dimension: c.dimension, name: breakdownFilterName(c), values: c.values, code: s.breakdowns.find((b) => b.dimension === c.dimension)!.code })),
      seriesChoices,
      areas: s.areaCodes.map((a) => ({ code: a, name: areaName(a, read.areas), withheldOnly: s.withheldOnlyAreaCodes.includes(a) })).sort((x, y) => x.name.localeCompare(y.name)),
      area: { code: areaCode, name },
      areaRule: request.area ? null : SUGGESTED_AREA_RULE,
      periods,
      from: request.from,
      to: request.to,
      comparePeriod,
    },
    series: {
      key: s.key,
      name: indicatorNameOf(s),
      indicatorCode: s.indicatorCode,
      unit: unitText(s),
      percent: isPercentUnit(s),
      chosenText: breakdownText(s.breakdowns.filter((b) => varying.has(b.dimension))),
      fixedText: breakdownText(s.breakdowns.filter((b) => !varying.has(b.dimension))),
    },
    axis: calendar ? { min: Math.min(...known), max: Math.max(...known) } : null,
    valueAxis: valueAxisOf(shownValues, isPercentUnit(s)),
    overview: { headline, trend, withheld, summary: viewSummary(name, headline, after) },
    compare,
    trends: { rule: request.trendAreas ? null : SUGGESTED_TREND_RULE, panels },
    definition: definitionLines({ s, attributes, provenance: read.provenance, fileName: read.fileName, layout: read.layout, publishedAt: read.publishedAt, observations: obs }),
    sourceLine: `${sourceText(read.provenance, read.fileName)}; ${s.indicatorCode ?? indicatorNameOf(s)}; observed values only, no interpolation`,
    coverage: read.coverage,
  };
}

export type { FileReadiness, IndicatorArea, IndicatorSeriesSummary, SeriesChoice };
