// R6 CSM extension screens, MOUNTED (react-dom/client in a linkedom document): the real CsmExtensionSections with
// only the server action stood in (it returns views shaped as loadCsmExtension returns them).
//   - Journey: figures with raw and weighted bases, pending beside known-outcome completion, the journey filter on a
//     customer-level score labelled as a different population, a Not measured figure with its reason (never 0);
//   - the task filter sends the raw code; the section and company come from the dashboard;
//   - late responses: an earlier request answered after a newer one never replaces it;
//   - Competitive and noncustomers: the sample selector shows the customer benchmark or the noncustomer profile,
//     never both, and the noncustomer view never shows a company or a satisfaction of the focal provider.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { CsmExtensionView } from "../csmExtension";
import type { CsmFigure, CsmReading } from "../csmExtensionMetrics";

const reading = (statistic: CsmReading["statistic"], value: number | null, rawBase: number, weightedBase: number, nonresponse = 0): CsmReading => ({ statistic, value, numerator: value === null ? null : value * weightedBase, weightedBase, rawBase, nonresponse, outsideDomain: 0, baseLevel: rawBase < 30 ? "very_small" : rawBase < 50 ? "small" : "ok" });
const ok = (id: string, label: string, r: CsmReading): CsmFigure => ({ id, label, definition: `${label} definition`, status: "ok", variable: id, reading: r });
const nm = (id: string, label: string, reason: string): CsmFigure => ({ id, label, definition: "", status: "not_measured", reason });

function baseView(section: CsmExtensionView["section"], over: Partial<CsmExtensionView> = {}): CsmExtensionView {
  return {
    wave: "Wave 1",
    openGrain: "relationship",
    openReason: null,
    weighted: true,
    files: [
      { grain: "relationship", grainText: "Relationship (one current customer)", sampleType: "current_customers", sampleTypeText: "Current customers", documentId: "d1", filename: "Banking_CSM_Relationship_Wave_1.xlsx", sheetName: "Respondents", evidence: "", records: 1000, distinctPeople: 1000, keysChecked: true, keyProblems: [], used: true },
      { grain: "noncustomer", grainText: "Noncustomer supplement", sampleType: "focal_noncustomers", sampleTypeText: "Focal noncustomers", documentId: "d3", filename: "Banking_CSM_Noncustomer_Wave_1.xlsx", sheetName: "Noncustomers", evidence: "", records: 500, distinctPeople: 500, keysChecked: true, keyProblems: [], used: true },
    ],
    absent: { channel: "No channel file is labelled Wave 1 in this project." },
    linkProblems: [],
    notUsed: [],
    channelNames: [{ code: "1", label: "Call centre" }, { code: "3", label: "Digital self service" }],
    dataWaves: ["1"],
    options: { tasks: [{ code: "1", label: "Payment or transfer" }, { code: "4", label: "Problem complaint or fraud concern" }], journeyChannels: [{ code: "1", label: "Call centre" }] },
    filters: { company: null, task: null, journeyChannel: null },
    section,
    ...over,
  };
}

