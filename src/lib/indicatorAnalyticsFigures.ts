// Indicator Analytics (D6; Grant, 29 October 2026): the figures and wording of the single-indicator dashboard,
// as pure rules over one stored series (src/lib/indicatorData.ts loadIndicatorSeriesRead). Contract:
// claude/indicator-analytics.md. Nothing here reads the database or changes a stored value; values are shown
// through the Indicator data display rules (indicatorDisplay.shownNumber, isPercentUnit).
//
// Method, stated once:
//   - Observed values only. A point is a stored observation of the chosen series and area; a year with no
//     observation has no point, is never zero, never interpolated and never carried forward.
//   - Latest = the observation with the latest period in the chosen range; previous = the observation
//     immediately before it in that range. Change = latest minus previous on the shown scale, from the unrounded
//     numbers, rounded once to the shown decimals. For a percentage it is in percentage points, never a relative
//     change; it is stated with both periods and is never called year-on-year unless the two are consecutive years.
//     Three things are kept apart (Codex D6-F01): the direction, from the unrounded values; whether the two
//     observations are shown as the same value, from the two shown values at their own precision; and the change
//     text, the unrounded change rounded once. A change that rounds to zero is never read as "no change".
//   - Time axis: one calendar for every chart of the view (Codex D6-F02). Each period is placed at its first day
//     (periodPlacement), and the axis spans the view's periods of every area (timeAxisOf); a period that cannot be
//     placed withholds the time-axis charts with the reason. A point is never placed by its index in one chart.
//   - One series at a time: a series is the indicator with one code per breakdown (for DHS, one reference window,
//     COMP_BREAKDOWN_1 ANCC_IRN_02, 03 or 05). Windows and other breakdowns are never pooled, averaged or summed.
//   - Comparison: the areas observed in exactly one period of the same series. An area with no observation in that
//     period is counted as not observed; no nearby period is used in its place. Ranked by the unrounded value.
//   - Withheld (OECD CONF_STATUS C with no value): listed as withheld, never a value and never zero.
//   - The summary is chosen by rule from these figures. It describes; it never explains a cause, infers an annual
//     path or claims significance. No sample size, weight or uncertainty is in these files, so none is shown.
import { areaName, breakdownChoices, indicatorKeyOf, indicatorNameOf, indicatorOptions, isPercentUnit, shownNumber, shownText, sourceText, unitText, withheldCells, type BreakdownChoice, type IndicatorOption } from "./indicatorDisplay";
import type { IndicatorArea, IndicatorFileSummary, IndicatorLayout, IndicatorObservation, IndicatorSeriesSummary } from "./indicatorData";
import { indicatorPeriodValid } from "./indicatorLayouts";

type Scale = Pick<IndicatorSeriesSummary, "valueScale" | "unitMult" | "unitCode" | "unitLabel" | "baseDescription">;

/** The frequencies of the shared period rule (indicatorPeriodValid), coarsest first. */
export const PERIOD_FREQUENCIES = ["year", "half", "quarter", "month", "week", "day"] as const;
export type PeriodFrequency = (typeof PERIOD_FREQUENCIES)[number];

/** Days since 1 January 1970 (UTC) of a calendar date; years 0 to 99 are kept as written, not read as 19xx. */
function dayNumber(year: number, monthIndex: number, day: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, monthIndex, day);
  return t.getTime() / 86400000;
}

/** ISO 8601 weeks in a year: 53 when 1 January is a Thursday, or a Wednesday in a leap year; otherwise 52. */
function isoWeeksIn(year: number): number {
  const jan1 = new Date(dayNumber(year, 0, 1) * 86400000).getUTCDay();
  const leap = dayNumber(year, 2, 1) - dayNumber(year, 1, 1) === 29;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}

/**
 * Where a period sits on the common calendar: the day number of its first day (a year at 1 January, a quarter,
 * half or month at its first day, a date at itself, an ISO week at its Monday, which for week 1 can fall in the
 * previous December), with its frequency. Every accepted form of the shared period rule is placed; a period the
 * rule refuses, or an ISO week 53 in a year that has 52 weeks (the rule accepts weeks 01 to 53 in every year, and
 * placing it would move it to week 1 of the next year), answers the reason instead.
 */
