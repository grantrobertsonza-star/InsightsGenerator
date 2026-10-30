// Batch 53: grid (battery) questions linked by their stem (Grant, 28 October 2026; May 2026 IGS Poll).
// Pure matcher tests through the public matchItems; the labels are the IGS codebook's, shortened rows.
import { describe, expect, it } from "vitest";
import { FAMILY_CONFIDENCE, gridRowOf, matchItems } from "../instrumentMatch";

const STEM_A = "Regardless of whom you supported for Governor, is your opinion of each of the top candidates generally favorable or unfavorable, or do you not know enough about them to say?";
const STEM_B = "Regardless of whom you will support for Governor, is your opinion of each of the top candidates generally favorable or unfavorable, or do you not know enough about them to say?";
const ROWS = ["Tony Thurmond, California State Superintendent of Public Instruction", "Antonio Villaraigosa, Housing Affordability Advocate", "Xavier Becerra, Former U.S. Secretary", "Steve Hilton, Small Business Owner"];
const cols = (prefix: string, stem: string, note: string, order = [0, 1, 2, 3]) =>
  order.map((i) => ({ name: `${prefix}_${i + 1}`, label: `${prefix}_${i + 1} ${stem} (${note}) – ${ROWS[i]}` }));
const summaries = ROWS.map((_, i) => ({ name: `Q5_${i + 1}_summary`, label: `Q5_${i + 1} (summary) Combines Q5_${i + 1} and Q5b_${i + 1}` }));
const items = [
  { id: "5A", code: "5A", text: `${STEM_A}\na. Tony Thurmond ... b. Antonio Villaraigosa ...` },
  { id: "5B", code: "5B", text: STEM_B },
];
const linked = (r: ReturnType<typeof matchItems>, item: string) => r.filter((c) => c.itemId === item && c.method === "grid").map((c) => [c.variable, c.method, c.confidence]).sort();

describe("grid rows linked by their stem", () => {
  it("5A takes Q5_1 to Q5_4 and 5B takes Q5b_1 to Q5b_4; the codes differ, the summaries are not rows", () => {
    const r = matchItems(items, [...cols("Q5", STEM_A, "already voted"), ...cols("Q5b", STEM_B, "planning to vote"), ...summaries], { grids: true });
    expect(linked(r, "5A")).toEqual(ROWS.map((_, i) => [`Q5_${i + 1}`, "grid", FAMILY_CONFIDENCE]));
    expect(linked(r, "5B")).toEqual(ROWS.map((_, i) => [`Q5b_${i + 1}`, "grid", FAMILY_CONFIDENCE]));
    expect(r.some((c) => c.variable.endsWith("_summary"))).toBe(false);
  });
  it("rows in a randomised order, or with one row missing, are matched by their labels", () => {
    const r = matchItems([items[0]], cols("Q5", STEM_A, "already voted", [3, 0, 2]), { grids: true });
    expect(linked(r, "5A").map((x) => x[0])).toEqual(["Q5_1", "Q5_3", "Q5_4"]);
  });
  it("without the option nothing changes: before migration 0130 no grid link is made (today's single wording suggestion stays)", () => {
    const r = matchItems(items, cols("Q5", STEM_A, "already voted"));
    expect(linked(r, "5A")).toEqual([]);
  });
  it("labels from the data file alone (no codebook) work the same way", () => {
    const data = ROWS.map((row, i) => ({ name: `v${i}`, label: `${STEM_A} - ${row}` }));
    expect(linked(matchItems([items[0]], data, { grids: true }), "5A").map((x) => x[0])).toEqual(["v0", "v1", "v2", "v3"]);
  });
  it("two items with the same question are ambiguous: offered below confirm-all", () => {
    const r = matchItems([items[0], { id: "copy", code: "5C", text: STEM_A }], cols("Q5", STEM_A, "already voted"), { grids: true });
    expect(r.filter((c) => c.method === "grid").every((c) => c.confidence < 0.9)).toBe(true);
  });
  it("a stem shared by one column only, a short question, or a different question is not a grid", () => {
    expect(linked(matchItems([items[0]], cols("Q5", STEM_A, "already voted").slice(0, 1), { grids: true }), "5A")).toEqual([]);
    const short = [{ name: "a1", label: "Rate it - Price" }, { name: "a2", label: "Rate it - Quality" }];
    expect(matchItems([{ id: "s", code: "S1", text: "Rate it?" }], short, { grids: true })).toEqual([]);
    expect(linked(matchItems([items[1]], cols("Q5", STEM_A, "already voted"), { grids: true }), "5B")).toEqual([]);
  });
  it("an item whose code names the columns keeps the code rule", () => {
    const r = matchItems([{ id: "q", code: "Q5", text: STEM_A }], cols("Q5", STEM_A, "already voted"), { grids: true });
    expect(new Set(r.map((c) => c.method))).toEqual(new Set(["stem"]));
  });
  it("a label's stem and row", () => {
    expect(gridRowOf({ name: "Q5_1", label: `Q5_1 ${STEM_A} (already voted) – Tony Thurmond` })).toEqual({ stem: `${STEM_A} (already voted)`, row: "Tony Thurmond" });
    expect(gridRowOf({ name: "Q5_1_summary", label: "Q5_1 (summary) Combines Q5_1 and Q5b_1" })).toBeNull();
    expect(gridRowOf({ name: "age", label: "Age in years" })).toBeNull();
  });
});
