// How Indicator data is shown (batch 54; contract claude/indicator-data.md): choosing a series from its
// indicator and breakdowns, the value shown for a stored value, the time axis, the unit and source
// wording, and the CSV of what is shown. Pure rules, shared by the Indicator data view and its tests;
// nothing here changes a stored value.
import { csvField, csvNumberField } from "./csvField";
import { indicatorPeriodValid } from "./indicatorLayouts";
import type { IndicatorArea, IndicatorBreakdown, IndicatorNote, IndicatorObservation, IndicatorSeriesSummary } from "./indicatorData";

/** An indicator's identity: its code, or its label where the file gives no code (label and value tables). */
export function indicatorKeyOf(s: Pick<IndicatorSeriesSummary, "indicatorCode" | "indicatorLabel">): string {
  return s.indicatorCode !== null ? `code:${s.indicatorCode}` : `label:${s.indicatorLabel ?? ""}`;
}

export function indicatorNameOf(s: Pick<IndicatorSeriesSummary, "indicatorCode" | "indicatorLabel">): string {
  if (s.indicatorLabel && s.indicatorCode) return `${s.indicatorLabel} (${s.indicatorCode})`;
  return s.indicatorLabel ?? s.indicatorCode ?? "";
}

export type IndicatorOption = { key: string; name: string };

/** The file's indicators, once each, in the order of the catalogue. */
export function indicatorOptions(series: IndicatorSeriesSummary[]): IndicatorOption[] {
  const seen = new Map<string, string>();
  for (const s of series) if (!seen.has(indicatorKeyOf(s))) seen.set(indicatorKeyOf(s), indicatorNameOf(s));
  return [...seen].map(([key, name]) => ({ key, name }));
}

export type BreakdownChoice = { dimension: string; values: { code: string; label: string }[] };

/**
 * The breakdowns a researcher chooses for one indicator: each dimension whose code differs between the
 * indicator's series (one with a single value needs no choice). Identity is the code; the label is
 * presentation, with the code shown when the file gives no label.
 */
export function breakdownChoices(series: IndicatorSeriesSummary[], indicatorKey: string): BreakdownChoice[] {
  const of = series.filter((s) => indicatorKeyOf(s) === indicatorKey);
  const dims = new Map<string, Map<string, string>>();
  for (const s of of) {
    for (const b of s.breakdowns) {
      if (!dims.has(b.dimension)) dims.set(b.dimension, new Map());
      const values = dims.get(b.dimension)!;
      if (!values.has(b.code)) values.set(b.code, b.label ? `${b.label} (${b.code})` : b.code);
    }
  }
  return [...dims]
    .filter(([, values]) => values.size > 1)
    .map(([dimension, values]) => ({ dimension, values: [...values].map(([code, label]) => ({ code, label })) }));
}

/** The series of an indicator with these breakdown codes; a dimension not picked takes its first value. */
export function seriesFor(series: IndicatorSeriesSummary[], indicatorKey: string, picks: Record<string, string>): IndicatorSeriesSummary | null {
  const choices = breakdownChoices(series, indicatorKey);
  const wanted = Object.fromEntries(choices.map((c) => [c.dimension, picks[c.dimension] ?? c.values[0].code]));
  return series.find((s) => indicatorKeyOf(s) === indicatorKey && s.breakdowns.every((b) => wanted[b.dimension] === undefined || wanted[b.dimension] === b.code)) ?? null;
}

/** The fixed breakdowns of a series (those with one value), for the chart's description. */
export function breakdownText(breakdowns: IndicatorBreakdown[], skip: Set<string> = new Set()): string {
  return breakdowns
    .filter((b) => !skip.has(b.dimension))
    .map((b) => `${b.dimension}: ${b.label ?? b.code}`)
    .join("; ");
}

/**
 * The number shown for a stored value: the value as written, times 100 when the file stores percent as
 * proportions (0.811 is shown as 81.1), times 10 to the unit multiplier when one is stated (SDMX
 * UNIT_MULT). Display only; the stored value is never changed.
 */
export function shownNumber(valueText: string, s: Pick<IndicatorSeriesSummary, "valueScale" | "unitMult">): number {
  const scale = s.valueScale === "proportion" ? 100 : 1;
  return Number(valueText) * scale * 10 ** (s.unitMult ?? 0);
}

/** Whether a series' values are percentages: a recorded value scale, or a unit naming a percentage. */
export const isPercentUnit = (s: Pick<IndicatorSeriesSummary, "valueScale" | "unitCode" | "unitLabel">) =>
  s.valueScale !== null || /percent|%/i.test(`${s.unitCode ?? ""} ${s.unitLabel ?? ""}`) || s.unitCode === "PT";

