import limits from "../../api/import-limits.json";

export const IMPORT_LIMITS = limits;

// The owner's declared release limits (api/import-limits.json, shared with the Python reader).
// 2026-10-19: raised from 20,000,000 to 100,000,000 bytes at Grant's decision, after the 20 MB limit
// added on 2026-10-16 blocked FinScope SA 2024.sav (26.7 MB), accepted before the limit existed.
// Measured then: the 80.8 MB FinScope SA 2025.sav reads in about 10 s at 1.5 GB peak memory, inside
// the deployed reader's 2,048 MB and 60 s (vercel.json). Messages are built from the numbers so they
// can never disagree with the limit actually enforced.
const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
export const FILE_LIMIT_MESSAGE = `This file exceeds the supported ${mb(limits.maxFileBytes)} limit (${limits.maxFileBytes.toLocaleString("en-GB")} bytes). Split it into smaller files, then retry.`;
export const CASE_LIMIT_MESSAGE = `This file exceeds the supported ${limits.maxCases.toLocaleString("en-GB")} case limit. Split it into smaller files, then retry; no partial result was published.`;
export const LIMITS_CAPTION = `Up to ${mb(limits.maxFileBytes)} and ${limits.maxCases.toLocaleString("en-GB")} cases per file`;

export function assertImportCaseCount(cases: number) {
  if (cases > limits.maxCases) throw new Error(CASE_LIMIT_MESSAGE);
}

export function assertImportFileSupported(fileName: string, size: number) {
  if (size > limits.maxFileBytes) throw new Error(FILE_LIMIT_MESSAGE);
  if (/\.sas7bdat$/i.test(fileName)) throw new Error("SAS imports are excluded from the supported release scope pending verification. Export this file as CSV or XLSX, then retry.");
}
