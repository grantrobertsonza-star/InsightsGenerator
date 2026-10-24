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
