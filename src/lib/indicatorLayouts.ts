// What the Indicator data screen needs from the reader's vocabulary, kept apart from indicatorData.ts so a
// client component can import it: indicatorData.ts reads and writes the database (pg), which cannot be bundled
// for the browser (the production build failed with "Can't resolve 'tls'" when the panel imported it).

export const INDICATOR_LAYOUTS = ["sdmx_long", "data360_wide", "wdi_wide", "imf_wide", "oecd_sdmx", "oecd_notes", "label_value"] as const;
export type IndicatorLayout = (typeof INDICATOR_LAYOUTS)[number];

export const INDICATOR_LAYOUT_LABEL: Record<IndicatorLayout, string> = {
  sdmx_long: "Data360 / SDMX long",
  data360_wide: "Data360 wide",
  wdi_wide: "World Bank WDI wide",
  imf_wide: "IMF data portal wide",
  oecd_sdmx: "OECD Data Explorer SDMX-CSV",
  oecd_notes: "OECD reference information (notes)",
  label_value: "Label and value table",
};

/** Areas one chart may compare at once: more lines than this cannot be told apart. */
export const MAX_INDICATOR_AREAS = 12;

/**
 * The engine's period rule (_IND_PERIOD with _ind_period_in_calendar in api/parse-stats-file.py): a year, or
 * a year with a quarter, half, ISO week, month (2015-M03 or 2015-03) or date, where the month, week or date
 * exists. Mirrored here and kept equal by indicatorData.test.ts, so the server refuses a stored period the
 * engine would refuse, and the chart never moves a value to another date (Codex NEW10K-F01: 2024-M13 was
 * stored, then drawn as 2025-M01 with no value).
 */
const INDICATOR_PERIOD_SHAPE = /^[0-9]{4}(?:-(?:Q[1-4]|S[12]|W[0-9]{2}|M[0-9]{2}|[0-9]{2}(?:-[0-9]{2})?))?$/;

export function indicatorPeriodValid(text: string): boolean {
  if (!INDICATOR_PERIOD_SHAPE.test(text)) return false;
  const m = /^([0-9]{4})-(?:M([0-9]{2})|W([0-9]{2})|([0-9]{2})(?:-([0-9]{2}))?)$/.exec(text);
  if (!m) return true; // a year, a quarter or a half: the shape already limits them
  const [, year, monthM, week, month, day] = m;
  if (week !== undefined) return Number(week) >= 1 && Number(week) <= 53;
  const monthNumber = Number(monthM ?? month);
  if (monthNumber < 1 || monthNumber > 12) return false;
  if (day === undefined) return true;
  const d = new Date(Date.UTC(Number(year), monthNumber - 1, Number(day)));
  return d.getUTCFullYear() === Number(year) && d.getUTCMonth() === monthNumber - 1 && d.getUTCDate() === Number(day);
}
