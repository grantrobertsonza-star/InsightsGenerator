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