function journeyView(completion: number): CsmExtensionView {
  const dist = (id: string, rows: [string, string, number][]) => ({ id, label: id, definition: "", status: "ok" as const, variable: id, rows: rows.map(([code, label, share]) => ({ code, label, share, weighted: share, raw: share })), weightedBase: 825.1, rawBase: 830, nonresponse: 0, outsideDomain: 0, baseLevel: "ok" as const });
  return baseView("journey", {
    journey: {
      status: "ok",
      documentId: "d1",
      filename: "f",
      weightVar: "weight",
      population: { text: "Recent tasks (journey_recent30 = 1)", rawBase: 830, weightedBase: 825.08 },
      recentShare: ok("recent", "Recent task", reading("yes", 82.507705, 1000, 1000)),
      completion: ok("completion", "Completed", reading("yes", completion, 763, 758.76)),
      pending: ok("pending", "Still pending", reading("yes", 8.0375745, 830, 825.08)),
      outcomes: dist("outcomes", [["1", "Completed", 68.79], ["2", "Partly completed", 11.32], ["3", "Unresolved or abandoned", 11.85], ["9", "Still pending", 8.04]]),
      journeyCsat: ok("journeyCsat", "Journey CSAT", reading("t2b", 44.259461, 820, 815.31, 10)),
      journeyCsatMean: ok("journeyCsatMean", "Mean", reading("mean5", 3.28, 820, 815.31)),
      journeyCsatDistribution: dist("csat", [["1", "Very dissatisfied", 6.8], ["5", "Very satisfied", 15]]),
      contacts: { status: "ok", mean: 2.44, rawBase: 830, weightedBase: 825.08, nonresponse: 0, baseLevel: "ok" },
      multichannel: ok("multichannel", "Multi", reading("yes", 29.35, 830, 825.08)),
      channelsUsed: [ok("channel1", "Used Call centre", reading("yes", 30, 830, 825)), nm("channel2", "Used Branch", "journey_channel_c02 is not in this file.")],
      digitalMode: dist("digital", [["1", "App", 60], ["2", "Website", 25], ["3", "Both app and website", 15]]),
      transferred: ok("transferred", "Transferred", reading("yes", 29.75, 830, 825.08)),
      repeatInfo: nm("repeatInfo", "Had to repeat information", "journey_repeat_info is not in this file."),
      paths: { status: "ok", rows: [{ path: "3>1", text: "Digital self service > Call centre", contacts: 2, share: 12.5, weighted: 100, raw: 101 }], distinct: [{ channels: 1, share: 70.6, raw: 586 }, { channels: 2, share: 29.4, raw: 244 }], weightedBase: 825.08, rawBase: 830, flagMismatches: 0, others: 150 },
      companyCsat: { all: ok("companyCsatAll", "all", reading("t2b", 55.72, 985, 984.4)), recent: ok("companyCsatRecent", "recent", reading("t2b", 57.1, 818, 813.2)), note: "Company satisfaction is a customer-level score." },
      options: { companies: [], tasks: [], channels: [] },
      applied: { text: "Recent tasks (journey_recent30 = 1)", filters: [] },
    },
  });
}

type Req = { section: string; company: string | null; task: string | null; journeyChannel: string | null };
const calls: { request: Req; resolve: (v: unknown) => void }[] = [];
vi.mock("@/lib/csmExtensionExport", async () => await import("../csmExtensionExport"));
vi.mock("@/lib/csmExtensionActions", () => ({
  loadCsmExtensionAction: (_run: string, _doc: string, request: Req) => new Promise((resolve) => calls.push({ request, resolve })),
}));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null; value?: string };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let doc: { createElement(t: string): unknown; body: { appendChild(n: unknown): unknown; replaceChildren(): void } };
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let Sections: (p: { runId: string; documentId: string; section: string; company: string | null; companyLabel: string }) => unknown;

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
  Sections = (await import("../../app/runs/[id]/CsmExtensionSections")).CsmExtensionSections as typeof Sections;
}, 30000);

const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const q = (sel: string) => [...body.querySelectorAll(sel)];
const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => await new Promise((r) => setTimeout(r, 2)));
};
const answer = async (i: number, view: CsmExtensionView) => act(async () => calls[i].resolve({ ok: true, view }));
async function choose(testId: string, value: string) {
  const el = q(`[data-testid="${testId}"]`)[0];
  if (!el) throw new Error(`no select ${testId}: ${text().slice(0, 600)}`);
  // React reads the new value from the event target.
  Object.defineProperty(el, "value", { value, configurable: true });
  await act(async () => void el.dispatchEvent(new EventCtor("change", { bubbles: true })));
}

async function mount(props: { section: string; company: string | null; companyLabel: string }): Promise<Root> {
  doc.body.replaceChildren();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(createElement(Sections as never, { runId: "r", documentId: "d1", ...props })));
  return root;
}

