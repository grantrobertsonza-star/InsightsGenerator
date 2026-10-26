// AN500-F01 (Codex, 2026-10-24): predictors X1, X2, X3 labelled "Service", "Service", "Service (X2)"
// were all shown as "Service" / "Service (X2)" / "Service (X2)", and the chart joined importance to
// performance by that name, so X3 (mean 106) was plotted at X2's mean of 16. These check the naming
// and the code-based joins every consumer now uses, including reports saved before codes existed.
import { describe, expect, it } from "vitest";
import { driverDisplayNames, driverRowsAmbiguous, recordForRow } from "../driverPresentation";

const p = (name: string, label: string) => ({ name, label });

describe("driver display names stay unique, including against generated suffixes", () => {
  it("the reported fixture: a literal label equal to another predictor's generated name", () => {
    const names = driverDisplayNames([p("X1", "Service"), p("X2", "Service"), p("X3", "Service (X2)")]);
    expect(new Set(names).size).toBe(3);
    // X3's own label is kept; X2 takes a further suffix rather than X3's name.
    expect(names).toEqual(["Service", "Service (X2) (2)", "Service (X2)"]);
  });

  it("ordinary duplicate labels get the predictor's code", () => {
    expect(driverDisplayNames([p("Q1", "Speed"), p("Q2", "Speed"), p("Q3", "Speed")])).toEqual(["Speed", "Speed (Q2)", "Speed (Q3)"]);
  });

  it("is unique whatever the order, and a reorder does not change which code a name carries", () => {
    const preds = [p("X1", "Service"), p("X2", "Service"), p("X3", "Service (X2)")];
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
      const list = order.map((i) => preds[i]);
      const names = driverDisplayNames(list);
      expect(new Set(names).size).toBe(3);
      // X3's literal label is reserved, so it is always X3's name, never X2's.
      expect(names[list.findIndex((x) => x.name === "X3")]).toBe("Service (X2)");
    }
  });

  it("distinct labels are left as they are; an empty label falls back to the code", () => {
    expect(driverDisplayNames([p("A", "Price"), p("B", "Quality"), p("C", "")])).toEqual(["Price", "Quality", "C"]);
  });
});

describe("joins by predictor code", () => {
  const rows = [
    { name: "Service (X2)", variable: "X3" },
    { name: "Service", variable: "X1" },
    { name: "Service (X2) (2)", variable: "X2" },
  ];
  const performance = [
    { name: "Service", variable: "X1", mean: 6 },
    { name: "Service (X2) (2)", variable: "X2", mean: 16 },
    { name: "Service (X2)", variable: "X3", mean: 106 },
  ];

  it("the strongest driver X3 joins to its own mean, 106, not X2's 16", () => {
    expect(recordForRow(rows[0], performance, rows)?.mean).toBe(106);
    expect(recordForRow(rows[2], performance, rows)?.mean).toBe(16);
  });

  it("a code join ignores names entirely: a performance record with the same name but another code is not used", () => {
    const misnamed = [{ name: "Service (X2)", variable: "X2", mean: 16 }];
    expect(recordForRow(rows[0], misnamed, rows)).toBeNull();
  });

  it("an old report without codes joins by a name only when that name is unique", () => {
    const oldRows = [{ name: "Service" }, { name: "Service (X2)" }, { name: "Service (X2)" }];
    const oldPerf = [{ name: "Service", mean: 6 }, { name: "Service (X2)", mean: 16 }, { name: "Service (X2)", mean: 106 }];
    expect(recordForRow(oldRows[0], oldPerf, oldRows)?.mean).toBe(6);
    // Colliding names: no guess.
    expect(recordForRow(oldRows[1], oldPerf, oldRows)).toBeNull();
    expect(recordForRow(oldRows[2], oldPerf, oldRows)).toBeNull();
  });

  it("ambiguity is reported only for old rows that share a name", () => {
    expect(driverRowsAmbiguous(rows)).toBe(false);
    expect(driverRowsAmbiguous([{ name: "A" }, { name: "B" }])).toBe(false);
    expect(driverRowsAmbiguous([{ name: "A" }, { name: "A" }])).toBe(true);
  });
});
