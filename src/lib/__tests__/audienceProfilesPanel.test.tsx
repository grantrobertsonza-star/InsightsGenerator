// The Audience and Media pages (AudienceProfiles.tsx, R5) MOUNTED (react-dom/client in a linkedom document). The server
// actions are the mocked boundary (the figures are the loaders', pinned by trackerAudienceProfiles.db.test.ts); the
// list, index, sort and headline rules are the real modules.
//   - Audience: one card per profile in the saved order (age and gender with every answer in code order, a default
//     income not found with "Choose a question", a saved province not in this wave's file); Add a profile question
//     lists the other questions by wording with the variable name, and choosing one saves the list with it added;
//     Hide and the up arrow save the list without the card and reordered; while saving the controls are disabled.
//   - Media: shares sorted by the focal share by default, then by the difference; long labels wrap (never cut);
//     index view with withheld n/a for a small base; the headline names only the tested differences; Compare to asks for Toyota's acquirers, and a late
//     answer for the earlier choice never replaces the newer one.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { BrandAudience, BrandMedia } from "../trackerAudience";
import type { ProfileChoice, ResolvedProfile } from "../trackerDashboard";

vi.mock("@/lib/trackerDashboard", async () => await import("../trackerDashboard"));
vi.mock("@/lib/trackerAudienceFigures", async () => await import("../trackerAudienceFigures"));
vi.mock("@/lib/variableSearch", async () => await import("../variableSearch"));

const share = (s: number | null, base: number | null, reason?: string) => ({ share: s, base, ...(reason ? { reason } : {}) });
const acquirers = (n: number, level: "ok" | "small" | "very_small") => ({ status: "ok" as const, brand: { code: "8", label: "BMW" }, label: "Past 12 month household acquisition", variable: "bought12_b08", code: "1", n, effectiveBase: n, level });
const AUDIENCE: BrandAudience = {
  documentId: "d",
  weighted: true,
  weightVar: "weight",
  effectiveBase: 950,
  categoryN: 1000,
  acquirers: acquirers(13, "very_small"),
  dashboard: { brands: [], focalBrand: { code: "8", label: "BMW", source: "prefilled" } },
  profilesSource: "chosen",
  profileQuestions: [
    { variable: "age_band", label: "Age group" },
    { variable: "gender", label: "Gender" },
    { variable: "settlement", label: "Settlement" },
    { variable: "life_stage", label: "Household life stage" },
  ],
  profiles: [
    { status: "ok", role: "age", variable: "age_band", label: "Age group", source: "suggested", rows: [{ key: "1", label: "18–24", acquirers: share(10, 13), category: share(16, 1000) }, { key: "2", label: "25–34", acquirers: share(90, 13), category: share(84, 1000) }] },
    { status: "ok", role: "gender", variable: "gender", label: "Gender", source: "suggested", rows: [{ key: "1", label: "Man", acquirers: share(60, 13), category: share(50, 1000) }, { key: "2", label: "Woman", acquirers: share(40, 13), category: share(48, 1000) }, { key: "4", label: "Prefer not to say", acquirers: share(0, 13), category: share(2, 1000) }] },
    { status: "not_found", role: "income", reason: "No question asked once whose wording names income was found.", source: "suggested" },
    { status: "not_in_file", role: null, variable: "province", label: "Province", source: "chosen" },
  ],
};
const PROFILES: ResolvedProfile[] = AUDIENCE.profiles.map((p) => (p.status === "ok" ? { status: p.status, role: p.role, variable: p.variable, label: p.label, source: p.source } : p));
const SAVED: ProfileChoice[] = [{ role: "age", variable: null, label: null }, { role: "gender", variable: null, label: null }, { role: "income", variable: null, label: null }, { role: null, variable: "province", label: "Province" }];

const mediaRow = (key: string, label: string, f: number | null, c: number | null, test: BrandMedia extends { media: infer M } ? (M extends { status: "ok"; rows: (infer R)[] } ? R extends { test: infer T } ? T : never : never) : never) => ({ key, label, focal: share(f, 360), comparison: share(c, 1000), test });
function mediaPage(compare: string | null, focalN: number): BrandMedia {
  return {
    documentId: "d",
    weighted: true,
    weightVar: "weight",
    effectiveBase: 950,
    categoryN: 1000,
    acquirers: acquirers(focalN, focalN >= 50 ? "ok" : "very_small"),
    dashboard: { brands: [], focalBrand: { code: "8", label: "BMW", source: "prefilled" } },
    comparison: compare === null ? { kind: "category" } : { kind: "brand", group: { status: "ok", brand: { code: "1", label: "Toyota" }, label: "Past 12 month household acquisition", variable: "bought12_b01", code: "1", n: 200, effectiveBase: 190, level: "ok" } },
    comparisonBrands: [{ code: "1", label: "Toyota" }, { code: "2", label: "Volkswagen" }],
    media: {
      status: "ok",
      label: "media",
      test: focalN >= 50 ? { ran: true, method: "Each medium tested at the 5% level." } : { ran: false, reason: "No test: a group has fewer than 50 respondents." },
      rows: [
        mediaRow("media_m01", "YouTube", 82.7, compare === null ? 81.7 : 80.1, { status: "no_difference" }),
        mediaRow("media_m03", "Instagram", 83.3, compare === null ? 66.4 : 70.2, { status: "higher" }),
        mediaRow("media_m05", "Audio streaming or podcasts with a long label", 27.5, compare === null ? 30.7 : 33.0, { status: "lower" }),
        mediaRow("media_m12", "AI chatbots", null, 34.3, { status: "untested", reason: "x" }),
      ],
    },
  };
}

