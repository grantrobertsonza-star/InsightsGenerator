// Codex BH-F02: the Brand Health loyalty card (LoyaltyGroups in BrandHealthAnalyticsPanel.tsx), rendered to static
// markup. A brand group without an NPS is listed under "Not shown" with its reason and counts, never as a score, and
// never just missing; a dashboard built before the change (no `unavailable`) renders as before.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The panel imports the module's server actions; none is called when the card renders.
vi.mock("@/lib/brandHealthActions", () => ({}));
vi.mock("@/lib/variableSetKeys", async () => await import("../variableSetKeys"));
vi.mock("@/lib/csmMetrics", async () => await import("../csmMetrics"));
vi.mock("@/lib/brandHealthMetrics", async () => await import("../brandHealthMetrics"));

const { LoyaltyGroups } = await import("../../app/runs/[id]/BrandHealthAnalyticsPanel");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const loyalty = {
  variable: "nps_main",
  label: "Recommendation likelihood",
  byBrand: [{ brand: "Toyota", nps: 26.7, promoters: 40, detractors: 13.3, n: 14 }],
  unavailable: [
    { brand: "Volkswagen", groupN: 6, validAnswers: 6, reason: "Suppressed for a small base: 6 valid answers in this brand's group." },
    { brand: "BMW", groupN: 15, validAnswers: 0, reason: "None of the 15 respondents in this brand's group gave a valid answer." },
    { brand: "Haval", groupN: 0, validAnswers: 0, reason: "No respondents in this brand's group." },
  ],
};

describe("LoyaltyGroups (Codex BH-F02)", () => {
  it("lists every group without an NPS under Not shown, with its reason and counts, and our brand marked", () => {
    const t = text(renderToStaticMarkup(<LoyaltyGroups loyalty={loyalty} ourBrand="BMW" />));
    expect(t).toContain("Toyota 27 40% / 13%");
    expect(t).toContain("Not shown");
    expect(t).toContain("Volkswagen : Suppressed for a small base: 6 valid answers in this brand's group. (group n=6, valid answers n=6)");
    expect(t).toContain("BMW (ours) : None of the 15 respondents in this brand's group gave a valid answer. (group n=15, valid answers n=0)");
    expect(t).toContain("Haval : No respondents in this brand's group. (group n=0, valid answers n=0)");
    // A group without a score is never shown with one.
    expect(t).not.toMatch(/Volkswagen\s+-?\d/);
  });

  it("a dashboard without unavailable groups (or built before the change) shows no Not shown list", () => {
    const { unavailable: _u, ...before } = loyalty;
    for (const l of [before, { ...loyalty, unavailable: [] }]) {
      const html = renderToStaticMarkup(<LoyaltyGroups loyalty={l} ourBrand="Toyota" />);
      expect(html).not.toContain("brand-health-loyalty-unavailable");
      expect(text(html)).toContain("Toyota (ours) 27");
    }
  });
});
