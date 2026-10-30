// R5 CSM segment, MOUNTED tests of the actual TrackerDashboardPanel opened as the CSM dashboard, in a linkedom document;
// the server actions are the mocked boundary and their answers are held, so the order of the answers is chosen by the
// test:
//   - the CSM dashboard's Segment chip is the brand dashboard's picker (SegmentPicker.tsx), not static text; Apply sends
//     the segment (codes) with the "csm" kind;
//   - switching segments quickly: an earlier segment's late answer is ignored;
//   - every tile and card names the segment with its base, and the cards say "customers in the segment";
//   - remembered per browser under tracker-segment:<runId>:csm, apart from the brand dashboard's segment.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { parseHTML } from "linkedom";

const overviewAction = vi.fn();
vi.mock("@/lib/trackerDashboardActions", () => ({
  loadBrandOverviewAction: (...a: unknown[]) => overviewAction(...a),
  loadBrandMomentsAction: vi.fn(),
  loadBrandAssociationsAction: vi.fn(),
  loadBrandAdvertisingAction: vi.fn(),
  loadBrandAudienceAction: vi.fn(),
  loadCategoryOverviewAction: vi.fn(),
  saveTrackerChoicesAction: vi.fn(),
  resetTrackerChoicesAction: vi.fn(),
}));

vi.mock("@/lib/variableSearch", async () => await import("../variableSearch"));

