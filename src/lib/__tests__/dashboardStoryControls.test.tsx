// R5story: the brand tracking dashboard's story controls MOUNTED (react-dom/client in a linkedom document). The
// server actions are the mocked boundary, their answers held so the test chooses their order.
//   - Post as finding: "Posting..." (disabled) until the server answers, then "Posted as finding"; an answer arriving
//     after the dashboard closed changes nothing; a refusal shows its reason on the card; a posted finding whose source changed says
//     "Source changed: post again";
//   - AI insights panel: opens and lists the page's drafts with "AI draft", a refused one with its reason; drafting
//     shows its state; a late answer for the previous page never replaces the page now shown; Accept updates the
//     badge only after the server answers; an edit shows "Saving..." then "Saved" only after the save;
//   - Export slides: with nothing accepted the summary cannot be drafted and the dialog says so; the download asks
//     with includeDrafts=1 only when ticked; a failed build is shown.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import type { AiDraft } from "../dashboardInsights";

type Held = { name: string; args: unknown[]; release: (v: unknown) => void };
const held: Held[] = [];
const hold = (name: string) => (...args: unknown[]) => new Promise((release) => held.push({ name, args, release }));
vi.mock("@/lib/trackerDashboardStoryActions", () => ({
  dashboardFindingStatusAction: hold("status"),
  postDashboardCardAction: hold("post"),
  loadPageInsightsAction: hold("load"),
  generatePageInsightsAction: hold("generate"),
  decideDraftAction: hold("decide"),
  editDraftAction: hold("edit"),
  postInsightAsFindingAction: hold("postInsight"),
  loadModuleStoryAction: hold("loadStory"),
  draftModuleStoryAction: hold("draftStory"),
}));

type El = { querySelectorAll(s: string): ArrayLike<El> & Iterable<El>; querySelector(s: string): El | null; dispatchEvent(e: unknown): boolean; textContent: string | null; getAttribute(n: string): string | null; value?: string; checked?: boolean };
type Root = { render: (el: unknown) => void; unmount: () => void };
let act: (cb: () => unknown) => Promise<void>;
let createRoot: (el: unknown) => Root;
let body: El;
let container: El;
let EventCtor: new (type: string, init?: { bubbles?: boolean }) => unknown;
let mod: {
  DashboardStoryProvider: (p: unknown) => unknown;
  DashboardFindingButton: (p: unknown) => unknown;
  DashboardInsightsButton: (p: unknown) => unknown;
  DashboardExportButton: (p: unknown) => unknown;
};

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
  const a = await import("../../app/runs/[id]/DashboardFindingButton");
  const b = await import("../../app/runs/[id]/DashboardInsightsPanel");
  const c = await import("../../app/runs/[id]/DashboardExport");
  mod = { DashboardStoryProvider: a.DashboardStoryProvider as never, DashboardFindingButton: a.DashboardFindingButton as never, DashboardInsightsButton: b.DashboardInsightsButton as never, DashboardExportButton: c.DashboardExportButton as never };
}, 30000);

const RUN = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const text = () => (body.textContent ?? "").replace(/\s+/g, " ");
const byTestId = (id: string) => [...body.querySelectorAll(`[data-testid="${id}"]`)];
const button = (re: RegExp) => {
  const b = [...body.querySelectorAll("button")].find((x) => re.test(x.textContent ?? ""));
  if (!b) throw new Error(`no button ${re}: ${text().slice(0, 600)}`);
  return b;
};
const click = async (el: El) => act(async () => void el.dispatchEvent(new EventCtor("click", { bubbles: true })));
const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => await new Promise((r) => setTimeout(r, 2)));
};
const take = (name: string) => {
  const i = held.findIndex((h) => h.name === name);
  if (i < 0) throw new Error(`no held ${name}; held: ${held.map((h) => h.name).join(", ")}`);
  return held.splice(i, 1)[0];
};
async function answer(name: string, value: unknown) {
  const h = take(name);
  await act(async () => h.release(value));
  await settle();
  return h;
}
const draft = (over: Partial<AiDraft>): AiDraft => ({ id: "d1", page: "overview", kind: "insight", position: 0, text: "Awareness: BMW awareness is 84.9%.", modelText: "x", humanEdited: false, status: "draft", checkNote: null, figuresHash: "h", stale: false, findingId: null, revision: 1, createdAt: "2026-10-30T10:00:00Z", ...over });

