// Page 02's moment by brand card and Moment reach card MOUNTED (react-dom/client in a linkedom document). The server
// actions are the mocked boundary (loadMomentProfileAction, loadMomentReachAction answer with stated figures, held
// when the test chooses their order); the view rules are the real module (src/lib/momentProfileView.ts):
//   - the card opens on "Recall table" (today's view); "Moment profile" loads and draws one line per brand, the
//     client's brand plus the four compared, moments on the x axis in category relevance order; the choice is
//     remembered per data file and survives a remount; storage that throws leaves the card working on the default;
//   - the brand picker: five brands drawn, the others disabled; one removed, another can be added; never six;
//   - an n/a value is not drawn (no point) and is listed with its reason and base; the table lists every value;
//   - switching data file: a late answer for the earlier file never replaces the newer file's profile;
//   - Moment reach: the headline for the client's brand, ranked bars, re-ranked by another measure.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { parseHTML } from "linkedom";
import type { MomentProfile } from "../trackerMomentProfile";
import type { MomentReach } from "../trackerMomentReach";
import type { BrandMoments } from "../trackerMoments";

vi.mock("@/lib/momentProfileView", async () => await import("../momentProfileView"));

const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "BMW"].map((label, i) => ({ code: String(i + 1), label }));
const FOCAL = "7";
const MOMENTS = [
  { group: "cep_c01", item: "Replacing an unreliable car" },
  { group: "cep_c02", item: "Reducing fuel and running costs" },
  { group: "cep_c03", item: "Feeling safer on the road" },
];
/** A profile whose every value is `offset` + brand code + moment index; Kia at moment 2 suppressed (base 8). */
function profileOf(documentId: string, offset: number): MomentProfile {
  return {
    documentId,
    weighted: true,
    weightVar: "weight",
    dashboard: { brands: BRANDS, focalBrand: BRANDS[6] } as unknown as MomentProfile["dashboard"],
    profile: {
      status: "ok",
      awareness: { group: "aware", label: "Brands heard of" },
      bases: BRANDS.map((b) => ({ code: b.code, variable: `aware_b0${b.code}`, awareCode: "1", n: 500 + Number(b.code), effectiveBase: 450 })),
      moments: MOMENTS.map((m, j) => ({
        ...m,
        cells: BRANDS.map((b) =>
          b.code === "5" && j === 1
            ? { code: b.code, variable: `${m.group}_b05`, share: null, base: 8, reason: "Suppressed for a small base." }
            : { code: b.code, variable: `${m.group}_b0${b.code}`, share: offset + Number(b.code) + j, base: 500 },
        ),
      })),
    },
  };
}
const moments: BrandMoments = {
  documentId: "doc-a",
  weighted: true,
  weightVar: "weight",
  effectiveBase: 900,
  // Relevance puts "Feeling safer" first, then "Replacing", then "Reducing".
  relevance: {
    status: "ok",
    group: "relevant",
    label: "Relevant",
    moments: [
      { variable: "relevant_c03", item: "Feeling safer on the road", gridGroup: "cep_c03", share: 71.2, base: 1000 },
      { variable: "relevant_c01", item: "Replacing an unreliable car", gridGroup: "cep_c01", share: 65.2, base: 1000 },
      { variable: "relevant_c02", item: "Reducing fuel and running costs", gridGroup: "cep_c02", share: 60.1, base: 1000 },
    ],
  },
  recall: { status: "not_measured", reason: "n/a in this test" },
};
const reach: MomentReach = {
  documentId: "doc-a",
  weighted: true,
  weightVar: "weight",
  dashboard: { brands: BRANDS, focalBrand: BRANDS[6] } as unknown as MomentReach["dashboard"],
  reach: {
    status: "ok",
    moments: 12,
    eligible: 1000,
    shareWithheld: null,
    brands: BRANDS.map((b, i) => ({
      code: b.code,
      perPerson: [2.5, 2.1, 1.9, 1.7, 1.2, 1.1, 1.84][i],
      penetration: [60, 50, 55, 45, 40, 35, 42.4][i],
      perLinker: [4.2, 4.2, 3.5, 3.8, 3, 3.1, 4.3][i],
      shareOfLinks: [20, 17, 15, 14, 10, 9, 15][i],
      base: 1000,
      effectiveBase: 960,
      noneValid: 0,
      partlyValid: 0,
      linkers: 400,
      momentsAsked: 12,
    })),
  },
};

