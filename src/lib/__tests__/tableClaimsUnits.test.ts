// Batch 57 (import test library L4, 28 October 2026): a report claim checked against an aggregated table, through the
// actual fromGeneric and checkAtom. Expected stances are written from the tables below by hand.
//   S1 AGG-02: 0.6 stored for an Excel cell shown as 60% (a column adding to 1) supports "60%".
//   S1 AGG-12: Findex's 0.811 under "(%, age 15+)" supports "81%".
//   S1 AGG-08: a stated "34%" is not compared with a count of 163 (silent with the reason, never "against").
//   S1 AGG-19: a constant first column does not collapse an indicator table into one row.
//   S2 AGG-06: "55+" does not resolve to a column named "5" (whole words, not characters).
// Controls: a percentage column of 0 to 100 is unchanged; a column of counts 0 and 1 is not read as proportions.
import { describe, expect, it } from "vitest";
import { checkAtom, fromGeneric } from "../tableClaims";
import { matchLabel } from "../evidenceStance";

const stanceOf = (view: ReturnType<typeof fromGeneric>, row: string, col: string, stated: string) =>
  checkAtom(view, { kind: "level", row, col, statedText: stated }).find((r) => r.check === "stated_figure" || r.check === "locate");

describe("claims against aggregated tables (batch 57)", () => {
  it("AGG-02: a proportion column adding to 1 supports the stated percentage, and says how it was read", () => {
    const view = fromGeneric("t", "d", "Heard of Brand X", ["Answer", "Total"], [
      { Answer: "Yes", Total: 0.6 }, { Answer: "No", Total: 0.35 }, { Answer: "Don't know", Total: 0.05 },
    ]);
    const r = stanceOf(view, "Yes", "Total", "60%");
    expect(r?.stance).toBe("supports");
    expect(r?.summary).toMatch(/read as proportions/);
  });
  it("AGG-12: Findex 0.811 under a % label supports 81%", () => {
    const view = fromGeneric("t", "d", "Account (%, age 15+)", ["Economy", "Value"], [{ Economy: "South Africa", Value: 0.811 }, { Economy: "Kenya", Value: 0.79 }]);
    expect(stanceOf(view, "South Africa", "Value", "81%")?.stance).toBe("supports");
  });
  it("AGG-08: a stated percentage is not compared with a count", () => {
    const view = fromGeneric("t", "d", "Satisfaction by gender (counts)", ["Answer", "Men", "Women"], [
      { Answer: "Very satisfied", Men: 163, Women: 170 }, { Answer: "Base", Men: 480, Women: 520 },
    ]);
    const r = stanceOf(view, "Very satisfied", "Men", "34%");
    expect(r?.stance).toBe("silent");
    expect(r?.summary).toMatch(/not show as a percentage/);
  });
  it("AGG-19: rows are named by the first column that varies, not a constant first column", () => {
    const view = fromGeneric("t", "d", "DHS", ["STRUCTURE", "INDICATOR", "OBS_VALUE"], [
      { STRUCTURE: "datastructure", INDICATOR: "Antenatal care", OBS_VALUE: 42.3 },
      { STRUCTURE: "datastructure", INDICATOR: "Skilled birth", OBS_VALUE: 42.4 },
    ]);
    expect(view.rows).toEqual(["Antenatal care", "Skilled birth"]);
    expect(stanceOf(view, "Skilled birth", "OBS_VALUE", "42.4")?.stance).toBe("supports");
  });
  it("AGG-06: 55+ is not matched to a column named 5; whole-word containment still works", () => {
    expect(matchLabel([" (5)", "18-34"], "55+")).toBeNull();
    expect(matchLabel(["Total", "Very satisfied overall"], "very satisfied")).toBe("Very satisfied overall");
  });
  it("AGG-17: the unweighted base is used for the interval when the table gives weighted and unweighted bases", () => {
    const view = fromGeneric("t", "d", "Agree (%)", ["Answer", "Men", "Women"], [
      { Answer: "Weighted base", Men: 490, Women: 510 },
      { Answer: "Unweighted base", Men: 400, Women: 600 },
      { Answer: "Agree", Men: 40, Women: 50 },
    ]);
    expect(view.cell("Agree", "Men")?.base).toBe(400);
  });
  it("Grant's decision: '-' is 0 and '*' is under 0.5%, each stated in the check", () => {
    const view = fromGeneric("t", "d", "Brand used (%)", ["Brand", "18-24", "25-34"], [
      { Brand: "Haval", "18-24": "-", "25-34": "*" },
      { Brand: "Toyota", "18-24": 40, "25-34": 38 },
    ]);
    const zero = stanceOf(view, "Haval", "18-24", "0%");
    expect(zero?.stance).toBe("supports");
    expect(zero?.summary).toMatch(/prints "-", read as 0/);
    expect(stanceOf(view, "Haval", "18-24", "5%")?.stance).toBe("against");
    const star = stanceOf(view, "Haval", "25-34", "0%");
    expect(star?.stance).toBe("supports");
    expect(star?.summary).toMatch(/under 0.5%/);
    expect(stanceOf(view, "Haval", "25-34", "3%")?.stance).toBe("against");
    expect(checkAtom(view, { kind: "level", row: "Haval", col: "25-34", threshold: 1, direction: "below" })[0].stance).toBe("supports");
  });
  it("controls: 0 to 100 percentages unchanged; counts of 0 and 1 are not proportions", () => {
    const pct = fromGeneric("t", "d", "Share (%)", ["Answer", "Total"], [{ Answer: "Yes", Total: 60 }, { Answer: "No", Total: 40 }]);
    expect(stanceOf(pct, "Yes", "Total", "60%")?.stance).toBe("supports");
    const counts = fromGeneric("t", "d", "Complaints", ["Branch", "Complaints"], [{ Branch: "A", Complaints: 0 }, { Branch: "B", Complaints: 1 }]);
    expect(stanceOf(counts, "B", "Complaints", "100%")?.stance).toBe("silent");
  });
});