export function periodPlacement(period: string): { frequency: PeriodFrequency; position: number } | { reason: string } {
  if (!indicatorPeriodValid(period)) return { reason: `${period} is not a real calendar period.` };
  const [y, rest] = [Number(period.slice(0, 4)), period.slice(5)];
  if (rest === "") return { frequency: "year", position: dayNumber(y, 0, 1) };
  let m = /^Q([1-4])$/.exec(rest);
  if (m) return { frequency: "quarter", position: dayNumber(y, (Number(m[1]) - 1) * 3, 1) };
  m = /^S([12])$/.exec(rest);
  if (m) return { frequency: "half", position: dayNumber(y, (Number(m[1]) - 1) * 6, 1) };
  m = /^W([0-9]{2})$/.exec(rest);
  if (m) {
    const week = Number(m[1]);
    const weeks = isoWeeksIn(y);
    if (week > weeks) return { reason: `${period} is not an ISO week of ${y}, which has ${weeks} weeks.` };
    // Week 1 is the week with 4 January in it; weeks start on Monday.
    const jan4 = dayNumber(y, 0, 4);
    const monday1 = jan4 - ((new Date(jan4 * 86400000).getUTCDay() + 6) % 7);
    return { frequency: "week", position: monday1 + (week - 1) * 7 };
  }
  m = /^M?([0-9]{2})$/.exec(rest);
  if (m) return { frequency: "month", position: dayNumber(y, Number(m[1]) - 1, 1) };
  m = /^([0-9]{2})-([0-9]{2})$/.exec(rest)!;
  return { frequency: "day", position: dayNumber(y, Number(m[1]) - 1, Number(m[2])) };
}

/** A period's day number on the common calendar (periodPlacement); null when it cannot be placed. */
export function periodPosition(period: string): number | null {
  const p = periodPlacement(period);
  return "position" in p ? p.position : null;
}

/**
 * The one time axis of a view: the span of the view's periods (every area's, within the range), or withheld with
 * the reason. Periods of more than one frequency are withheld too: a series is one frequency (frequency is a
 * breakdown), and placing a year at 1 January beside daily values would read as a daily observation.
 */
export type TimeAxis = { state: "calendar"; frequency: PeriodFrequency; min: number; max: number } | { state: "withheld"; reason: string };
export function timeAxisOf(periods: string[]): TimeAxis {
  const withheld = (why: string): TimeAxis => ({ state: "withheld", reason: `Not placed on a time axis: ${why}` });
  if (periods.length === 0) return withheld("no period is observed in this range.");
  const placed: { frequency: PeriodFrequency; position: number }[] = [];
  for (const period of [...periods].sort()) {
    const p = periodPlacement(period);
    if ("reason" in p) return withheld(p.reason);
    placed.push(p);
  }
  const frequencies = PERIOD_FREQUENCIES.filter((f) => placed.some((p) => p.frequency === f));
  if (frequencies.length > 1) return withheld(`the periods mix frequencies (${frequencies.join(", ")}), so one axis would misstate their spacing.`);
  const positions = placed.map((p) => p.position);
  return { state: "calendar", frequency: frequencies[0], min: Math.min(...positions), max: Math.max(...positions) };
}

/**
 * A position's share of the axis span, 0 at the first period and 1 at the last; one period alone sits in the
 * middle (0.5). Null when the axis is withheld or the position is outside it: the chart then places nothing.
 */
export function axisFraction(position: number | null, axis: TimeAxis): number | null {
  if (axis.state !== "calendar" || position === null || position < axis.min || position > axis.max) return null;
  return axis.max === axis.min ? 0.5 : (position - axis.min) / (axis.max - axis.min);
}

/** Digits after the decimal point of a value as written; null for an exponent spelling (5.12E-4). */
function writtenDecimals(valueText: string): number | null {
  if (/[eE]/.test(valueText)) return null;
  const dot = valueText.indexOf(".");
  return dot < 0 ? 0 : valueText.length - dot - 1;
}

