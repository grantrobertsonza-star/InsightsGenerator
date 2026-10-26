// FND-001 golden-thread smoke repairs: the actual DOCX and deck story-export routes, with the actual
// discovery loader (discoveryReport.ts), support loader, framing qualification and document
// builders. Mocked boundaries only: the database wrapper (the scripted client in
// helpers/fakeStoryDb.ts, here also answering the discovery reads), current-settings lookups and
// chart rendering. The produced files are unzipped and read back as a reader would see them.
//
// Fixture (helpers/fakeStoryDb.ts): accepted insights si-cur (current), si-stale (a figure
// changed), si-inv (a source finding rejected); two net-new computed findings from survey.xlsx; two
// contradictions, one resting on si-inv, one on a computed finding and one on a computed finding
// the researcher rejected.
//   1. "New insights beyond the report" follows the support rule: si-inv is not listed as a new
//      insight there, nor as the basis of a contradiction; si-stale is listed with its reason.
//      The existing exclusion disclosure still names si-inv, once.
//   2. Net-new findings carry their own sources on the deck, also when every insight the
//      narrative cites is excluded.
//   3. The saved framing is printed as generated, with the qualification beside it.
// Not established here: rendered layout (checked separately by rendering the files).
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/methodologyStatus", async () => await import("../methodologyStatus"));

const state = vi.hoisted(() => ({
  statements: [] as string[],
  supportAvailable: true,
  discovery: true,
  pillarInsightIds: undefined as string[] | undefined,
}));

