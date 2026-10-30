// The Conversion view of the brand dashboard's funnel card (ConversionView.tsx), MOUNTED (react-dom/client in a
// linkedom document). The server action is the mocked boundary: its answers are BrandConversion values held so the
// test chooses their order. The ranking and headline are the real display rules (trackerConversionDisplay.ts).
//   - the switch: Funnel pressed by default, Conversion when chosen;
//   - one chart per step, brands ranked by the unrounded figure, the client's brand marked, value labels, the
//     headline with the rank among brands with a figure and the count left out; a suppressed brand shows its base
//     (n=8), never 0%, and is last; the non-nested note and the unknown answers note; skipped steps listed; the table
//     with every base; a bar's base on hover and focus (title and aria-label);
//   - a late answer for an earlier load never replaces the newer one (refreshKey changed while the first was pending);
//   - a failed calculation says why and "Try again" recovers.
//   - switching to another data file while the first file's answer is pending: the first file's answer, arriving
//     later, never replaces the second's; a brand whose later stage was not read shows n/a (never 0) for its unknown
//     answers, and a long brand name is shown in full (wrapped, not cut).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { BrandConversion } from "../trackerConversion";
import type { ConversionCell } from "../trackerConversionDisplay";

vi.mock("@/lib/trackerConversionDisplay", async () => await import("../trackerConversionDisplay"));

const held: { resolve: (v: unknown) => void }[] = [];
vi.mock("@/lib/trackerConversionActions", () => ({
  loadBrandConversionAction: () => new Promise((resolve) => held.push({ resolve })),
}));

const BRANDS = [
  { code: "1", label: "Toyota" },
  { code: "2", label: "Ford" },
  { code: "8", label: "BMW" },
  { code: "9", label: "Kia" },
];
const cell = (code: string, conversion: number | null, extra: Partial<ConversionCell> = {}): ConversionCell => ({
  code, fromVariable: `a_${code}`, toVariable: `b_${code}`, conversion, base: 400, weightedBase: 400, weightedConverted: conversion === null ? null : conversion * 4,
  atFrom: 400, converted: conversion === null ? null : Math.round(conversion * 4), unknownAtTo: [], noAnswerAtTo: 0, nonNested: 0, suppressed: false, ...extra,
});
function answer(bmwFirstStep: number): BrandConversion {
  return {
    documentId: "d",
    weighted: true,
    weightVar: "weight",
    effectiveBase: 812,
    minBase: 10,
    dashboard: { brands: BRANDS, focalBrand: { code: "8", label: "BMW", source: "chosen" } },
    conversion: {
      status: "ok",
      skipped: [{ from: "usage", to: "frequent_usage", status: "not_measured", reason: "Usage to Frequent usage: no frequent usage question was found in this file." }],
      steps: [
        {
          from: "awareness", to: "consideration", bridged: [], label: "Awareness to Consideration",
          fromQuestion: { group: "aware", label: "Prompted awareness" }, toQuestion: { group: "consider", label: "Consideration" },
          cells: [cell("1", 67.2), cell("2", 40.04, { nonNested: 40 }), cell("8", bmwFirstStep, { unknownAtTo: [{ code: "9", label: "Don't know", kind: "non_answer", n: 30 }] }), cell("9", 52.5)],
        },
        {
          from: "consideration", to: "shortlist", bridged: [], label: "Consideration to Shortlist",
          fromQuestion: { group: "consider", label: "Consideration" }, toQuestion: { group: "shortlist", label: "Shortlist" },
          cells: [cell("1", 47.9), cell("2", 45.1), cell("8", 51.7), cell("9", null, { suppressed: true, base: 8, reason: "Suppressed for a small base: 8 respondents, under the minimum of 10." })],
        },
      ],
    },
  };
}

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; querySelector(s: string): El | null; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let container: El;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let View: typeof import("../../app/runs/[id]/ConversionView");

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
  container = document.getElementById("app") as unknown as El;
  body = document.body as unknown as El;
  View = await import("../../app/runs/[id]/ConversionView");
}, 30000);

const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const all = (s: string) => [...body.querySelectorAll(s)];
const click = async (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => await new Promise((r) => setTimeout(r, 2)));
};
const answerWith = async (i: number, value: unknown) => {
  held[i].resolve(value);
  await settle();
};

