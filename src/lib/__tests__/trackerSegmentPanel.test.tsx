// R5 segment, MOUNTED tests of the actual TrackerDashboardPanel with its Segment chip (SegmentPicker.tsx), in a
// linkedom document; the server actions are the mocked boundary and their answers are held, so the order of the
// answers is chosen by the test:
//   - the picker lists the file's profile questions; Apply sends the segment (codes, never labels) to the overview;
//   - switching segments quickly: an answer computed for an earlier segment that arrives after the later one's is
//     ignored; the screen shows the later segment's figures and its base line on every card;
//   - the segment is remembered in this browser for the project and is sent on the next opening; storage that throws
//     leaves the dashboard on all eligible respondents;
//   - Clear goes back to all eligible respondents; a refused segment shows the reason with Clear the segment.
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
  { variable: "age_band", label: "Age group", answers: [{ code: "1", label: "18-24" }, { code: "2", label: "25-34" }] },
];
/** A brand overview as the server sends it, with the awareness share and segment given. */
function overview(share: number, segment: { text: string; n: number } | null) {
  const brands = [{ code: "8", label: "BMW" }];
  return {
    kind: "brand",
    view: {
      dashboard: {
        type: "brand",
        brands,
        nonBrandCodes: [],
        focalBrand: { code: "8", label: "BMW", source: "chosen" },
        stages: [{ group: "aware", label: "Awareness", stage: "awareness", source: "suggested" }],
        csm: {
          overallSatisfaction: { variable: null, source: "suggested" },
          recommend0to10: { variable: null, source: "suggested" },
          likelyToStay: { variable: null, source: "suggested" },
          likelyToSwitch: { variable: null, source: "suggested" },
          company: { variable: null, source: "suggested" },
          drivers: { variables: [], source: "suggested" },
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
      scopeNames: ["BMW car tracker"],
      storageAvailable: true,
      labelsCut: [],
    },
    wave: "Wave 1",
    figures: {
      documentId: "doc-1",
      weighted: true,
      weightVar: "weight",
      effectiveBase: 200,
      stages: [{ stage: "awareness", group: "aware", label: "Awareness", byBrand: [{ code: "8", variable: "aware_b08", share, base: segment?.n ?? 1000 }] }],
      unresolvedStages: [],
      noFigures: null,
      segment: null,
    },
    previous: { status: "none", reason: "This is the earliest wave of this project." },
    changes: [],
    suggestedComparators: ["8"],
    stageTiles: [{ stage: "awareness", status: "shown", groups: ["aware"] }],
    stageCandidates: [],
    csm: [],
    csmCandidates: [],
    csmCompany: null,
    csmChanges: [],
    timeline: [],
    attributes: [],
    segment: segment ? { questions: [], text: segment.text, filters: [], n: segment.n, weighted: segment.n, effectiveBase: segment.n - 10 } : null,
    segmentQuestions: QUESTIONS,
  };
}

type Panel = ComponentType<Record<string, unknown>>;
async function mount(runId = "run-1") {
  const Panel = (await import("../../app/runs/[id]/TrackerDashboardPanel")).default as unknown as Panel;
  if (!root) root = createRoot(container);
  await act(() => root!.render(createElement(Panel, { kind: "brand", runId, documentId: "doc-1", filename: "bmw.sav", onClose: () => {} })));
}
const click = async (el: El | null | undefined) => {
  if (!el) throw new Error("element not found");
  await act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
};
const q = (sel: string) => body.querySelector(sel);
const all = (sel: string) => [...body.querySelectorAll(sel)];
const text = () => body.textContent ?? "";
/** Opens the picker, ticks the given answers of one question (after clearing the draft's others) and applies. */
async function choose(variable: string, codes: string[]) {
  await click(q("[data-testid=tracker-segment-chip]"));
  await click(all("[data-testid=tracker-segment-question]").find((b) => b.getAttribute("data-variable") === variable));
  for (const c of codes) await click(all("[data-testid=tracker-segment-answer]").find((b) => b.getAttribute("data-code") === c));
  await click(q("[data-testid=tracker-segment-apply]"));
}

describe("Segment chip on the brand dashboard (R5, mounted)", () => {
  it("lists the profile questions; Apply sends codes; a late answer for an earlier segment is ignored", async () => {
    const first = deferred<unknown>();
    const woman = deferred<unknown>();
    const man = deferred<unknown>();
    overviewAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(woman.promise).mockReturnValueOnce(man.promise);
    await mount();
    expect(overviewAction.mock.calls[0]).toEqual(["run-1", "doc-1", "brand", null]);
    await act(async () => first.resolve({ ok: true, overview: overview(70, null) }));
    expect(q("[data-testid=tracker-segment-chip]")!.textContent).toContain("All eligible");
    expect(q("[data-testid=tracker-segment-base]")).toBeNull();

    await click(q("[data-testid=tracker-segment-chip]"));
    expect(all("[data-testid=tracker-segment-question]").map((b) => b.getAttribute("data-variable"))).toEqual(["gender", "age_band"]);
    await click(q("[data-testid=tracker-segment-chip]"));

    await choose("gender", ["2"]);
    expect(overviewAction.mock.calls[1]).toEqual(["run-1", "doc-1", "brand", { questions: [{ variable: "gender", codes: ["2"] }] }]);
    // The researcher switches to Man (and clears Woman) before Woman's figures arrive.
    await click(q("[data-testid=tracker-segment-chip]"));
    await click(all("[data-testid=tracker-segment-answer]").find((b) => b.getAttribute("data-code") === "2"));
    await click(all("[data-testid=tracker-segment-answer]").find((b) => b.getAttribute("data-code") === "1"));
    await click(q("[data-testid=tracker-segment-apply]"));
    expect(overviewAction.mock.calls[2]).toEqual(["run-1", "doc-1", "brand", { questions: [{ variable: "gender", codes: ["1"] }] }]);
    expect(q("[data-testid=tracker-segment-chip]")!.textContent).toContain("Man");

    await act(async () => man.resolve({ ok: true, overview: overview(64, { text: "Man", n: 480 }) }));
    expect(text()).toContain("Segment: Man; n=480");
    // Woman's answer arrives late: ignored, the screen keeps Man's figures.
    await act(async () => woman.resolve({ ok: true, overview: overview(81, { text: "Woman", n: 500 }) }));
    expect(text()).toContain("Segment: Man; n=480");
    expect(text()).not.toContain("Segment: Woman");
    expect(all("[data-testid=tracker-segment-base]").length).toBeGreaterThan(0);
    expect(JSON.parse(stored.get("tracker-segment:run-1:brand")!)).toEqual({ questions: [{ variable: "gender", codes: ["1"] }] });
  });

  it("remembered for the project in this browser; Clear goes back to all eligible; a refused segment offers Clear the segment", async () => {
    stored.set("tracker-segment:run-1:brand", JSON.stringify({ questions: [{ variable: "age_band", codes: ["2"] }] }));
    overviewAction.mockResolvedValueOnce({ ok: false, error: "The segment cannot be applied to this file: The segment question age_band is not in this file. Change or clear the segment." });
    await mount();
    expect(overviewAction.mock.calls[0][3]).toEqual({ questions: [{ variable: "age_band", codes: ["2"] }] });
    expect(text()).toContain("The segment question age_band is not in this file");
    overviewAction.mockResolvedValueOnce({ ok: true, overview: overview(70, null) });
    await click(q("[data-testid=tracker-segment-clear-failed]"));
    expect(overviewAction.mock.calls[1][3]).toBeNull();
    expect(stored.has("tracker-segment:run-1:brand")).toBe(false);
    expect(q("[data-testid=tracker-segment-chip]")!.textContent).toContain("All eligible");

    // Another project keeps its own segment (none here).
    overviewAction.mockResolvedValueOnce({ ok: true, overview: overview(70, null) });
    await act(() => root!.unmount());
    root = null;
    await mount("run-2");
    expect(overviewAction.mock.calls[2][3]).toBeNull();
  });

  it("storage that cannot be read or written leaves the dashboard on all eligible and the segment still applies now", async () => {
    storageThrows = true;
    overviewAction.mockResolvedValue({ ok: true, overview: overview(70, null) });
    await mount();
    expect(overviewAction.mock.calls[0][3]).toBeNull();
    await choose("age_band", ["1", "2"]);
    expect(overviewAction.mock.calls[1][3]).toEqual({ questions: [{ variable: "age_band", codes: ["1", "2"] }] });
    expect(q("[data-testid=tracker-segment-chip]")!.textContent).toContain("18-24 or 25-34");
  });
});
