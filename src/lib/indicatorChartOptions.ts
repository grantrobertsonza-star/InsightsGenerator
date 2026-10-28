// The Observable Plot recipe for an Indicator data line chart (batch 54), kept out of the component as
// plotChartOptions.ts is for the findings charts: the caller passes its own Plot import.
//
// One line per area over the period axis (indicatorDisplay.periodAxis). A period with no value is a gap:
// the line mark breaks at a null value, and nothing is drawn there. A filled circle marks every normal
// value, so a value with no neighbour (a survey every five years) is still seen; a value whose status
// is not normal (estimated, provisional, break in series) is drawn as an open shape of its own
// (indicatorDisplay.statusMarkers), with a symbol legend naming each status. Colours are the app's
// categorical palette, in the order the areas were chosen.
import type * as PlotNS from "@observablehq/plot";
import type { ChartPoint, StatusMarker } from "./indicatorDisplay";
import { CATEGORICAL_PALETTE, CHART_HEIGHT } from "./plotChartOptions";

const OKABE_ITO_PLUS = [...CATEGORICAL_PALETTE, "#332288", "#117733", "#882255", "#44AA99"];

export function buildIndicatorPlotOptions(
  Plot: typeof PlotNS,
  input: { points: ChartPoint[]; axis: string[]; areas: string[]; yLabel: string; width: number; markers?: StatusMarker[] },
): PlotNS.PlotOptions {
  const { points, axis, areas, yLabel, width, markers = [] } = input;
  const plain = points.filter((p) => p.value !== null && p.statusLabel === null);
  const marked = points.filter((p) => p.value !== null && p.statusLabel !== null);
  // Roughly one labelled tick per 56 pixels, so a 45-year axis stays readable.
  const every = Math.max(1, Math.ceil(axis.length / Math.max(2, Math.floor(width / 56))));
  return {
    width,
    height: CHART_HEIGHT,
    marginLeft: 56,
    marginBottom: 36,
    x: { type: "point", domain: axis, label: null, tickFormat: (d: string) => (axis.indexOf(d) % every === 0 ? d : "") },
    y: { label: yLabel, grid: true, nice: true },
    color: { legend: true, domain: areas, range: OKABE_ITO_PLUS.slice(0, Math.max(1, areas.length)) },
    ...(markers.length > 0 ? { symbol: { legend: true, domain: markers.map((m) => m.label), range: markers.map((m) => m.symbol) } } : {}),
    marks: [
      Plot.line(points, { x: "period", y: "value", stroke: "area", strokeWidth: 2 }),
      Plot.dot(plain, { x: "period", y: "value", fill: "area", r: 3, title: (p: ChartPoint) => `${p.area}, ${p.period}: ${p.value}` }),
      Plot.dot(marked, {
        x: "period",
        y: "value",
        symbol: "statusLabel",
        stroke: "area",
        fill: "white",
        strokeWidth: 2,
        r: 5,
        title: (p: ChartPoint) => `${p.area}, ${p.period}: ${p.value} (${p.statusLabel})`,
      }),
    ],
  };
}