const held: { doc: string; release: () => void }[] = [];
let hold = false;
vi.mock("@/lib/trackerDashboardActions", () => ({
  loadMomentProfileAction: async (_run: string, documentId: string) => {
    if (hold) await new Promise<void>((release) => held.push({ doc: documentId, release }));
    return { ok: true, profile: profileOf(documentId, documentId === "doc-b" ? 40 : 10) };
  },
  loadMomentReachAction: async () => ({ ok: true, reach }),
}));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; querySelector(s: string): El | null; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null; hasAttribute(n: string): boolean };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let container: El;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let Card: (p: Record<string, unknown>) => unknown;
let Reach: (p: Record<string, unknown>) => unknown;
const store = new Map<string, string>();
let storageThrows = false;

beforeAll(async () => {
  const { window, document } = parseHTML("<!doctype html><html><body><div id=app></div></body></html>");
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = document;
  g.HTMLElement = window.HTMLElement;
  g.Node = window.Node;
  g.Event = window.Event;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      if (storageThrows) throw new Error("SecurityError: storage blocked");
      return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    },
  });
  EventCtor = window.Event as unknown as typeof EventCtor;
  act = ((await import("react")) as unknown as { act: typeof act }).act;
  createRoot = ((await import("react-dom/client")) as unknown as { createRoot: typeof createRoot }).createRoot;
  container = document.getElementById("app") as unknown as El;
  body = document.body as unknown as El;
  Card = (await import("../../app/runs/[id]/MomentProfileView")).MomentByBrandCard as unknown as typeof Card;
  Reach = (await import("../../app/runs/[id]/MomentReachCard")).MomentReachCard as unknown as typeof Reach;
}, 30000);

const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const buttons = () => [...body.querySelectorAll("button")];
const button = (re: RegExp) => {
  const b = buttons().find((x) => re.test(x.textContent ?? ""));
  if (!b) throw new Error(`no button ${re}: ${text().slice(0, 600)}`);
  return b;
};
const click = async (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)));
};
const frame = (subtitle: ReactNode, body: ReactNode) => createElement("section", { "data-testid": "card" }, createElement("p", null, subtitle), body);
const cardProps = (documentId: string) => ({
  runId: "run",
  documentId,
  moments: { ...moments, documentId },
  brands: BRANDS,
  focal: FOCAL,
  compared: ["1", "2", "3", "4", "5"],
  recallSubtitle: "Cue-specific recall, not personal relevance.",
  recallBody: createElement("div", { "data-testid": "recall-body" }, "RECALL TABLE BODY"),
  frame,
});
const lines = () => [...body.querySelectorAll('[data-testid="moment-profile-line"]')].map((l) => l.getAttribute("data-code"));
const brandButton = (label: string) => [...body.querySelectorAll('[data-testid="moment-profile-brands"] button')].find((b) => b.textContent?.trim() === label)!;

