// IMP-015: the actual import-screen notice (LabelDiagnosticsNotice in ImportQualityPanel.tsx) and the
// checks table's Value labels row (ValueLabelsRow, 2026-10-22), rendered to static markup. Checks what a
// researcher reads: which variables conflict, that no label was chosen, the recovery step, and every
// unmatched label-sheet name with its exact count. How the page loads the
// diagnostics (getLabelDiagnostics in page.tsx) is not executed here.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/dataQuality", async () => await import("../dataQuality"));
// The withheld-preview notice offers "Read the file again" (a server action); not exercised here.
vi.mock("@/lib/dataSetupActions", () => ({ readDataFileAction: vi.fn() }));

const { LabelDiagnosticsNotice, ValueLabelsRow } = await import("../../app/runs/[id]/ImportQualityPanel");

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
    expect(renderToStaticMarkup(<LabelDiagnosticsNotice conflicts={[]} />)).toBe("");
    expect(renderToStaticMarkup(<table><tbody><ValueLabelsRow conflicts={[]} unmatched={[]} /></tbody></table>)).toBe("<table><tbody></tbody></table>");
  });

  it("names the conflicting variable once, says no label was chosen, and gives the recovery step", () => {
    const html = renderToStaticMarkup(
      <LabelDiagnosticsNotice
        conflicts={[
          { variable: "q", kind: "value_label", value: 1 },
          { variable: "q", kind: "value_label", value: 2 },
        ]}
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

  it("counts label-sheet names that match no data column and lists every one of them", () => {
    const names = Array.from({ length: 22 }, (_, i) => `q_old_${i + 1}`);
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <ValueLabelsRow conflicts={[{ variable: "q", kind: "value_label", value: 1 }, { variable: "q", kind: "value_label", value: 2 }]} unmatched={names} />
        </tbody>
      </table>,
    );
    const t = text(html);
    expect(t).toContain("Value labels");
    expect(t).toContain("22 variables in the label sheets are not in the data");
    expect(t).toContain("not applied");
    expect(t).toContain("1 variable has conflicting labels");
    for (const n of names) expect(html).toContain(`<li class="break-all">${n}</li>`);
  });
});
