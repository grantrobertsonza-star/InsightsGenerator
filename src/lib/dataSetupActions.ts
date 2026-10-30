"use server";

import { revalidatePath } from "next/cache";
import { loadDataSetup, loadDataSetupWithStatus, saveDataSetup, type ExpectedPreviousSetup } from "./dataSetup";
import { extractAndStoreDocumentTables } from "./documentTables";
import { DEFAULT_DATA_SETUP, normaliseDataSetup, parseHeaderRowsSkipped, type DataSetup } from "./dataSetupShared";
import { requireTenantId } from "./requestContext";
import { assertRunAccessible, RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";

/**
 * ANA-NPS-003 (second counter-review): the one client-callable way to read a document's
 * persisted set-up, including its survey-design choice (DataSetup.design) - needed by Cross tabs'
 * own workspace to initialise its design picker from whatever was last saved (by itself, or by
 * another tool/session) rather than always starting from the bare heuristic.
 */
export async function loadDataSetupAction(runId: string, documentId: string): Promise<DataSetup> {
  const TENANT_ID = await requireTenantId();
  await assertRunAccessible(TENANT_ID, runId);
  return loadDataSetup(TENANT_ID, documentId);
}

/**
 * Overnight queue, package 4: same read as `loadDataSetupAction`, but surfaces a genuine
 * lookup failure (missing migration, dropped connection, permission error) to the caller
 * instead of returning indistinguishable defaults. Cross tabs' own workspace uses this one so
 * it can show the researcher an actual error rather than silently acting as if the document
 * had no saved design/unit/layout choice at all.
 */
export async function loadDataSetupStatusAction(
  runId: string,
  documentId: string,
): Promise<{ setup: DataSetup; ok: true } | { setup: DataSetup; ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { setup: DEFAULT_DATA_SETUP, ok: false, error: RUN_NOT_AVAILABLE };
  return loadDataSetupWithStatus(TENANT_ID, documentId);
}

/**
 * `expected` is what the caller last saw for this document's set-up (see saveDataSetup):
 * passing it turns this into a compare-and-swap, so a save that lost a race against
 * another one is reported as a conflict instead of silently discarding the newer value.
 * Omitted, this behaves exactly as before - an unconditional overwrite.
 */
export async function saveDataSetupAction(
  runId: string,
  documentId: string,
  setup: DataSetup,
  expected?: ExpectedPreviousSetup,
): Promise<{ ok: true } | { ok: false; error: string; conflict?: boolean; current?: DataSetup | null }> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  // The header row choice is checked here, before anything is written: normaliseDataSetup reads an invalid stored
  // value as detected automatically, which must never be how an invalid request is saved. Whether the file has a
  // header row at all is checked on the write (saveDataSetup), in the same transaction.
  const header = parseHeaderRowsSkipped((setup as Partial<DataSetup> | null)?.headerRowsSkipped);
  if (!header.ok) return { ok: false, error: header.error };
  // No revalidatePath, same as the transcript set-up: the row keeps its own state.
  try {
    const r = await saveDataSetup(TENANT_ID, runId, documentId, normaliseDataSetup(setup), expected);
    if (!r.saved && r.refused) return { ok: false, error: r.refused };
    if (!r.saved) {
      return {
        ok: false,
        error: "This file's set-up changed elsewhere while this was in flight; showing the latest version instead of overwriting it.",
        conflict: true,
        current: r.current,
      };
    }
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await extractAndStoreDocumentTables(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
