// FND-001 probe B, static part: the ACTUAL FindingsTable rendered to static markup with the
// wording-edit state the page passes it. Checks what a researcher sees: an edited report finding
// is marked, keeps its extracted wording visible, and says when it is not yet re-checked; only a
// report finding offers "Edit wording"; nothing is editable when the state is unavailable; a failed
// load is announced rather than shown as "nothing edited". Mounted interaction (save, conflict,
// revert clicks) is not established here; the server side of those is covered by
// findingWording.db.test.ts.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/findingActions", () => ({}));
vi.mock("@/lib/previewActions", () => ({}));
vi.mock("@/components/icons", async () => await import("../../components/icons"));
vi.mock("@/lib/findingsChartData", async () => await import("../findingsChartData"));
vi.mock("@/lib/discoveryClassification", async () => await import("../discoveryClassification"));
vi.mock("@/lib/rowCells", async () => await import("../rowCells"));
vi.mock("@/lib/findingBasis", async () => await import("../findingBasis"));
vi.mock("@/lib/evidenceOverview", async () => await import("../evidenceOverview"));
vi.mock("../../app/runs/[id]/FindingsChart", () => ({ default: () => null }));

const { default: FindingsTable } = await import("../../app/runs/[id]/FindingsTable");

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const base = {
  data_type: "quantitative" as const,
  finding_kind: "fact" as const,
  theme: "Satisfaction",
  status: "accepted" as const,
  source_filename: "report.pdf",
  source_page: 3,
  quote_verified: true,
  source_document_id: "doc-1",
  source_table_id: null,
  source_cells: null,
  duplicate_group_id: null,
  researcher_note: null,
  pattern_type: null,
  stated_stats: null,
  created_at: "2026-10-16T00:00:00Z",
  corroborates_report_claim: false,
  is_contradicted: false,
  contradicts_report: false,
  reproduced_runs: null,
  total_runs: null,
  supporting_segments: null,
  supporting_speakers: null,
  quote_match: null,
  designFreshness: null,
};
const stated = { ...base, id: "f-stated", origin: "stated" as const, finding_text: "Satisfaction is 71% among recent customers." };
const computed = { ...base, id: "f-computed", origin: "generated" as const, finding_text: "Satisfaction is 72% (base 300).", theme: "Computed" };

describe("FindingsTable wording-edit state (probe B)", () => {
  it("marks an edited report finding, shows its extracted wording and the pending re-check; only report findings are editable", () => {
    const html = renderToStaticMarkup(
      <FindingsTable
        runId="run-1"
        findings={[stated, computed] as never}
        wordingEdits={{ available: true, edits: { "f-stated": { originalText: "Satisfaction is 72% among recent customers.", recheckPending: true } } }}
      />,
    );
    const t = text(html);
    expect(html).toContain('data-testid="finding-wording-edited"');
    expect(t).toContain("Edited by researcher");
    expect(t).toContain("Extracted wording Satisfaction is 72% among recent customers.");
    expect(t).toContain("Wording edited: not yet re-checked against the data.");
    expect(t).toContain("Revert to extracted wording");
    expect(t.split("Edit wording").length - 1).toBe(1); // the report finding only, not the computed one
  });

  it("a re-checked edit no longer says it is pending", () => {
    const t = text(
      renderToStaticMarkup(
        <FindingsTable
          runId="run-1"
          findings={[stated] as never}
          wordingEdits={{ available: true, edits: { "f-stated": { originalText: "x", recheckPending: false } } }}
        />,
      ),
    );
    expect(t).toContain("Edited by researcher");
    expect(t).not.toContain("not yet re-checked");
  });

  it("unavailable (migration not applied): nothing editable; a failed load is announced, not shown as unedited", () => {
    const off = text(renderToStaticMarkup(<FindingsTable runId="run-1" findings={[stated] as never} wordingEdits={{ available: false, edits: {} }} />));
    expect(off).not.toContain("Edit wording");
    const failed = renderToStaticMarkup(
      <FindingsTable runId="run-1" findings={[stated] as never} wordingEdits={{ available: false, edits: {}, error: "connection reset" }} />,
    );
    expect(failed).toContain('data-testid="wording-edits-error"');
    expect(text(failed)).toMatch(/could not be loaded \(connection reset\)/);
  });
});
