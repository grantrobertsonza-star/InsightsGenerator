// R2P-F01: the Codebook's "Saved" is shown only for a save known to have succeeded, across the remount
// a successful save causes (remountConfirmation). MOUNTED tests of the actual CodebookPanel
// (react-dom/client in a linkedom document); the server actions are the mocked boundary and their
// answers are held so the order of response and remount is chosen by the test:
//   - a save still pending when the panel remounts shows nothing; a late refusal then shows the error in
//     the new panel with the researcher's draft put back; a late success shows Saved;
//   - a success the old panel already showed is still shown by the remount that follows it;
//   - a reload (a new page load) before the reply says the outcome is unknown, never Saved, and puts
//     the draft back; a success from a much earlier visit is not shown again;
//   - an ordinary refusal keeps the draft and a retry then saves; another document's panel is untouched;
//   - B35-F01: wording typed in the remounted panel while the earlier save is out is never replaced by
//     that save's drafts when it is refused late, and a late success does not touch it either.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { parseHTML } from "linkedom";

const saveMeta = vi.fn();
vi.mock("@/lib/codingAnalysisActions", () => ({
  saveCodeMetaAction: (...a: unknown[]) => saveMeta(...a),
  suggestThemesAction: vi.fn(),
  restoreCodebookVersionAction: vi.fn(),
}));

type El = {
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El> & Iterable<El>;
  dispatchEvent(event: unknown): boolean;
  value?: string;
  textContent: string | null;
  type?: string;
  setAttribute(n: string, v: string): void;
};
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let container: El;
let root: Root | null = null;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
const storage = new Map<string, string>();

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(window, "sessionStorage", {
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    configurable: true,
  });
  Object.defineProperty(document, "oninput", { value: null, writable: true, configurable: true });
  g.window = window;
  g.document = document;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.Event = window.Event;
  g.CustomEvent = (window as unknown as { CustomEvent: unknown }).CustomEvent;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  EventCtor = window.Event as unknown as typeof EventCtor;
  act = ((await import("react")) as unknown as { act: typeof act }).act;
  createRoot = ((await import("react-dom/client")) as unknown as { createRoot: typeof createRoot }).createRoot;
  container = document.getElementById("app") as unknown as El;
}, 30000);

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  saveMeta.mockReset();
  storage.clear();
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const code = (id: string, name: string) => ({
  id, name, definition: `${name} definition`, inclusion_criteria: "", exclusion_criteria: "",
  reproduced_runs: null, total_runs: null, turns: 1, speakers: 1, theme: "", note: "", keywords: "",
});
const codebook = (documentId = "doc-1") => ({
  runId: "run-1", documentId, version: 2, source: "edited" as const, createdAt: "2026-10-26T00:00:00Z",
  codes: [code(`${documentId}-c1`, "Trust"), code(`${documentId}-c2`, "Cost")], participantTurns: 4, codedTurns: 4, versions: [], passes: null,
});

type Panel = ComponentType<{ codebook: ReturnType<typeof codebook>; reapply: () => Promise<{ ok: true }> }>;
async function load(): Promise<Panel> {
  return (await import("../../app/runs/[id]/CodebookPanel")).default as unknown as Panel;
}
/** Mounts a fresh panel, as the remount a revalidation causes (a new key, same props). */
async function mountPanel(Panel: Panel, key: string, documentId = "doc-1") {
  if (!root) root = createRoot(container);
  await act(() => root!.render(createElement(Panel, { key, codebook: codebook(documentId), reapply: async () => ({ ok: true as const }) })));
}
const themeInput = () => {
  const input = container.querySelector("input[list]")!;
  if (!input.type) input.setAttribute("type", "text");
  return input;
};
async function typeTheme(text: string) {
  const input = themeInput();
  await act(async () => {
    let proto = Object.getPrototypeOf(input);
    while (proto && !Object.getOwnPropertyDescriptor(proto, "value")) proto = Object.getPrototypeOf(proto);
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, text);
    input.dispatchEvent(new EventCtor("input", { bubbles: true }));
    input.dispatchEvent(new EventCtor("change", { bubbles: true }));
  });
}
const saveButton = () => [...container.querySelectorAll("button")].find((b) => /Save themes, keywords and notes|Saving\.\.\./.test(b.textContent ?? ""))!;
async function clickSave() {
  await act(async () => void saveButton().dispatchEvent(new EventCtor("click", { bubbles: true })));
}
const text = () => container.textContent ?? "";
// The confirmation is the success-coloured note beside the save button.
const savedShown = () => [...container.querySelectorAll("span.text-success")].some((s) => /^Saved/.test(s.textContent ?? ""));

