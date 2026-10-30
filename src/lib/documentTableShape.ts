// The tables the model reads from a Word, PDF or PowerPoint document's pages, given their shape (import test library
// L4, path B, 29 October 2026). The model returns headers and rows as arrays; everything about how those become a
// stored table is decided here, so it is the same for every document and can be tested without a model.
//   - B-02: a banner's group row (Wave 1: Yes, No; Wave 2: Yes, No) is kept by naming each column with its group, so
//     two columns printed "Yes" stay two columns. Without groups, a repeated name gets the engine's "(2)" suffix.
//   - B-03: pages are read five at a time; a table that runs on from the last page of one part into the first page
//     of the next, with the same columns and no title of its own, is one table, joined.
//   - B-05: a page the document does not have is never stored as the table's page.
//   - B-06: a row with more or fewer cells than there are columns is kept as read (surplus cells dropped, missing
//     ones blank) and counted, so the reading says so instead of passing silently.
import { setCell, type TableCell } from "./rowCells";

export type ShapedTable = {
  label: string | null;
  sourcePage: number | null;
  headers: string[];
  rows: Record<string, TableCell>[];
  /** What the reading had to adjust, said with the table (empty when nothing). */
  notes: string[];
};

/** Names columns by their group when the model gives one, and makes every name unique ("Yes (2)"). */
export function columnNames(headers: string[], groups: (string | null)[] | null): string[] {
  const named = headers.map((h, i) => {
    const g = groups?.[i]?.trim();
    return g && g !== h.trim() ? `${g}: ${h}` : h;
  });
  const seen = new Map<string, number>();
  const taken = new Set(named);
  return named.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    if (count === 1) return n;
    let k = count;
    while (taken.has(`${n} (${k})`)) k++;
    taken.add(`${n} (${k})`);
    return `${n} (${k})`;
  });
}

/** One table as read from a part of the document, shaped; pages is the set of page numbers that part holds. */
export function shapeTable(
  raw: { page_number?: unknown; label?: unknown; headers?: unknown; column_groups?: unknown; rows?: unknown },
  pages: Set<number>,
): ShapedTable | null {
  const notes: string[] = [];
  const page = typeof raw.page_number === "number" ? raw.page_number : null;
  let sourcePage = page;
  if (page !== null && !pages.has(page)) {
    sourcePage = null;
    notes.push(`The reading named page ${page}, which is not one of the pages it read, so no page is recorded.`);
  }
  const label = typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label.trim() : null;
  const printed = Array.isArray(raw.headers) ? raw.headers.filter((h): h is string => typeof h === "string") : [];
  const groups = Array.isArray(raw.column_groups) && raw.column_groups.length === printed.length
    ? raw.column_groups.map((g) => (typeof g === "string" ? g : null))
    : null;
  const headers = columnNames(printed, groups);
  const rawRows = (Array.isArray(raw.rows) ? raw.rows : []).filter((r): r is unknown[] => Array.isArray(r));
  if (headers.length === 0 || rawRows.length === 0) return null;
  let longer = 0;
  let shorter = 0;
  const rows = rawRows.map((row) => {
    if (row.length > headers.length) longer++;
    if (row.length < headers.length) shorter++;
    const record: Record<string, TableCell> = {};
    headers.forEach((header, index) => {
      const cell = row[index];
      setCell(record, header, typeof cell === "string" || typeof cell === "number" ? cell : null);
    });
    return record;
  });
  if (longer > 0) notes.push(`${longer} row${longer === 1 ? " has" : "s have"} more cells than there are columns; the cells beyond the last column were left out.`);
  if (shorter > 0) notes.push(`${shorter} row${shorter === 1 ? " has" : "s have"} fewer cells than there are columns; the missing cells are blank.`);
  return { label, sourcePage, headers, rows, notes };
}

/**
 * Joins a table that runs on across the boundary between two parts: the last table of a part, on that part's last
 * page, and the first table of the next part, on its first page, with the same columns and no title of its own (or
 * the same title). Parts are in page order.
 */
export function joinAcrossParts(parts: { firstPage: number; lastPage: number; tables: ShapedTable[] }[]): ShapedTable[] {
  const out: ShapedTable[] = [];
  let previous: { lastPage: number } | null = null;
  for (const part of parts) {
    part.tables.forEach((t, i) => {
      const before = out[out.length - 1];
      const runsOn =
        i === 0 &&
        previous !== null &&
        before !== undefined &&
        before.sourcePage === previous.lastPage &&
        t.sourcePage === part.firstPage &&
        before.headers.length === t.headers.length &&
        before.headers.every((h, k) => h === t.headers[k]) &&
        (t.label === null || t.label === before.label);
      if (runsOn) {
        out[out.length - 1] = {
          ...before,
          rows: [...before.rows, ...t.rows],
          notes: [...before.notes, ...t.notes, `Continues on page ${t.sourcePage}; read as one table.`],
        };
      } else out.push(t);
    });
    previous = { lastPage: part.lastPage };
  }
  return out;
}
