// P2a repair, IMP-005 (correction picker reload/reselect). MOUNTED component test: the actual
// ImportVariablesPanel is mounted with react-dom/client into a linkedom document (linkedom is
// already a direct project dependency; nothing was installed), then RE-RENDERED in the same root
// with different props - the exact instance reuse the Import detail pane performs when the
// researcher selects another file (SelectedFileDetail renders the selected row's panel in one
// fixed tree position, and after a reload auto-selects the first listed file).
//
// Mocked boundary: only the save server action (saveVariableOverrideAction), so persistence
// timing and success/failure are controlled. dataQuality, variableOverrideTypes and
// ImportQualityPanel are the real modules (mapped below because this repo has no Vitest alias
// configuration).
//
// Not established here: a real browser, Next's router/refresh behaviour, or the native save ->
// hard reload -> reselect sequence against PostgreSQL (P2a G8). Those remain browser checks.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { parseHTML } from "linkedom";

const saveMock = vi.fn();
vi.mock("@/lib/variableOverrideActions", () => ({
  saveVariableOverrideAction: (...args: unknown[]) => saveMock(...args),
}));
vi.mock("@/lib/dataQuality", async () => await import("../dataQuality"));
vi.mock("@/lib/variableOverrideTypes", async () => await import("../variableOverrideTypes"));
vi.mock("@/lib/statedRouting", () => ({}));
vi.mock("@/lib/variableOverrides", () => ({}));

// The small slice of the linkedom DOM these checks read; typed here rather than as `any`.
type El = {
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El> & Iterable<El>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  dispatchEvent(event: unknown): boolean;
  selected?: boolean;
  disabled?: boolean;
  value?: string;
  textContent: string | null;
};
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let Panel: ComponentType<{ runId: string; tables: unknown[] }>;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let container: El;
let root: Root | null = null;

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
  Panel = (await import("../../app/runs/[id]/ImportVariablesPanel")).default as unknown as typeof Panel;
  container = document.getElementById("app") as unknown as El;
}, 30000);

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  saveMock.mockReset();
});

// The P2a fixture's columns: Q1 (2) takes values 0..3; its saved correction is "continuous".
function rows() {
  return Array.from({ length: 40 }, (_, i) => ({
    RespondentID: String(i + 1).padStart(3, "0"),
    Q1: i % 2,
    "Q1 (3)": (i + 1) % 2,
    "Q1 (2)": i % 4,
  }));
}

function table(documentId: string, name: string, overrides: Record<string, { type?: string; questionType?: string }>) {
  return {
    id: `table-${documentId}`,
    documentId,
    documentName: name,
    label: null,
    tableIndex: 0,
    headers: ["RespondentID", "Q1", "Q1 (3)", "Q1 (2)"],
    rows: rows(),
    ingestionType: "raw" as const,
    overrides,
  };
}

const CSV = table("doc-csv", "cases.csv", {});
const XLSX_DOC = table("doc-xlsx", "sparse-dense.xlsx", { "Q1 (2)": { type: "continuous" } });

async function mount(tables: unknown[]) {
  if (!root) root = createRoot(container);
  await act(() => root!.render(createElement(Panel, { runId: "run-1", tables })));
}

function select(variable: string, field: "Data type" | "Question type" = "Data type"): El {
  const el = container.querySelector(`select[aria-label="${field}: ${variable}"]`);
  if (!el) throw new Error(`no ${field} select for ${variable}`);
  return el;
}

/** The value the researcher sees: the selected option (React drives option.selected for a
 *  controlled select). */
function shown(variable: string, field: "Data type" | "Question type" = "Data type"): string {
  const el = select(variable, field);
  const options = [...el.querySelectorAll("option")];
  const chosen = options.find((o) => o.selected) ?? options.find((o) => o.hasAttribute("selected"));
  return (chosen ? chosen.getAttribute("value") : el.value) ?? "";
}

