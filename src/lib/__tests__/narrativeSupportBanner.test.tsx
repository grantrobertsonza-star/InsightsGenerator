// FND-001 / REP-OUT-001: the narrative support banner must count each support status truthfully.
// Regression for Codex's finding: one invalid insight plus five unknown (legacy, never snapshotted)
// insights was reported as "6 of the 6 insights ... rest on evidence that changed or was removed".
// Exercises the actual NarrativeSupportBanner rendered to static markup and the shared counting
// rule behind it. The page's data loading is not exercised here.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { InsightSupport } from "../supportStatusShared";

vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));

const { NarrativeSupportBanner } = await import("../../app/runs/[id]/NarrativeSupportBanner");
const { summariseNarrativeSupport } = await import("../narrativeSupportSummary");

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const current: InsightSupport = { status: "current", reasons: [] };
const unknown: InsightSupport = { status: "unknown", reasons: [{ kind: "not_recorded", findingId: null, findingText: null }] };
const invalid: InsightSupport = { status: "invalid", reasons: [{ kind: "rejected", findingId: "f-1", findingText: "x" }] };
const stale: InsightSupport = { status: "stale", reasons: [{ kind: "figures", findingId: "f-2", findingText: "y" }] };

function render(ids: string[], byId: Record<string, InsightSupport | undefined>) {
  return renderToStaticMarkup(<NarrativeSupportBanner insightIds={ids} supportById={byId} />);
}

describe("NarrativeSupportBanner", () => {
  it("one invalid plus five unknown: counts each status and never calls unknown a change", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const byId = { a: invalid, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown };
    const html = render(ids, byId);
    expect(html).toContain('data-support-status="invalid"');
    const t = text(html);
    expect(t).toContain("Support no longer valid:");
    expect(t).toContain("Of the 6 insights this narrative uses, 1 is no longer valid and 5 could not be checked for changes.");
    expect(t).not.toContain("changed or was removed");
    expect(t).not.toContain("6 of the 6");
    expect(summariseNarrativeSupport(ids, byId)?.counts).toEqual({ current: 0, stale: 0, invalid: 1, unknown: 5 });
  });

  it("renders nothing when every cited insight is current", () => {
    expect(render(["a", "b"], { a: current, b: current })).toBe("");
  });

  it("only unknown: says the support could not be checked, with no change claimed", () => {
    const t = text(render(["a", "b"], { a: unknown, b: unknown }));
    expect(t).toContain("Support not checked:");
    expect(t).toContain("Of the 2 insights this narrative uses, 2 could not be checked for changes. Exports note this.");
    expect(t).not.toMatch(/changed since|no longer valid/);
  });

  it("mixed stale, unknown and current are each counted under their own wording", () => {
    const t = text(render(["a", "b", "c", "d"], { a: stale, b: stale, c: unknown, d: current }));
    expect(t).toContain("Support changed since drafted:");
    expect(t).toContain("2 have changed since they were drafted, 1 could not be checked for changes and 1 is current.");
  });

  it("counts an insight cited by several pillars once, and a missing insight as no longer valid", () => {
    const summary = summariseNarrativeSupport(["a", "a", "gone"], { a: unknown });
    expect(summary?.total).toBe(2);
    expect(summary?.counts).toEqual({ current: 0, stale: 0, invalid: 1, unknown: 1 });
    expect(summary?.sentence).toContain("Of the 2 insights this narrative uses, 1 is no longer valid and 1 could not be checked for changes.");
  });
});