/**
 * Decimals to show for a value: the file's DECIMALS for the series when recorded, else the decimals the value is
 * written with. Both describe the stored value, so the shown value (times 10 to the unit multiplier, times 100 for
 * a proportion) loses as many places as it gains. Null when neither is known (an exponent spelling): the
 * Indicator data display rule (shownText) then applies.
 */
export function shownDecimals(valueText: string, s: Scale, recordedDecimals: number | null): number | null {
  const stored = recordedDecimals ?? writtenDecimals(valueText);
  if (stored === null) return null;
  return Math.max(0, stored - (s.unitMult ?? 0) - (s.valueScale === "proportion" ? 2 : 0));
}

/** A shown number as text with a fixed number of decimals, and % for a percentage. */
export function figureText(n: number, decimals: number | null, s: Scale): string {
  if (decimals === null) {
    const t = shownText(n, s);
    return isPercentUnit(s) && !t.endsWith("%") ? `${t}%` : t;
  }
  const text = n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return isPercentUnit(s) ? `${text}%` : text;
}

export type ObservedPoint = {
  period: string;
  /** Day number of the period's first day on the common calendar (periodPosition); null when it cannot be placed. */
  position: number | null;
  valueText: string;
  value: number;
  shown: string;
  decimals: number | null;
  status: string | null;
  statusLabel: string | null;
  /** COMMENT_OBS as written: the survey or fieldwork label ("DHS, 2008-09"). */
  note: string | null;
};

function pointOf(o: IndicatorObservation, s: Scale, recordedDecimals: number | null, statuses: Record<string, string | null>): ObservedPoint {
  const value = shownNumber(o.valueText, s);
  const decimals = shownDecimals(o.valueText, s, recordedDecimals);
  return {
    period: o.period ?? "Not stated",
    position: o.period ? periodPosition(o.period) : null,
    valueText: o.valueText,
    value,
    shown: figureText(value, decimals, s),
    decimals,
    status: o.status,
    statusLabel: o.status ? (statuses[o.status] ? `${statuses[o.status]} (${o.status})` : `Status ${o.status}`) : null,
    note: o.note,
  };
}

export type PeriodRange = { from: string | null; to: string | null };
const inRange = (p: string | null, r: PeriodRange) => p !== null && (r.from === null || p >= r.from) && (r.to === null || p <= r.to);

/**
 * The observed points of one area in the chosen range, in period order. Periods of one series share one
 * frequency (frequency is a breakdown), so text order is calendar order. A period the file does not state is
 * left out of a trend: it cannot be placed in time.
 */
export function observedTrend(observations: IndicatorObservation[], areaCode: string | null, s: Scale, range: PeriodRange, recordedDecimals: number | null, statuses: Record<string, string | null>): ObservedPoint[] {
  return observations
    .filter((o) => o.areaCode === areaCode && inRange(o.period, range))
    .sort((a, b) => (a.period! < b.period! ? -1 : a.period! > b.period! ? 1 : 0))
    .map((o) => pointOf(o, s, recordedDecimals, statuses));
}

export type Change = {
  /** Latest minus previous on the shown scale, unrounded. */
  value: number;
  /** From the unrounded values: never from the rounded change, which can be 0 for a real rise or fall. */
  direction: "rose" | "fell" | "same";
  /** The unrounded change rounded once ("+19.7 pp"); a rise or fall smaller than the shown step is "+<0.1 pp". */
  text: string;
  unitWords: string;
  periodsText: string;
  arithmetic: string;
};

const yearOf = (p: string) => (/^[0-9]{4}$/.test(p) ? Number(p) : null);