vi.mock("../db", async () => (await import("./helpers/fakeStoryDb")).dbModule(state));
vi.mock("@/lib/db", async () => (await import("./helpers/fakeStoryDb")).dbModule(state));
vi.mock("@/lib/docxReport", async () => await import("../docxReport"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/narrativeFreshness", async () => await import("../narrativeFreshness"));
vi.mock("@/lib/evidenceTrail", async () => await import("../evidenceTrail"));
vi.mock("@/lib/objectiveCoverage", async () => await import("../objectiveCoverage"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
vi.mock("@/lib/discoveryReport", async () => await import("../discoveryReport"));
vi.mock("@/lib/discoverySlides", async () => await import("../discoverySlides"));
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

const decode = (x: string) =>
  x
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** DOCX sections: heading text -> the paragraphs under it, in order. */
async function docxSections(response: Response): Promise<{ heading: string; paragraphs: string[] }[]> {
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const xml = await zip.file("word/document.xml")!.async("string");
  const out = [{ heading: "(start)", paragraphs: [] as string[] }];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const text = decode(p.replace(/<\/w:t>/g, "</w:t>")).trim();
    if (!text) continue;
    if (/<w:pStyle w:val="Heading\d"/.test(p)) out.push({ heading: text, paragraphs: [] });
    else out.at(-1)!.paragraphs.push(text);
  }
  return out;
}

/** Deck slides' text, in slide order. */
async function slides(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  return Promise.all(names.map(async (n) => decode((await zip.file(n)!.async("string")).replace(/<\/a:p>/g, "\n"))));
}

const params = { params: Promise.resolve({ id: "run-1" }) };
const FRAMING_ALL =
  "Support no longer valid: this framing was written before a change to the evidence it rests on and is shown as it was generated. " +
  "Of the 4 insights it uses, 2 are no longer valid, 1 has changed since it was drafted and 1 is current. Regenerate the report to update it.";
const FRAMING_ONLY_INVALID =
  "Support no longer valid: this framing was written before a change to the evidence it rests on and is shown as it was generated. " +
  "Of the 1 insight it uses, 1 is no longer valid. Regenerate the report to update it.";

beforeEach(() => {
  state.statements = [];
  state.supportAvailable = true;
  state.discovery = true;
  state.pillarInsightIds = undefined;
});

describe("DOCX: new-insights section, sources and framing follow the support rule", () => {
  it("lists only eligible new insights (changed one qualified), drops the contradiction resting on the invalid insight, and qualifies the framing in place", async () => {
    const { GET } = await import("../../app/api/runs/[id]/story/export-docx/route");
    const doc = await docxSections(await GET(new Request("http://x/"), params));
    const section = (h: string) => doc.find((s) => s.heading === h)?.paragraphs ?? [];

    const newInsights = section("New insights").join("\n");
    expect(newInsights).toContain("Current insight headline");
    expect(newInsights).toContain("Stale insight headline");
    expect(newInsights).toMatch(/Support changed since drafted: the figures in “Brand A leads on trust by 12 points” changed\./);
    expect(newInsights).not.toContain("Invalid insight headline");

    const contradictions = section("Where the evidence contradicts the report").join("\n");
    expect(contradictions).toContain("Region A grew fastest");
    expect(contradictions).not.toContain("Region C leads");
    // A contradiction resting on a REJECTED finding is not shown as evidence, and is disclosed.
    expect(contradictions).not.toContain("Region D");
    // One whose finding was re-worded since is shown, qualified in place.
    expect(contradictions).toMatch(/Region E grew[\s\S]*Support changed since drafted: the contradicting finding's wording was edited after this contradiction was found/);
    expect(section("Excluded from this report: needs review").join("\n")).toContain(
      "Contradiction: “Region D is flat”, contradicted by “Region D fell 9 points” (the contradicting finding was rejected)",
    );

    const findings = section("New findings from the data").join("\n");
    expect(findings).toContain("Region B leads (robust; source: survey.xlsx, Region by year)");
    expect(findings).toMatch(/Region C is flat \(.*; source: survey\.xlsx\)/);

    // Outside its exclusion section, the invalid insight appears only in the pillar's own
    // "Left out:" disclosure, never as content.
    const outside = doc.filter((s) => !/^Excluded from this report/.test(s.heading));
    const mentions = outside.flatMap((s) => s.paragraphs).filter((p) => p.includes("Invalid insight headline"));
    expect(mentions).toEqual(["Left out: Invalid insight headline (Support no longer valid: “Older claim about region C” was rejected.)"]);
    const excluded = section("Excluded from this report: needs review").join("\n");
    expect(excluded.match(/Insight: Invalid insight headline/g)).toHaveLength(1);

    // Framing: printed as saved, the qualification is the very next paragraph.
    const summary = section("Executive summary");
    expect(summary).toEqual(["Executive summary text.", FRAMING_ALL]);
    const insights = section("Insights");
    expect(insights.slice(0, 2)).toEqual(["Invest where demand is growing.", FRAMING_ALL]);
    expect(state.statements.filter((q) => /^\s*(insert|update|delete)\b/i.test(q))).toEqual([]);
  });

  it("every framing passage is qualified when the only cited insight is excluded", async () => {
    state.pillarInsightIds = ["si-inv"];
    const { GET } = await import("../../app/api/runs/[id]/story/export-docx/route");
    const doc = await docxSections(await GET(new Request("http://x/"), params));
    expect(doc.find((s) => s.heading === "Executive summary")?.paragraphs).toEqual(["Executive summary text.", FRAMING_ONLY_INVALID]);
  });

  it("current support everywhere: no framing qualification and nothing excluded", async () => {
    state.pillarInsightIds = ["si-cur"];
    state.discovery = false;
    const { GET } = await import("../../app/api/runs/[id]/story/export-docx/route");
    const doc = await docxSections(await GET(new Request("http://x/"), params));
    expect(doc.find((s) => s.heading === "Executive summary")?.paragraphs).toEqual(["Executive summary text."]);
  });
});

describe("deck: new-insights slides, sources and framing follow the support rule", () => {
  it("shows the invalid insight only on the evidence-status slide, qualifies every framing slide, and attributes net-new findings", async () => {
    const { GET } = await import("../../app/api/runs/[id]/story/export/route");
    const deck = await slides(await GET(new Request("http://x/"), params));
    const status = deck.findIndex((s) => s.includes("EVIDENCE STATUS: NEEDS REVIEW"));
    expect(status).toBeGreaterThan(0);
    expect(deck.slice(0, status).join("\n")).not.toContain("Invalid insight headline");
    expect(deck[status].match(/Insight left out: Invalid insight headline/g)).toHaveLength(1);

    const newInsights = deck.find((s) => s.includes("NEW INSIGHTS"))!;
    expect(newInsights).toContain("Current insight headline");
    expect(newInsights).toMatch(/Stale insight headline[\s\S]*Support changed since drafted/);
    const contradictions = deck.find((s) => s.includes("WHERE THE EVIDENCE CONTRADICTS THE REPORT"))!;
    expect(contradictions).toContain("Region A grew fastest");
    expect(contradictions).not.toContain("Region C leads");
    expect(deck.slice(0, status).join("\n")).not.toContain("Region D");
    expect(contradictions).toMatch(/Region E grew[\s\S]*Support changed since drafted: the contradicting finding's wording was edited/);
    expect(deck[status]).toContain("Contradiction left out: “Region D is flat”, contradicted by “Region D fell 9 points”; the contradicting finding was rejected.");

    const findings = deck.find((s) => s.includes("NEW FINDINGS FROM THE DATA"))!;
    expect(findings).toContain("Regions: Region B leads (source: survey.xlsx, Region by year)");
    expect(findings).toContain("Regions: Region C is flat (source: survey.xlsx)");

    // Each saved-framing slide carries the qualification on the slide itself.
    for (const label of ["Executive summary", "SCQA", "Governing thought", "The shape of this argument"]) {
      const slide = deck.find((s) => s.trimEnd().endsWith(label) || s.includes(`\n${label}\n`))!;
      expect(slide, label).toBeTruthy();
      expect(slide.replace(/\n/g, " "), label).toContain(FRAMING_ALL);
    }
  });

  it("with every cited insight excluded, the deck still names the sources of the findings it shows", async () => {
    state.pillarInsightIds = ["si-inv"];
    const { GET } = await import("../../app/api/runs/[id]/story/export/route");
    const deck = await slides(await GET(new Request("http://x/"), params));
    const status = deck.findIndex((s) => s.includes("EVIDENCE STATUS: NEEDS REVIEW"));
    expect(deck.slice(0, status).join("\n")).not.toContain("Invalid insight headline");
    expect(deck.join("\n")).toContain("(source: survey.xlsx, Region by year)");
    const summary = deck.find((s) => s.includes("EXECUTIVE SUMMARY") && s.includes("Executive summary text."))!;
    expect(summary.replace(/\n/g, " ")).toContain(FRAMING_ONLY_INVALID);
  });
});