describe("Moment by brand card (mounted)", () => {
  it("recall table by default; Moment profile draws five lines in relevance order, remembered per file across a remount", async () => {
    store.clear();
    let root = createRoot(container);
    await act(async () => root.render(createElement(Card as never, cardProps("doc-a"))));
    expect(text()).toContain("RECALL TABLE BODY");
    expect(button(/^Recall table$/).getAttribute("aria-pressed")).toBe("true");
    await click(button(/^Moment profile$/));
    await settle();
    expect(text()).not.toContain("RECALL TABLE BODY");
    expect(text()).toContain("Cue-specific recall among those aware of each brand; pick-any. Weighted by weight.");
    // Client's brand drawn last (on top); the four compared brands up to five in all.
    expect(lines().sort()).toEqual(["1", "2", "3", "4", "7"]);
    const axis = [...body.querySelectorAll('[data-testid="moment-profile-chart"] text title')].map((t) => t.textContent);
    expect(axis).toEqual(["Feeling safer on the road", "Replacing an unreliable car", "Reducing fuel and running costs"]);
    expect(text()).toContain("Aware bases: BMW n=507 (effective 450) | Toyota n=501 (effective 450)");
    expect(text()).toContain("Pick-any: a brand's values across moments do not add up to 100");
    expect(store.get("insights-elevator:moment-card-view:doc-a")).toBe("profile");
    // Every drawn value is in the table, unrounded to one decimal.
    const cells = [...body.querySelectorAll('[data-testid="moment-profile-cell"]')];
    expect(cells).toHaveLength(15);
    expect(cells.find((c) => c.getAttribute("data-code") === "7" && c.getAttribute("data-group") === "cep_c03")!.textContent).toContain("19.0%");

    await act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(Card as never, cardProps("doc-a"))));
    await settle();
    expect(lines()).toHaveLength(5);
    await click(button(/^Recall table$/));
    expect(text()).toContain("RECALL TABLE BODY");
    expect(store.get("insights-elevator:moment-card-view:doc-a")).toBe("recall");
    await act(() => root.unmount());
  });

  it("at most five brands: the others are disabled; remove one and another can be added; the client's brand stays", async () => {
    store.clear();
    store.set("insights-elevator:moment-card-view:doc-a", "profile");
    const root = createRoot(container);
    await act(async () => root.render(createElement(Card as never, cardProps("doc-a"))));
    await settle();
    expect(text()).toContain("Brands (5 of 5)");
    expect(brandButton("Nissan").hasAttribute("disabled")).toBe(true);
    expect(brandButton("Kia").hasAttribute("disabled")).toBe(true);
    expect(brandButton("BMW").hasAttribute("disabled")).toBe(true);
    await click(brandButton("Nissan"));
    expect(lines()).toHaveLength(5);
    expect(lines()).not.toContain("6");
    await click(brandButton("Ford"));
    expect(lines().sort()).toEqual(["1", "2", "4", "7"]);
    expect(brandButton("Nissan").hasAttribute("disabled")).toBe(false);
    await click(brandButton("Kia"));
    expect(lines().sort()).toEqual(["1", "2", "4", "5", "7"]);
    // Kia's suppressed value is not drawn and is named with its reason and base.
    expect([...body.querySelectorAll('[data-testid="moment-profile-point"][data-code="5"]')]).toHaveLength(2);
    expect(text()).toContain("Kia, Reducing fuel and running costs: Suppressed for a small base. (n=8)");
    expect(brandButton("Ford").hasAttribute("disabled")).toBe(true);
    await act(() => root.unmount());
  });

  it("storage that throws: the card opens on the recall table and still switches", async () => {
    storageThrows = true;
    try {
      const root = createRoot(container);
      await act(async () => root.render(createElement(Card as never, cardProps("doc-a"))));
      expect(text()).toContain("RECALL TABLE BODY");
      await click(button(/^Moment profile$/));
      await settle();
      expect(lines()).toHaveLength(5);
      await act(() => root.unmount());
    } finally {
      storageThrows = false;
    }
  });

  it("switching data file: a late answer for the earlier file never replaces the newer file's profile", async () => {
    store.clear();
    store.set("insights-elevator:moment-card-view:doc-a", "profile");
    store.set("insights-elevator:moment-card-view:doc-b", "profile");
    hold = true;
    const root = createRoot(container);
    await act(async () => root.render(createElement(Card as never, cardProps("doc-a"))));
    await settle();
    await act(async () => root.render(createElement(Card as never, cardProps("doc-b"))));
    await settle();
    expect(held.map((h) => h.doc)).toEqual(["doc-a", "doc-b"]);
    held[1].release();
    await settle();
    held[0].release();
    await settle();
    held.length = 0;
    hold = false;
    // doc-b's values are 40 + code + moment: BMW at "Feeling safer" (index 2) is 49.0%.
    const bmw = [...body.querySelectorAll('[data-testid="moment-profile-cell"]')].find((c) => c.getAttribute("data-code") === "7" && c.getAttribute("data-group") === "cep_c03")!;
    expect(bmw.textContent).toContain("49.0%");
    await act(() => root.unmount());
  });
});

describe("Moment reach card (mounted)", () => {
  it("headline for the client's brand; ranked by moments per person; re-ranked by penetration; the table has all four", async () => {
    const root = createRoot(container);
    await act(async () => root.render(createElement(Reach as never, { runId: "run", documentId: "doc-a", moments, brands: BRANDS, focal: FOCAL, frame })));
    await settle();
    expect(body.querySelector('[data-testid="moment-reach-headline"]')!.textContent).toBe("BMW: 1.8 moments per person, 4th of 7; linked to at least one moment by 42%");
    const order = () => [...body.querySelectorAll('[data-testid="moment-reach-row"]')].map((r) => r.getAttribute("data-code"));
    expect(order()).toEqual(["1", "2", "3", "7", "4", "5", "6"]);
    expect(text()).toContain("Moments per person = moment penetration x moments per linker.");
    await click(button(/^Moment penetration$/));
    expect(order()).toEqual(["1", "3", "2", "4", "7", "5", "6"]);
    const bmwRow = [...body.querySelectorAll('[data-testid="moment-reach-table-row"]')].find((r) => r.getAttribute("data-code") === "7")!;
    expect([...bmwRow.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["1.84", "42.4%", "4.30", "15.0%", "n=1,000eff. 960"]);
    await act(() => root.unmount());
  });
});
