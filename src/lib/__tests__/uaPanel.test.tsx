import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { UaWorkspace } from "../uaDashboards";
import type { UaPage } from "../uaTypes";
const actions = vi.hoisted(() => ({ workspace: vi.fn(), page: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/uaActions", () => ({ loadUaWorkspaceAction: (...a: unknown[]) => actions.workspace(...a), loadUaPageAction: (...a: unknown[]) => actions.page(...a), saveUaChoicesAction: (...a: unknown[]) => actions.save(...a) }));
vi.mock("@/lib/uaTypes", async () => await import("../uaTypes"));
let act: (cb: () => unknown) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLElement; let doc: Document; let EventCtor: typeof Event;
beforeAll(async () => {
  const parsed = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(parsed.document, "oninput", { value: null, writable: true, configurable: true });
  for (const name of ["window", "document", "HTMLElement", "Node", "Event", "CustomEvent"]) g[name] = name === "window" ? parsed.window : name === "document" ? parsed.document : (parsed.window as unknown as Record<string, unknown>)[name];
  g.IS_REACT_ACT_ENVIRONMENT = true; doc = parsed.document as unknown as Document; EventCtor = parsed.window.Event as unknown as typeof Event;
  act = (await import("react")).act as typeof act; createRoot = (await import("react-dom/client")).createRoot;
  container = doc.getElementById("app")!;
});
afterEach(async () => { if (root) await act(() => root!.unmount()); root = null; vi.clearAllMocks(); });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const workspace = (): UaWorkspace => ({ recognition: { recognised: true, needsMapping: false, fields: [], reasons: [], questions: [], brands: [], roles: {}, analysisWeight: "weight", populationWeight: null }, choices: { focalBrand: null, weighted: true, roleCorrections: {}, lightUserMaximum: null }, revision: null, scope: "project:x", storageAvailable: true, metrics: [{ page: "footprint" }, { page: "needs" }] as UaWorkspace["metrics"], unavailable: [] });
const response = (page: "footprint" | "needs", label: string) => ({ ok: true as const, page: { page, documentId: "doc", weightVar: "weight", unavailable: [], metrics: [{ spec: { id: label, label, page, sourceQuestionIds: ["Q1"], kind: "percent", unit: "percent", reason: "Declared question", period: "P3M", variable: "v" }, result: { id: label, value: 42, numerator: 42, assignedBase: { n: 100, w: 100, nEff: 90 }, eligibleBase: { n: 100, w: 100, nEff: 90 }, validBase: { n: 100, w: 100, nEff: 90 }, suppressed: false, reason: null, designApplied: false } }] } as UaPage, comparison: { status: "none" as const, reason: "Earliest wave" } });
async function mount() {
  const Panel = (await import("../../app/runs/[id]/UaDashboardPanel")).default;
  root = createRoot(container); await act(() => root!.render(createElement(Panel, { runId: "run", initialDocumentId: "doc", waveFiles: [], onClose: vi.fn() })));
}
const button = (text: string) => Array.from(doc.querySelectorAll("button")).find(b => b.textContent?.includes(text))!;

describe("mounted U&A panel navigation and late replies", () => {
  it("keeps the later page when the earlier page answers last; missing inputs are labelled", async () => {
    const earlier = deferred<ReturnType<typeof response>>(); actions.workspace.mockResolvedValue({ ok: true, view: workspace() });
    actions.page.mockImplementation((_run: string, _doc: string, page: string) => page === "footprint" ? earlier.promise : Promise.resolve(response("needs", "Current attitude")));
    await mount(); await act(() => button("Needs, emotions").dispatchEvent(new EventCtor("click", { bubbles: true })));
    expect(doc.body.textContent).toContain("Current attitude");
    await act(() => earlier.resolve(response("footprint", "Stale footprint")));
    expect(doc.body.textContent).not.toContain("Stale footprint"); expect(doc.body.textContent).toContain("Current attitude");
    expect(doc.body.textContent).toContain("Not asked in this file");
  });
  it("exposes an ambiguous study as a mapping question without publishing guessed figures", async () => {
    const view = workspace(); view.recognition.recognised = false; view.recognition.needsMapping = true;
    view.recognition.questions = [{ role: "everConsumption", reason: "Choose the category-ever question.", candidates: ["a", "b"] }];
    view.recognition.fields = ["a", "b"].map(variable => ({ variable, label: `Candidate ${variable}`, questionId: "Q17", options: [], meta: { stateVariable: "state", fieldRole: "Survey response" } }));
    actions.workspace.mockResolvedValue({ ok: true, view }); actions.page.mockResolvedValue({ ok: false, error: "Resolve the question mapping first." });
    const Tile = (await import("../../app/runs/[id]/UaDashboardTile")).default;
    root = createRoot(container); await act(() => root!.render(createElement(Tile, { runId: "run", documentId: "doc", waveFiles: [] })));
    await act(() => button("review question mapping").dispatchEvent(new EventCtor("click", { bubbles: true })));
    expect(doc.querySelector('[aria-label="Question for everConsumption"]')).toBeTruthy();
    expect(doc.body.textContent).toContain("Choose the category-ever question");
    expect(doc.querySelectorAll('[data-testid="ua-metric"]')).toHaveLength(0);
  });
  it("shows Saved only after a successful save and surfaces a refused save", async () => {
    actions.workspace.mockResolvedValue({ ok: true, view: workspace() }); actions.page.mockResolvedValue(response("footprint", "Current footprint"));
    const saved = deferred<{ ok: true; result: { saved: false; reason: string } }>(); actions.save.mockReturnValue(saved.promise);
    await mount(); await act(() => button("Save choices").dispatchEvent(new EventCtor("click", { bubbles: true })));
    expect(doc.querySelector('[role="status"]')?.textContent).not.toBe("Saved");
    await act(() => saved.resolve({ ok: true, result: { saved: false, reason: "Someone else saved first. Reload." } }));
    expect(doc.querySelector('[role="alert"]')?.textContent).toContain("Someone else saved first");
    expect(doc.body.textContent).not.toContain("Saved");
  });
});
