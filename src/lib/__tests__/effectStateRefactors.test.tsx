// Batch 29 (lint to zero errors): six react-hooks/set-state-in-effect findings were fixed by moving the
// state that follows a value out of effects (React's "adjust state while rendering" pattern) and by
// reading browser-only values through useSyncExternalStore. These MOUNTED tests (react-dom/client in a
// linkedom document, as importVariablesHydration.test.ts) hold the behaviour the effects provided:
//   - ClaimTableChecks: a late first load for an earlier project never replaces the current project's
//     claims;
//   - CodingProgressBar: switching it off drops the progress shown; switching it on again shows nothing
//     until the first poll answers (no previous work flashed back);
//   - CrosstabFilters: choosing another variable clears the previous one's ticks; a late answer list for
//     the earlier variable is dropped;
//   - RunSectionProvider: a ?section= link opens that section and is remembered; without a link the
//     section remembered for the run opens; an unknown one falls back to the default; a choice made in
//     the page wins and is remembered.
// Mocked boundaries: the server actions and fetch. ProcessProgress (useFormStatus inside a form) and
// RunNav's portals are left to the browser suite, which exercises both on every run page.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { parseHTML } from "linkedom";

const loadClaims = vi.fn();
vi.mock("@/lib/claimTableChecksActions", () => ({
  loadClaimChecksAction: (...a: unknown[]) => loadClaims(...a),
  checkClaimsAction: vi.fn(),
  resetClaimChecksAction: vi.fn(),
}));
const loadCategories = vi.fn();
vi.mock("@/lib/crosstabActions", () => ({ loadCategoriesAction: (...a: unknown[]) => loadCategories(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/sectionIcons", () => ({ SectionIcon: () => null }));
vi.mock("@/components/openSection", () => ({ publishOpenSection: vi.fn() }));

type El = {
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El> & Iterable<El>;
  dispatchEvent(event: unknown): boolean;
  checked?: boolean;
  value?: string;
  textContent: string | null;
};
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let container: El;
let root: Root | null = null;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
const storage = new Map<string, string>();
const place = { pathname: "/runs/run-1", search: "" };

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(window, "location", { value: place, configurable: true });
  Object.defineProperty(window, "sessionStorage", {
    value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
    configurable: true,
  });
  // React chooses the "input" event for text fields only where the document reports supporting it.
  Object.defineProperty(document, "oninput", { value: null, writable: true, configurable: true });
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
}, 30000);

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  loadClaims.mockReset();
  loadCategories.mockReset();
  storage.clear();
  place.search = "";
  vi.unstubAllGlobals();
});

async function mount(el: unknown) {
  if (!root) root = createRoot(container);
  await act(() => root!.render(el));
}
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const claim = (id: string, text: string) => ({ finding_id: id, finding_text: text, finding_kind: null, stance: "silent", datasets: [], nothingFound: true });

describe("ClaimTableChecks", () => {
  it("a late first load for an earlier project does not replace the current project's claims", async () => {
    const Checks = (await import("../../app/runs/[id]/ClaimTableChecks")).default as unknown as ComponentType<{ runId: string }>;
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    loadClaims.mockImplementation((runId: string) => (runId === "run-a" ? first.promise : second.promise));
    await mount(createElement(Checks, { runId: "run-a" }));
    await mount(createElement(Checks, { runId: "run-b" }));
    await act(async () => second.resolve({ ok: true, claims: [claim("b1", "Claim of project B")] }));
    await act(async () => first.resolve({ ok: true, claims: [claim("a1", "Claim of project A")] }));
    expect(container.textContent).toContain("Claim of project B");
    expect(container.textContent).not.toContain("Claim of project A");
  });
});

describe("CodingProgressBar", () => {
  it("switching off drops the progress; switching on again shows nothing until the first poll answers", async () => {
    const Bar = (await import("../../app/runs/[id]/CodingProgressBar")).default as unknown as ComponentType<{ runId: string; active: boolean }>;
    const entry = (label: string) => ({ documentId: "d1", label, done: 1, total: 4, updatedAt: Date.now(), estimatedRemainingMs: null });
    let answer = deferred<unknown>();
    vi.stubGlobal("fetch", vi.fn(() => answer.promise));
    await mount(createElement(Bar, { runId: "run-1", active: true }));
    await act(async () => answer.resolve({ ok: true, json: async () => ({ progress: [entry("Earlier pass")] }) }));
    expect(container.textContent).toContain("Earlier pass");
    await mount(createElement(Bar, { runId: "run-1", active: false }));
    expect(container.textContent).toBe("");
    answer = deferred<unknown>();
    await mount(createElement(Bar, { runId: "run-1", active: true }));
    expect(container.textContent).not.toContain("Earlier pass");
    await act(async () => answer.resolve({ ok: true, json: async () => ({ progress: [entry("New pass")] }) }));
    expect(container.textContent).toContain("New pass");
  });
});