const held: { compare: string | null; release: () => void }[] = [];
let holdAnswers = false;
let focalN = 360;
vi.mock("@/lib/trackerDashboardActions", () => ({
  loadBrandAudienceAction: async () => ({ ok: true, audience: AUDIENCE }),
  loadBrandMediaAction: async (_r: string, _d: string, compare: string | null) => {
    if (holdAnswers) await new Promise<void>((release) => held.push({ compare, release }));
    return { ok: true, media: mediaPage(compare, focalN) };
  },
}));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; querySelector(s: string): El | null; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null; hasAttribute(n: string): boolean };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let container: El;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let Pages: typeof import("../../app/runs/[id]/AudienceProfiles");

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
  Pages = await import("../../app/runs/[id]/AudienceProfiles");
}, 30000);

const text = (el: El = body) => (el.textContent ?? "").replace(/\s+/g, " ");
const byTestId = (id: string) => [...body.querySelectorAll(`[data-testid="${id}"]`)];
const button = (label: RegExp) => [...body.querySelectorAll("button")].find((b) => label.test(b.getAttribute("aria-label") ?? b.textContent ?? ""))!;
const fire = async (el: El, type: string) => act(async () => void el.dispatchEvent(new EventCtor(type, { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 5)));
};
async function choose(testId: string, value: string) {
  const select = byTestId(testId)[0];
  Object.defineProperty(select, "value", { value, configurable: true });
  await act(async () => void select.dispatchEvent(new EventCtor("change", { bubbles: true })));
}

describe("Audience page (mounted)", () => {
  it("cards in the saved order; add, hide and reorder save the list; controls wait while saving", async () => {
    const saves: ProfileChoice[][] = [];
    const root = createRoot(container);
    const render = (saving: boolean) =>
      act(() =>
        root.render(
          createElement(Pages.AudiencePage, {
            runId: "r",
            documentId: "d",
            loadKey: 1,
            chrome: () => null,
            profiles: PROFILES,
            saved: SAVED,
            saving,
            canSave: true,
            onSave: async (next: ProfileChoice[]) => void saves.push(next),
          }),
        ),
      );
    await render(false);
    await settle();
    const cards = byTestId("tracker-audience-profile");
    expect(cards.map((c) => [c.getAttribute("data-role"), c.getAttribute("data-variable"), c.getAttribute("data-status")])).toEqual([
      ["age", "age_band", "ok"],
      ["gender", "gender", "ok"],
      ["income", "", "not_found"],
      ["", "province", "not_in_file"],
    ]);
    // Every answer in code order, "Prefer not to say" included; both bases shown.
    expect([...cards[1].querySelectorAll('[data-testid="tracker-audience-profile-row"]')].map((r) => r.getAttribute("data-key"))).toEqual(["1", "2", "4"]);
    expect(text(cards[1])).toContain("answered: acquirers n=13, all eligible n=1,000");
    expect(text(cards[1])).toContain("Prefer not to say0.0%2.0%");
    expect(text(cards[2])).toContain("Not found in this file.");
    expect(text(cards[2])).toContain("Choose a question");
    expect(text(cards[3])).toContain("Not in this wave’s file.");
    // Answer labels wrap in full on the cards too.
    expect(byTestId("tracker-audience-profile-row-label").map((l) => l.textContent)).toContain("Prefer not to say");
    expect(body.querySelector(".truncate")).toBeNull();
    expect(byTestId("tracker-audience-small-base")[0].getAttribute("data-level")).toBe("very_small");

    // Add a profile question: the questions not shown, by wording with the variable name.
    await fire(button(/Add a profile question/), "click");
    const input = body.querySelector('input[aria-label="Add a profile question"]')!;
    await fire(input, "focusin");
    const options = [...body.querySelectorAll('[role="option"]')].map((o) => text(o));
    expect(options).toEqual(["Choose a question to add", "Settlement (settlement)", "Household life stage (life_stage)"]);
    const settlement = [...body.querySelectorAll('[role="option"]')].find((o) => text(o).startsWith("Settlement"))!;
    await fire(settlement, "mousedown");
    expect(saves.at(-1)).toEqual([...SAVED, { role: null, variable: "settlement", label: "Settlement" }]);

    // Hide gender; move income up; replace the income default with a chosen question.
    await fire(button(/^Hide Gender$/), "click");
    expect(saves.at(-1)).toEqual([SAVED[0], SAVED[2], SAVED[3]]);
    await fire(button(/^Move Household income up$/), "click");
    expect(saves.at(-1)).toEqual([SAVED[0], SAVED[2], SAVED[1], SAVED[3]]);
    await fire(button(/^Choose a question$/), "click");
    await fire(body.querySelector('input[aria-label="Question for household income"]')!, "focusin");
    await fire([...body.querySelectorAll('[role="option"]')].find((o) => text(o).startsWith("Household life stage"))!, "mousedown");
    expect(saves.at(-1)![2]).toEqual({ role: "income", variable: "life_stage", label: "Household life stage" });

    // While a save is on its way nothing else can be changed.
    await render(true);
    expect(button(/^Hide Age group$/).hasAttribute("disabled")).toBe(true);
    expect(button(/Add a profile question/).hasAttribute("disabled")).toBe(true);
    expect(text()).toContain("Saving...");
    await act(() => root.unmount());
  });
});