function mount(children: unknown) {
  const root = createRoot(container);
  return { root, render: () => act(() => root.render(createElement(mod.DashboardStoryProvider as never, { runId: RUN, documentId: DOC, focalCode: "8" }, children as never))) };
}

describe("Post as finding (mounted)", () => {
  it("shows Posted only after the answer; a refusal is shown; a changed source says so; a late answer after closing changes nothing", async () => {
    const { root, render } = mount(createElement(mod.DashboardFindingButton as never, { page: "overview", card: "funnel", label: "Compare the brand funnel" }));
    await render();
    await answer("status", { ok: true, statuses: [], freshnessError: null });
    expect(byTestId("dashboard-finding-button")[0].textContent).toBe("Post as finding");

    await click(button(/^Post as finding$/));
    expect(byTestId("dashboard-finding-button")[0].textContent).toBe("Posting...");
    expect((byTestId("dashboard-finding-button")[0] as unknown as { disabled: boolean }).disabled).toBe(true);
    const first = take("post");
    expect(first.args).toEqual([RUN, DOC, "overview", "funnel"]);
    await act(async () => first.release({ ok: false, error: "The dashboard's choices or data changed while the figures were read, so nothing was posted. Try again." }));
    await settle();
    expect(byTestId("dashboard-finding-error")[0].textContent).toMatch(/nothing was posted/);
    await click(button(/^Post as finding$/));
    await answer("post", { ok: true, added: true, findingId: "f1", superseded: 0 });
    expect(byTestId("dashboard-finding-button")[0].textContent).toBe("Posted as finding");
    expect(byTestId("dashboard-finding-error")).toHaveLength(0);
    // The provider refreshes what is posted; the finding's source changed since.
    await answer("status", { ok: true, statuses: [{ findingId: "f1", page: "overview", card: "funnel", kind: "card", status: "accepted", figuresHash: "h", stale: true, superseded: false, reasons: ["The dashboard choices were changed."], focalCode: "8" }], freshnessError: null });
    expect(byTestId("dashboard-finding-button")[0].textContent).toBe("Posted as finding");
    await act(() => root.unmount());
    held.length = 0;

    // Mounted again (a reopened dashboard): the posted finding whose source changed reads so.
    const again = mount(createElement(mod.DashboardFindingButton as never, { page: "overview", card: "funnel" }));
    await again.render();
    await answer("status", { ok: true, statuses: [{ findingId: "f1", page: "overview", card: "funnel", kind: "card", status: "accepted", figuresHash: "h", stale: true, superseded: false, reasons: ["The dashboard choices were changed."], focalCode: "8" }], freshnessError: null });
    expect(byTestId("dashboard-finding-button")[0].textContent).toBe("Source changed: post again");
    // An answer that arrives after the dashboard was closed (or switched to another file, which remounts the
    // provider) changes nothing and raises nothing.
    await click(button(/^Source changed/));
    const p1 = take("post");
    await act(() => again.root.unmount());
    await act(async () => p1.release({ ok: true, added: true, findingId: "f2", superseded: 1 }));
    expect(byTestId("dashboard-finding-button")).toHaveLength(0);
    held.length = 0;
  });
});

