"use server";

import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const BUCKET = "documents";

/**
 * Returns a short-lived signed URL to a document's browser-viewable PDF
 * (its preview_storage_path), for the "view source" side panel. Returns an
 * error message instead of throwing, since "no preview yet" is an expected,
 * normal outcome for a document that hasn't been extracted, not a bug.
 */
export async function getDocumentPreviewUrl(
  documentId: string
): Promise<{ url: string } | { error: string }> {
  const document = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ preview_storage_path: string | null; source_filename: string }>(
      "select preview_storage_path, source_filename from documents where id = $1",
      [documentId]
    );
    return result.rows[0];
  });

  if (!document) {
    return { error: "Document not found." };
  }

  if (!document.preview_storage_path) {
    return {
      error: `No preview is available yet for "${document.source_filename}". Try extracting claims from it first.`,
    };
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(document.preview_storage_path, 3600);

  if (error || !data) {
    return { error: `Could not create a preview link: ${error?.message ?? "unknown error"}` };
  }

  return { url: data.signedUrl };
}
