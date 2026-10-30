# CSV exports keep text as text

Codex RR-F07 (2026-10-23). `src/lib/csvField.ts` is the one rule for a CSV field: RFC 4180 quoting
(a comma, quote or line break wraps the value in quotes with inner quotes doubled), and formula
neutralising: a value starting with `=`, `+`, `-` or `@` (also after leading spaces), or with a tab
or carriage return, is written with a leading apostrophe, the spreadsheet convention for text, so a
finding's wording can never become a live formula. Used by the history export
(`api/runs/[id]/history/export`), where every field is text, and by the Indicator data CSV (batch 54,
`indicatorDisplay.indicatorCsv`), whose two value columns go through `csvNumberField`: a plain decimal
number (signed, with an exponent) is written as it is, so a negative value keeps its sign as a number;
anything else goes through `csvField`, so no formula can pass. Test: `indicatorDisplay.test.ts`.

Test: `historyCsvFormula.db.test.ts`: the field rule's cases, and the actual route's bytes opened by
headless LibreOffice (`LIBREOFFICE_PATH` or `/usr/bin/soffice`; the case is skipped, never passed,
when it is not installed): `=1+1` and `@SUM(1,2)` are text cells with no formula; text with commas,
quotes and a line break keeps its columns.