type El = {
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El> & Iterable<El>;
  dispatchEvent(event: unknown): boolean;
  textContent: string | null;
  getAttribute(n: string): string | null;
};
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let container: El;
let body: El;
let root: Root | null = null;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
const stored = new Map<string, string>();
let storageThrows = false;

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k: string) => {
        if (storageThrows) throw new Error("blocked");
        return stored.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (storageThrows) throw new Error("blocked");
        stored.set(k, v);
      },
      removeItem: (k: string) => void stored.delete(k),
    },
    configurable: true,
  });
  g.window = window;
  g.document = document;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.Event = window.Event;
  g.MouseEvent = window.Event;
  g.KeyboardEvent = (window as unknown as { KeyboardEvent?: unknown }).KeyboardEvent ?? window.Event;
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  g.IS_REACT_ACT_ENVIRONMENT = true;
  EventCtor = window.Event as unknown as typeof EventCtor;
  act = ((await import("react")) as unknown as { act: typeof act }).act;
  createRoot = ((await import("react-dom/client")) as unknown as { createRoot: typeof createRoot }).createRoot;
  container = document.getElementById("app") as unknown as El;
  body = document.body as unknown as El;
}, 30000);

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  overviewAction.mockReset();
  stored.clear();
  storageThrows = false;
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const QUESTIONS = [
  { variable: "gender", label: "Gender", answers: [{ code: "1", label: "Man" }, { code: "2", label: "Woman" }] },
  { variable: "segment", label: "Synthetic demonstration segment", answers: [{ code: "1", label: "Segment 1" }, { code: "2", label: "Segment 2" }, { code: "3", label: "Segment 3" }] },
];
const role = (variable: string | null) => ({ variable, source: "suggested" });
/** A CSM overview as the server sends it, with the satisfaction mean and segment given. */
function overview(mean: number, segment: { text: string; n: number } | null) {
  return {
    kind: "csm",
    view: {
      dashboard: {
        type: "csm",
        brands: [],
        nonBrandCodes: [],
        focalBrand: null,
        stages: [],
        csm: {
          overallSatisfaction: role("company_csat5"),
          recommend0to10: role("recommend_0to10"),
          likelyToStay: role("continue5"),
          likelyToSwitch: role("switch_0to10"),
          company: role(null),
          drivers: { variables: ["company_driver_d01", "company_driver_d02"], source: "suggested" },
        },
        weightVar: "weight",
        weighted: true,
        weightSource: "default",
        hidden: [],
        needsChoice: [],
      },
      revision: 1,
      choices: {},
      choicesFrom: null,
      resetAt: null,
      scope: "project",
      scopeKey: "project:00000000-0000-0000-0000-000000000001",
      scopeNames: ["Banking CSM"],
      storageAvailable: true,
      labelsCut: [],
    },
    wave: "Wave 2",
    figures: { documentId: "doc-1", weighted: true, weightVar: "weight", effectiveBase: null, stages: [], unresolvedStages: [], noFigures: null, segment: null },
    previous: { status: "none", reason: "This is the earliest wave of this project." },
    changes: [],
    suggestedComparators: [],
    stageTiles: [],
    stageCandidates: [],
    csm: [
      { id: "satisfaction", status: "ok", variable: "company_csat5", label: "Overall company satisfaction", mean, scaleTop: 5, box: 62.5, boxCodes: "top two", effectiveBase: 330, rawBase: 343, weightedBase: 339.3, byCompany: null },
      { id: "recommend", status: "ok", variable: "recommend_0to10", label: "Likelihood to recommend", nps: 4.2, lo: -3, hi: 11, promoters: 33.3, passives: 37.7, detractors: 29.1, base: 343, effectiveBase: 333, weightedBase: 339.3, byCompany: null },
      { id: "stay", status: "ok", variable: "continue5", label: "Intend to continue", mean: 3.9, scaleTop: 5, box: 70, boxCodes: "top two", effectiveBase: 330, rawBase: 343, weightedBase: 339.3, byCompany: null },
      { id: "switch", status: "ok", variable: "switch_0to10", label: "Switching", mean: null, scaleTop: 10, box: 20, boxCodes: "8 to 10", effectiveBase: 330, rawBase: 343, weightedBase: 339.3, byCompany: null },
      { id: "drivers", status: "ok", variable: "company_csat5", label: "Overall company satisfaction", method: "shapley", rSquared: 0.2, n: 257, cases: segment?.n ?? 1000, rows: [{ variable: "company_driver_d01", label: "Reliable", share: 0.6, rank: 1, coefficient: 0.3 }, { variable: "company_driver_d02", label: "Prompt", share: 0.4, rank: 2, coefficient: 0.2 }] },
    ],
    csmCandidates: [],
    csmCompany: null,
    csmChanges: [],
    timeline: [{ documentId: "doc-1", wave: "Wave 2", waveDate: null, status: "ok", satisfaction: { mean, effectiveBase: 330 } }],
    attributes: [
      { variable: "company_driver_d01", label: "Reliable", mean: 3.8, scaleTop: 5, effectiveBase: 320, rawBase: 330, weightedBase: 331 },
      { variable: "company_driver_d02", label: "Prompt", mean: 3.5, scaleTop: 5, effectiveBase: 320, rawBase: 330, weightedBase: 331 },
    ],
    segment: segment ? { questions: [], text: segment.text, filters: [], n: segment.n, weighted: segment.n, effectiveBase: segment.n - 10 } : null,
    segmentQuestions: QUESTIONS,
  };
}

type Panel = ComponentType<Record<string, unknown>>;
async function mount(runId = "run-1") {
  const Panel = (await import("../../app/runs/[id]/TrackerDashboardPanel")).default as unknown as Panel;
  if (!root) root = createRoot(container);
  await act(() => root!.render(createElement(Panel, { kind: "csm", runId, documentId: "doc-1", filename: "banking_w2.sav", onClose: () => {} })));
}
const click = async (el: El | null | undefined) => {
  if (!el) throw new Error("element not found");
  await act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
};
const q = (sel: string) => body.querySelector(sel);
const all = (sel: string) => [...body.querySelectorAll(sel)];
const text = () => body.textContent ?? "";
async function tick(variable: string, codes: string[]) {
  await click(all("[data-testid=tracker-segment-question]").find((b) => b.getAttribute("data-variable") === variable));
  for (const c of codes) await click(all("[data-testid=tracker-segment-answer]").find((b) => b.getAttribute("data-code") === c));
}

