// r6brandext: the extension's screens rendered to static markup (BrandExtensionViews.tsx, VariablesSelector.tsx).
// Unknown states are words, never figures: a construct the file lacks says "Not measured" with what is missing; a
// measured figure with no valid base says "Not available", never 0%; the Variables selector lists every construct
// with its status and offers a confirmation only for one in review. Interaction (collapse, confirm, weighting) is
// checked in the browser: e2e/ui/tracker-brand-extension.check.mjs.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrandExtension, BrandRating, ExtensionDiagnostics } from "../brandExtension";

vi.mock("@/lib/brandExtensionActions", () => ({}));
const { RatingsView, ChoiceView } = await import("../../app/runs/[id]/BrandExtensionViews");
const { default: VariablesSelector } = await import("../../app/runs/[id]/VariablesSelector");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const scale = ["Strongly disagree", "Disagree", "Neither agree nor disagree", "Agree", "Strongly agree"].map((label, i) => ({ code: String(i + 1), label }));
const rating = (code: string, label: string, topTwo: number | null): BrandRating => ({
  code,
  label,
  variable: `needsfit_b0${code}`,
  aware: { n: topTwo === null ? 12 : 400, weighted: 400 },
  valid: topTwo === null ? { n: 0, weighted: 0, effective: null } : { n: 380, weighted: 381.2, effective: 360.1 },
  cannotJudge: { n: 20, weighted: 18.8, share: 4.7 },
  missing: { n: 0, weighted: 0 },
  otherCodes: [],
  answeredNotAware: 0,
  distribution: scale.map((s) => ({ ...s, n: 0, weighted: 0, share: topTwo === null ? null : 20 })),
  topTwo,
  mean: topTwo === null ? null : 3.1,
  topTwoInterval: topTwo === null ? null : [36, 44],
  smallBase: topTwo === null ? "none" : "ok",
  ...(topTwo === null ? { reason: "No aware respondent gave a rating from 1 to 5, so this figure is not available." } : {}),
});
const notMeasured = { status: "not_measured" as const, reason: "Not measured: No differentiation rating was found in this file. Missing: a five-point agreement rating, per aware brand, that the brand offers something meaningfully different." };
const diag = (construct: ExtensionDiagnostics["construct"], status: ExtensionDiagnostics["status"]): ExtensionDiagnostics => ({
  construct,
  title: construct,
  status,
  reason: status === "found" ? null : "why",
  question: null,
  sourceFields: [],
  valueLabels: [],
  universe: "u",
  denominator: "d",
  evidence: [],
  candidates: status === "needs_review" ? [{ key: "a,b", description: "Candidate A" }] : [],
  confirmed: null,
});
const ext = {
  documentId: "d",
  weighted: true,
  weightVar: "weight",
  weightAvailable: true,
  weightNote: "Weighted by weight.",
  audience: null,
  brands: [{ code: "1", label: "Capitec" }, { code: "8", label: "FNB" }],
  focalBrand: { code: "8", label: "FNB" },
  diagnostics: [],
  confirmations: { scopeKey: "project:x", revision: null, storageAvailable: true, aliases: [] },
  ratings: {
    needs_fit: { status: "ok", construct: "needs_fit", family: { key: "k", wording: "meets my personal needs for personal banking.", byBrand: [], scale, cannotJudge: [{ code: "9", label: "Do not know enough to judge" }], otherCodes: [] }, awareness: { group: "aware", label: "Prompted resolved recognition" }, brands: [rating("1", "Capitec", null), rating("8", "FNB", 41.2)], routeBreaks: 0 },
    differentiation: notMeasured,
    price_justification: notMeasured,
  },
  episode: { status: "not_measured", reason: "Not measured: No pair of questions. Missing: the brand actually chosen and the brand ideally preferred for the same most recent category event." },
  reasons: { status: "not_measured", reason: "Not measured: no reasons." },
  audienceOptions: [],
} as unknown as BrandExtension;

describe("ratings view", () => {
  it("a measured brand with no valid base reads Not available, never 0%; the other brand's figures and bases are shown", () => {
    const html = text(renderToStaticMarkup(<RatingsView ext={ext} construct="needs_fit" onConstruct={() => {}} shown={["1", "8"]} trend={{ state: "idle" }} onTrend={() => {}} />));
    expect(html).toContain("Capitec Not available Not available Not available 4.7%");
    expect(html).toContain("FNB");
    expect(html).toContain("41.2%");
    expect(html).toContain("aware n=400; valid n=380, weighted 381.2, effective 360.1");
    expect(html).toContain("Cannot judge (9 Do not know enough to judge): share of all respondents aware of the brand");
    expect(html).not.toMatch(/\b0\.0%/);
  });
  it("a construct the file lacks says Not measured with what is missing, and shows no brand rows", () => {
    const html = renderToStaticMarkup(<RatingsView ext={ext} construct="differentiation" onConstruct={() => {}} shown={["1", "8"]} trend={{ state: "idle" }} onTrend={() => {}} />);
    expect(text(html)).toContain("Not measured Not measured: No differentiation rating was found in this file. Missing:");
    expect(html).not.toContain('data-testid="ext-rating-row"');
  });
});

describe("choice view", () => {
  it("no episode pair: Not measured, never an empty chart", () => {
    const html = text(renderToStaticMarkup(<ChoiceView ext={ext} shown={["8"]} reasonBrand="" onReasonBrand={() => {}} onAlias={() => {}} saving={false} />));
    expect(html).toContain("Not measured Not measured: No pair of questions.");
    expect(html).not.toContain("Different brand");
  });
});

describe("Variables selector", () => {
  it("every construct with its status; a confirmation offered only in review; brands, weighting and audience controls", () => {
    const html = renderToStaticMarkup(
      <VariablesSelector
        diagnostics={[diag("needs_fit", "found"), diag("differentiation", "needs_review"), diag("price_justification", "not_measured")]}
        brands={ext.brands}
        shownBrands={["8"]}
        onBrands={() => {}}
        weighted={true}
        canWeight={true}
        onWeighted={() => {}}
        audienceOptions={[]}
        audience={null}
        onAudience={() => {}}
        storageAvailable={true}
        save={{ state: "idle" }}
        onConfirm={() => {}}
      />,
    );
    const t = text(html);
    expect(t).toContain("Variables Hide");
    expect(t).toContain("needs_fit Found");
    expect(t).toContain("differentiation Needs review");
    expect(t).toContain("price_justification Not measured");
    expect(html.match(/data-testid="ext-construct"/g)).toHaveLength(3);
    // Details open on request only (no confirmation form until the construct is opened).
    expect(html).not.toContain('data-testid="ext-confirm"');
    expect(t).toContain("Weighted Unweighted");
    expect(t).toContain("All respondents");
  });
});
