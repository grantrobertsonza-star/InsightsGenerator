// FND-001 (F7, static part): the actual SupportStatusNotice, rendered to static markup for each status. Checks
// what a reader sees: the status in words (never colour alone), the reason, the export
// consequence, and nothing at all for current support. Mounted-component behaviour (the review
// screens' data flow) is not established here.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { InsightSupport } from "../supportStatusShared";

vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));

const { SupportStatusNotice } = await import("../../app/runs/[id]/SupportStatusNotice");

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const finding = { findingId: "f-1", findingText: "Brand A leads on trust by 12 points" };

describe("SupportStatusNotice (F7)", () => {
  it("renders nothing for current support", () => {
    expect(renderToStaticMarkup(<SupportStatusNotice support={{ status: "current", reasons: [] }} />)).toBe("");
  });

  it("stale: names the status and the changed finding, and says exports carry the note", () => {
    const support: InsightSupport = { status: "stale", reasons: [{ kind: "figures", ...finding }] };
    const html = renderToStaticMarkup(<SupportStatusNotice support={support} />);
    expect(html).toContain('data-support-status="stale"');
    const t = text(html);
    expect(t).toContain("Support changed since drafted");
    expect(t).toContain("the figures in");
    expect(t).toContain("Brand A leads on trust by 12 points");
    expect(t).toContain("Exports show it with this note.");
  });

  it("invalid: says it is left out of exports and that human wording and decisions are kept", () => {
    const support: InsightSupport = { status: "invalid", reasons: [{ kind: "rejected", ...finding }] };
    const t = text(renderToStaticMarkup(<SupportStatusNotice support={support} />));
    expect(t).toContain("Support no longer valid");
    expect(t).toContain("was rejected");
    expect(t).toContain("left out of exports until you review it");
    expect(t).toContain("Your wording and decision are kept.");
  });

  it("unknown: never presented as current", () => {
    const support: InsightSupport = {
      status: "unknown",
      reasons: [{ kind: "check_failed", findingId: null, findingText: null, detail: "lookup failed" }],
    };
    const t = text(renderToStaticMarkup(<SupportStatusNotice support={support} />));
    expect(t).toContain("Support not checked");
    expect(t).not.toContain("Support current");
  });

  it("recommendation subject: the reason is attributed to its insight", () => {
    const support: InsightSupport = { status: "stale", reasons: [{ kind: "wording", ...finding }] };
    const t = text(renderToStaticMarkup(<SupportStatusNotice support={support} subject="recommendation" />));
    expect(t).toContain("Its insight:");
  });
});
