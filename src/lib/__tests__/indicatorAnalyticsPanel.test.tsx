// Indicator Analytics (D6): the workspace MOUNTED (react-dom/client in a linkedom document). The server actions are
// the mocked boundary; each answer is the real loader (loadIndicatorAnalytics, loadIndicatorWorkspace) over a stored
// read stood in for the database (listIndicatorFiles, loadIndicatorSeriesRead), and answers are held so the test
// chooses their order:
//   - the launcher opens the workspace; the headline, change and summary are the loader's (90.2%, +19.7 pp,
//     "2022 vs 2014, not year-on-year"), with "Auto-generated" and "Observed data only";
//   - a late answer for an earlier choice (Kenya) never replaces the newer one (Ghana);
//   - a stale answer (the file read again) is asked again from the new read and the view says why;
//   - closing by unmount (a refresh) and mounting again keeps it open with the same choices;
//   - Compare and Data & sources show the comparison and "IMF: no file provided".
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { IndicatorFileSummary, IndicatorSeriesRead } from "../indicatorData";
import type { IndicatorAnalyticsRequest } from "../indicatorAnalytics";

const KEY = '["RH_ANCC_W_IRN", [["COMP_BREAKDOWN_1", "ANCC_IRN_02"]]]';
const KEY03 = '["RH_ANCC_W_IRN", [["COMP_BREAKDOWN_1", "ANCC_IRN_03"]]]';
const series = (key: string, window: string, areaCodes: string[]) => ({
  id: key, key, indicatorCode: "RH_ANCC_W_IRN", indicatorLabel: "Iron during antenatal care",
  breakdowns: [{ dimension: "COMP_BREAKDOWN_1", code: window, label: `Timelapse: ${window}` }],
  unitCode: "PT_W_SUB", unitLabel: "Percentage of women in the same subgroup", unitMult: 0, valueScale: null, baseDescription: null, groups: null,
  observationCount: 6, areaCodes, withheldOnlyAreaCodes: [],
});
const o = (areaCode: string, period: string, valueText: string, note: string) => ({ areaCode, period, valueText, status: "A", note });
let readId = "11111111-1111-4111-8111-111111111111";
function stored(): IndicatorSeriesRead {
  return {
    state: "ready", readId, fileName: "DHS_SD_WIDEF.csv", layout: "data360_wide", reader: "engine-indicators-2026.10.29",
    provenance: { statuses: { A: "Normal value" }, sources: [{ code: "DHS_SD", label: "Survey Based Indicators" }], seriesAttributeColumns: ["DECIMALS"], seriesAttributes: { [KEY]: { DECIMALS: [{ code: "1", label: "One" }] } } },
    publishedAt: "2026-10-29T10:00:00.000Z", lastFailure: null,
    areas: [{ code: "GHA", label: "Ghana" }, { code: "KEN", label: "Kenya" }],
    series: [series(KEY, "ANCC_IRN_02", ["GHA", "KEN"]), series(KEY03, "ANCC_IRN_03", ["KEN"])],
    seriesKey: KEY,
    observations: [o("GHA", "2014", "91.4", "DHS, 2014"), o("GHA", "2022", "92.3", "DHS, 2022"), o("KEN", "2003", "45.8", "DHS, 2003"), o("KEN", "2008", "71.0", "DHS, 2008-09"), o("KEN", "2014", "70.5", "DHS, 2014"), o("KEN", "2022", "90.2", "DHS, 2022")],
    coverage: { observations: 6, areas: 2, areaSeries: 2, indicators: 1, firstPeriod: "2003", lastPeriod: "2022", valueRange: ["45.8", "92.3"] },
  };
}
const FILES: IndicatorFileSummary[] = [
  { documentId: "22222222-2222-4222-8222-222222222222", fileName: "DHS_SD_WIDEF.csv", processingStatus: "ready", read: { readId, layout: "data360_wide", provenance: {}, seriesCount: 2, observationCount: 6, areaCount: 2, noteCount: 0, publishedAt: "x", failure: null, failedAt: null } },
];

vi.mock("../indicatorData", () => ({
  IndicatorDocumentNotFoundError: class extends Error {},
  listIndicatorFiles: async () => ({ state: "ready", files: FILES }),
  loadIndicatorSeriesRead: async (_t: string, _r: string, _d: string, req: { readId: string | null }) =>
    req.readId !== null && req.readId !== readId ? { state: "stale", message: "This file was read again since the view was loaded." } : stored(),
}));

// The app's "@/lib" alias is not configured for vitest: the screen's pure imports are the real modules.
vi.mock("@/lib/indicatorAnalyticsFigures", async () => await import("../indicatorAnalyticsFigures"));
vi.mock("@/lib/indicatorDisplay", async () => await import("../indicatorDisplay"));