describe("Media page (mounted)", () => {
  it("sort, show and compare; the headline names tested differences only; a late answer never replaces a newer choice", async () => {
    focalN = 360;
    const root = createRoot(container);
    await act(() => root.render(createElement(Pages.MediaPage, { runId: "r", documentId: "d", loadKey: 1, chrome: () => null })));
    await settle();
    const keys = () => byTestId("tracker-audience-media-row").map((r) => r.getAttribute("data-key"));
    expect(keys()).toEqual(["media_m03", "media_m01", "media_m05", "media_m12"]);
    expect(byTestId("tracker-media-headline")[0].textContent).toBe("BMW recent acquirers are more likely to use Instagram (83.3% vs 66.4%), and less likely to use Audio streaming or podcasts with a long label (27.5% vs 30.7%) than all eligible category respondents.");
    // A long label wraps in full: never cut (no truncate class, no hover-only text).
    const long = byTestId("tracker-audience-media-row-label").find((l) => l.textContent === "Audio streaming or podcasts with a long label")!;
    expect(long).toBeDefined();
    expect(long.getAttribute("class")).toContain("[overflow-wrap:anywhere]");
    expect(body.querySelector(".truncate")).toBeNull();

    await choose("tracker-media-sort", "difference");
    expect(keys()).toEqual(["media_m03", "media_m01", "media_m05", "media_m12"]);
    await choose("tracker-media-show", "index");
    expect(byTestId("tracker-audience-media-row-index").map((x) => x.textContent)).toEqual(["125", "101", "90", "n/a"]);
    await choose("tracker-media-show", "shares");

    // Compare to Toyota, then back to all eligible: Toyota's answer arrives last and is ignored.
    holdAnswers = true;
    await choose("tracker-media-compare", "1");
    await choose("tracker-media-compare", "");
    expect(held.map((h) => h.compare)).toEqual(["1", null]);
    held[1].release();
    await settle();
    held[0].release();
    await settle();
    held.length = 0;
    holdAnswers = false;
    expect(text(byTestId("tracker-media-groups")[0])).toContain("vs all eligible category respondents (n=1,000)");

    await choose("tracker-media-compare", "1");
    await settle();
    expect(text(byTestId("tracker-media-groups")[0])).toContain("vs Toyota recent acquirers (n=200)");
    expect(byTestId("tracker-media-headline")[0].textContent).toContain("than Toyota recent acquirers.");
    await act(() => root.unmount());
  });

  it("a very small focal base: no headline, the index withheld, the banner shown", async () => {
    focalN = 13;
    const root = createRoot(container);
    await act(() => root.render(createElement(Pages.MediaPage, { runId: "r", documentId: "d", loadKey: 2, chrome: () => null })));
    await settle();
    expect(byTestId("tracker-media-headline")).toHaveLength(0);
    expect(byTestId("tracker-audience-small-base")[0].getAttribute("data-level")).toBe("very_small");
    await choose("tracker-media-show", "index");
    expect(byTestId("tracker-audience-media-row-index").every((x) => x.textContent === "n/a")).toBe(true);
    expect(text()).toContain("No test: a group has fewer than 50 respondents.");
    await act(() => root.unmount());
  });
});