describe("AI insights panel (mounted)", () => {
  it("lists drafts with their state; drafting state; a late answer for the previous page is ignored; Accept and Saved only after the server", async () => {
    const page = (p: string, title: string) => createElement(mod.DashboardInsightsButton as never, { page: p, title });
    const { root, render } = mount(page("overview", "Brand overview"));
    await render();
    await answer("status", { ok: true, statuses: [], freshnessError: null });
    await click(byTestId("ai-insights-button")[0]);
    expect(text()).toContain("Reading this page's insights...");
    const overviewLoad = take("load");
    expect(overviewLoad.args).toEqual([RUN, DOC, "overview"]);
    // (released below, after a page switch, as a late answer)

    // The researcher moves to Moments & needs while the overview's answer is still out.
    await act(() => root.render(createElement(mod.DashboardStoryProvider as never, { runId: RUN, documentId: DOC, focalCode: "8" }, page("moments", "Moments & needs"))));
    const moments = take("load");
    expect(moments.args).toEqual([RUN, DOC, "moments"]);
    await act(async () => moments.release({ ok: true, drafts: [draft({ id: "m1", page: "moments", text: "Moments: relevance is led by daily commuting at 41.2%." }), draft({ id: "m2", page: "moments", status: "refused", text: "Invented: 77.0%.", checkNote: "Refused by the figure check: 77.0 (77.0 does not appear in the cited evidence)." })] }));
    await settle();
    expect(text()).toContain("AI insights");
    expect(text()).toContain("Moments & needs");
    expect(text()).toContain("Moments: relevance is led by daily commuting at 41.2%.");
    expect(byTestId("ai-insight-status").map((e) => e.textContent)).toEqual(["AI draft", "Refused by the figure check"]);
    expect(text()).toContain("77.0 does not appear in the cited evidence");
    // The overview's answer arrives now, late: the page shown keeps its own drafts.
    await act(async () => overviewLoad.release({ ok: true, drafts: [draft({ id: "o1", text: "Overview late answer: 84.9%." })] }));
    await settle();
    expect(text()).not.toContain("Overview late answer");
    expect(text()).toContain("Moments: relevance is led by daily commuting at 41.2%.");

    // Drafting: the state shows; the answer replaces the list.
    await click(byTestId("ai-insights-draft")[0]);
    expect(text()).toContain("Drafting insights from this page's figures...");
    await answer("generate", { ok: true, superseded: false, refused: 0, drafts: [draft({ id: "m3", page: "moments", text: "Recall: BMW is recalled for commuting by 12.5%." })] });
    expect(text()).toContain("Recall: BMW is recalled for commuting by 12.5%.");
    expect(text()).not.toContain("Drafting insights");

    // Accept: the badge changes only when the server answers.
    await click(byTestId("ai-insight-accept")[0]);
    expect(text()).toContain("Accepting...");
    expect(byTestId("ai-insight-status")[0].textContent).toBe("AI draft");
    const decide = await answer("decide", { ok: true, draft: draft({ id: "m3", page: "moments", status: "accepted", revision: 2, text: "Recall: BMW is recalled for commuting by 12.5%." }) });
    expect(decide.args).toEqual([RUN, DOC, "m3", "accept", 1]);
    expect(byTestId("ai-insight-status")[0].textContent).toBe("Accepted");

    // Edit: "Saving..." until the server saved, then "Saved".
    await click(button(/^Edit$/));
    await click(button(/^Save$/));
    expect(text()).toContain("Saving...");
    expect(text()).not.toContain("Saved");
    await answer("edit", { ok: true, draft: draft({ id: "m3", page: "moments", status: "draft", humanEdited: true, revision: 3, text: "Recall: BMW is recalled for commuting by 12.5%." }) });
    expect(byTestId("ai-insight-message")[0].textContent).toBe("Saved");
    expect(text()).toContain("Edited");
    // A refused edit is not saved and says why.
    await click(button(/^Edit$/));
    await click(button(/^Save$/));
    await answer("edit", { ok: false, error: "Not saved. Refused by the figure check: 55.5 (55.5 does not appear in the cited evidence)." });
    expect(byTestId("ai-insight-message")[0].textContent).toMatch(/^Not saved/);
    await act(() => root.unmount());
    held.length = 0;
  });
});

describe("Export slides (mounted)", () => {
  it("nothing accepted is said; include drafts reaches the request; a failed build is shown", async () => {
    const calls: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      calls.push(url);
      return { ok: false, status: 422, json: async () => ({ error: "The deck could not be laid out without cutting text: The footnote is too long." }), headers: { get: () => null } };
    };
    const { root, render } = mount(createElement(mod.DashboardExportButton as never, {}));
    await render();
    await answer("status", { ok: true, statuses: [], freshnessError: null });
    await click(byTestId("export-slides-button")[0]);
    await answer("loadStory", { ok: true, drafts: [], inputs: [] });
    expect(byTestId("export-summary-nothing")[0].textContent).toMatch(/Nothing is accepted yet/);
    expect((byTestId("export-summary-draft")[0] as unknown as { disabled: boolean }).disabled).toBe(true);

    const box = byTestId("export-include-drafts")[0] as unknown as El & { checked: boolean };
    await act(async () => {
      box.checked = true;
      box.dispatchEvent(new EventCtor("click", { bubbles: true }));
    });
    await click(byTestId("export-download")[0]);
    await settle();
    expect(calls).toEqual([`/api/runs/${RUN}/tracker-dashboard/export?documentId=${DOC}&includeDrafts=1`]);
    expect(byTestId("export-failed")[0].textContent).toMatch(/without cutting text/);
    await act(() => root.unmount());
    held.length = 0;
  });
});
