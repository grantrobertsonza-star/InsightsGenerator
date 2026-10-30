// R5 waves: the brand tracking dashboard MOUNTED (react-dom/client in a linkedom document). The server actions are the
// mocked boundary (their figures and changes are tested against the engine in trackerWaveChange.db.test.ts); answers
// are held so the test chooses their order:
//   - the Wave chip is a selector of the included waves in order (the excluded wave named as left out), "Compare
//     with" defaults to the previous wave, and the change is shown against it with a significance mark and its line;
//   - switching quickly from Wave 3 to Wave 2 to Wave 1: Wave 1's answer arrives first, Wave 2's late; the late answer
//     never replaces the newer choice; the page (Brand associations) and the Compare selection are kept;
//   - a wave whose figures fail shows the failure with Try again while the choices stay usable, and another wave
//     still loads;
//   - Compare with: None is sent to the loaders and the page says no change is shown.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";

const W = [
  { documentId: "aaaaaaaa-0000-4000-8000-000000000001", wave: "Wave 1", filename: "w1.sav", waveDate: "2026-02" },
  { documentId: "aaaaaaaa-0000-4000-8000-000000000002", wave: "Wave 2", filename: "w2.sav", waveDate: "2026-06" },
  { documentId: "aaaaaaaa-0000-4000-8000-000000000003", wave: "Wave 3", filename: "w3.sav", waveDate: "2026-10" },
];
const BROKEN = "aaaaaaaa-0000-4000-8000-0000000000ff";
const AWARE = [60.25, 62.5, 70.75];
const at = (doc: string) => W.findIndex((w) => w.documentId === doc);
const waves = (doc: string) => ({ included: W, excluded: [{ documentId: "p", wave: "Pilot", filename: "p.sav", waveDate: "2025-11" }], orderText: "Waves in order of fieldwork date.", undated: [], current: at(doc) });
function compared(doc: string, compare: string) {
  const i = at(doc);
  if (compare === "none") return { status: "off", reason: "Compare with: None, so no change is shown." };
  const j = compare === "previous" ? i - 1 : at(compare);
  if (j < 0) return { status: "none", reason: "This is the earliest wave of this project." };
  return { status: "ok", ...W[j] };
}
const TEST = { line: "Change marked when a two-sample test on effective bases gives p < 0.05; not adjusted for multiple comparisons.", note: "Weights enter through each wave's effective base (Kish).", failed: null };
function overviewFor(doc: string, compare: string) {
  const i = at(doc);
  const c = compared(doc, compare);
  const prevShare = c.status === "ok" ? AWARE[at((c as { documentId: string }).documentId)] : null;
  const change = prevShare === null ? null : AWARE[i] - prevShare;
  return {
    kind: "brand",
    view: {
      dashboard: { brands: [{ code: "8", label: "BMW" }, { code: "1", label: "Toyota" }], focalBrand: { code: "8", label: "BMW", source: "chosen" }, needsChoice: [], weighted: true, weightVar: "weight", weightSource: "default", stages: [], hidden: [], csm: { overallSatisfaction: { variable: null }, recommend0to10: { variable: null }, likelyToStay: { variable: null }, likelyToSwitch: { variable: null }, company: { variable: null }, drivers: { variables: [] } } },
      revision: 1, choices: {}, choicesFrom: null, resetAt: null, scope: "programme", scopeKey: "programme:x", scopeNames: [], storageAvailable: true, labelsCut: [],
    },
    wave: W[i].wave,
    figures: { documentId: doc, weighted: true, weightVar: "weight", effectiveBase: 900, unresolvedStages: [], noFigures: null, stages: [{ stage: "awareness", group: "aware", label: "Awareness", byBrand: [{ code: "8", variable: "aware_b08", share: AWARE[i], base: 1000 }, { code: "1", variable: "aware_b01", share: 80, base: 1000 }] }] },
    previous: c.status === "ok" ? { status: "ok", documentId: (c as { documentId: string }).documentId, wave: (c as { wave: string }).wave, filename: "x" } : c,
    changes: [{ stage: "awareness", code: "8", current: AWARE[i], previous: prevShare, changePp: change, ...(change === null ? { reason: "No earlier wave." } : { test: { status: "tested", z: 3.2, p: 0.0014, significant: true, direction: 1, method: "pooled_effective_base" } }) }],
    suggestedComparators: ["8", "1"],
    stageTiles: [{ stage: "awareness", status: "shown", groups: ["aware"] }],
    stageCandidates: [], csm: [], csmCandidates: [], csmCompany: null, csmChanges: [],
    timeline: W.slice(0, i + 1).map((w, k) => ({ documentId: w.documentId, wave: w.wave, waveDate: w.waveDate, status: "ok", stages: [{ stage: "awareness", group: "aware", label: "Awareness", byBrand: [{ code: "8", variable: "aware_b08", share: AWARE[k], base: 1000 }] }] })),
    attributes: [], waves: waves(doc), compareWith: compare, compareTest: c.status === "ok" ? TEST : null,
  };
}
function associationsFor(doc: string, compare: string) {
  const i = at(doc);
  const c = compared(doc, compare);
  return {
    documentId: doc, weighted: true, weightVar: "weight", dashboard: { brands: [{ code: "8", label: "BMW" }], focalBrand: { code: "8", label: "BMW", source: "chosen" } },
    profile: { status: "ok", awareness: { group: "aware", label: "Awareness" }, bases: [{ code: "8", variable: "aware_b08", awareCode: "1", n: 800, effectiveBase: 700 }], attributes: [{ group: "a01", item: "Reliable", cells: [{ code: "8", variable: "attr_a01_b08", share: 40 + i, base: 800 }] }] },
    waveChange: {
      compared: c, waves: waves(doc),
      changes: c.status === "ok" ? { "attr_a01_b08|8": { current: 40 + i, previous: 39, changePp: 1 + i, test: { status: "tested", z: 0.5, p: 0.6, significant: false, direction: 0, method: "pooled_effective_base" } } } : null,
      test: c.status === "ok" ? TEST : null,
    },
    trend: { brand: { code: "8", label: "BMW" }, attributes: [{ variable: "attr_a01_b08", item: "Reliable" }], waves: W.slice(0, i + 1).map((w, k) => ({ ...w, status: "ok", cells: { attr_a01_b08: { share: 40 + k, base: 800 } } })) },
  };
}