/** The change from the previous observation to the latest one (see the file header). */
export function changeBetween(previous: ObservedPoint, latest: ObservedPoint, s: Scale): Change {
  const value = latest.value - previous.value;
  const direction = value > 0 ? "rose" : value < 0 ? "fell" : "same";
  const sign = direction === "rose" ? "+" : direction === "fell" ? "-" : "";
  const decimals = latest.decimals === null || previous.decimals === null ? null : Math.max(latest.decimals, previous.decimals);
  const percent = isPercentUnit(s);
  const fixed = (n: number, d: number) => n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  let magnitude: string;
  let roundsAway = false;
  if (decimals === null) magnitude = shownText(Math.abs(value), { ...s, valueScale: null });
  else {
    const rounded = Number(Math.abs(value).toFixed(decimals));
    // A real rise or fall that rounds to 0 is stated as smaller than one shown step, keeping its sign.
    roundsAway = rounded === 0 && direction !== "same";
    magnitude = roundsAway ? `<${fixed(10 ** -decimals, decimals)}` : fixed(rounded, decimals);
  }
  // The shown values are rounded on their own, so their difference can differ from the rounded change (1.1% minus
  // 1.0% is a change of +0.02 pp when the values are 1.06 and 1.04): then say where the change comes from.
  const shownDifference = decimals === null ? null : Number((shownValueOf(latest) - shownValueOf(previous)).toFixed(decimals));
  const fromUnrounded = shownDifference !== null && (roundsAway || shownDifference !== Number(value.toFixed(decimals!)));
  const ly = yearOf(latest.period);
  const py = yearOf(previous.period);
  const consecutive = ly !== null && py !== null && ly - py === 1;
  return {
    value,
    direction,
    text: `${sign}${magnitude}${percent ? " pp" : ""}`,
    unitWords: percent ? "percentage points" : `in the series' unit (${unitText(s).replace(/^Unit: /, "")})`,
    periodsText: `${latest.period} vs ${previous.period}, ${consecutive ? "consecutive years" : "not year-on-year"}`,
    arithmetic: `${latest.shown} minus ${previous.shown}${fromUnrounded ? ", calculated from the unrounded values" : ""}`,
  };
}

/** The number an observation is shown as ("3,427" is 3427, "1.0%" is 1), so two shown values can be compared. */
function shownValueOf(p: ObservedPoint): number {
  return Number(p.shown.replace(/[,%]/g, ""));
}

export type Headline = {
  latest: ObservedPoint | null;
  previous: ObservedPoint | null;
  change: Change | null;
  observationCount: number;
  /** The observed periods with their survey labels, in order. */
  observed: { period: string; note: string | null }[];
};

export function headlineFigures(points: ObservedPoint[], s: Scale): Headline {
  const latest = points.at(-1) ?? null;
  const previous = points.length >= 2 ? points[points.length - 2] : null;
  return {
    latest,
    previous,
    change: latest && previous ? changeBetween(previous, latest, s) : null,
    observationCount: points.length,
    observed: points.map((p) => ({ period: p.period, note: p.note })),
  };
}

export type ViewSummary = { statement: string; detail: string };

/**
 * How the value moved, in words that agree with both shown observations (Codex D6-F01). The direction is the
 * unrounded one; whether the two are shown as one value is read from the shown values themselves:
 *   - unrounded equal: "was the same" (naming both shown values when written to different precisions);
 *   - shown as one value but unrounded different: "is shown as 70.5% in both ...; unrounded, it fell (change ...)";
 *   - shown order agrees with the direction: "rose from 1.0% in 2020 to 1.1% in 2021";
 *   - shown order disagrees (two precisions: 1% then 1.03% for 1.04 then 1.03): both shown values, then the
 *     unrounded direction, never "rose" against the unrounded values or "fell" against the shown ones.
 */
function movement(previous: ObservedPoint, latest: ObservedPoint, change: Change): string {
  const [p, l] = [shownValueOf(previous), shownValueOf(latest)];
  const unrounded = `unrounded, it ${change.direction} (change ${change.text})`;
  if (change.direction === "same") {
    return previous.shown === latest.shown ? `was the same in ${previous.period} and ${latest.period} (${latest.shown})` : `was the same in ${previous.period} (${previous.shown}) and ${latest.period} (${latest.shown})`;
  }
  const comparable = Number.isFinite(p) && Number.isFinite(l);
  if (comparable && p === l) {
    return previous.shown === latest.shown
      ? `is shown as ${latest.shown} in both ${previous.period} and ${latest.period}; ${unrounded}`
      : `is shown as ${previous.shown} in ${previous.period} and ${latest.shown} in ${latest.period}, the same value at different precisions; ${unrounded}`;
  }
  if (!comparable || l > p === (change.direction === "rose")) return `${change.direction} from ${previous.shown} in ${previous.period} to ${latest.shown} in ${latest.period}`;
  return `is shown as ${previous.shown} in ${previous.period} and ${latest.shown} in ${latest.period}, at different precisions; ${unrounded}`;
}