describe("CrosstabFilters", () => {
  it("choosing another variable clears the previous ticks; a late answer list for the earlier variable is dropped", async () => {
    const Filters = (await import("../../app/runs/[id]/CrosstabFilters")).default as unknown as ComponentType<Record<string, unknown>>;
    const dict = {
      variables: [
        { name: "gender", label: "Gender", numeric: false, labelled: true, nDistinct: 2 },
        { name: "region", label: "Region", numeric: false, labelled: true, nDistinct: 2 },
      ],
    };
    const genderAnswers = deferred<unknown>();
    const regionAnswers = deferred<unknown>();
    loadCategories.mockImplementation((_r: string, _d: string, v: string) => (v === "gender" ? genderAnswers.promise : regionAnswers.promise));
    const props = { runId: "run-1", documentId: "doc-1", dict, value: [], onChange: vi.fn() };
    await mount(createElement(Filters, props));
    const typeName = async (name: string) => {
      const input = container.querySelector("input[list]")! as El & { type: string; setAttribute(n: string, v: string): void };
      // A browser reports an input without a type attribute as type "text"; linkedom reports "", which
      // React does not treat as a text field. Stated here so React sees what a browser gives it.
      if (!input.type) input.setAttribute("type", "text");
      await act(async () => {
        // The prototype's setter, as a browser's typing does: React's own value tracker is not updated,
        // so it sees the change and calls onChange.
        let proto = Object.getPrototypeOf(input);
        while (proto && !Object.getOwnPropertyDescriptor(proto, "value")) proto = Object.getPrototypeOf(proto);
        const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
        if (setter) setter.call(input, name);
        else input.value = name;
        input.dispatchEvent(new EventCtor("input", { bubbles: true }));
        input.dispatchEvent(new EventCtor("change", { bubbles: true }));
      });
    };
    await typeName("gender");
    await act(async () => genderAnswers.resolve({ ok: true, list: { categories: [{ label: "Male" }, { label: "Female" }] } }));
    const box = container.querySelector('input[type="checkbox"]')!;
    await act(async () => void box.dispatchEvent(new EventCtor("click", { bubbles: true })));
    expect(container.querySelector('input[type="checkbox"]')!.checked).toBe(true);
    await typeName("region");
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    await act(async () => regionAnswers.resolve({ ok: true, list: { categories: [{ label: "North" }, { label: "South" }] } }));
    const boxes = [...container.querySelectorAll('input[type="checkbox"]')];
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect(container.textContent).toContain("North");
    expect(container.textContent).not.toContain("Male");
  });
});

describe("RunSectionProvider", () => {
  async function shownSection(validIds?: string[]) {
    const { RunSectionProvider, useRunSection } = await import("../../app/runs/[id]/RunShell");
    let pick: (id: string) => void = () => {};
    function Probe() {
      const { selected, setSelected } = useRunSection();
      pick = setSelected;
      return createElement("p", { id: "shown" }, selected);
    }
    await mount(<RunSectionProvider defaultId="dashboard" validIds={validIds}><Probe /></RunSectionProvider>);
    return { text: () => container.querySelector("#shown")!.textContent, pick: (id: string) => act(async () => pick(id)) };
  }
  const key = "run-section:/runs/run-1";

  it("a ?section= link opens that section and is remembered", async () => {
    place.search = "?section=analytics";
    const s = await shownSection(["dashboard", "analytics"]);
    expect(s.text()).toBe("analytics");
    expect(storage.get(key)).toBe("analytics");
  });

  it("without a link the remembered section opens; an unknown one falls back to the default", async () => {
    storage.set(key, "import");
    expect((await shownSection(["dashboard", "import"])).text()).toBe("import");
    await act(() => root!.unmount());
    root = null;
    storage.set(key, "gone");
    expect((await shownSection(["dashboard", "import"])).text()).toBe("dashboard");
  });

  it("a section chosen in the page wins over the link and is remembered", async () => {
    place.search = "?section=analytics";
    const s = await shownSection(["dashboard", "analytics", "import"]);
    await s.pick("import");
    expect(s.text()).toBe("import");
    expect(storage.get(key)).toBe("import");
  });
});
