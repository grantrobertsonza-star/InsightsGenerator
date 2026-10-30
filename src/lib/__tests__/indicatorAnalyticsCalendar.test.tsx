// Indicator Analytics (D6-F02, Codex review 30 October 2026): every Trends panel places the same period at the same
// horizontal position. The workspace is MOUNTED (react-dom/client in a linkedom document): the real launcher, the
// real loader (loadIndicatorAnalytics, loadIndicatorWorkspace) over a stored read stood in for the database
// (listIndicatorFiles, loadIndicatorSeriesRead); only the server actions and the database read are stood in.
//   - the review's case: Ghana observed on 2 and 11 January 2024, Kenya on 1, 2 and 11 January 2024. Ghana's
//     2 January is its first point and Kenya's second; both circles must share one cx (the review saw 40 and 328);
//   - ISO weeks across a year boundary (2020-W52, 2020-W53, 2021-W01, then a gap to 2021-W05), unequal coverage
//     and a single-point country: one cx per week in every panel, a week apart is a week apart on screen, and the
//     single point sits at its week, not in the middle of its panel;
//   - a week that cannot be placed (2021-W53: 2021 has 52 ISO weeks) withholds the time-axis charts with the
//     reason and lists the observed values instead of placing them by order.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { IndicatorFileSummary, IndicatorSeriesRead } from "../indicatorData";

const KEY = '["DAILY_IND", [["FREQ", "D"]]]';
const READ = "11111111-1111-4111-8111-111111111111";
type Obs = [area: string, period: string, value: string];
let observations: Obs[] = [];
function stored(): IndicatorSeriesRead {
  const areaCodes = [...new Set(observations.map((x) => x[0]))];
  return {
    state: "ready", readId: READ, fileName: "daily.csv", layout: "sdmx_long", reader: "engine-indicators-2026.10.29",
    provenance: { statuses: { A: "Normal value" } },
    publishedAt: "2026-10-30T10:00:00.000Z", lastFailure: null,
    areas: [{ code: "GHA", label: "Ghana" }, { code: "KEN", label: "Kenya" }, { code: "NGA", label: "Nigeria" }],
    series: [{
      id: KEY, key: KEY, indicatorCode: "DAILY_IND", indicatorLabel: "A daily indicator", breakdowns: [{ dimension: "FREQ", code: "D", label: "Daily" }],
      unitCode: "PT", unitLabel: "Percent", unitMult: 0, valueScale: null, baseDescription: null, groups: null,
      observationCount: observations.length, areaCodes, withheldOnlyAreaCodes: [],
    }],
    seriesKey: KEY,
    observations: observations.map(([areaCode, period, valueText]) => ({ areaCode, period, valueText, status: "A", note: null })),
    coverage: { observations: observations.length, areas: areaCodes.length, areaSeries: areaCodes.length, indicators: 1, firstPeriod: null, lastPeriod: null, valueRange: null },
  };
}
const FILES: IndicatorFileSummary[] = [
  { documentId: "22222222-2222-4222-8222-222222222222", fileName: "daily.csv", processingStatus: "ready", read: { readId: READ, layout: "sdmx_long", provenance: {}, seriesCount: 1, observationCount: 5, areaCount: 2, noteCount: 0, publishedAt: "x", failure: null, failedAt: null } },
];

vi.mock("../indicatorData", () => ({
  IndicatorDocumentNotFoundError: class extends Error {},
  listIndicatorFiles: async () => ({ state: "ready", files: FILES }),
  loadIndicatorSeriesRead: async () => stored(),
}));
vi.mock("@/lib/indicatorAnalyticsFigures", async () => await import("../indicatorAnalyticsFigures"));
vi.mock("@/lib/indicatorDisplay", async () => await import("../indicatorDisplay"));
vi.mock("@/lib/indicatorAnalyticsActions", () => ({
  indicatorWorkspaceAction: async () => ({ ok: true, workspace: await (await import("../indicatorAnalytics")).loadIndicatorWorkspace("t", "r") }),
  indicatorAnalyticsAction: async (_run: string, request: import("../indicatorAnalytics").IndicatorAnalyticsRequest) => (await import("../indicatorAnalytics")).loadIndicatorAnalytics("t", "r", request),
}));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let doc: { createElement(t: string): unknown; body: { appendChild(n: unknown): unknown; replaceChildren(): void } };
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let Launcher: (p: { runId: string; fileCount: number }) => unknown;

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = document;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.Event = window.Event;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  EventCtor = window.Event as unknown as typeof EventCtor;
  act = ((await import("react")) as unknown as { act: typeof act }).act;
  createRoot = ((await import("react-dom/client")) as unknown as { createRoot: typeof createRoot }).createRoot;
  doc = document as unknown as typeof doc;
  body = document.body as unknown as El;
  Launcher = (await import("../../app/runs/[id]/IndicatorAnalyticsPanel")).IndicatorAnalyticsLauncher as typeof Launcher;
}, 30000);