/** "What this view says": chosen by rule from the headline, descriptive only (see the file header). */
export function viewSummary(area: string, h: Headline, withheldAfterLatest: string[]): ViewSummary {
  const withheld = withheldAfterLatest.length > 0 ? ` ${withheldAfterLatest.join(", ")} ${withheldAfterLatest.length === 1 ? "is" : "are"} withheld by the publisher as confidential and not counted.` : "";
  if (!h.latest) return { statement: `${area} has no observed value in this range.`, detail: `Nothing is filled in or carried forward from another period.${withheld}` };
  if (!h.previous || !h.change) {
    return { statement: `${area}: ${h.latest.shown} in ${h.latest.period}, the only observation in this range.`, detail: `No change can be stated from one observation.${withheld}` };
  }
  const { latest, previous, change } = h;
  const statement = `For ${area}, the reported value ${movement(previous, latest, change)}.`;
  const ly = yearOf(latest.period);
  const py = yearOf(previous.period);
  const gap = ly !== null && py !== null ? ly - py : null;
  const spacing = gap === null ? `The previous observation is ${previous.period}.` : gap === 1 ? "The two observations are from consecutive years." : `This is ${/^8/.test(String(gap)) || gap === 11 || gap === 18 ? "an" : "a"} ${gap}-year gap between observations.`;
  return { statement, detail: `${spacing} No annual path or statistical significance is inferred.${withheld}` };
}

export type ComparisonRow = { areaCode: string | null; name: string; value: number; shown: string; note: string | null; statusLabel: string | null; selected: boolean };
export type Comparison = {
  period: string;
  rows: ComparisonRow[];
  /** Areas whose value for this period the publisher withholds: listed, never a bar. */
  withheld: { areaCode: string | null; name: string }[];
  /** Areas with values in this series but none for this period (no nearby period is used). */
  notObserved: number;
};

/** The areas observed in one period of the series, highest unrounded value first (ties by area code). */
export function comparisonFor(
  observations: IndicatorObservation[],
  period: string,
  s: IndicatorSeriesSummary,
  areas: IndicatorArea[],
  provenance: Record<string, unknown>,
  selectedArea: string | null,
  recordedDecimals: number | null,
  statuses: Record<string, string | null>,
): Comparison {
  const at = observations.filter((o) => o.period === period);
  const rows = at
    .map((o) => {
      const p = pointOf(o, s, recordedDecimals, statuses);
      return { areaCode: o.areaCode, name: areaName(o.areaCode, areas), value: p.value, shown: p.shown, note: o.note, statusLabel: p.statusLabel, selected: o.areaCode === selectedArea };
    })
    .sort((a, b) => b.value - a.value || (a.areaCode ?? "").localeCompare(b.areaCode ?? ""));
  const cells = withheldCells(provenance, s.key, s.areaCodes);
  const withheld = s.areaCodes.filter((a) => cells.has(`${a ?? ""}\u0000${period}`)).map((a) => ({ areaCode: a, name: areaName(a, areas) }));
  const observedHere = new Set(at.map((o) => o.areaCode));
  const withValues = new Set(observations.map((o) => o.areaCode));
  return { period, rows, withheld, notObserved: [...withValues].filter((a) => !observedHere.has(a)).length };
}

/** Withheld periods of one area in the range (OECD confidential cells), in order. */
export function withheldPeriods(provenance: Record<string, unknown>, s: IndicatorSeriesSummary, areaCode: string | null, range: PeriodRange): string[] {
  const list = Array.isArray(provenance.withheld) ? (provenance.withheld as unknown[]) : [];
  return list
    .filter((w): w is [string, string | null, string] => Array.isArray(w) && w[0] === s.key && (w[1] ?? null) === areaCode && typeof w[2] === "string")
    .map((w) => w[2])
    .filter((p) => inRange(p, range))
    .sort();
}

/**
 * The area chosen automatically: the one with the most observations in the series, then the latest observation,
 * then the area code. Stated in the view; the researcher can choose another.
 */