describe("CSM extension sections (mounted)", () => {
  let root: Root | null = null;
  afterEach(async () => {
    if (root) await act(() => root!.unmount());
    root = null;
    calls.length = 0;
  });

  it("Journey: bases, pending beside completion, the population change labelled, Not measured with its reason", async () => {
    root = await mount({ section: "journey", company: "1", companyLabel: "FNB" });
    expect(calls[0].request).toEqual({ section: "journey", company: "1", task: null, journeyChannel: null, dataWave: null });
    expect(text()).toContain("Calculating this section");
    await answer(0, journeyView(74.801697));
    await settle();
    const t = text();
    expect(t).toContain("Completed (known outcomes)74.8%");
    expect(t).toContain("Pending beside it: 8.0% of all outcomes");
    expect(t).toContain("n = 763 · weighted 758.8");
    expect(t).toContain("10 don't know excluded");
    expect(t).toContain("Had to repeat information: not measured");
    expect(t).toContain("journey_repeat_info is not in this file.");
    expect(t).not.toMatch(/Had to repeat information0\.0%/);
    expect(t).toContain("Customers with a recent task (journey filter: a different population)");
    expect(t).toContain("Digital self service > Call centre");
    expect(t).toContain("Sample Current customers");
    expect(t).toContain("Company FNB");
    expect(q('[data-testid="csmx-file"]').map((f) => f.getAttribute("data-grain"))).toEqual(["relationship", "noncustomer"]);
    expect(t).toContain("No channel file is labelled Wave 1 in this project.");
  });

  it("the task filter sends the raw code, and a late answer to the earlier request never replaces the newer one", async () => {
    root = await mount({ section: "journey", company: null, companyLabel: "All customers" });
    await answer(0, journeyView(74.8));
    await settle();
    await choose("csmx-task", "4");
    expect(calls[1].request).toEqual({ section: "journey", company: null, task: "4", journeyChannel: null, dataWave: null });
    await choose("csmx-task", "1");
    expect(calls[2].request.task).toBe("1");
    // The newest request answers first, then the older one arrives late.
    await answer(2, journeyView(61.1));
    await settle();
    await answer(1, journeyView(33.3));
    await settle();
    expect(text()).toContain("Completed (known outcomes)61.1%");
    expect(text()).not.toContain("33.3%");
  });

  it("Competitive and noncustomers: the sample selector shows one profile at a time, separately", async () => {
    root = await mount({ section: "competitive", company: null, companyLabel: "All customers" });
    const fig = (id: string, label: string, v: number, n: number, stat: CsmReading["statistic"] = "mean5") => ok(id, label, reading(stat, v, n, n));
    await answer(
      0,
      baseView("competitive", {
        competitive: {
          benchmark: {
            customer: ok("benchmark", "gap", reading("mean_gap", -0.005267, 184, 179.57)),
            recorded: { asked: 830, comparable: 194, noComparableUse: 636 },
            noncomparable: 10,
            byChannel: [{ code: "1", label: "Call centre", figure: nm("benchmark-c1", "Call centre only", "Not measured: no single-channel Call centre journey has a comparable task") }],
            problems: [],
          },
          noncustomer: {
            status: "ok",
            filename: "Banking_CSM_Noncustomer_Wave_1.xlsx",
            focal: { code: "1", label: "FNB" },
            records: { inFile: 500, inSample: 500, leftOut: 0 },
            awareness: fig("awareness", "Aware of FNB", 91.2, 500, "yes"),
            consider: fig("consider", "Would consider FNB", 36.403509, 456, "t2b"),
            preferredChannel: { id: "pc", label: "pc", definition: "", status: "not_measured", reason: "expect_preferred_channel is not in this file." },
            attributes: [{ code: "d01", label: "Services work accurately and reliably", expected: fig("e1", "x", 3.958333, 456), importance: fig("i1", "x", 4.014228, 492), customerPerformance: fig("p1", "x", 3.9, 195) }],
            alternative: fig("alternative", "alt", 53.645833, 384, "t2b"),
            alternativeAsked: { recent: 384, notRecent: 116 },
            customerProfile: { status: "ok", filename: "rel", text: "Current customers of FNB: performance in the past three months (retrospective)." },
          },
        },
      }),
    );
    await settle();
    expect(text()).toContain("Main provider minus alternative (scale points)−0.01");
    expect(text()).toContain("Reported a comparable task with another provider: 194");
    expect(text()).toContain("Call centre: not measured");
    expect(text()).not.toContain("Aware of FNB");
    await choose("csmx-sample", "focal_noncustomers");
    await settle();
    const t = text();
    expect(t).toContain("Aware of FNB91.2%");
    expect(t).toContain("Would consider FNB (aware only)36.4%");
    expect(t).toContain("no gap is computed");
    expect(t).toContain("3.96 n = 456");
    expect(t).not.toContain("Main provider minus alternative");
    // The noncustomer profile has no company filter and no focal satisfaction or NPS.
    expect(t).not.toContain("Company All customers");
    expect(t).not.toMatch(/Net Promoter|satisfaction with FNB/i);
    // Switching the sample does not ask the server again (both profiles came in one answer).
    expect(calls.length).toBe(1);
  });
});