/** A shown number as text: one decimal for percentages, otherwise up to three significant decimals. */
export function shownText(n: number, s: Pick<IndicatorSeriesSummary, "valueScale" | "unitCode" | "unitLabel">): string {
  const pct = isPercentUnit(s);
  const text = Math.abs(n) >= 1 || n === 0
    ? n.toLocaleString("en-GB", { maximumFractionDigits: pct ? 1 : 2 })
    : n.toLocaleString("en-GB", { maximumSignificantDigits: 3 });
  return s.valueScale !== null ? `${text}%` : text;
}

/** The unit in words, with how the values are shown when that differs from how they are stored. */
export function unitText(s: Pick<IndicatorSeriesSummary, "unitCode" | "unitLabel" | "unitMult" | "valueScale" | "baseDescription">): string {
  const parts: string[] = [];
  const unit = s.unitLabel && s.unitCode && s.unitLabel !== s.unitCode ? `${s.unitLabel} (${s.unitCode})` : s.unitLabel ?? s.unitCode;
  parts.push(unit ? `Unit: ${unit}` : "Unit: not stated in the file");
  if (s.baseDescription) parts.push(`base: ${s.baseDescription}`);
  if (s.valueScale === "proportion") parts.push("stored as proportions from 0 to 1 and shown as percentages (0.811 is shown as 81.1%)");
  if (s.unitMult !== null && s.unitMult !== 0) parts.push(`values shown multiplied by 10 to the power ${s.unitMult} (the file's unit multiplier)`);
  return parts.join("; ");
}

export function areaName(code: string | null, areas: IndicatorArea[]): string {
  if (code === null) return "Area not stated in the file";
  const label = areas.find((a) => a.code === code)?.label;
  return label ? `${label} (${code})` : code;
}

/**
 * The periods along the time axis. Years (2015), quarters (2015-Q1) and months (2015-M01 or 2015-01) run
 * from the first to the last with every period of that frequency in between, so a period with no value
 * is a gap in the line, never zero and never skipped silently. A series is one frequency (frequency is
 * one of its breakdowns), so periods of different frequencies are not mixed on one axis; if they were,
 * or for any other spelling, the axis is the observed periods in order. The axis is filled only when
 * every period is a real one (indicatorPeriodValid): a month 13 stored before the engine refused it would
 * otherwise be counted as January of the next year and its value lost from the chart (Codex NEW10K-F01),
 * so such a period stays on the axis as written, with its value. A period the file does not state comes
 * last, as "Not stated".
 */
export function periodAxis(periods: (string | null)[]): (string | null)[] {
  const stated = [...new Set(periods.filter((p): p is string => p !== null))].sort();
  const hasUnstated = periods.includes(null);
  let axis: (string | null)[] = stated;
  const forms: [RegExp, number, (year: number, sub: number) => string][] = [
    [/^([0-9]{4})$/, 1, (y) => String(y)],
    [/^([0-9]{4})-Q([1-4])$/, 4, (y, q) => `${y}-Q${q}`],
    [/^([0-9]{4})-M([0-9]{2})$/, 12, (y, m) => `${y}-M${String(m).padStart(2, "0")}`],
    [/^([0-9]{4})-([0-9]{2})$/, 12, (y, m) => `${y}-${String(m).padStart(2, "0")}`],
  ];
  for (const [re, per, text] of forms) {
    if (stated.length === 0 || !stated.every((p) => re.test(p) && indicatorPeriodValid(p))) continue;
    const index = (p: string) => {
      const m = re.exec(p)!;
      return Number(m[1]) * per + (per === 1 ? 0 : Number(m[2]) - 1);
    };
    const first = index(stated[0]);
    const last = index(stated[stated.length - 1]);
    axis = Array.from({ length: last - first + 1 }, (_, i) => text(Math.floor((first + i) / per), per === 1 ? 0 : ((first + i) % per) + 1));
    break;
  }
  return hasUnstated ? [...axis, null] : axis;
}

/**
 * SDMX observation status "A" is a normal value. Any other status the file gives (E estimated, P
 * provisional, B break in series, O missing, ...) is marked on the chart and in the table, named by the
 * file's own label for it. An observation with no status is unmarked: the file says nothing about it.
 */
export const NORMAL_STATUS = "A";
export const isMarkedStatus = (code: string | null): code is string => code !== null && code !== NORMAL_STATUS;

/** Point shapes for marked statuses, in order; a normal value is a filled circle. */
export const STATUS_SYMBOLS = ["triangle", "diamond", "square", "star", "cross", "wye"] as const;
export type StatusMarker = { code: string; label: string; symbol: string };

