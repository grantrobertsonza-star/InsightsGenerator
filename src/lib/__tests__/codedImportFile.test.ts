// A coding file read through the vendored SheetJS 0.20.3 (RR-F05, 2026-10-23): an .xlsx with a
// merged code cell, a one-sheet-per-code workbook and a CSV give the same entries as the parser does
// from the grid, so the upgrade changes nothing a researcher's coding import relies on.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readCodingFile } from "../codedImportFile";

const rows = [
  ["Document", "Quotation Content", "Codes", "Comment"],
  ["P1", "My data ran out and I was charged again", "Billing; Bundle confusion", ""],
  ["P1", "I just want someone to own the problem", "Accountability", ""],
  ["P2", "Nothing was coded here", "", ""],
];
const expected = [
  ["Billing", "My data ran out and I was charged again"],
  ["Bundle confusion", "My data ran out and I was charged again"],
  ["Accountability", "I just want someone to own the problem"],
];
const xlsx = (sheets: Record<string, (string | number)[][]>, merges?: XLSX.Range[]) => {
  const wb = XLSX.utils.book_new();
  for (const [name, grid] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(grid);
    if (merges) ws["!merges"] = merges;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

describe("coding files through SheetJS 0.20.3", () => {
  it("reads an .xlsx table and a CSV the same way", async () => {
    const fromXlsx = await readCodingFile(xlsx({ Quotations: rows }), "coding.xlsx");
    expect(fromXlsx.entries.map((e) => [e.code, e.quote])).toEqual(expected);
    const csv = Buffer.from(rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n"), "utf8");
    const fromCsv = await readCodingFile(csv, "coding.csv");
    expect(fromCsv.entries.map((e) => [e.code, e.quote])).toEqual(expected);
  });

  it("fills a merged code cell down its rows, and uses a sheet's name as its code when the sheet has no code column", async () => {
    const merged = await readCodingFile(
      xlsx({ Sheet1: [["Code", "Quote"], ["Pricing", "It costs too much"], ["", "The fee went up"]] }, [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]),
      "merged.xlsx",
    );
    expect(merged.entries.map((e) => [e.code, e.quote])).toEqual([
      ["Pricing", "It costs too much"],
      ["Pricing", "The fee went up"],
    ]);
    const perCode = await readCodingFile(xlsx({ Support: [["Quote"], ["Nobody called back"]] }), "per-code.xlsx");
    expect(perCode.entries.map((e) => [e.code, e.quote])).toEqual([["Support", "Nobody called back"]]);
  });

  it("the installed SheetJS is the vendored 0.20.3", () => {
    expect(XLSX.version).toBe("0.20.3");
  });
});