export function suggestedArea(observations: IndicatorObservation[]): string | null {
  const by = new Map<string | null, { n: number; last: string }>();
  for (const o of observations) {
    if (o.period === null) continue;
    const x = by.get(o.areaCode) ?? { n: 0, last: "" };
    by.set(o.areaCode, { n: x.n + 1, last: o.period > x.last ? o.period : x.last });
  }
  const best = [...by].sort(([a, x], [b, y]) => y.n - x.n || (y.last > x.last ? 1 : y.last < x.last ? -1 : 0) || (a ?? "").localeCompare(b ?? ""))[0];
  return best ? best[0] : null;
}
export const SUGGESTED_AREA_RULE = "Chosen automatically: the area with the most observations in this series (ties: the latest observation, then the area code).";

export const MAX_TREND_PANELS = 12;
export const SUGGESTED_TREND_PANELS = 6;
/** The small multiples shown before any choice: the selected area, then areas observed in the same period, highest value first. */
export function suggestedTrendAreas(observations: IndicatorObservation[], selected: string | null, period: string | null, s: Scale): (string | null)[] {
  const others = period === null ? [] : observations
    .filter((o) => o.period === period && o.areaCode !== selected)
    .sort((a, b) => shownNumber(b.valueText, s) - shownNumber(a.valueText, s) || (a.areaCode ?? "").localeCompare(b.areaCode ?? ""))
    .map((o) => o.areaCode);
  return [selected, ...others].slice(0, SUGGESTED_TREND_PANELS);
}
export const SUGGESTED_TREND_RULE = "Shown first: the selected area, then the areas observed in its latest period, highest value first, up to six.";

/** A breakdown filter's name: the dimension code, or "Reference window" for DHS timelapse windows (labels say so). */
export function breakdownFilterName(choice: BreakdownChoice): string {
  return choice.values.every((v) => /^Timelapse:/i.test(v.label)) ? "Reference window" : choice.dimension;
}

export type SeriesAttributes =
  | { state: "not_recorded" }
  | { state: "recorded"; columns: string[]; values: Record<string, { code: string; label: string | null }[]> };

/** The record attributes the read kept for a series (engine seriesAttributes, reader 2026.10.29 and later). */
export function seriesAttributesOf(provenance: Record<string, unknown>, seriesKey: string): SeriesAttributes {
  if (!Array.isArray(provenance.seriesAttributeColumns) || !provenance.seriesAttributes || typeof provenance.seriesAttributes !== "object") return { state: "not_recorded" };
  const all = provenance.seriesAttributes as Record<string, Record<string, { code: string; label: string | null }[]>>;
  return { state: "recorded", columns: provenance.seriesAttributeColumns as string[], values: all[seriesKey] ?? {} };
}

/** Attributes that are part of a publisher's full series key: two codes in one stored series need review. */
export const SERIES_KEY_ATTRIBUTES = ["STRUCTURE_ID", "DATABASE_ID", "AGG_METHOD", "UNIT_TYPE"] as const;

/** Why a series cannot be shown as one series (an attribute of its full key has two codes), or null. */
export function seriesNeedsReview(a: SeriesAttributes): string | null {
  if (a.state !== "recorded") return null;
  for (const col of SERIES_KEY_ATTRIBUTES) {
    const v = a.values[col] ?? [];
    if (v.length > 1) return `Needs review: ${col} has ${v.length} codes in this series (${v.map((x) => x.code).join(", ")}). It is part of the publisher's series key, so these values may be different series; nothing is charted until the file is split or corrected.`;
  }
  return null;
}

/** The file's DECIMALS for the series when it is one whole number; null otherwise. */
export function recordedDecimals(a: SeriesAttributes): number | null {
  if (a.state !== "recorded") return null;
  const v = a.values.DECIMALS ?? [];
  return v.length === 1 && /^[0-9]$/.test(v[0].code) ? Number(v[0].code) : null;
}

