"use server";

import { saveVariableOverride, type QuestionType } from "./variableOverrides";
import type { VariableType } from "./dataQuality";
import { requireTenantId } from "./requestContext";

/**
 * Corrects (or clears, with `null`) what import inferred for one variable:
 * its data type and/or its question type. No revalidatePath: the Import
 * screen holds this in local state once saved, same as the data set-up
 * choices above it.
 */
export async function saveVariableOverrideAction(
  runId: string,
  documentId: string,
  variableName: string,
  patch: { type?: VariableType | null; questionType?: QuestionType | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    await saveVariableOverride(TENANT_ID, runId, documentId, variableName, patch);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: /variable_overrides/.test(message)
        ? "Saving this needs migration 0077 applied first (npx.cmd supabase migration up)."
        : message,
    };
  }
}

/**
 * Import step 3: confirms one battery item as worded the other way. The battery, its scale and the
 * evidence come from the engine's reading of the file (reverseCoding.ts confirmReversal), not from here.
 */
export async function confirmReversalAction(runId: string, documentId: string, variable: unknown): Promise<{ ok: true; derived: string } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  if (typeof variable !== "string" || !variable) return { ok: false, error: "Choose an item to reverse." };
  try {
    const { confirmReversal } = await import("./reverseCoding");
    return { ok: true, ...(await confirmReversal(TENANT_ID, runId, documentId, variable)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /variable_overrides/.test(message) ? "Saving this needs migration 0077 applied first (npx.cmd supabase migration up)." : message };
  }
}

/** Withdraws a reversal; the derived variable is no longer offered or computed. */
export async function removeReversalAction(runId: string, documentId: string, variable: unknown): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  if (typeof variable !== "string" || !variable) return { ok: false, error: "Choose an item." };
  try {
    const { removeReversal } = await import("./reverseCoding");
    return { ok: true, ...(await removeReversal(TENANT_ID, runId, documentId, variable)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