// Held answers: each call waits until the test releases it.
const held: { request: IndicatorAnalyticsRequest; release: () => void }[] = [];
let holdAnswers = false;
vi.mock("@/lib/indicatorAnalyticsActions", () => ({
  indicatorWorkspaceAction: async () => ({ ok: true, workspace: await (await import("../indicatorAnalytics")).loadIndicatorWorkspace("t", "r") }),
  indicatorAnalyticsAction: async (_run: string, request: IndicatorAnalyticsRequest) => {
    if (holdAnswers) await new Promise<void>((release) => held.push({ request, release }));
    return (await import("../indicatorAnalytics")).loadIndicatorAnalytics("t", "r", request);
  },
}));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; querySelector(s: string): El | null; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let container: El;
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
  container = document.getElementById("app") as unknown as El;
  body = document.body as unknown as El;
  Launcher = (await import("../../app/runs/[id]/IndicatorAnalyticsPanel")).IndicatorAnalyticsLauncher as typeof Launcher;
}, 30000);

const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const button = (re: RegExp) => [...body.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const click = async (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)));
};
async function choose(testId: string, value: string) {
  const all = [...body.querySelectorAll("select")];
  const select = all.find((x) => x.getAttribute("data-testid") === testId);
  if (!select) throw new Error(`no select ${testId} among ${all.map((x) => x.getAttribute("data-testid")).join(", ")}: ${text().slice(600, 2400)}`);
  // React reads the new value from the event target.
  Object.defineProperty(select, "value", { value, configurable: true });
  await act(async () => void select.dispatchEvent(new EventCtor("change", { bubbles: true })));
}

describe("Indicator Analytics workspace (mounted)", () => {
  it("opens with the loader's figures; a late earlier answer never replaces a newer choice; stale reloads; kept on remount", async () => {
    let root = createRoot(container);
    await act(() => root.render(createElement(Launcher as never, { runId: "33333333-3333-4333-8333-333333333333", fileCount: 1 })));
    await click(button(/^Indicator Analytics/));
    await settle();
    const t = text();
    expect(t).toContain("Auto-generated");
    expect(t).toContain("Observed data only");
    expect(t).toContain("90.2%");
    expect(t).toContain("+19.7 pp");
    expect(t).toContain("2022 vs 2014, not year-on-year");
    expect(t).toContain("For Kenya (KEN), the reported value rose from 70.5% in 2014 to 90.2% in 2022.");
    expect(t).toContain("Chosen automatically: the area with the most observations");

    // Choose Ghana, then Kenya; Kenya's answer is released first, Ghana's (the earlier choice) late.
    holdAnswers = true;
    await choose("indicator-area", "GHA");
    await choose("indicator-area", "KEN");
    expect(held.map((h) => h.request.area?.code)).toEqual(["GHA", "KEN"]);
    held[1].release();
    await settle();
    held[0].release();
    await settle();
    held.length = 0;
    holdAnswers = false;
    expect(text()).toContain("Latest observed: Kenya (KEN)");
    expect(text()).not.toContain("Latest observed: Ghana (GHA)");

    // The file is read again: the next request with the old read id is stale, asked again, and said.
    readId = "44444444-4444-4444-8444-444444444444";
    await choose("indicator-area", "GHA");
    await settle();
    expect(text()).toContain("This file was read again since the view was loaded.");
    expect(text()).toContain("Latest observed: Ghana (GHA)");

    // A refresh unmounts Analytics: mounted again, the workspace is open with Ghana still chosen.
    await act(() => root.unmount());
    expect(text()).not.toContain("Indicators dashboard");
    root = createRoot(container);
    await act(() => root.render(createElement(Launcher as never, { runId: "33333333-3333-4333-8333-333333333333", fileCount: 1 })));
    await settle();
    expect(text()).toContain("Latest observed: Ghana (GHA)");

    // Compare: one period, highest first; Data & sources: readiness per provider.
    await click(button(/^Compare$/));
    await settle();
    expect(text()).toContain("Reference period 2022");
    expect(text()).toMatch(/Ghana \(GHA\)\s*92\.3%.*Kenya \(KEN\)\s*90\.2%/);
    await click(button(/^Data & sources$/));
    await settle();
    expect(text()).toContain("IMF: no file provided");
    expect(text()).toContain("OECD: no file provided");
    expect(text()).toContain("Ready: charts populated");
    // Closing clears it.
    await click(button(/All analytics/));
    expect(text()).not.toContain("Indicators dashboard");
    await act(() => root.unmount());
  });
});
