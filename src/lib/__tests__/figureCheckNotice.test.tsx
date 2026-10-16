// Numerical traceability, static part: the ACTUAL FigureCheckNotice / FigureChecksProvider /
// FigureCheckFor rendered to static markup. What a reader sees: figures needing review (amber) or
// unsupported (rose) with their reasons; nothing for traced or unchecked items; a failed load of
// the checks announced once rather than read as "nothing to review". The page's data loading is
// covered by figureTraceability.db.test.ts; mounted interaction is not established here.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));

const { FigureCheckNotice, FigureChecksProvider, FigureCheckFor } = await import("../../app/runs/[id]/FigureCheckNotice");

const check = (status: "traced" | "needs_review" | "unsupported") => ({
  status,
  checked: 1,
  figures: status === "traced" ? [] : [{ field: "headline", text: "25", status, reason: "context not matched" }],
  checked_at: "2026-10-16T00:00:00Z",
});
const empty = { available: true, preInsights: {}, synthesizedInsights: {}, recommendations: {}, narrative: null };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("FigureCheckNotice", () => {
  it("needs review and unsupported are stated with the figure and reason; traced and unchecked show nothing", () => {
    const review = renderToStaticMarkup(<FigureCheckNotice check={check("needs_review") as never} />);
    expect(review).toContain('data-figure-status="needs_review"');
    expect(text(review)).toBe("Figures need review: 25 (context not matched).");
    expect(text(renderToStaticMarkup(<FigureCheckNotice check={check("unsupported") as never} />))).toBe(
      "Figures not supported by the cited evidence: 25 (context not matched).",
    );
    expect(renderToStaticMarkup(<FigureCheckNotice check={check("traced") as never} />)).toBe("");
    expect(renderToStaticMarkup(<FigureCheckNotice check={null} />)).toBe("");
  });

  it("each card reads its own stored check from the provider", () => {
    const html = renderToStaticMarkup(
      <FigureChecksProvider checks={{ ...empty, synthesizedInsights: { a: check("needs_review") } } as never}>
        <FigureCheckFor kind="synthesizedInsights" id="a" />
        <FigureCheckFor kind="synthesizedInsights" id="b" />
        <FigureCheckFor kind="recommendations" id="a" />
      </FigureChecksProvider>,
    );
    expect(html.split('data-testid="figure-check"').length - 1).toBe(1);
  });

  it("a failed load is announced once, never read as nothing to review", () => {
    const html = renderToStaticMarkup(
      <FigureChecksProvider checks={{ ...empty, available: false, error: "connection reset" } as never}>
        <FigureCheckFor kind="preInsights" id="a" />
      </FigureChecksProvider>,
    );
    expect(html).toContain('data-testid="figure-check-error"');
    expect(text(html)).toMatch(/could not be loaded \(connection reset\)/);
  });
});
