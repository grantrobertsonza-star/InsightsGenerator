"use server";

import { getDocumentProxy } from "unpdf";
import { withTenantRead } from "./db";
import { countWords, reviewCoverage, type ReviewCoverage } from "./documentIndicators";
import { requireTenantId } from "./requestContext";
import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";

export type DocumentIndicators = {
  /** null when the text has not been read from the file yet. */
  words: number | null;
  chars: number | null;
  /** A page count, or why there is none: kept apart, so unknown is never shown as zero. */
  pages: { count: number } | { count: null; reason: string };
  /** Briefs and proposals only (kind "evidence"); null for reports and for text not yet read. */
  coverage: ReviewCoverage | null;
};
export type DocumentIndicatorsResult = { ok: true; indicators: DocumentIndicators } | { ok: false; error: string };

// Page counts by stored PDF, so selecting a file again does not download it again. A changed file is
// a new upload with a new storage path, so a key never goes stale; bounded so it cannot grow forever.
const PAGE_CACHE = new Map<string, number>();
const PAGE_CACHE_LIMIT = 500;

/**
 * Size indicators for one imported brief, proposal or report (rules in documentIndicators.ts): words
 * and characters from the text the app read, pages from the PDF it reads. Read-only, scoped to this
 * project and organisation. Counting pages downloads the PDF once per server process; a failed
 * download says so rather than reporting no pages.
 */
export async function documentIndicatorsAction(runId: string, documentId: string): Promise<DocumentIndicatorsResult> {
  const tenantId = await requireTenantId();
  const doc = await withTenantRead(tenantId, async (client) =>
    (
      await client.query<{ kind: string; storage_path: string; preview_storage_path: string | null; source_filename: string; extracted_text: string | null }>(
        "select kind, storage_path, preview_storage_path, source_filename, extracted_text from documents where id = $1 and run_id = $2 and tenant_id = $3",
        [documentId, runId, tenantId],
      )
    ).rows[0],
  );
  if (!doc) return { ok: false, error: "That file is not in this project." };
  const text = doc.extracted_text;
  const words = text === null ? null : countWords(text);
  const chars = text === null ? null : text.length;
  const coverage = doc.kind === "evidence" && chars !== null ? reviewCoverage(chars) : null;

  const pdf = doc.preview_storage_path ?? (/\.pdf$/i.test(doc.source_filename) ? doc.storage_path : null);
  let pages: DocumentIndicators["pages"];
  if (!pdf) {
    pages = { count: null, reason: text === null ? "not counted until the file has been read" : "no PDF copy of this file to count pages from" };
  } else if (PAGE_CACHE.has(pdf)) {
    pages = { count: PAGE_CACHE.get(pdf)! };
  } else {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(pdf);
    if (error || !data) {
      pages = { count: null, reason: `the PDF could not be downloaded (${error?.message ?? "no data"})` };
    } else {
      try {
        const proxy = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()));
        const count = proxy.numPages;
        if (PAGE_CACHE.size >= PAGE_CACHE_LIMIT) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value!);
        PAGE_CACHE.set(pdf, count);
        pages = { count };
      } catch (e) {
        pages = { count: null, reason: `the PDF could not be read (${e instanceof Error ? e.message : String(e)})` };
      }
    }
  }
  return { ok: true, indicators: { words, chars, pages, coverage } };
}
