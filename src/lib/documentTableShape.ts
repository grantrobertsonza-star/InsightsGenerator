// The tables the model reads from a Word, PDF or PowerPoint document's pages, given their shape (import test library
// L4, path B, 29 October 2026). The model returns headers and rows as arrays; everything about how those become a
// stored table is decided here, so it is the same for every document and can be tested without a model.
//   - B-02: a banner's group row (Wave 1: Yes, No; Wave 2: Yes, No) is kept by naming each column with its group, so
//     two columns printed "Yes" stay two columns. Without groups, a repeated name gets the engine's "(2)" suffix.
//   - B-03: pages are read five at a time; a table that runs on from the last page of one part into the first page
//     of the next, with the same columns and no title of its own, is one table, joined. The table keeps the page it
//     starts on (sourcePage, the page a citation names) and separately the last page it is known to reach (lastPage),
//     which is what decides whether it runs on into the next part; so a table can run on across three or more parts
//     (Codex T2-F02, 30 October 2026: the join compared the start page, so a third part never joined).
//   - B-05: a page the document does not have is never stored as the table's page.
//   - B-06: a row with more or fewer cells than there are columns is kept as read (surplus cells dropped, missing
//     ones blank) and counted, so the reading says so instead of passing silently.
import { setCell, type TableCell } from "./rowCells";

export type ShapedTable = {
  label: string | null;
  sourcePage: number | null;
  /** The last page the table is known to reach (its reading's last_page_number, else sourcePage); null without a page. */
  lastPage: number | null;
  /** Whether the reading itself said where the table ends (last_page_number), rather than lastPage defaulting to sourcePage. */
  lastPageStated: boolean;
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
  raw: { page_number?: unknown; last_page_number?: unknown; label?: unknown; headers?: unknown; column_groups?: unknown; rows?: unknown },
  pages: Set<number>,
): ShapedTable | null {
  const notes: string[] = [];
  const page = typeof raw.page_number === "number" ? raw.page_number : null;
  let sourcePage = page;
  if (page !== null && !pages.has(page)) {
    sourcePage = null;
    notes.push(`The reading named page ${page}, which is not one of the pages it read, so no page is recorded.`);
  }
  // Where the table ends: only a page of this part, from its start page on, counts; anything else is said and left
  // out, so the table is taken to end where it starts (unknown is never a reach it was not shown to have).
  const end = typeof raw.last_page_number === "number" ? raw.last_page_number : null;
  let lastPage = sourcePage;
  let lastPageStated = false;
  if (end !== null && sourcePage !== null && end !== sourcePage) {
    if (Number.isInteger(end) && pages.has(end) && end > sourcePage) {
      lastPage = end;
      lastPageStated = true;
    } else notes.push(`The reading said the table ends on page ${end}, which is not a page after its start among the pages it read, so the end page was not used.`);
  } else if (end !== null && sourcePage !== null) lastPageStated = true;
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
  return { label, sourcePage, lastPage, lastPageStated, headers, rows, notes };
}

/**
 * Joins a table that runs on across the boundary between two parts: the last table of a part, reaching that part's
 * last page, and the first table of the next part, on its first page, with the same columns and no title of its own
 * (or the same title). Parts are in page order. Repeats across any number of parts: a joined table keeps its start
 * page and carries forward the last page reached, so it can run on again into the part after.
 *
 * A continuation's own end: the page the reading gave (last_page_number), else, when the continuation is the only
 * table read in its part, that part's last page (a table read from a part's first page with nothing else in the part
 * is taken to fill it; the note says so when a further join relies on it). Otherwise it ends on the page it was read
 * on. A part read with no tables breaks the run: the parts on either side are not adjacent pages.
 */
export function joinAcrossParts(parts: { firstPage: number; lastPage: number; tables: ShapedTable[] }[]): ShapedTable[] {
  const out: ShapedTable[] = [];
  // Whether the last output table's reach was inferred from its part (not stated, not its own page).
  let reachInferred = false;
  let previous: { lastPage: number } | null = null;
  for (const part of parts) {
    part.tables.forEach((t, i) => {
      const before = out[out.length - 1];
      const runsOn =
        i === 0 &&
        previous !== null &&
        before !== undefined &&
        before.lastPage === previous.lastPage &&
        t.sourcePage === part.firstPage &&
        before.headers.length === t.headers.length &&
        before.headers.every((h, k) => h === t.headers[k]) &&
        (t.label === null || t.label === before.label);
      if (runsOn) {
        const inferReach = !t.lastPageStated && part.tables.length === 1 && part.lastPage > (t.lastPage ?? part.lastPage);
        const notes = [...before.notes, ...t.notes, `Continues on page ${t.sourcePage}; read as one table.`];
        if (reachInferred) notes.push(`Read as running on to page ${previous!.lastPage}, the end of the part it continued into, since that part held no other table and the reading did not say where it ends.`);
        out[out.length - 1] = { ...before, lastPage: inferReach ? part.lastPage : t.lastPage, rows: [...before.rows, ...t.rows], notes };
        reachInferred = inferReach;
      } else {
        out.push(t);
        reachInferred = false;
      }
    });
    previous = { lastPage: part.lastPage };
  }
  return out;
}