describe("Segment chip on the CSM dashboard (R5 CSM segment, mounted)", () => {
  it("the picker, not static text; Apply sends a two-question segment with the csm kind; a late answer is ignored; every tile and card names the segment", async () => {
    const first = deferred<unknown>();
    const two = deferred<unknown>();
    const man = deferred<unknown>();
    overviewAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(two.promise).mockReturnValueOnce(man.promise);
    await mount();
    expect(overviewAction.mock.calls[0]).toEqual(["run-1", "doc-1", "csm", null]);
    await act(async () => first.resolve({ ok: true, overview: overview(3.6, null) }));
    expect(text()).not.toContain("All segments");
    expect(q("[data-testid=tracker-segment-chip]")!.textContent).toContain("All eligible");
    expect(q("[data-testid=tracker-segment-base]")).toBeNull();
    expect(q("[data-testid=tracker-csm-trend]")!.textContent).toContain("all customers");

    await click(q("[data-testid=tracker-segment-chip]"));
    expect(all("[data-testid=tracker-segment-question]").map((b) => b.getAttribute("data-variable"))).toEqual(["gender", "segment"]);
    await tick("gender", ["2"]);
    await tick("segment", ["1", "3"]);
    await click(q("[data-testid=tracker-segment-apply]"));
    const twoQuestions = { questions: [{ variable: "gender", codes: ["2"] }, { variable: "segment", codes: ["1", "3"] }] };
    expect(overviewAction.mock.calls[1]).toEqual(["run-1", "doc-1", "csm", twoQuestions]);
    expect(JSON.parse(stored.get("tracker-segment:run-1:csm")!)).toEqual(twoQuestions);
    expect(stored.has("tracker-segment:run-1:brand")).toBe(false);

    // Switched to Man only before the first answer arrives.
    await click(q("[data-testid=tracker-segment-chip]"));
    await tick("gender", ["2", "1"]);
    await tick("segment", ["1", "3"]);
    await click(q("[data-testid=tracker-segment-apply]"));
    expect(overviewAction.mock.calls[2]).toEqual(["run-1", "doc-1", "csm", { questions: [{ variable: "gender", codes: ["1"] }] }]);
    await act(async () => man.resolve({ ok: true, overview: overview(3.4, { text: "Man", n: 480 }) }));
    await act(async () => two.resolve({ ok: true, overview: overview(3.9, { text: "Woman; Segment 1 or Segment 3", n: 351 }) }));
    expect(text()).toContain("Segment: Man; n=480");
    expect(text()).not.toContain("Segment: Woman");
    expect(text()).toContain("3.4 / 5");
    // Every tile (four) and card (trend, attributes, NPS, drivers) names the segment.
    expect(all("[data-testid=tracker-segment-base]").length).toBeGreaterThanOrEqual(8);
    expect(all("[data-testid=tracker-csm-tile]").every((t) => t.querySelector("[data-testid=tracker-segment-base]") !== null)).toBe(true);
    expect(q("[data-testid=tracker-csm-trend]")!.textContent).toContain("customers in the segment");
    expect(q("[data-testid=tracker-csm-nps]")!.textContent).toContain("customers in the segment");
    expect(q("[data-testid=tracker-drivers]")!.textContent).toContain("257 complete cases of 480 in the segment");
  });

  it("remembered under the csm key, apart from the brand dashboard's segment; a refused segment offers Clear the segment", async () => {
    stored.set("tracker-segment:run-1:brand", JSON.stringify({ questions: [{ variable: "gender", codes: ["1"] }] }));
    stored.set("tracker-segment:run-1:csm", JSON.stringify({ questions: [{ variable: "segment", codes: ["2"] }] }));
    overviewAction.mockResolvedValueOnce({ ok: false, error: "No respondent in this file is in the segment Segment 2 (n=0), so no figures can be shown. Change or clear the segment." });
    await mount();
    expect(overviewAction.mock.calls[0]).toEqual(["run-1", "doc-1", "csm", { questions: [{ variable: "segment", codes: ["2"] }] }]);
    expect(text()).toContain("No respondent in this file is in the segment Segment 2");
    overviewAction.mockResolvedValueOnce({ ok: true, overview: overview(3.6, null) });
    await click(q("[data-testid=tracker-segment-clear-failed]"));
    expect(overviewAction.mock.calls[1][3]).toBeNull();
    expect(stored.has("tracker-segment:run-1:csm")).toBe(false);
    expect(stored.get("tracker-segment:run-1:brand")).toBeDefined();
  });
});
