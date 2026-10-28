// The Indicator data chart (batch 54), drawn by the real Observable Plot into a linkedom document as the
// export renderer does: a line per area, a gap (no point, a broken line) for a year without a value, a
// filled circle for a normal value, and an open shape of its own for a value whose status is not normal,
// with a symbol legend naming the status (Grant, 28 October 2026).
import { describe, expect, it } from "vitest";
import * as Plot from "@observablehq/plot";
import { DOMParser } from "linkedom";
import { buildIndicatorPlotOptions } from "../indicatorChartOptions";
import { chartPoints, periodAxis, statusMarkers } from "../indicatorDisplay";
import type { IndicatorObservation, IndicatorSeriesSummary } from "../indicatorData";

const series: IndicatorSeriesSummary = {
  id: "s", key: "k", indicatorCode: "X", indicatorLabel: "X", breakdowns: [], unitCode: "PT", unitLabel: "Percent", unitMult: 0,
  valueScale: null, baseDescription: null, groups: null, observationCount: 5, areaCodes: ["ZAF", "KEN"],
};
const obs: IndicatorObservation[] = [
  { areaCode: "ZAF", period: "2019", valueText: "10", status: "A", note: null },
  { areaCode: "ZAF", period: "2020", valueText: "11", status: "E", note: null },
  { areaCode: "ZAF", period: "2022", valueText: "12", status: "A", note: null },
  { areaCode: "KEN", period: "2019", valueText: "20", status: "B", note: null },
  { areaCode: "KEN", period: "2020", valueText: "21", status: null, note: null },
];
const statuses = { A: "Normal value", E: "Estimated value", B: "Break in series" };
const areas = [{ code: "ZAF", label: "South Africa" }, { code: "KEN", label: "Kenya" }];

function render(o: IndicatorObservation[]) {
  const points = chartPoints(o, ["ZAF", "KEN"], areas, series, statuses);
  const markers = statusMarkers(o, statuses);
  const axis = periodAxis(o.map((x) => x.period)).map((p) => p ?? "Not stated");
  const document = new DOMParser().parseFromString("<!doctype html><html><body></body></html>", "text/html") as unknown as Document;
  const el = Plot.plot({ ...buildIndicatorPlotOptions(Plot, { points, axis, areas: ["South Africa (ZAF)", "Kenya (KEN)"], yLabel: "Percent", width: 600, markers }), document }) as unknown as { outerHTML: string };
  return { html: el.outerHTML, points, markers };
}

describe("indicator chart", () => {
  it("marks estimated and break-in-series values with their own shapes and names them in a legend", () => {
    const { html, points, markers } = render(obs);
    expect(markers).toEqual([
      { code: "B", label: "Break in series (B)", symbol: "triangle" },
      { code: "E", label: "Estimated value (E)", symbol: "diamond" },
    ]);
    // Normal values and a value with no status are not marked.
    expect(points.filter((p) => p.statusLabel).map((p) => `${p.area} ${p.period} ${p.statusLabel}`)).toEqual(["South Africa (ZAF) 2020 Estimated value (E)", "Kenya (KEN) 2019 Break in series (B)"]);
    // Two dot marks: the plain circles, and the marked shapes drawn as paths with the status in their title.
    const dots: string[] = html.match(/aria-label="dot"[\s\S]*?<\/g>/g) ?? [];
    expect(dots).toHaveLength(2);
    expect((dots[0].match(/<circle/g) ?? []).length).toBe(3);
    expect(dots[1]).toContain("Estimated value (E)");
    expect(dots[1]).toContain("Break in series (B)");
    expect(dots[1]).not.toContain("<circle");
    // The symbol legend names each status.
    expect(html).toContain("Break in series (B)</");
    expect(html).toContain("Estimated value (E)</");
  });

  it("a year with no value is a gap: no point is drawn for it and its value is null, never zero", () => {
    const { points, html } = render(obs);
    expect(points.find((p) => p.area.startsWith("South Africa") && p.period === "2021")?.value).toBeNull();
    expect(html).not.toMatch(/: 0[ <]/);
  });

  it("no marked status: no symbol legend", () => {
    const { markers, html } = render(obs.filter((o) => o.status === "A"));
    expect(markers).toEqual([]);
    expect(html).not.toContain("Estimated value");
  });
});