async function choose(variable: string, value: string) {
  const el = select(variable);
  // linkedom's option.selected setter clears whichever option is currently selected, so only the
  // chosen option is set (setting the others to false would clear the choice again); its
  // select.value then reads that option, as a browser's does after a user pick.
  const option = [...el.querySelectorAll("option")].find((o) => o.getAttribute("value") === value);
  if (!option) throw new Error(`no option ${value}`);
  option.selected = true;
  await act(async () => {
    el.dispatchEvent(new EventCtor("change", { bubbles: true }));
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("correction picker hydration (P2a, IMP-005)", () => {
  it("reproduction: reselecting another file in the same panel instance shows that file's saved correction; siblings keep their own values", async () => {
    await mount([CSV]);
    const inferredQ12 = shown("Q1 (2)");
    const inferredQ1 = shown("Q1");
    const inferredQ13 = shown("Q1 (3)");
    expect(inferredQ12).not.toBe("continuous"); // the inferred type the bug kept showing

    await mount([XLSX_DOC]); // same root and position: the detail pane's reselect
    expect(shown("Q1 (2)")).toBe("continuous");
    expect(shown("Q1")).toBe(inferredQ1);
    expect(shown("Q1 (3)")).toBe(inferredQ13);

    await mount([CSV]); // and back: the CSV file has no correction, so nothing leaks across files
    expect(shown("Q1 (2)")).toBe(inferredQ12);
  });

  it("a fresh mount with saved overrides shows them (initial hydration)", async () => {
    await mount([XLSX_DOC]);
    expect(shown("Q1 (2)")).toBe("continuous");
  });

  it("a newer unsaved edit is not overwritten by older props, and its failure is reported without reverting it", async () => {
    const pending = deferred<{ ok: true } | { ok: false; error: string }>();
    saveMock.mockReturnValue(pending.promise);
    await mount([XLSX_DOC]);
    await choose("Q1 (2)", "categorical");
    expect(saveMock).toHaveBeenCalledWith("run-1", "doc-xlsx", "Q1 (2)", { type: "categorical" });
    expect(shown("Q1 (2)")).toBe("categorical");
    expect(select("Q1 (2)").disabled).toBe(true); // in flight

    // Props re-arrive unchanged (save deliberately does not refresh them): still the old saved value.
    await mount([table("doc-xlsx", "sparse-dense.xlsx", { "Q1 (2)": { type: "continuous" } })]);
    expect(shown("Q1 (2)")).toBe("categorical");

    await act(async () => {
      pending.resolve({ ok: false, error: "Could not verify \"Q1 (2)\" against this file right now" });
      await pending.promise;
    });
    expect(shown("Q1 (2)")).toBe("categorical");
    expect(container.textContent).toContain("Could not verify");
    expect(select("Q1 (2)").disabled).toBe(false);
  });

  it("a local edit survives switching to another file and back (state is document-scoped, not lost on reselect)", async () => {
    saveMock.mockResolvedValue({ ok: true });
    await mount([XLSX_DOC]);
    await choose("Q1 (2)", "categorical");
    await mount([CSV]);
    expect(shown("Q1 (2)")).not.toBe("categorical");
    await mount([XLSX_DOC]); // props still pre-save
    expect(shown("Q1 (2)")).toBe("categorical");
  });

  it("withholds correction controls and shows recovery for an unverified cached workbook", async () => {
    await mount([{ ...XLSX_DOC, previewError: "Stored preview cannot be verified. Re-upload the corrected file." }]);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelector('[data-testid="import-preview-recovery"]')?.textContent).toContain("Re-upload");
  });

  it("changing one field keeps the other field's saved correction in the save's starting point", async () => {
    saveMock.mockResolvedValue({ ok: true });
    await mount([table("doc-xlsx", "sparse-dense.xlsx", { "Q1 (2)": { type: "continuous", questionType: "single" } })]);
    expect(shown("Q1 (2)", "Question type")).toBe("single");
    await choose("Q1 (2)", "categorical");
    expect(shown("Q1 (2)")).toBe("categorical");
    expect(shown("Q1 (2)", "Question type")).toBe("single");
  });
});
