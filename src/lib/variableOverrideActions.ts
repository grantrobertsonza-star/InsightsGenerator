"use server";

import { saveVariableOverride, type QuestionType } from "./variableOverrides";
import type { VariableType } from "./dataQuality";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

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
