import limits from "../../api/import-limits.json";

export const IMPORT_LIMITS = limits;

export function assertImportCaseCount(cases: number) {
  if (cases > limits.maxCases) throw new Error("This file exceeds the supported 100,000 case limit. Split it into smaller files, then retry; no partial result was published.");
}

export function assertImportFileSupported(fileName: string, size: number) {
  if (size > limits.maxFileBytes) throw new Error("This file exceeds the supported 20 MB limit (20,000,000 bytes). Split it into smaller files, then retry.");
  if (/\.sas7bdat$/i.test(fileName)) throw new Error("SAS imports are excluded from the supported release scope pending verification. Export this file as CSV or XLSX, then retry.");
}
