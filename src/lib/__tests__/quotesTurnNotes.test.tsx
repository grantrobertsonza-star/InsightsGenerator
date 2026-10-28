// Batch 60, Codex COD5K-F02: the Quotes tab's turn notes, MOUNTED (react-dom/client in a linkedom
// document); the server actions are the mocked boundary. A note is saved with the turn's text as the
// screen shows it (the server refuses it if the turn changed); notes whose turn changed are listed
// apart, word for word, never on the turn now at their old number; attaching sends the chosen turn and
// its shown text; removing asks first; an unreadable list says so instead of showing none. A failed
// read of the turn notes themselves is shown with Try again, pauses note editing, and is distinct from
// a transcript that has no notes.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { parseHTML } from "linkedom";

const saveNote = vi.fn();
const attach = vi.fn();
const clear = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// The @/ alias is not resolved by vitest here; the shared reason wording is the real module.
vi.mock("@/lib/setAsideNotes", async () => await import("../setAsideNotes"));
vi.mock("@/lib/codingAnalysisActions", () => ({
  saveTurnNoteAction: (...a: unknown[]) => saveNote(...a),
  attachOrphanTurnNoteAction: (...a: unknown[]) => attach(...a),
  clearOrphanTurnNoteAction: (...a: unknown[]) => clear(...a),
  addResearcherCodeAction: vi.fn(),
  changeTurnCodeAction: vi.fn(),
}));

type El = {
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El> & Iterable<El>;
  dispatchEvent(event: unknown): boolean;
  value?: string;
  textContent: string | null;
  disabled?: boolean;
  type?: string;
  setAttribute(n: string, v: string): void;
};
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let container: El;
let root: Root | null = null;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
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
  saveNote.mockReset();
  attach.mockReset();
  clear.mockReset();
  refresh.mockReset();
});

const verbatim = (index: number, text: string, note = "") => ({
  segmentId: `seg-${index}`, index, speaker: "Person", group: null, page: null, text, codeIds: [], researcherCodeIds: [], note,
});
const view = (orphanNotes: unknown, turnNotesError: string | null = null) => ({
  documentId: "doc-1",
  codebookId: "book-1",
  codes: [],
  verbatims: [verbatim(1, "The account service failed."), verbatim(3, "Something else entirely.")],
  orphanNotes,
  turnNotesError,
});
const orphan = {
  ref: "orphan:00000000-0000-4000-8000-000000000001", formerIndex: 3, note: "About the charge", reason: "turn_changed",
  writtenAt: "2026-10-01T00:00:00.000Z", segmentTextHash: "abc", turnText: "My second visit involved an unexpected charge.", setAsideAt: "2026-10-02T00:00:00.000Z",
};

type Tab = ComponentType<Record<string, unknown>>;
async function mount(orphanNotes: unknown, turnNotesError: string | null = null) {
  const QuotesTab = (await import("../../app/runs/[id]/QuotesTab")).default as unknown as Tab;
  const run = (fn: () => Promise<unknown>) => void fn();
  root = createRoot(container);
  await act(() => root!.render(createElement(QuotesTab, { runId: "run-1", view: view(orphanNotes, turnNotesError), run, busy: false })));
}
const buttons = (label: RegExp) => [...container.querySelectorAll("button")].filter((b) => label.test(b.textContent ?? ""));
const click = (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
async function type(input: El, text: string) {
  if (!input.type) input.setAttribute("type", "text");
  await act(async () => {
    let proto = Object.getPrototypeOf(input);
    while (proto && !Object.getOwnPropertyDescriptor(proto, "value")) proto = Object.getPrototypeOf(proto);
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, text);
    input.dispatchEvent(new EventCtor("input", { bubbles: true }));
  });
}
const text = () => container.textContent ?? "";

describe("Quotes tab turn notes (COD5K-F02)", () => {
  it("a note is saved with the turn's shown text, so the server can refuse a changed turn", async () => {
    saveNote.mockResolvedValue({ ok: true });
    await mount([]);
    await click(buttons(/Change themes/)[0]);
    await type(container.querySelector("textarea")!, "My note");
    await click(buttons(/^Save note$/)[0]);
    expect(saveNote).toHaveBeenCalledWith("run-1", "doc-1", 1, "My note", "The account service failed.");
  });

  it("a set-aside note is shown word for word, apart from the turns, and not as the note of the turn now at its number", async () => {
    await mount([orphan]);
    expect(text()).toContain("“About the charge”");
    expect(text()).toContain("Written on turn 4; that turn now holds different words.");
    expect(text()).not.toContain("Your note: About the charge");
    expect(text()).toContain("Turn 4 now says: “Something else entirely.”");
    expect(text()).toContain("That turn said: “My second visit involved an unexpected charge.”");
  });

  it("a set-aside note whose turn words were not kept says so", async () => {
    await mount([{ ...orphan, turnText: null }]);
    expect(text()).toContain("The words of that turn were not kept.");
    expect(text()).not.toContain("That turn said");
  });

  it("attach sends the chosen turn and the text shown for it; a turn number that does not exist cannot be chosen", async () => {
    attach.mockResolvedValue({ ok: true });
    await mount([orphan]);
    const input = container.querySelector("section input")!;
    await type(input, "9");
    expect(buttons(/^Attach$/)[0].disabled).toBe(true);
    expect(text()).toContain("There is no participant turn 9 to attach it to.");
    await type(input, "2");
    await click(buttons(/^Attach$/)[0]);
    expect(attach).toHaveBeenCalledWith("run-1", "doc-1", orphan.ref, 1, "The account service failed.");
  });

  it("removing asks first; Keep cancels and nothing is sent", async () => {
    clear.mockResolvedValue({ ok: true });
    await mount([orphan]);
    await click(buttons(/^Remove\.\.\.$/)[0]);
    expect(text()).toContain("Remove this note for good?");
    await click(buttons(/^Keep$/)[0]);
    expect(clear).not.toHaveBeenCalled();
    await click(buttons(/^Remove\.\.\.$/)[0]);
    await click(buttons(/^Remove$/)[0]);
    expect(clear).toHaveBeenCalledWith("run-1", "doc-1", orphan.ref);
  });

  it("set-aside notes that could not be read are reported with Try again, not shown as none", async () => {
    await mount(null);
    expect(text()).toContain("Notes set aside from changed turns could not be read. None has been removed; try again.");
    await click(buttons(/^Try again$/)[0]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("turn notes that could not be read: a visible failure with Try again, and no note can be typed over the unknown one", async () => {
    await mount([], "Your notes on turns could not be read just now. They have not been removed; try again.");
    expect([...container.querySelectorAll("[role=alert]")].map((a) => a.textContent)).toEqual([
      "Your notes on turns could not be read just now. They have not been removed; try again.Try again",
    ]);
    await click(buttons(/Change themes/)[0]);
    expect(container.querySelector("textarea[placeholder^='An analytical note']")).toBeNull();
    expect(buttons(/^Save note$/)).toHaveLength(0);
    expect(text()).toContain("Notes cannot be edited until they can be read again");
    await click(buttons(/^Try again$/)[0]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a transcript with no notes and nothing set aside shows no failure and lets a note be written", async () => {
    await mount([]);
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
    expect(text()).not.toContain("could not be read");
    await click(buttons(/Change themes/)[0]);
    expect(buttons(/^Save note$/)).toHaveLength(1);
  });
});
