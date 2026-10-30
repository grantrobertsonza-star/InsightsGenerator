// SAS (.sas7bdat, and .xpt transport files) enabled 26 October 2026 after reference-file verification
// (dataFileFormats.db.test.ts, fixtures/sas).
// R (.rds, .RData, .rda) and Parquet (pandas, Polars, Spark, R arrow) since 26 October 2026, read by
// the engine through pyreadr and fastparquet (dataFileFormats.db.test.ts, fixtures/r).
const STATS_FILE_EXTENSIONS = [".sav", ".zsav", ".dta", ".sas7bdat", ".xpt", ".rds", ".rdata", ".rda", ".parquet"] as const;

/** True for SPSS, Stata, SAS, R and Parquet file names. Safe to import in client code. */
export function isStatsFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return STATS_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// .txt is a delimited text export (tab, comma, semicolon or pipe); it is a table only when uploaded as
// Raw data or Tables, which every caller checks (ingestion_type) before asking this.
const CASE_TABLE_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".xls"] as const;

/** True for CSV, TSV, delimited text and Excel file names, which the cross tab tool reads when the file is case-level data. */
export function isCaseTableFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return CASE_TABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
