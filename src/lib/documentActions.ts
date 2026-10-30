"use server";

import { revalidatePath } from "next/cache";
import { finishDocumentStorageCleanup } from "./documentStorageCleanup";
import { requireRequestContext, requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, assertRunAccessible, runAccessible } from "./runOwnership";
import { eraseRemovedDocument, listBin, removeDocumentToBin, restoreDocumentFromBin } from "./documentBin";

/**
 * Removes a file from the project into its bin (claude/document-deletion-contract.md): its findings
 * are archived with the researcher's review decisions and notes, its own material is hidden with it,
 * unreviewed objective and decision suggestions drawn only from it are removed, and it can be restored for
 * BIN_DAYS days. The form's delete button calls this; documentBin.removeDocumentToBin does the work in
 * one transaction. Nothing is erased here: the stored file stays until it is erased from the bin.
 */
export async function deleteDocument(runId: string, documentId: string) {
  const context = await requireRequestContext();
  await assertRunAccessible(context.tenantId, runId);
  await removeDocumentToBin(context.tenantId, runId, documentId, context.userId);
  revalidatePath(`/runs/${runId}`);
}

type BinResult = { ok: true; message: string } | { ok: false; error: string };

/** Puts a removed file back, with its findings, review decisions and notes. */
export async function restoreDocumentAction(runId: string, removalId: string): Promise<BinResult> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const { findings, linksWaiting, linksLost } = await restoreDocumentFromBin(TENANT_ID, runId, removalId);
    revalidatePath(`/runs/${runId}`);
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    let message = `Restored, with ${plural(findings, "finding", "findings")}.`;
    if (linksWaiting > 0) {
      message += ` ${plural(linksWaiting, "link", "links")} to findings of another removed file will come back when that file is restored.`;
    }
    if (linksLost > 0) {
      message += ` ${plural(linksLost, "link", "links")} to findings that were erased could not be restored.`;
    }
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Erases a removed file for good (see documentBin.eraseRemovedDocument). */
export async function eraseDocumentAction(runId: string, documentId: string): Promise<BinResult> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const { linksRemoved } = await eraseRemovedDocument(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return {
      ok: true,
      message:
        linksRemoved > 0
          ? `Erased. ${linksRemoved} ${linksRemoved === 1 ? "link" : "links"} between its findings and other files' findings went with it.`
          : "Erased.",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Erases every file in the project's bin, one file per transaction. A failure stops there and says
 * how many were erased before it; the rest stay in the bin and the action can be run again.
 */
export async function emptyBinAction(runId: string): Promise<BinResult> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  let erased = 0;
  try {
    for (const item of await listBin(TENANT_ID, runId)) {
      await eraseRemovedDocument(TENANT_ID, runId, item.documentId);
      erased++;
    }
    revalidatePath(`/runs/${runId}`);
    return { ok: true, message: `Erased ${erased} file${erased === 1 ? "" : "s"}.` };
  } catch (error) {
    if (erased > 0) revalidatePath(`/runs/${runId}`);
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${erased} file${erased === 1 ? " was" : "s were"} erased, then this stopped: ${reason} The rest are still in the bin.` };
  }
}

export async function retryDocumentStorageCleanup(runId: string): Promise<{ ok: boolean; error?: string }> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await finishDocumentStorageCleanup(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