describe("Codebook save confirmation (R2P-F01)", () => {
  it("a pending save is not confirmed by a remount; a late refusal shows the error and the draft in the new panel", async () => {
    const Panel = await load();
    const answer = deferred<unknown>();
    saveMeta.mockReturnValue(answer.promise);
    await mountPanel(Panel, "a");
    await typeTheme("Relationships");
    await clickSave();
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0][2][0]).toMatchObject({ name: "Trust", theme: "Relationships" });
    await mountPanel(Panel, "b");
    expect(savedShown()).toBe(false);
    expect(themeInput().value).toBe("");
    await act(async () => answer.resolve({ ok: false, error: "The codebook changed since you opened it." }));
    expect(savedShown()).toBe(false);
    expect(text()).toContain("The codebook changed since you opened it.");
    expect(themeInput().value).toBe("Relationships");
  });

  it("a pending save confirmed late shows Saved in the panel that replaced the one that sent it", async () => {
    const Panel = await load();
    const answer = deferred<unknown>();
    saveMeta.mockReturnValue(answer.promise);
    await mountPanel(Panel, "a");
    await typeTheme("Relationships");
    await clickSave();
    await mountPanel(Panel, "b");
    expect(savedShown()).toBe(false);
    await act(async () => answer.resolve({ ok: true, message: "Saved." }));
    expect(savedShown()).toBe(true);
  });

  it("a success shown before the remount it causes is still shown after it", async () => {
    const Panel = await load();
    saveMeta.mockResolvedValue({ ok: true, message: "Saved." });
    await mountPanel(Panel, "a");
    await typeTheme("Relationships");
    await clickSave();
    expect(savedShown()).toBe(true);
    await mountPanel(Panel, "b");
    expect(savedShown()).toBe(true);
    // Shown once: a later remount does not repeat it.
    await mountPanel(Panel, "c");
    expect(savedShown()).toBe(false);
  });

  it("an ordinary refusal keeps the draft, a retry saves, and another document's panel shows nothing", async () => {
    const Panel = await load();
    saveMeta.mockResolvedValueOnce({ ok: false, error: "Database unavailable." }).mockResolvedValueOnce({ ok: true, message: "Saved." });
    await mountPanel(Panel, "a");
    await typeTheme("Relationships");
    await clickSave();
    expect(text()).toContain("Database unavailable.");
    expect(themeInput().value).toBe("Relationships");
    expect(savedShown()).toBe(false);
    await clickSave();
    expect(savedShown()).toBe(true);
    expect(text()).not.toContain("Database unavailable.");
    await mountPanel(Panel, "other", "doc-2");
    expect(savedShown()).toBe(false);
  });
  // B35-F01 (Codex, batch 35 review): the remounted panel stays editable while the earlier save is out.
  it("a late refusal after newer edits keeps the newer edits, says so, and the newer edits then save", async () => {
    const Panel = await load();
    const answer = deferred<unknown>();
    saveMeta.mockReturnValueOnce(answer.promise).mockResolvedValueOnce({ ok: true, message: "Saved." });
    await mountPanel(Panel, "a");
    await typeTheme("FIRST_SUBMITTED");
    await clickSave();
    await mountPanel(Panel, "b");
    await typeTheme("NEW_UNSAVED_EDIT");
    await act(async () => answer.resolve({ ok: false, error: "The codebook changed since you opened it." }));
    expect(text()).toContain("The codebook changed since you opened it.");
    expect(text()).toContain("edits you have made since are kept");
    expect(themeInput().value).toBe("NEW_UNSAVED_EDIT");
    expect(savedShown()).toBe(false);
    await clickSave();
    expect(saveMeta.mock.calls[1][2][0]).toMatchObject({ name: "Trust", theme: "NEW_UNSAVED_EDIT" });
    expect(savedShown()).toBe(true);
  });

  it("a late success after newer edits shows Saved for the earlier save and keeps the newer edits unsaved", async () => {
    const Panel = await load();
    const answer = deferred<unknown>();
    saveMeta.mockReturnValue(answer.promise);
    await mountPanel(Panel, "a");
    await typeTheme("FIRST_SUBMITTED");
    await clickSave();
    await mountPanel(Panel, "b");
    await typeTheme("NEW_UNSAVED_EDIT");
    await act(async () => answer.resolve({ ok: true, message: "Saved." }));
    expect(savedShown()).toBe(true);
    expect(themeInput().value).toBe("NEW_UNSAVED_EDIT");
  });

  it("a reload before the reply says the outcome is unknown, never Saved, and puts the draft back", async () => {
    const Panel = await load();
    saveMeta.mockReturnValue(new Promise(() => {}));
    await mountPanel(Panel, "a");
    await typeTheme("Relationships");
    await clickSave();
    await act(() => root!.unmount());
    root = null;
    // A new page load: a fresh module instance, the same session storage. Last in the file, because
    // resetting modules also gives later tests a second copy of React.
    vi.resetModules();
    const Reloaded = await load();
    await mountPanel(Reloaded, "reloaded");
    expect(savedShown()).toBe(false);
    expect(text()).toContain("may not have been saved");
    expect(themeInput().value).toBe("Relationships");
  });

});
