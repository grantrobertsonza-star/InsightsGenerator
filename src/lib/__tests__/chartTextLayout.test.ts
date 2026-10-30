// Chart legends and titles fit the chart's width (Grant, 29 October 2026: legends cut off). Expected placements
// worked out by hand from the stated estimate (0.64 x font size per bold character, 14 for the swatch, 18
// between entries).
import { describe, expect, it } from "vitest";
import { fitText, legendLayout, textWidth, wrapTitle } from "../chartTextLayout";

describe("legendLayout", () => {
  it("wraps to a new row instead of running past the width (nine provinces in a 522-wide chart)", () => {
    const labels = ["Western Cape (n=872)", "Eastern Cape (n=568)", "Northern Cape (n=260)", "Free State (n=368)", "KwaZulu- Natal (n=828)", "North West (n=400)", "Gauteng (n=900)", "Mpumalanga (n=500)", "Limpopo (n=704)"];
    const { placements, rows } = legendLayout(labels.map((label) => ({ label })), 507, 10.5);
    expect(rows).toBeGreaterThan(1);
    placements.forEach((p, i) => expect(p.x + 14 + textWidth(labels[i], 10.5, true)).toBeLessThanOrEqual(507));
  });
  it("places entries left to right on one row when they fit; the first entry starts each row at 0", () => {
    const { placements, rows } = legendLayout([{ label: "Male" }, { label: "Female" }], 500, 10);
    // "Male" is 4 x 6.4 = 25.6 wide; with its swatch 39.6, plus 18: the next starts at 57.6.
    expect(rows).toBe(1);
    expect(placements[0]).toEqual({ x: 0, row: 0 });
    expect(placements[1].x).toBeCloseTo(57.6, 5);
  });
  it("an entry wider than the row gets a row of its own; no entries, no rows", () => {
    expect(legendLayout([{ label: "a" }, { label: "x".repeat(200) }, { label: "b" }], 100, 10).placements.map((p) => p.row)).toEqual([0, 1, 2]);
    expect(legendLayout([], 100, 10).rows).toBe(0);
  });
});

describe("wrapTitle and fitText", () => {
  const long = "C1_36. Source of money- Salary/wage/ money from individuals - Domestic worker/Char";
  it("a long title breaks at spaces into lines that each fit", () => {
    const lines = wrapTitle(long, 500, 18);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(textWidth(l, 18, true)).toBeLessThanOrEqual(500);
    expect(lines.join(" ")).toBe(long);
  });
  it("past two lines the last ends with an ellipsis and still fits", () => {
    const lines = wrapTitle(long, 250, 18);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(textWidth(lines[1], 18, true)).toBeLessThanOrEqual(250);
  });
  it("a short title is one line, unchanged; a single over-long word is shortened", () => {
    expect(wrapTitle("HH_size", 500, 18)).toEqual(["HH_size"]);
    const [w] = wrapTitle("x".repeat(100), 200, 18);
    expect(w.endsWith("…")).toBe(true);
    expect(textWidth(w, 18, true)).toBeLessThanOrEqual(200);
    expect(fitText("Short", 200, 10)).toBe("Short");
  });
});
