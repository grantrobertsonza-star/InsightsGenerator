/**
 * One CSV field as text a spreadsheet keeps as text (Codex RR-F07, 2026-10-23).
 *
 * RFC 4180 quoting: a value with a comma, quote or line break is wrapped in quotes with inner
 * quotes doubled, so it cannot break the file's columns.
 *
 * Formula neutralising: a spreadsheet opening a CSV treats a cell starting with `=`, `+`, `-` or
 * `@` (also after leading spaces), or with a tab or carriage return, as a formula, so text from a
 * report, the model or a researcher could become a live formula. Such a value is written with a
 * leading apostrophe, the spreadsheet convention for "this is text"; Excel and LibreOffice show the
 * text without running it. The apostrophe is the only change, and only for those values. Every
 * field this app writes to CSV is text (findings, labels, dates), so no number loses its sign.
 */
const FORMULA_LEAD = /^[\t\r]|^\s*[=+\-@]/;

export function csvField(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
