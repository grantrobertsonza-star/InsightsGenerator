/**
 * Writing and reading one column's value on a row object keyed by column name (Codex TR500-F01).
 *
 * Column names are researcher data, and a few of them are special to plain JavaScript objects:
 * assigning `row["__proto__"] = 10` sets the object's prototype instead of storing 10, so the
 * column survives in the headers while every value in it is lost; and reading
 * `row["constructor"]` from a row with no such own value returns a function, not "missing".
 * Every reader that builds rows from column names writes through `setCell` (a defined own
 * property, never an assignment), and a comparison that must not be fooled by an inherited
 * property reads through `cellValue`. Rows written this way serialise to JSON with the column, and
 * JSON parsing (the database, the engine's replies) gives own properties back.
 */
export function setCell<T>(row: Record<string, T>, name: string, value: T): void {
  Object.defineProperty(row, name, { value, writable: true, enumerable: true, configurable: true });
}

/** The row's own value for a column, or undefined when the row has none (never an inherited one). */
export function cellValue<T>(row: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(row, name) ? row[name] : undefined;
}

/**
 * One stored table cell, as the engine's one reader writes it (parseTable.ts): text, a number, a
 * genuine Excel logical cell (true/false, kept logical; CSV TRUE/FALSE are text), or missing (null).
 */
export type TableCell = string | number | boolean | null;

/**
 * The text a preview shows for one cell (Codex B26-F02). React renders neither `true` nor `false`, so a
 * logical cell rendered directly looks the same as a missing one. Logical cells are written TRUE/FALSE,
 * as Excel shows them and as the engine writes a logical name (_literal_text); zero stays "0"; only a
 * missing cell (null, or no own value) is blank. Display only: the stored value is never converted.
 */
export function cellText(value: TableCell | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}
