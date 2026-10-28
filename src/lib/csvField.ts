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
 * text without running it. The apostrophe is the only change, and only for those values. Text fields
 * (findings, labels, dates) go through csvField; a number goes through csvNumberField, so a negative
 * number keeps its sign.
 */
const FORMULA_LEAD = /^[\t\r]|^\s*[=+\-@]/;

export function csvField(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A number written as a plain decimal (optionally signed, with an exponent): written as it is, so a
 * spreadsheet reads it as a number and "-2.5" keeps its sign. Anything that is not such a number is
 * written as text through csvField, so this can never let a formula through.
 */
const PLAIN_NUMBER = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

export function csvNumberField(value: string): string {
  return PLAIN_NUMBER.test(value) ? value : csvField(value);
}