/**
 * The marked statuses among these observations, each with its shape and the words for it: the file's
 * label for the code (OBS_STATUS_LABEL) with the code, or the code alone when the file gives no label.
 * In code order, so a status keeps its shape whatever is chosen; beyond the six shapes they repeat,
 * and the words still name each status.
 */
export function statusMarkers(observations: IndicatorObservation[], statuses: Record<string, string | null>): StatusMarker[] {
  const codes = [...new Set(observations.map((o) => o.status).filter(isMarkedStatus))].sort();
  return codes.map((code, i) => ({ code, label: statuses[code] ? `${statuses[code]} (${code})` : `Status ${code}`, symbol: STATUS_SYMBOLS[i % STATUS_SYMBOLS.length] }));
}

export type ChartPoint = { area: string; periodIndex: number; period: string; value: number | null; status: string | null; statusLabel: string | null };

/**
 * One point per area and axis period, value null where the file has none, so the line breaks there.
 * Only periods on the axis are used; a value is never filled in. A marked status carries its words
 * (statusMarkers), for the point's shape and the legend.
 */
export function chartPoints(
  observations: IndicatorObservation[],
  areaCodes: (string | null)[],
  areas: IndicatorArea[],
  s: IndicatorSeriesSummary,
  statuses: Record<string, string | null> = {},
  extraPeriods: (string | null)[] = [],
): ChartPoint[] {
  // extraPeriods: periods with no value to draw (withheld) that still belong on the axis.
  const axis = periodAxis([...observations.map((o) => o.period), ...extraPeriods]);
  const markers = new Map(statusMarkers(observations, statuses).map((m) => [m.code, m.label]));
  const byKey = new Map(observations.map((o) => [`${o.areaCode ?? "\u0000"}|${o.period ?? "\u0000"}`, o]));
  return areaCodes.flatMap((code) =>
    axis.map((period, periodIndex) => {
      const o = byKey.get(`${code ?? "\u0000"}|${period ?? "\u0000"}`);
      return {
        area: areaName(code, areas),
        periodIndex,
        period: period ?? "Not stated",
        value: o ? shownNumber(o.valueText, s) : null,
        status: o?.status ?? null,
        statusLabel: o && isMarkedStatus(o.status) ? (markers.get(o.status) ?? null) : null,
      };
    }),
  );
}

export function sourceText(provenance: Record<string, unknown>, fileName: string): string {
  const sources = Array.isArray(provenance.sources) ? (provenance.sources as { code: string | null; label: string | null }[]) : [];
  const named = sources.map((x) => (x.label && x.code ? `${x.label} (${x.code})` : x.label ?? x.code)).filter(Boolean);
  return `Source: ${named.length > 0 ? `${named.join(", ")}, ` : ""}file ${fileName}`;
}

/**
 * Values the file withholds as confidential (OECD CONF_STATUS C with no value), for one series and the
 * chosen areas, as "area|period" keys. Never a value and never zero: shown as withheld.
 */
export function withheldCells(provenance: Record<string, unknown>, seriesKey: string, areaCodes: (string | null)[]): Set<string> {
  const list = Array.isArray(provenance.withheld) ? (provenance.withheld as [string, string | null, string | null][]) : [];
  const areas = new Set(areaCodes);
  return new Set(list.filter(([key, area]) => key === seriesKey && areas.has(area)).map(([, area, period]) => `${area ?? ""}\u0000${period ?? ""}`));
}

/**
 * The notes (OECD reference information) that apply to a charted series and its areas. A note names some
 * dimensions and leaves the rest as any ("~"): it applies when its MEASURE is the series' indicator code,
 * its REF_AREA (if named) is one of the chosen areas, and every other dimension it names is a breakdown of
 * the series with the same code; a dimension the series does not have never matches. The period a note
 * names (TIME_PERIOD) does not filter it out: it is said with the note. Notes never change a value.
 */
export function notesFor(notes: IndicatorNote[], s: Pick<IndicatorSeriesSummary, "indicatorCode" | "breakdowns">, areaCodes: (string | null)[]): IndicatorNote[] {
  const codes = new Map(s.breakdowns.map((b) => [b.dimension, b.code]));
  return notes.filter((n) =>
    Object.entries(n.key).every(([dim, code]) => {
      if (dim === "MEASURE") return s.indicatorCode === code;
      if (dim === "REF_AREA") return areaCodes.includes(code);
      return codes.get(dim) === code;
    }),
  );
}

