// Batch 47: the table method version the TypeScript side compares with must be the one the engine
// writes into every table's notes; read from the engine source, so the two cannot drift apart.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_TABLE_METHOD, EARLIER_METHOD_TEXT, tableMethodStatus } from "../tableMethod";

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
