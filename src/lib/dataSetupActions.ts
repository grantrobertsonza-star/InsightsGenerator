"use server";

import { revalidatePath } from "next/cache";
import { saveDataSetup } from "./dataSetup";
import { extractAndStoreDocumentTables } from "./documentTables";
import { normaliseDataSetup, type DataSetup } from "./dataSetupShared";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export async function saveDataSetupAction(
  runId: string,
  documentId: string,
  setup: DataSetup,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // No revalidatePath, same as the transcript set-up: the row keeps its own state.
  try {
    await saveDataSetup(TENANT_ID, runId, documentId, normaliseDataSetup(setup));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: /data_setup/.test(message)
        ? "Saving this needs migration 0057 applied first (npx.cmd supabase migration up)."
        : message,
    };
  }
}

/**
 * Reads a case-level data file into its table, so the preview and the data
 * quality appear without a separate processing step. Safe to repeat: the table
 * is replaced in place.
 */
export async function readDataFileAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await extractAndStoreDocumentTables(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
