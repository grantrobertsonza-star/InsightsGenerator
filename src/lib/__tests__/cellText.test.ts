// Codex B26-F02: the one display rule for a stored table cell (rowCells.cellText), used by the Import
// Preview (TranscriptSetup), the run page's table preview and the finding source viewer (FindingsTable).
// React renders neither true nor false, so these surfaces used to show a logical cell as blank.
import { describe, expect, it } from "vitest";
import { cellText } from "../rowCells";
import { isMissing } from "../dataQuality";
import { buildTableDigest } from "../tableDigestCharts";

describe("cellText", () => {
  it("shows logical cells as TRUE/FALSE, keeps zero, and leaves only a missing cell blank", () => {
    expect(cellText(true)).toBe("TRUE");
    expect(cellText(false)).toBe("FALSE");
    expect(cellText(0)).toBe("0");
    expect(cellText("")).toBe("");
    expect(cellText("FALSE")).toBe("FALSE");
    expect(cellText(2.5)).toBe("2.5");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
  });

  it("a logical cell is an answer in Data quality, not missing", () => {
    expect(isMissing(true)).toBe(false);
    expect(isMissing(false)).toBe(false);
    expect(isMissing(null)).toBe(true);
  });

  it("the table digest charts logical cells under TRUE/FALSE, not as blank categories", () => {
    const rows = [{ a: true }, { a: false }, { a: true }, { a: null }];
    const [digest] = buildTableDigest(["a"], rows);
    expect(digest.kind).toBe("categorical");
    if (digest.kind !== "categorical") return;
    expect(Object.fromEntries(digest.bars.map((b) => [b.category, b.count]))).toEqual({ TRUE: 2, FALSE: 1 });
  });
});