function attributeText(a: SeriesAttributes, column: string): string {
  if (a.state === "not_recorded") return "not recorded by this file's read (read before 29 October 2026); read the file again on its Indicator data tab to record it";
  if (!a.columns.includes(column)) return "not stated in the file";
  const v = a.values[column] ?? [];
  if (v.length === 0) return "blank in the file for this series";
  const one = (x: { code: string; label: string | null }) => (x.label ? `${x.label} (${x.code})` : x.code);
  return v.length === 1 ? one(v[0]) : `varies within this series: ${v.map(one).join(", ")}`;
}

export type DefinitionLine = { label: string; value: string };

/** Definition and provenance of a series, as lines; every unknown says so. */
export function definitionLines(input: {
  s: IndicatorSeriesSummary;
  attributes: SeriesAttributes;
  provenance: Record<string, unknown>;
  fileName: string;
  layout: IndicatorLayout;
  publishedAt: string;
  observations: IndicatorObservation[];
}): DefinitionLine[] {
  const { s, attributes: a, provenance } = input;
  const statuses = (provenance.statuses ?? {}) as Record<string, string | null>;
  const codes = [...new Set(input.observations.map((o) => o.status))].sort((x, y) => (x ?? "").localeCompare(y ?? ""));
  const statusText = codes.length === 0 ? "none" : codes.map((c) => (c === null ? "not stated" : statuses[c] ? `${statuses[c]} (${c})` : c)).join(", ");
  const dataset = (provenance.dataset ?? {}) as Record<string, string>;
  const metadataDate = typeof provenance.lastUpdated === "string" ? provenance.lastUpdated : dataset.UPDATE_DATE ?? null;
  return [
    { label: "Indicator", value: indicatorNameOf(s) },
    { label: "Definition", value: "No separate definition text is in the file; the indicator's own label is shown above." },
    { label: "Breakdowns", value: s.breakdowns.length > 0 ? s.breakdowns.map((b) => `${b.dimension}: ${b.label ? `${b.label} (${b.code})` : b.code}`).join("; ") : "none" },
    { label: "Unit", value: unitText(s).replace(/^Unit: /, "") },
    { label: "Unit multiplier", value: s.unitMult === null ? "not stated in the file" : s.unitMult === 0 ? "0 (values as written)" : `${s.unitMult} (values shown times 10 to the power ${s.unitMult})` },
    { label: "Decimals", value: attributeText(a, "DECIMALS") },
    { label: "Observation status", value: statusText },
    { label: "Confidentiality", value: attributeText(a, "OBS_CONF") },
    { label: "Aggregation method", value: attributeText(a, "AGG_METHOD") },
    { label: "Unit type", value: attributeText(a, "UNIT_TYPE") },
    { label: "Data structure", value: attributeText(a, "STRUCTURE_ID") },
    { label: "Source", value: sourceText(provenance, input.fileName).replace(/^Source: /, "") },
    { label: "Source metadata date", value: metadataDate ? `${metadataDate} (the publisher's date for the data, not the observation year)` : "not supplied in the file" },
    { label: "Release vintage", value: "not supplied in the file" },
    { label: "Sample size and uncertainty", value: "not supplied in the file: no interval, significance or weighting is shown" },
    { label: "File read", value: `${input.publishedAt.slice(0, 10)} (when this app read the file, not a publication date)` },
  ];
}

/** Which provider a file is from, by its recognised layout (claude/indicator-data.md, the layout table). */
export type Provider = "world_bank" | "oecd" | "imf" | "other";
export const PROVIDER_NAME: Record<Provider, string> = { world_bank: "World Bank", oecd: "OECD", imf: "IMF", other: "Other published statistics" };
const PROVIDER_OF_LAYOUT: Record<IndicatorLayout, Provider> = {
  sdmx_long: "world_bank",
  data360_wide: "world_bank",
  wdi_wide: "world_bank",
  oecd_sdmx: "oecd",
  oecd_notes: "oecd",
  imf_wide: "imf",
  label_value: "other",
};

export type FileReadiness = {
  documentId: string;
  fileName: string;
  provider: Provider | null;
  state: "observations_ready" | "definitions_only" | "not_read" | "import_error";
  content: string;
  status: string;
  nextStep: string;
  readId: string | null;
};