const calls: { action: string; doc: string; compare: unknown }[] = [];
const held: { doc: string; release: () => void }[] = [];
let holdAnswers = false;
const hold = async (doc: string) => {
  if (holdAnswers) await new Promise<void>((release) => held.push({ doc, release }));
};
vi.mock("@/lib/trackerDashboardActions", () => ({
  loadBrandOverviewAction: async (_r: string, doc: string, _k: string, compare: string) => {
    calls.push({ action: "overview", doc, compare });
    await hold(doc);
    if (doc === BROKEN || at(doc) < 0) return { ok: false, error: "The data file's variables could not be read: not found" };
    return { ok: true, overview: overviewFor(doc, compare ?? "previous") };
  },
  loadBrandAssociationsAction: async (_r: string, doc: string, compare: string) => {
    calls.push({ action: "associations", doc, compare });
    await hold(`assoc:${doc}`);
    return { ok: true, associations: associationsFor(doc, compare ?? "previous") };
  },
  loadBrandMomentsAction: async () => ({ ok: false, error: "not used" }),
  loadBrandAdvertisingAction: async () => ({ ok: false, error: "not used" }),
  loadBrandAudienceAction: async () => ({ ok: false, error: "not used" }),
  loadCategoryOverviewAction: async () => ({ ok: false, error: "not used" }),
  saveTrackerChoicesAction: async () => ({ ok: false, error: "not used" }),
  resetTrackerChoicesAction: async () => ({ ok: false, error: "not used" }),
}));
vi.mock("@/lib/variableSearch", async () => await import("../variableSearch"));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; querySelector(s: string): El | null; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null; value?: string };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let Panel: unknown;

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = document;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.Event = window.Event;
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  g.IS_REACT_ACT_ENVIRONMENT = true;
  EventCtor = window.Event as unknown as typeof EventCtor;
  act = ((await import("react")) as unknown as { act: typeof act }).act;
  createRoot = ((await import("react-dom/client")) as unknown as { createRoot: typeof createRoot }).createRoot;
  body = document.body as unknown as El;
  Panel = (await import("../../app/runs/[id]/TrackerDashboardPanel")).default;
}, 60000);

/** A container of its own for each mount (React refuses a second root on one container). */
const freshContainer = () => {
  const d = (globalThis as unknown as { document: { createElement(t: string): El; body: { appendChild(e: El): void } } }).document;
  const el = d.createElement("div");
  d.body.appendChild(el);
  return el;
};
const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const byTestId = (id: string) => [...body.querySelectorAll(`[data-testid="${id}"]`)];
const click = async (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)));
};
async function choose(testId: string, value: string) {
  const select = [...body.querySelectorAll("select")].find((x) => x.getAttribute("data-testid") === testId);
  if (!select) throw new Error(`no select ${testId}: ${text().slice(0, 1500)}`);
  Object.defineProperty(select, "value", { value, configurable: true });
  await act(async () => void select.dispatchEvent(new EventCtor("change", { bubbles: true })));
}
const selected = (testId: string) => [...body.querySelectorAll("select")].find((x) => x.getAttribute("data-testid") === testId)?.value;

