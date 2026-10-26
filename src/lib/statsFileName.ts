const STATS_FILE_EXTENSIONS = [".sav", ".dta", ".sas7bdat"] as const;

/** True for SPSS, Stata and SAS file names. Safe to import in client code. */
export function isStatsFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return STATS_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const CASE_TABLE_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"] as const;

/** True for CSV and Excel file names, which the cross tab tool reads when the file is case-level data. */
export function isCaseTableFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return CASE_TABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
