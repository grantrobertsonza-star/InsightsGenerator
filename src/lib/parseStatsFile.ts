import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string | number | null>[];
};

const STATS_FILE_EXTENSIONS = [".sav", ".dta", ".sas7bdat"] as const;

export function isStatsFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return STATS_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Reads an SPSS (.sav), Stata (.dta), or SAS (.sas7bdat) file by handing
 * it to the Python conversion function at api/parse-stats-file.py (see
 * that file for why this has to leave the Node/TypeScript runtime: there's
 * no reliable JS reader for these binary formats, and their variable/value
 * label metadata is usually the actual point of the format, not optional
 * extra).
 *
 * Returns the same { headers, rows } shape parseTableDocument does, with
 * headers already resolved to each variable's label (falling back to its
 * raw SPSS/Stata/SAS name when it has none) and categorical values already
 * decoded from numeric codes to their label text, so every downstream
 * consumer - the table preview, the banner-plan picker,
 * bannerPlanComputation.ts - sees exactly what it already expects from a
 * CSV/Excel upload and needs no SPSS-specific branch of its own.
 *
 * This function tells the Python function where the file already is in
 * Supabase Storage rather than sending it the file's bytes, and the
 * Python function writes its result back to storage rather than returning
 * it directly, both for the same reason: Vercel serverless functions cap
 * a function invocation's request AND response body at 4.5MB, and a real
 * SPSS/Stata/SAS file - let alone its fully label-decoded JSON equivalent,
 * which is usually larger again - routinely exceeds that (confirmed
 * against a 26MB real file: a direct byte-body call failed with
 * FUNCTION_PAYLOAD_TOO_LARGE, a 413, before this was fixed). Downloading
 * the converted result from storage here is an ordinary Supabase Storage
 * download, not a function invocation payload, so it has no such limit.
 */
export async function parseStatsFile(storagePath: string, sourceFilename: string): Promise<ParsedTable> {
  // VERCEL_URL is set automatically on Vercel (preview and production) to
  // this deployment's own hostname, so this always calls the sibling
  // Python function within the same deployment rather than guessing at a
  // separately configured service URL. PARSE_STATS_FILE_URL is the escape
  // hatch for local development with `vercel dev`, where VERCEL_URL isn't
  // set; without either, this falls back to localhost on the default
  // Next.js dev port, which only works if the Python function is also
  // being served locally (plain `next dev` does not do that -- use
  // `vercel dev` to exercise this path locally at all).
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.PARSE_STATS_FILE_URL ?? "http://127.0.0.1:3000";

  const response = await fetch(`${base}/api/parse-stats-file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storagePath, sourceFilename, bucket: BUCKET }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      message = (JSON.parse(detail) as { error?: string }).error ?? detail;
    } catch {
      // detail wasn't JSON; use it as-is
    }
    throw new Error(
      `Couldn't read this as SPSS/Stata/SAS data (${response.status}). ${message || "The conversion step failed."}`
    );
  }

  const { resultPath } = (await response.json()) as { resultPath: string };

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(resultPath);
  if (error || !data) {
    throw new Error(`Converted SPSS/Stata/SAS result could not be read back from storage: ${error?.message}`);
  }
  const parsed = JSON.parse(await data.text()) as ParsedTable;

  // Best-effort cleanup: this intermediate file has no further use once
  // read, and leaving it around would otherwise just accumulate in the
  // bucket indefinitely. A failure here is never worth surfacing to the
  // caller - the actual table has already been read successfully.
  await supabaseAdmin.storage.from(BUCKET).remove([resultPath]).catch(() => {});

  return parsed;
}