describe("Brand tracking: switching waves and comparing (mounted)", () => {
  it("lists the waves, compares with the previous one by default, keeps the page on a switch, and never lets a late answer win", async () => {
    const root = createRoot(freshContainer());
    await act(() => root.render(createElement(Panel as never, { kind: "brand", runId: "r", documentId: W[2].documentId, filename: "w3.sav", onClose: () => {} })));
    await settle();
    const options = [...body.querySelectorAll('[data-testid="wave-select"] option')].map((o) => o.textContent);
    expect(options).toEqual(["Wave 1 (Feb 2026)", "Wave 2 (Jun 2026)", "Wave 3 (Oct 2026)"]);
    expect(text()).toContain("Left out of wave tracking: Pilot.");
    expect([...body.querySelectorAll('[data-testid="wave-compare-select"] option')].map((o) => o.textContent)).toEqual(["Previous wave (Wave 2)", "Wave 1", "None"]);
    expect(text()).toContain("Change against Wave 2, in points from unrounded figures.");
    expect(text()).toContain(TEST.line);
    // The significance mark: an arrow and bold type with words for assistive technology, not colour alone.
    const badge = byTestId("tracker-kpi-change-badge")[0];
    expect(badge.getAttribute("data-state")).toBe("significant");
    expect(badge.textContent).toContain("▲ +8.3 pts");
    expect(badge.textContent).toContain("+8.3 points against Wave 2, significant at 95% (p = 0.001)");

    // Page 03, then Wave 2 and Wave 1 chosen quickly; Wave 1's answers arrive first, Wave 2's late.
    await click([...body.querySelectorAll("button")].find((b) => /Brand associations/.test(b.textContent ?? ""))!);
    await settle();
    expect(text()).toContain("BMW associations across waves");
    holdAnswers = true;
    await choose("wave-select", W[1].documentId);
    expect(text()).toContain("Loading Wave 2...");
    await choose("wave-select", W[0].documentId);
    const release = async (key: string) => {
      const h = held.find((x) => x.doc === key);
      if (!h) throw new Error(`nothing held for ${key}: ${held.map((x) => x.doc).join(", ")}`);
      h.release();
      await settle();
    };
    expect(held.map((h) => h.doc).filter((d) => !d.startsWith("assoc:"))).toEqual([W[1].documentId, W[0].documentId]);
    // The newer choice answers first; the earlier choice's answers arrive late and are dropped.
    await release(W[0].documentId);
    await release(`assoc:${W[0].documentId}`);
    await release(W[1].documentId);
    if (held.some((h) => h.doc === `assoc:${W[1].documentId}`)) await release(`assoc:${W[1].documentId}`);
    held.length = 0;
    holdAnswers = false;
    expect(selected("wave-select")).toBe(W[0].documentId);
    expect(text()).toContain("Brand associations");
    expect(text()).toContain("This is the earliest wave of this project.");
    expect(text()).not.toContain("Change against Wave 2");
    expect(text()).toContain("40.0%");
    // Every call after the switch carries the choice; nothing from Wave 2 is on screen.
    expect(calls.filter((c) => c.action === "associations").at(-1)).toMatchObject({ doc: W[0].documentId, compare: "previous" });

    // Back to Wave 3, compare with Wave 1, then None.
    await choose("wave-select", W[2].documentId);
    await settle();
    await choose("wave-compare-select", W[0].documentId);
    await settle();
    expect(calls.at(-1)).toMatchObject({ action: "associations", doc: W[2].documentId, compare: W[0].documentId });
    expect(text()).toContain("Change against Wave 1, in points from unrounded figures.");
    await choose("wave-compare-select", "none");
    await settle();
    expect(calls.filter((c) => c.action === "overview").at(-1)).toMatchObject({ compare: "none" });
    expect(text()).toContain("Compare with: None, so no change is shown.");
    await act(() => root.unmount());
  });

  it("a wave whose figures fail: the failure with Try again, the choices still on screen, and another wave still loads", async () => {
    const root = createRoot(freshContainer());
    await act(() => root.render(createElement(Panel as never, { kind: "brand", runId: "r", documentId: W[2].documentId, filename: "w3.sav", onClose: () => {} })));
    await settle();
    // A wave file that cannot be read (the list offers it; its read fails).
    W.push({ documentId: BROKEN, wave: "Wave 4", filename: "w4.sav", waveDate: "2027-02" });
    try {
      await choose("wave-select", W[2].documentId);
      await settle();
      await choose("wave-select", BROKEN);
      await settle();
      expect(text()).toContain("The dashboard could not be calculated: The data file's variables could not be read: not found");
      expect([...body.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(true);
      expect(byTestId("wave-selector-row").length).toBe(1);
      await choose("wave-select", W[1].documentId);
      await settle();
      expect(text()).toContain("Change against Wave 1, in points from unrounded figures.");
      expect(text()).not.toContain("could not be calculated");
    } finally {
      W.pop();
      await act(() => root.unmount());
    }
  });
});
