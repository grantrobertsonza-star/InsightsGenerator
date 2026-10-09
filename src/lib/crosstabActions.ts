"use server";

import { revalidatePath } from "next/cache";
import {
  buildCrosstab,
  commitCrosstabs,
  deleteCrosstab,
  deleteDraftCrosstabs,
  listCrosstabs,
  loadCategories,
  loadCrosstab,
  loadVariableDictionary,
  setCrosstabText,
  type CrosstabListItem,
} from "./crosstabs";
import { planStarterTables } from "./starterTables";
import { planCrosstabFromText, type AskPlan } from "./crosstabAsk";
import type { CategoryList, CrosstabRequest, CrosstabResult, VariableDictionary } from "./parseStatsFile";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type Fail = { ok: false; error: string };

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/crosstab_status/.test(message)) return "This needs migration 0059 applied first (npx.cmd supabase migration up).";
  if (/(crosstab|variable_dictionary)/.test(message) && /column/.test(message))
    return "This needs migration 0058 applied first (npx.cmd supabase migration up).";
  return message;
}

export async function loadVariablesAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; dictionary: VariableDictionary } | Fail> {
  try {
    return { ok: true, dictionary: await loadVariableDictionary(TENANT_ID, runId, documentId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function loadCategoriesAction(
  runId: string,
  documentId: string,
  variable: string,
): Promise<{ ok: true; list: CategoryList } | Fail> {
  try {
    return { ok: true, list: await loadCategories(TENANT_ID, runId, documentId, variable) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function listCrosstabsAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; items: CrosstabListItem[] } | Fail> {
  try {
    return { ok: true, items: await listCrosstabs(TENANT_ID, runId, documentId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function addCrosstabAction(
  runId: string,
  documentId: string,
  request: CrosstabRequest,
): Promise<{ ok: true; tableId: string; questions: number; skipped: { variable: string; reason: string }[] } | Fail> {
  try {
    const r = await buildCrosstab(TENANT_ID, runId, documentId, request);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function commitCrosstabsAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; tables: number; findings: number } | Fail> {
  try {
    const r = await commitCrosstabs(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function deleteCrosstabAction(runId: string, tableId: string): Promise<{ ok: true } | Fail> {
  try {
    await deleteCrosstab(TENANT_ID, runId, tableId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function loadCrosstabAction(
  runId: string,
  tableId: string,
): Promise<{ ok: true; label: string; result: CrosstabResult | null } | Fail> {
  try {
    return { ok: true, ...(await loadCrosstab(TENANT_ID, runId, tableId)) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Builds the suggested starter set as drafts: one table per demographic banner. */
export async function buildStarterTablesAction(
  runId: string,
  documentId: string,
  settings?: Pick<CrosstabRequest, "weightVar" | "correction" | "excludeDk" | "design">,
): Promise<{ ok: true; tables: number; questions: number; banners: string[] } | Fail> {
  try {
    const dictionary = await loadVariableDictionary(TENANT_ID, runId, documentId);
    const plan = planStarterTables(dictionary);
    if (plan.banners.length === 0)
      return { ok: false, error: "No demographic variables (gender, age, province and so on) were found to split by. Choose columns in the workspace instead." };
    if (plan.items.length === 0) return { ok: false, error: "No questions suited a starter table. Choose rows in the workspace instead." };
    let tables = 0;
    for (const banner of plan.banners) {
      await buildCrosstab(TENANT_ID, runId, documentId, {
        columnVars: [banner.name],
        rowItems: plan.items,
        ...(settings ?? {}),
        weightVar: settings && settings.weightVar !== undefined ? settings.weightVar : plan.weightVar,
        starter: true,
      });
      tables++;
    }
    revalidatePath(`/runs/${runId}`);
    return { ok: true, tables, questions: plan.items.length, banners: plan.banners.map((b) => b.label) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Deletes every draft table of the file. Committed tables and their findings are kept. */
export async function deleteDraftCrosstabsAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; deleted: number } | Fail> {
  try {
    const deleted = await deleteDraftCrosstabs(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, deleted };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Saves the title and caption of one table. */
export async function setCrosstabTextAction(runId: string, tableId: string, title: string, caption: string): Promise<{ ok: true } | Fail> {
  try {
    await setCrosstabText(TENANT_ID, runId, tableId, title, caption);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Turns a plain-English request into a table setup for the researcher to review. Nothing is built here. */
export async function askCrosstabAction(runId: string, documentId: string, text: string): Promise<{ ok: true; plan: AskPlan } | Fail> {
  try {
    return { ok: true, plan: await planCrosstabFromText(TENANT_ID, runId, documentId, text) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