const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const button = (re: RegExp) => [...body.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const click = async (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)));
};

/** Opens the workspace on the Trends tab (a run id per scenario, so no choice is kept from another). */
async function openTrends(runId: string): Promise<Root> {
  // A fresh document body per scenario, so nothing a failed scenario left mounted is read by the next.
  doc.body.replaceChildren();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(createElement(Launcher as never, { runId, fileCount: 1 })));
  await click(button(/^Indicator Analytics/));
  await settle();
  await click(button(/^Trends$/));
  await settle();
  return root;
}

/** The cx of each circle in the Trends panel of an area, by the period its tooltip names. */
function circles(areaName: string): Record<string, number> {
  const panel = [...body.querySelectorAll('[data-testid="indicator-trend-panel"]')].find((p) => (p.querySelectorAll("h3")[0]?.textContent ?? "") === areaName);
  if (!panel) throw new Error(`no Trends panel for ${areaName}: ${text().slice(0, 1500)}`);
  return Object.fromEntries([...panel.querySelectorAll("circle")].map((c) => [(c.querySelectorAll("title")[0]?.textContent ?? "").split(/[:,]/)[0], Number(c.getAttribute("cx"))]));
}

describe("Indicator Analytics Trends: one time axis for every panel (mounted)", () => {
  let root: Root | null = null;
  afterEach(async () => {
    if (root) await act(() => root!.unmount());
    root = null;
  });
  it("the review's case: 2 January 2024 has one horizontal position in Ghana's and Kenya's panels", async () => {
    observations = [["GHA", "2024-01-02", "10.0"], ["GHA", "2024-01-11", "12.0"], ["KEN", "2024-01-01", "20.0"], ["KEN", "2024-01-02", "21.0"], ["KEN", "2024-01-11", "22.0"]];
    root = await openTrends("33333333-3333-4333-8333-333333333301");
    const ken = circles("Kenya (KEN)");
    const gha = circles("Ghana (GHA)");
    expect(Object.keys(ken)).toEqual(["2024-01-01", "2024-01-02", "2024-01-11"]);
    expect(Object.keys(gha)).toEqual(["2024-01-02", "2024-01-11"]);
    expect(gha["2024-01-02"]).toBe(ken["2024-01-02"]);
    expect(gha["2024-01-11"]).toBe(ken["2024-01-11"]);
    // Irregular gaps keep their calendar length: 1 to 2 January is one ninth of 2 to 11 January.
    expect((ken["2024-01-11"] - ken["2024-01-02"]) / (ken["2024-01-02"] - ken["2024-01-01"])).toBeCloseTo(9, 9);
  });

  it("ISO weeks across a year boundary, unequal coverage and a single-point country share one axis", async () => {
    observations = [
      ["KEN", "2020-W52", "20.0"], ["KEN", "2020-W53", "21.0"], ["KEN", "2021-W01", "22.0"], ["KEN", "2021-W05", "23.0"],
      ["GHA", "2020-W53", "11.0"], ["GHA", "2021-W05", "12.0"],
      ["NGA", "2021-W05", "30.0"],
    ];
    root = await openTrends("33333333-3333-4333-8333-333333333302");
    const ken = circles("Kenya (KEN)");
    const gha = circles("Ghana (GHA)");
    const nga = circles("Nigeria (NGA)");
    expect(gha["2020-W53"]).toBe(ken["2020-W53"]);
    expect(gha["2021-W05"]).toBe(ken["2021-W05"]);
    expect(nga["2021-W05"]).toBe(ken["2021-W05"]);
    // Week 53 of 2020 (from Monday 28 December) is one week after week 52 and one week before 2021-W01; 2021-W05
    // is four weeks after 2021-W01.
    const week = ken["2020-W53"] - ken["2020-W52"];
    expect(week).toBeGreaterThan(0);
    expect(ken["2021-W01"] - ken["2020-W53"]).toBeCloseTo(week, 9);
    expect(ken["2021-W05"] - ken["2021-W01"]).toBeCloseTo(4 * week, 9);
  });

  it("a week that does not exist (2021-W53) withholds the time-axis charts with the reason, values listed", async () => {
    observations = [["KEN", "2021-W52", "20.0"], ["KEN", "2021-W53", "21.0"], ["GHA", "2021-W53", "11.0"]];
    root = await openTrends("33333333-3333-4333-8333-333333333303");
    expect([...body.querySelectorAll("circle")].length).toBe(0);
    expect(text()).toContain("Not placed on a time axis: 2021-W53 is not an ISO week of 2021, which has 52 weeks.");
    expect(text()).toContain("2021-W53: 21.0%");
  });
});
