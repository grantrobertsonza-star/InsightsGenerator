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
 * NOT YET VERIFIED END TO END: the cross-function call this makes (Node
 * server action -> Python serverless function, both in the same Vercel
 * deployment) hasn't been exercised against a live deployment from this
 * session - see the accompanying message for why. Test it, ideally with
 * `vercel dev` locally against a real file, before relying on it.
 */
export async function parseStatsFile(storagePath: string, sourceFilename: string): Promise<ParsedTable> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not download file from storage: ${error?.message}`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());

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
    headers: {
      "content-type": "application/octet-stream",
      "x-source-filename": sourceFilename,
    },
    body: buffer,
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

  return (await response.json()) as ParsedTable;
}
