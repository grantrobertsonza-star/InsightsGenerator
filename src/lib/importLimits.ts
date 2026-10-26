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

/**
 * Python data files that are not read, and why. A pickle can run code when it is opened, so a pickle
 * from anyone else is never opened here; Feather needs a reader too large for the deployed engine.
 * Both say how to save the same data in a form that is read.
 */
export const REFUSED_DATA_FILE: Record<string, string> = {
  ".pkl": "Python pickle files can run code when they are opened, so they are not read. Save the data frame as Parquet (df.to_parquet(\"data.parquet\")) or CSV and upload that instead.",
  ".pickle": "Python pickle files can run code when they are opened, so they are not read. Save the data frame as Parquet (df.to_parquet(\"data.parquet\")) or CSV and upload that instead.",
  ".feather": "Feather files are not read yet. Save the data as Parquet (df.to_parquet(\"data.parquet\"), or write_parquet in R) and upload that instead.",
};

export function assertImportFileSupported(fileName: string, size: number) {
  const ext = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0] ?? "";
  if (REFUSED_DATA_FILE[ext]) throw new Error(REFUSED_DATA_FILE[ext]);
  if (size > limits.maxFileBytes) throw new Error(FILE_LIMIT_MESSAGE);
}
