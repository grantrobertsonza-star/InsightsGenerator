// Grant, 29 October 2026: the Brand tracking dashboard "shows the menu for a short while then goes". A refresh while
// a wave is read again unmounted the file's Analytics, and each workspace came back closed. useKeptOpen (the state
// AnalyticsBuilder's workspaces use) is MOUNTED here, react-dom/client in a linkedom document: a workspace opened,
// unmounted and mounted again is still open; another file or place starts closed; closing it clears it.
import { beforeAll, describe, expect, it } from "vitest";
import { createElement, useEffect } from "react";
import { parseHTML } from "linkedom";

type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let container: { textContent: string | null };
let useKeptOpen: <T>(key: string, closed: T) => [T, (v: T) => void];

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = document;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  act = ((await import("react")) as unknown as { act: typeof act }).act;
  createRoot = ((await import("react-dom/client")) as unknown as { createRoot: typeof createRoot }).createRoot;
  container = document.getElementById("app") as unknown as { textContent: string | null };
  useKeptOpen = (await import("../../app/runs/[id]/useKeptOpen")).useKeptOpen;
}, 30000);

let setter: ((v: string | null) => void) | null = null;
function Workspace({ place }: { place: string }) {
  const [open, setOpen] = useKeptOpen<string | null>(`${place}:tracker`, null);
  useEffect(() => {
    setter = setOpen;
  });
  return createElement("p", null, open ?? "closed");
}
async function mount(place: string) {
  const root = createRoot(container);
  await act(() => root.render(createElement(Workspace, { place })));
  return root;
}

describe("an open workspace survives its Analytics being unmounted", () => {
  it("opened, unmounted by a refresh, mounted again: still open; another file starts closed; closing clears it", async () => {
    let root = await mount("run:w1");
    expect(container.textContent).toBe("closed");
    await act(() => setter!("brand"));
    expect(container.textContent).toBe("brand");
    await act(() => root.unmount());
    root = await mount("run:w1");
    expect(container.textContent).toBe("brand");
    await act(() => root.unmount());
    root = await mount("run:w2");
    expect(container.textContent).toBe("closed");
    await act(() => root.unmount());
    root = await mount("run:w1");
    await act(() => setter!(null));
    await act(() => root.unmount());
    root = await mount("run:w1");
    expect(container.textContent).toBe("closed");
    await act(() => root.unmount());
  });
});