describe("Conversion view (mounted)", () => {
  it("the switch: Funnel by default, Conversion when chosen", async () => {
    const root = createRoot(container);
    let value: "funnel" | "conversion" = "funnel";
    const render = () => root.render(createElement(View.FunnelViewSwitch, { value, onChange: (v) => { value = v; render(); } }));
    await act(() => render());
    const pressed = () => all("button").map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`);
    expect(pressed()).toEqual(["Funnel:true", "Conversion:false"]);
    await click(all("button")[1]);
    expect(pressed()).toEqual(["Funnel:false", "Conversion:true"]);
    await act(() => root.unmount());
  });

  it("ranked charts per step, headline, suppressed base, notes and table; a late earlier answer never replaces the newer one; failure and Try again", async () => {
    held.length = 0;
    const root = createRoot(container);
    await act(() => root.render(createElement(View.ConversionView, { runId: "r", documentId: "d", refreshKey: 1 })));
    expect(text()).toContain("Calculating conversion between stages");

    // A reload of the dashboard (refreshKey) while the first answer is on its way: the second answer is shown, and
    // the first, arriving later, is ignored.
    await act(() => root.render(createElement(View.ConversionView, { runId: "r", documentId: "d", refreshKey: 2 })));
    expect(held).toHaveLength(2);
    await answerWith(1, { ok: true, conversion: answer(39.4) });
    await answerWith(0, { ok: true, conversion: answer(11.1) });
    expect(text()).toContain("BMW converts 39% of aware respondents to consideration, 4th of 4 brands.");
    expect(text()).not.toContain("11.1%");

    const steps = all("[data-testid=tracker-conversion-step]");
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["awareness:consideration", "consideration:shortlist"]);
    const bars = (i: number) => [...steps[i].querySelectorAll("[data-testid=tracker-conversion-bar]")];
    expect(bars(0).map((b) => `${b.getAttribute("data-code")} ${b.querySelector("[data-testid=tracker-conversion-value]")!.textContent}`)).toEqual(["1 67.2%", "9 52.5%", "2 40.0%", "8 39.4%"]);
    expect(bars(0).filter((b) => b.getAttribute("data-focal") === "true").map((b) => b.getAttribute("data-code"))).toEqual(["8"]);
    // Suppressed: last, its base instead of a figure, not ranked, and said in the headline.
    expect(bars(1).map((b) => `${b.getAttribute("data-code")} ${b.querySelector("[data-testid=tracker-conversion-value]")!.textContent}`)).toEqual(["8 51.7%", "1 47.9%", "2 45.1%", "9 n=8"]);
    expect(steps[1].querySelector("[data-testid=tracker-conversion-headline]")!.textContent).toBe("BMW converts 52% of considering respondents to shortlist, 1st of 3 brands; 1 brand not ranked (1 small base).");
    // The base on hover and focus.
    const bmw = bars(0)[3];
    expect(bmw.getAttribute("tabindex")).toBe("0");
    expect(bmw.getAttribute("title")).toContain("base n=400");
    expect(bmw.getAttribute("aria-label")).toContain("30 unknown at the later stage, outside the base");
    // Notes: non-nested, unknown answers, skipped steps.
    expect(steps[0].querySelector("[data-testid=tracker-conversion-nonnested]")!.textContent).toContain("Ford 40 at consideration without awareness");
    expect(steps[0].querySelector("[data-testid=tracker-conversion-unknown]")!.textContent).toContain("BMW 30");
    expect(body.querySelector("[data-testid=tracker-conversion-skipped]")!.textContent).toContain("no frequent usage question");
    // The table: every brand of every step with its base.
    const rows = [...body.querySelectorAll("[data-testid=tracker-conversion-table] tbody tr")];
    expect(rows).toHaveLength(8);
    expect(rows[7].textContent).toContain("small base");
    expect(rows[7].textContent).toContain("8");
    expect(text()).toContain("Weighted by weight");
    expect(text()).toContain("no significance tests");

    // Failure, then Try again.
    await act(() => root.render(createElement(View.ConversionView, { runId: "r", documentId: "d", refreshKey: 3 })));
    await answerWith(2, { ok: false, error: "The data file's variables could not be read: gone" });
    expect(body.querySelector("[data-testid=tracker-conversion-failed]")!.textContent).toContain("The data file's variables could not be read: gone");
    await click(all("button").find((b) => b.textContent === "Try again")!);
    await answerWith(3, { ok: true, conversion: answer(39.4) });
    expect(body.querySelector("[data-testid=tracker-conversion-failed]")).toBeNull();
    expect(all("[data-testid=tracker-conversion-step]")).toHaveLength(2);
    await act(() => root.unmount());
  });

  it("another data file while the first is pending: only the second file's answer is shown; a cell not read reads n/a, never 0; long brand names in full", async () => {
    held.length = 0;
    const root = createRoot(container);
    await act(() => root.render(createElement(View.ConversionView, { runId: "r", documentId: "doc-a", refreshKey: 1 })));
    await act(() => root.render(createElement(View.ConversionView, { runId: "r", documentId: "doc-b", refreshKey: 1 })));
    expect(held).toHaveLength(2);
    const second = answer(39.4);
    second.documentId = "doc-b";
    second.dashboard = { ...second.dashboard, brands: [...BRANDS.slice(0, 3), { code: "9", label: "Kia Motors Corporation South Africa" }] };
    if (second.conversion.status !== "ok") throw new Error("fixture");
    // Kia not asked at the later stage of the first step: no base, so its unknown answers are not known.
    second.conversion.steps[0].cells[3] = cell("9", null, { base: null, converted: null, noAnswerAtTo: null, nonNested: null, weightedBase: null, reason: "Not asked about this brand. (the later stage)" });
    await answerWith(1, { ok: true, conversion: second });
    await answerWith(0, { ok: true, conversion: answer(11.1) });
    expect(text()).not.toContain("11.1%");
    expect(text()).toContain("BMW converts 39% of aware respondents to consideration, 3rd of 3 brands; 1 brand not ranked (1 not available).");
    const kiaRow = [...body.querySelectorAll("[data-testid=tracker-conversion-table] tbody tr")][3];
    const kiaCells = [...kiaRow.querySelectorAll("td")].map((c) => c.textContent);
    // Brand, Conversion, Base, At earlier, At both, Unknown at later, No answer at later, At later only.
    expect(kiaCells).toEqual(["Kia Motors Corporation South Africa", "n/a", "n/a", "400", "n/a", "n/a", "n/a", "n/a"]);
    const names = all("[data-testid=tracker-conversion-brand]");
    expect(names.some((el) => el.textContent === "Kia Motors Corporation South Africa")).toBe(true);
    expect(names.every((el) => !(el.getAttribute("class") ?? "").split(/\s+/).includes("truncate"))).toBe(true);
    await act(() => root.unmount());
  });
});