/** One note in words: its field, what it names beyond the series (area, period), and its English text. */
export function noteText(n: IndicatorNote): string {
  const names = [n.key.REF_AREA ? (n.keyLabels.REF_AREA ? `${n.keyLabels.REF_AREA} (${n.key.REF_AREA})` : n.key.REF_AREA) : null, n.period].filter(Boolean);
  return `${n.fieldLabel ?? n.field}${names.length > 0 ? ` (${names.join(", ")})` : ""}: ${n.text}`;
}

/**
 * The dataset's own description, when the file carries one (the IMF data portal: publisher, update
 * date, citation, licence), as lines for under the chart's source line. Empty when there is none.
 */
export function datasetLines(provenance: Record<string, unknown>): string[] {
  const d = (provenance.dataset ?? {}) as Record<string, string>;
  const lines: string[] = [];
  if (d.PUBLISHER) lines.push(`Publisher: ${d.PUBLISHER}${d.DEPARTMENT ? `, ${d.DEPARTMENT}` : ""}`);
  if (d.UPDATE_DATE) lines.push(`Updated: ${d.UPDATE_DATE}`);
  const citation = d.SUGGESTED_CITATION ?? d.FULL_SOURCE_CITATION ?? d.SHORT_SOURCE_CITATION;
  if (citation) lines.push(`Citation: ${citation}`);
  if (d.LICENSE) lines.push(`Licence: ${d.LICENSE}`);
  return lines;
}

/**
 * The CSV of what is shown: one line per observation of the chosen series and areas, with the value as
 * written in the file and the value as shown, the unit, multiplier, scale, status and note, and the
 * source. Text fields go through csvField (formula-safe); the two value fields are numbers.
 */
export function indicatorCsv(input: {
  series: IndicatorSeriesSummary;
  areas: IndicatorArea[];
  observations: IndicatorObservation[];
  statuses: Record<string, string | null>;
  source: string;
  /** Cells the file withholds as confidential: a line each, with no value. */
  withheld?: { areaCode: string | null; period: string | null }[];
  /** Notes that apply (notesFor): a section after the values, after a blank line. */
  notes?: IndicatorNote[];
}): string {
  const { series: s } = input;
  const dims = s.breakdowns.map((b) => b.dimension);
  const header = ["area_code", "area", "indicator_code", "indicator", ...dims.flatMap((d) => [d, `${d}_label`]), "period", "value_as_written", "value_shown", "unit_code", "unit", "unit_multiplier", "value_scale", "base", "status", "status_label", "note", "source"];
  const lines = [header.map(csvField).join(",")];
  for (const o of input.observations) {
    const text = [
      o.areaCode ?? "",
      areaName(o.areaCode, input.areas),
      s.indicatorCode ?? "",
      s.indicatorLabel ?? "",
      ...s.breakdowns.flatMap((b) => [b.code, b.label ?? ""]),
      o.period ?? "",
    ].map(csvField);
    const shown = shownNumber(o.valueText, s);
    lines.push(
      [
        ...text,
        csvNumberField(o.valueText),
        csvNumberField(String(shown)),
        ...[
          s.unitCode ?? "",
          s.unitLabel ?? "",
          s.unitMult === null ? "" : String(s.unitMult),
          s.valueScale ?? "",
          s.baseDescription ?? "",
          o.status ?? "",
          o.status ? (input.statuses[o.status] ?? "") : "",
          o.note ?? "",
          input.source,
        ].map(csvField),
      ].join(","),
    );
  }
  for (const w of input.withheld ?? []) {
    const text = [w.areaCode ?? "", areaName(w.areaCode, input.areas), s.indicatorCode ?? "", s.indicatorLabel ?? "", ...s.breakdowns.flatMap((b) => [b.code, b.label ?? ""]), w.period ?? ""];
    const rest = [s.unitCode ?? "", s.unitLabel ?? "", s.unitMult === null ? "" : String(s.unitMult), s.valueScale ?? "", s.baseDescription ?? "", "", "", "Withheld by the publisher as confidential", input.source];
    lines.push([...text.map(csvField), "", "", ...rest.map(csvField)].join(","));
  }
  if (input.notes && input.notes.length > 0) {
    lines.push("");
    lines.push(["notes_file", "field", "field_label", "area_code", "period", "note"].map(csvField).join(","));
    for (const n of input.notes) lines.push([n.fileName, n.field, n.fieldLabel ?? "", n.key.REF_AREA ?? "", n.period ?? "", n.text].map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Request order for a view that asks again whenever the choice changes: each request takes the next
 * number, and only an answer to the latest one may be shown, so an earlier answer arriving late never
 * replaces the newer choice.
 */
export function createRequestOrder() {
  let latest = 0;
  return {
    next: () => ++latest,
    isLatest: (n: number) => n === latest,
  };
}
