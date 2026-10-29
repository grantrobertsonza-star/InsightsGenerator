// Batch 47: the table method version the TypeScript side compares with must be the one the engine
// writes into every table's notes; read from the engine source, so the two cannot drift apart.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_LABEL_READER, CURRENT_TABLE_METHOD, EARLIER_METHOD_TEXT, WORKBOOK_LABELS_TEXT, earlierMethodText, tableMethodStatus } from "../tableMethod";

describe("table method version", () => {
  it("equals the engine's TABLE_METHOD", () => {
    const engine = readFileSync(path.resolve(__dirname, "../../../api/parse-stats-file.py"), "utf8");
    const m = engine.match(/^TABLE_METHOD = "([^"]+)"$/m);
    expect(m?.[1]).toBe(CURRENT_TABLE_METHOD);
    expect(engine).toMatch(/"methodVersion": TABLE_METHOD/);
  });

  it("a table with no recorded version, or another one, was built with an earlier method", () => {
    expect(tableMethodStatus(CURRENT_TABLE_METHOD)).toBe("current");
    expect(tableMethodStatus(null)).toBe("earlier");
    expect(tableMethodStatus(undefined)).toBe("earlier");
    expect(tableMethodStatus("2026.10.26")).toBe("earlier");
  });

  it("a table saved under the batch 47 method is earlier: its row % and shares of responses came from rounded counts (CT5K-F01)", () => {
    expect(tableMethodStatus("2026.10.27")).toBe("earlier");
    expect(EARLIER_METHOD_TEXT).toMatch(/unrounded weighted counts/);
  });
});

// Codex R1-F01: a table read from a workbook before the label reader repair may have merged answers; it is earlier
// until rebuilt. Tables from other formats, and workbook tables read with the repaired reader, are not.
describe("workbook tables read before the label reader repair (R1)", () => {
  it("the label reader version equals the engine's LABEL_READER, written into every table's notes", () => {
    const engine = readFileSync(path.resolve(__dirname, "../../../api/parse-stats-file.py"), "utf8");
    expect(engine.match(/^LABEL_READER = "([^"]+)"$/m)?.[1]).toBe(CURRENT_LABEL_READER);
    expect(engine).toMatch(/"labelReader": LABEL_READER/);
  });
  it("an old workbook table is earlier, with the workbook reason; rebuilt it is current", () => {
    expect(tableMethodStatus(CURRENT_TABLE_METHOD, { sourceFile: "Car_Brand_Tracker_Wave_1.xlsx", labelReader: null })).toBe("earlier");
    expect(earlierMethodText(CURRENT_TABLE_METHOD, { sourceFile: "Car_Brand_Tracker_Wave_1.xlsx", labelReader: null })).toBe(WORKBOOK_LABELS_TEXT);
    expect(tableMethodStatus(CURRENT_TABLE_METHOD, { sourceFile: "wave.XLS", labelReader: CURRENT_LABEL_READER })).toBe("current");
  });
  it("other formats are unaffected; an unknown source is judged on the method version alone", () => {
    expect(tableMethodStatus(CURRENT_TABLE_METHOD, { sourceFile: "wave.csv", labelReader: null })).toBe("current");
    expect(tableMethodStatus(CURRENT_TABLE_METHOD, { sourceFile: "wave.sav" })).toBe("current");
    expect(tableMethodStatus(CURRENT_TABLE_METHOD)).toBe("current");
    expect(earlierMethodText("2026.10.27", { sourceFile: "w.xlsx" })).toBe(EARLIER_METHOD_TEXT);
  });
});