/** One file's readiness for the dashboard, from its read (generation states of the design handoff). */
export function fileReadiness(f: IndicatorFileSummary): FileReadiness {
  const base = { documentId: f.documentId, fileName: f.fileName, readId: f.read?.readId ?? null, provider: f.read?.layout ? PROVIDER_OF_LAYOUT[f.read.layout] : null };
  if (!f.read || (!f.read.readId && !f.read.failure)) return { ...base, state: "not_read", content: "Not read yet", status: "Not read yet", nextStep: "Open its Indicator data tab in Sources" };
  if (!f.read.readId) return { ...base, state: "import_error", content: "No usable read", status: `Import error: ${f.read.failure}`, nextStep: "Check the file, then read it again in Sources" };
  const later = f.read.failure ? ". The last attempt to read it again failed; the earlier read is shown" : "";
  if (f.read.layout === "oecd_notes") {
    const rows = typeof f.read.provenance.dataRows === "number" ? `${f.read.provenance.dataRows} metadata rows` : "Metadata rows";
    return { ...base, state: "definitions_only", content: `${rows}, ${f.read.noteCount} English notes, no values`, status: `Metadata only: no charts${later}`, nextStep: "Add the observation data file of this dataflow" };
  }
  const n = f.read.observationCount;
  return { ...base, state: "observations_ready", content: `${n.toLocaleString("en-GB")} observation${n === 1 ? "" : "s"}, ${f.read.seriesCount} series, ${f.read.areaCount} area${f.read.areaCount === 1 ? "" : "s"}`, status: `Ready: charts populated${later}`, nextStep: "Explore or refine the selection" };
}

/** Per provider, what is loaded: "OECD: metadata only", "IMF: no file provided". */
export function providerLines(files: FileReadiness[]): { provider: Provider | null; text: string }[] {
  // A file not read (or not readable) has no layout, so its provider is not known: it is counted on its own
  // line, and a provider with no read file then says "no file read" rather than "no file provided".
  const unknown = files.filter((f) => f.provider === null).length;
  const lines: { provider: Provider | null; text: string }[] = (["world_bank", "oecd", "imf", "other"] as Provider[])
    .map((p) => {
      const of = files.filter((f) => f.provider === p);
      const data = of.filter((f) => f.state === "observations_ready").length;
      const notes = of.filter((f) => f.state === "definitions_only").length;
      const name = PROVIDER_NAME[p];
      if (of.length === 0) return p === "other" ? null : { provider: p, text: `${name}: ${unknown > 0 ? "no file read" : "no file provided"}` };
      if (data > 0) return { provider: p, text: `${name}: ${data} file${data === 1 ? "" : "s"} with observations${notes > 0 ? `, ${notes} metadata only` : ""}` };
      return { provider: p, text: `${name}: metadata only` };
    })
    .filter((x): x is { provider: Provider; text: string } => x !== null);
  if (unknown > 0) lines.push({ provider: null, text: `${unknown} file${unknown === 1 ? "" : "s"} not read: provider not known until read` });
  return lines;
}

/** A series of the read by its identity: the stored series key, its indicator and its code per breakdown. */
export type SeriesChoice = { key: string; indicatorKey: string; codes: Record<string, string> };

/**
 * The series key for an indicator and breakdown codes. A picked code the indicator has is kept; a breakdown with
 * no pick, or a pick this indicator does not have (after changing indicator), takes the indicator's first code,
 * which the filter then shows. Null when no series has that combination: nothing else is put in its place.
 */
export function seriesKeyFor(choices: SeriesChoice[], indicatorKey: string, picks: Record<string, string>): string | null {
  const of = choices.filter((c) => c.indicatorKey === indicatorKey);
  if (of.length === 0) return null;
  const dims = [...new Set(of.flatMap((c) => Object.keys(c.codes)))];
  const wanted = Object.fromEntries(dims.map((d) => [d, of.some((c) => c.codes[d] === picks[d]) ? picks[d] : of[0].codes[d]]));
  return of.find((c) => dims.every((d) => c.codes[d] === wanted[d]))?.key ?? null;
}

export { breakdownChoices, indicatorKeyOf, indicatorOptions, type BreakdownChoice, type IndicatorOption };
