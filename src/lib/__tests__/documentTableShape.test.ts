import { describe, expect, it } from "vitest";
import { columnNames, joinAcrossParts, shapeTable } from "../documentTableShape";

const pages = (...n: number[]) => new Set(n);

describe("tables read from a document's pages (path B)", () => {
  it("B-02: a banner's group row names the columns, so Wave 1 and Wave 2 Yes stay apart with their values", () => {
    const t = shapeTable(
      { page_number: 1, headers: ["Province", "Yes", "No", "Yes", "No"], column_groups: [null, "Wave 1", "Wave 1", "Wave 2", "Wave 2"], rows: [["Gauteng", "48%", "52%", "55%", "45%"]] },
      pages(1, 2),
    )!;
    expect(t.headers).toEqual(["Province", "Wave 1: Yes", "Wave 1: No", "Wave 2: Yes", "Wave 2: No"]);
    expect(t.rows[0]).toEqual({ Province: "Gauteng", "Wave 1: Yes": "48%", "Wave 1: No": "52%", "Wave 2: Yes": "55%", "Wave 2: No": "45%" });
  });
  it("B-02 without groups: a repeated name is made unique, never overwritten", () => {
    expect(columnNames(["Yes", "No", "Yes", "No", "Yes (2)"], null)).toEqual(["Yes", "No", "Yes (3)", "No (2)", "Yes (2)"]);
  });
  it("B-05: a page the part did not read is not recorded, and the reading says so", () => {
    const t = shapeTable({ page_number: 99, headers: ["a", "b"], rows: [[1, 2], [3, 4]] }, pages(1, 2))!;
    expect(t.sourcePage).toBeNull();
    expect(t.notes[0]).toMatch(/page 99/);
  });
  it("B-06: longer and shorter rows are kept as read and counted", () => {
    const t = shapeTable({ page_number: 1, headers: ["a", "b"], rows: [[1, 2, 9], [3], [5, 6]] }, pages(1))!;
    expect(t.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: null }, { a: 5, b: 6 }]);
    expect(t.notes).toEqual([
      "1 row has more cells than there are columns; the cells beyond the last column were left out.",
      "1 row has fewer cells than there are columns; the missing cells are blank.",
    ]);
  });
  it("B-03: a table running on from the last page of one part into the first of the next is one table", () => {
    const a = shapeTable({ page_number: 5, label: "Table 4", headers: ["Region", "n"], rows: [["A", 1], ["B", 2]] }, pages(1, 2, 3, 4, 5))!;
    const b = shapeTable({ page_number: 6, headers: ["Region", "n"], rows: [["C", 3], ["D", 4]] }, pages(6, 7))!;
    const [t, ...rest] = joinAcrossParts([{ firstPage: 1, lastPage: 5, tables: [a] }, { firstPage: 6, lastPage: 7, tables: [b] }]);
    expect(rest).toEqual([]);
    expect(t.rows.map((r) => r.Region)).toEqual(["A", "B", "C", "D"]);
    expect(t.label).toBe("Table 4");
    expect(t.notes).toContain("Continues on page 6; read as one table.");
  });
  it("B-03 boundaries: different columns, a title of its own, or not on the joining pages stay separate", () => {
    const a = shapeTable({ page_number: 5, headers: ["Region", "n"], rows: [["A", 1], ["B", 2]] }, pages(5))!;
    const other = (raw: Record<string, unknown>) => shapeTable({ rows: [["C", 3], ["D", 4]], ...raw }, pages(6, 7))!;
    const parts = (b: ReturnType<typeof other>) => joinAcrossParts([{ firstPage: 1, lastPage: 5, tables: [a] }, { firstPage: 6, lastPage: 7, tables: [b] }]).length;
    expect(parts(other({ page_number: 6, headers: ["Region", "%"] }))).toBe(2);
    expect(parts(other({ page_number: 6, headers: ["Region", "n"], label: "Table 5" }))).toBe(2);
    expect(parts(other({ page_number: 7, headers: ["Region", "n"] }))).toBe(2);
  });
});
