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

// Codex T2-F02 (independent T2 review, 30 October 2026): the join compared the accumulated table's start page with the
// previous part's last page, so a table that had already joined pages 5 and 6 never joined page 11. The start page is
// still the citation page; the last page reached is tracked separately (lastPage).
describe("a table running on across three or more reading parts (T2-F02)", () => {
  const range = (a: number, b: number) => pages(...Array.from({ length: b - a + 1 }, (_, k) => a + k));
  const piece = (page: number, part: Set<number>, extra: Record<string, unknown> = {}) =>
    shapeTable({ page_number: page, headers: ["Region", "n"], rows: [[`R${page}a`, page], [`R${page}b`, page]], ...extra }, part)!;
  const P1 = range(1, 5), P2 = range(6, 10), P3 = range(11, 15), P4 = range(16, 20);

  it("Codex's counterexample: one table spanning parts 1-5, 6-10 and 11-15 stays one table", () => {
    const table = (page: number) => shapeTable({ page_number: page, label: "Table 1", headers: ["Region", "n"], rows: [["A", 1]] }, new Set([page]))!;
    const result = joinAcrossParts([{ firstPage: 1, lastPage: 5, tables: [table(5)] }, { firstPage: 6, lastPage: 10, tables: [table(6)] }, { firstPage: 11, lastPage: 15, tables: [table(11)] }]);
    expect(result).toHaveLength(1);
    expect(result[0].rows).toHaveLength(3);
  });
  it("joined in page order with every row and note; the citation page stays the start page; a following table stays apart", () => {
    const first = shapeTable({ page_number: 5, label: "Table 4", headers: ["Region", "n"], rows: [["A", 1], ["B", 2, 99]] }, P1)!;
    const next = shapeTable({ page_number: 13, label: "Table 5", headers: ["Region", "n"], rows: [["X", 1], ["Y", 2]] }, P3)!;
    const out = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [first] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2, { last_page_number: 10 })] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3), next] },
    ]);
    expect(out.map((t) => t.label)).toEqual(["Table 4", "Table 5"]);
    expect(out[0].rows.map((r) => r.Region)).toEqual(["A", "B", "R6a", "R6b", "R11a", "R11b"]);
    expect(out[0].sourcePage).toBe(5);
    expect(out[0].lastPage).toBe(11);
    expect(out[0].notes).toEqual([
      "1 row has more cells than there are columns; the cells beyond the last column were left out.",
      "Continues on page 6; read as one table.",
      "Continues on page 11; read as one table.",
    ]);
    expect(out[1].rows.map((r) => r.Region)).toEqual(["X", "Y"]);
  });
  it("four parts: the reach is carried forward each time", () => {
    const out = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(5, P1)] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2, { last_page_number: 10 })] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3, { last_page_number: 15 })] },
      { firstPage: 16, lastPage: 20, tables: [piece(16, P4)] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rows.map((r) => r.n)).toEqual([5, 5, 6, 6, 11, 11, 16, 16]);
    // The last piece is the only table of its part and says no end, so it is taken to reach page 20.
    expect([out[0].sourcePage, out[0].lastPage]).toEqual([5, 20]);
  });
  it("without a stated end, the only table of a part is taken to fill it, and the note says so when relied on", () => {
    const out = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(5, P1)] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2)] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3)] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].notes).toContain("Read as running on to page 10, the end of the part it continued into, since that part held no other table and the reading did not say where it ends.");
  });
  it("boundaries: a continuation said to end before its part's last page, or followed by another table, ends the run", () => {
    const endsEarly = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(5, P1)] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2, { last_page_number: 7 })] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3)] },
    ]);
    expect(endsEarly.map((t) => t.rows.length)).toEqual([4, 2]);
    expect(endsEarly[1].sourcePage).toBe(11);
    const other = shapeTable({ page_number: 9, headers: ["Brand", "%"], rows: [["K", 1], ["L", 2]] }, P2)!;
    const followed = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(5, P1)] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2), other] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3)] },
    ]);
    expect(followed.map((t) => t.rows.length)).toEqual([4, 2, 2]);
    // The same columns in the next part with a title of their own are a new table, as before.
    const titled = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(5, P1)] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2, { last_page_number: 10 })] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3, { label: "Table 9" })] },
    ]);
    expect(titled.map((t) => t.rows.length)).toEqual([4, 2]);
  });
  it("a part read with no tables breaks the run: pages 5 and 11 are not adjacent", () => {
    const out = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(5, P1)] },
      { firstPage: 6, lastPage: 10, tables: [] },
      { firstPage: 11, lastPage: 15, tables: [piece(11, P3)] },
    ]);
    expect(out).toHaveLength(2);
  });
  it("a stated end page outside the part, or before the start, is said and not used", () => {
    const outside = piece(6, P2, { last_page_number: 12 });
    expect([outside.lastPage, outside.lastPageStated]).toEqual([6, false]);
    expect(outside.notes).toEqual(["The reading said the table ends on page 12, which is not a page after its start among the pages it read, so the end page was not used."]);
    const before = piece(8, P2, { last_page_number: 7 });
    expect(before.lastPage).toBe(8);
    // A start page the part lacks gives no page at all, so no end either, and it never joins.
    const noPage = shapeTable({ page_number: 99, last_page_number: 10, headers: ["Region", "n"], rows: [["A", 1], ["B", 2]] }, P2)!;
    expect([noPage.sourcePage, noPage.lastPage]).toEqual([null, null]);
  });
  it("a table that starts mid-part and is read as reaching the part's last page now runs on (its end page said)", () => {
    const out = joinAcrossParts([
      { firstPage: 1, lastPage: 5, tables: [piece(3, P1, { last_page_number: 5 })] },
      { firstPage: 6, lastPage: 10, tables: [piece(6, P2)] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sourcePage).toBe(3);
    // Without its end page it does not (unchanged).
    expect(joinAcrossParts([{ firstPage: 1, lastPage: 5, tables: [piece(3, P1)] }, { firstPage: 6, lastPage: 10, tables: [piece(6, P2)] }])).toHaveLength(2);
  });
});
