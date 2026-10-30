"use server";

import { withTenantRead } from "./db";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { supabaseAdmin } from "./supabaseAdmin";

const BUCKET = "documents";
/** Long enough to open or download, short enough that a forwarded link soon stops working. */
const LINK_SECONDS = 600;

export type OpenDocumentResult = { ok: true; url: string; opens: "pdf" | "download" } | { ok: false; error: string };

/**
 * A short-lived link to view or download one imported file (Grant 2026-10-19: "click on the file and
 * it opens"). The file must belong to this project and organisation; the check runs on the server,
 * under the signed-in tenant, so a document id from elsewhere gets nothing.
 *   - a stored PDF copy (Word and PowerPoint files get one when their findings are read) opens in the
 *     browser;
 *   - an original PDF opens in the browser;
 *   - anything else (Word not yet read, spreadsheets, SPSS, Stata, CSV) downloads under its own name.
 * With `want: "download"` (View original, Grant 2026-10-22: "just download, don't open an empty
 * browser"), the original as uploaded is always signed as an attachment under its own name, PDFs
 * included, so following the link downloads it and leaves the page where it is.
 * The original stays exactly as uploaded; nothing here changes or copies it.
 */
export async function openDocumentAction(runId: string, documentId: string, want: "view" | "download" = "view"): Promise<OpenDocumentResult> {
  if (want !== "view" && want !== "download") return { ok: false, error: "That is not a way this file can be opened." };
  const tenantId = await requireTenantId();
  if (!(await runAccessible(tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const doc = await withTenantRead(tenantId, async (client) =>
    (
      await client.query<{ storage_path: string; preview_storage_path: string | null; source_filename: string }>(
        "select storage_path, preview_storage_path, source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3",
        [documentId, runId, tenantId],
      )
    ).rows[0],
  );
  if (!doc) return { ok: false, error: "That file is not in this project." };
  const pdf = want === "download" ? null : (doc.preview_storage_path ?? (/\.pdf$/i.test(doc.source_filename) ? doc.storage_path : null));
  const { data, error } = pdf
    ? await supabaseAdmin.storage.from(BUCKET).createSignedUrl(pdf, LINK_SECONDS)
    : await supabaseAdmin.storage.from(BUCKET).createSignedUrl(doc.storage_path, LINK_SECONDS, { download: doc.source_filename });
  if (error || !data?.signedUrl) return { ok: false, error: `The file could not be opened: ${error?.message ?? "no link was returned"}. Try again in a moment.` };
  return { ok: true, url: data.signedUrl, opens: pdf ? "pdf" : "download" };
}
