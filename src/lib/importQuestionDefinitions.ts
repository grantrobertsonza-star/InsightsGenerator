import { loadImportedVariableDictionary } from "./crosstabs";
import type { QuestionType } from "./variableOverrideTypes";

export async function loadImportQuestionDefinitions(tenantId: string, runId: string, documentId: string) {
  try {
    const dictionary = await loadImportedVariableDictionary(tenantId, runId, documentId);
    const types: Record<string, QuestionType> = {};
    for (const set of dictionary.sets ?? []) {
      for (const name of set.vars) types[name] = set.kind ?? "multi";
    }
    return { types, error: null };
  } catch (error) {
    return { types: {} as Record<string, QuestionType>, error: error instanceof Error ? error.message : String(error) };
  }
}
