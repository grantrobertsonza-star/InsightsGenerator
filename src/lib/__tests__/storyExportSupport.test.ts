// FND-001 / REP-OUT-001 (F8, F11): the actual DOCX and deck story-export route handlers, with the
// actual support loader, classifier and document builders. Mocked boundaries only: the database
// wrapper (a scripted client), the two current-settings lookups, chart rendering and the
// discovery section (unrelated to this change). The produced .docx/.pptx is unzipped and its text
// read back, so these assert what a reader of the file would see, not intermediate structures.
//
// Fixture: one generated narrative whose single pillar references four insights -
//   si-cur   current support                          -> shown, no note
//   si-stale a source finding's figures changed       -> shown, with a "changed since drafted" note
//   si-inv   a source finding was rejected            -> left out AND listed with its reason
//   si-gone  no longer accepted / no longer exists    -> counted as left out
// and two accepted recommendations, one on si-cur and one on si-inv (left out and listed).
//
// Not established here: layout/pagination of the rendered files (needs a visual render check).
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const state = vi.hoisted(() => ({ statements: [] as string[], supportAvailable: true }));

vi.mock("../db", async () => (await import("./helpers/fakeStoryDb")).dbModule(state));
vi.mock("@/lib/db", async () => (await import("./helpers/fakeStoryDb")).dbModule(state));
vi.mock("@/lib/docxReport", async () => await import("../docxReport"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
// Discovery data is not what these tests are about: an empty section, with the real support rule.
vi.mock("@/lib/discoveryReport", async () => ({
  ...(await import("../discoveryReport")),
  loadDiscoveryReportData: vi.fn(async () => ({ inputState: "complete", netNewSources: [], verificationNote: null, netNewInsights: [], netNewFindings: [], netNewFindingsOmitted: 0, contradictions: [] })),
}));
vi.mock("@/lib/discoverySlides", () => ({ addDiscoverySlides: vi.fn() }));
vi.mock("@/lib/exportChartImages", () => ({ buildChartImagesByTheme: vi.fn(async () => []) }));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/latestVerdict", async () => await import("../latestVerdict"));
vi.mock("../crosstabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../crosstabs")>()),
  resolveCurrentDesignSnapshotStatus: vi.fn(async () => ({ ok: true, snapshot: "null" })),
}));
vi.mock("../variableOverrides", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../variableOverrides")>()),
  loadVariableOverrides: vi.fn(async () => ({})),
}));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

vi.setConfig({ testTimeout: 30000 });

async function textOf(response: Response, kind: "docx" | "pptx"): Promise<string> {
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter((n) => (kind === "docx" ? n === "word/document.xml" : /^ppt\/slides\/slide\d+\.xml$/.test(n)))
    .sort((a, b) => Number(a.match(/\d+/g)?.pop() ?? 0) - Number(b.match(/\d+/g)?.pop() ?? 0));
  const xml = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  return xml
    .map((x) => x.replace(/<\/w:p>|<\/a:p>/g, "\n").replace(/<[^>]+>/g, ""))
    .join("\n")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const params = { params: Promise.resolve({ id: "run-1" }) };

beforeEach(() => {
  state.statements = [];
  state.supportAvailable = true;
});

function noWrites() {
  return state.statements.filter((s) => /^\s*(insert|update|delete)\b/i.test(s));
}

describe("DOCX story export applies the support status (F8)", () => {
  it("keeps current and changed insights (changed one noted), lists the invalid insight and its recommendation, and never writes", async () => {
    const { GET } = await import("../../app/api/runs/[id]/story/export-docx/route");
    const text = await textOf(await GET(new Request("http://x/"), params), "docx");

    expect(text).toContain("Current insight headline");
    expect(text).toContain("Stale insight headline");
    expect(text).toMatch(/Support changed since drafted: the figures in “Brand A leads on trust by 12 points” changed\./);

    // The invalid insight is not reported as a finding of the report...
    const body = text.split("Excluded from this report: needs review")[0];
    expect(body).not.toMatch(/Invalid insight observation/);
    // ...but it is listed, with the reason, and so is its recommendation.
    expect(text).toContain("Excluded from this report: needs review");
    expect(text).toMatch(/Insight: Invalid insight headline \(Support no longer valid: “Older claim about region C” was rejected\.\)/);
    expect(text).toMatch(/Recommendation: Act on the invalid insight \(its insight "Invalid insight headline" is no longer supported/);
    expect(text).toContain("Act on the current insight");

    // Per-pillar note: the invalid and the no-longer-accepted references.
    expect(text).toMatch(/2 insights referenced here are no longer current and have been left out\./);
    expect(text).toMatch(/Left out: An insight this narrative referenced \(it is no longer accepted or no longer exists\)/);
    // The saved framing is printed as generated, with its qualification directly beside it (the
    // next paragraph) under the executive summary and under the governing thought. si-gone counts
    // as no longer valid, the same rule the app's support line uses.
    const framing =
      "Support no longer valid: this framing was written before a change to the evidence it rests on and is shown as it was generated. " +
      "Of the 4 insights it uses, 2 are no longer valid, 1 has changed since it was drafted and 1 is current. Regenerate the report to update it.";
    expect(text).toContain(`Executive summary text.\n${framing}`);
    expect(text).toContain(`Invest where demand is growing.\n${framing}`);

    expect(noWrites()).toEqual([]);
  });

  it("without migration 0096 every shown insight is qualified as not checked; rejection is still excluded", async () => {
    state.supportAvailable = false;
    const { GET } = await import("../../app/api/runs/[id]/story/export-docx/route");
    const text = await textOf(await GET(new Request("http://x/"), params), "docx");
    expect(text).toContain("Current insight headline");
    expect(text).toMatch(/Support not checked: it was drafted before support tracking/);
    expect(text).toMatch(/Insight: Invalid insight headline \(Support no longer valid/);
  });
});

describe("deck story export applies the support status (F8)", () => {
  it("badges changed support in words, keeps the invalid insight off the pillar slides and lists it on the evidence-status slide", async () => {
    const { GET } = await import("../../app/api/runs/[id]/story/export/route");
    const text = await textOf(await GET(new Request("http://x/"), params), "pptx");

    expect(text).toContain("Current insight headline");
    expect(text).toContain("Stale insight headline");
    expect(text).toMatch(/· SUPPORT CHANGED/);
    // Golden-thread repair: insight cards name their evidence's sources; one without recorded sources says so.
    expect(text).toContain("Sources: report.docx, p. 2; survey.xlsx");
    expect(text).toContain("Source not recorded");

    const statusSlide = text.split("EVIDENCE STATUS: NEEDS REVIEW")[1] ?? "";
    expect(statusSlide).toMatch(/Insight left out: Invalid insight headline\. Support no longer valid: “Older claim about region C” was rejected\./);
    expect(statusSlide).toMatch(/Recommendation left out: Act on the invalid insight\./);
    expect(statusSlide).toMatch(/1 insight reference in this narrative is no longer accepted or no longer exists/);
    expect(statusSlide).toMatch(/Stale insight headline\. Support changed since drafted/);
    // The invalid insight appears only on the status slide, never as a pillar card.
    expect(text.split("EVIDENCE STATUS: NEEDS REVIEW")[0]).not.toContain("Invalid insight headline");
    expect(text).not.toContain("Act on the invalid insight · ");

    expect(noWrites()).toEqual([]);
  });
});
