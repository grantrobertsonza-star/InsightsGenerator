// IMP-015: the actual import-screen notice (LabelDiagnosticsNotice in ImportQualityPanel.tsx),
// rendered to static markup. Checks what a researcher reads: which variables conflict, that no
// label was chosen, the recovery step, and the unmatched-name diagnosis. How the page loads the
// diagnostics (getLabelDiagnostics in page.tsx) is not executed here.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/dataQuality", async () => await import("../dataQuality"));

const { LabelDiagnosticsNotice } = await import("../../app/runs/[id]/ImportQualityPanel");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("LabelDiagnosticsNotice (IMP-015)", () => {
  it("renders nothing when there is nothing to report", () => {
    expect(renderToStaticMarkup(<LabelDiagnosticsNotice conflicts={[]} unmatched={[]} />)).toBe("");
  });

  it("names the conflicting variable once, says no label was chosen, and gives the recovery step", () => {
    const html = renderToStaticMarkup(
      <LabelDiagnosticsNotice
        conflicts={[
          { variable: "q", kind: "value_label", value: 1 },
          { variable: "q", kind: "value_label", value: 2 },
        ]}
        unmatched={[]}
      />,
    );
    expect(html).toContain('role="alert"');
    const t = text(html);
    expect(t).toContain('the variable "q"');
    expect(t.match(/"q"/g)).toHaveLength(1);
    expect(t).toContain("No label was chosen");
    expect(t).toContain("counts are unaffected");
    expect(t).toContain("correct the label sheets in the workbook");
    expect(t).toContain("recalculate them after re-uploading");
  });

  it("lists label-sheet names that match no data column", () => {
    const t = text(renderToStaticMarkup(<LabelDiagnosticsNotice conflicts={[]} unmatched={["q_old"]} />));
    expect(t).toContain('"q_old"');
    expect(t).toContain("not applied");
  });
});
