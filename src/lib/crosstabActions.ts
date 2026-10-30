"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { verifyAfterGenerate } from "./verifyAfterGenerate";
import {
  buildCrosstab,
  commitCrosstabs,
  deleteCrosstab,
  loadTableDefinition,
  replaceDraftCrosstab,
  type TableDefinition,
  deleteDraftCrosstabs,
  listCrosstabs,
  loadCategories,
  loadCrosstab,
  loadVariableDictionary,
  replicateCrosstabsToWave,
  setCrosstabText,
  type CrosstabListItem,
} from "./crosstabs";
import { chosenBannersProblem, planStarterTables } from "./starterTables";
import { planCrosstabFromText, type AskPlan } from "./crosstabAsk";
import { ASK_MEMORY_REQUESTS } from "./crosstabAskShared";
import type { CategoryList, CrosstabRequest, CrosstabResult, VariableDictionary } from "./parseStatsFile";
import { summarizeCrosstabTable, type CrosstabInsights } from "./crosstabInsights";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadRespondentQuality, type RespondentQuality } from "./respondentQuality";

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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, dictionary: await loadVariableDictionary(TENANT_ID, runId, documentId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function loadRespondentQualityAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; quality: RespondentQuality } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, quality: await loadRespondentQuality(TENANT_ID, runId, documentId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function loadCategoriesAction(
  runId: string,
  documentId: string,
  variable: string,
): Promise<{ ok: true; list: CategoryList } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await commitCrosstabs(TENANT_ID, runId, documentId);
    if (r.findings > 0) after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function deleteCrosstabAction(runId: string, tableId: string): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, ...(await loadCrosstab(TENANT_ID, runId, tableId)) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/**
 * A plain, descriptive read of a saved crosstab table: what the numbers show,
 * regenerated fresh each time. Never persisted and never fed into findings or
 * insights (see crosstabInsights.ts for why).
 */
export async function summarizeCrosstabAction(
  runId: string,
  tableId: string,
): Promise<{ ok: true; insights: CrosstabInsights } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const { result } = await loadCrosstab(TENANT_ID, runId, tableId);
    if (!result) return { ok: false, error: "This crosstab has no saved result." };
    const insights = await summarizeCrosstabTable(TENANT_ID, runId, result);
    return { ok: true, insights };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/**
 * Rebuilds every saved table from another document in this run (an earlier or later wave) onto
 * this one, replaying each table's own banner, rows, filters, weight, design and correction as-is.
 * The new tables land as drafts in this document's set alongside anything already here, same as
 * any other table add; review and commit them the normal way.
 */
export async function replicateCrosstabsToWaveAction(
  runId: string,
  sourceDocumentId: string,
  targetDocumentId: string,
): Promise<{ ok: true; tables: number; built: number; alreadyCopied: number; skipped: { label: string; reason: string }[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await replicateCrosstabsToWave(TENANT_ID, runId, sourceDocumentId, targetDocumentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Builds the suggested starter set as drafts: one table per demographic banner. */
export async function buildStarterTablesAction(
  runId: string,
  documentId: string,
  settings?: Pick<CrosstabRequest, "weightVar" | "correction" | "excludeDk" | "design" | "meanRows">,
  /** The researcher's columns to split by; omitted for the recognised ones. Checked against the file here. */
  banners?: unknown,
): Promise<{ ok: true; tables: number; questions: number; banners: string[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const dictionary = await loadVariableDictionary(TENANT_ID, runId, documentId);
    let chosen: string[] | undefined;
    if (banners !== undefined && banners !== null) {
      if (!Array.isArray(banners) || !banners.every((b) => typeof b === "string")) return { ok: false, error: "The columns to split by were not understood. Choose them again." };
      const problem = chosenBannersProblem(dictionary, banners);
      if (problem) return { ok: false, error: problem };
      chosen = banners;
    }
    const plan = planStarterTables(dictionary, chosen);
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
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
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await setCrosstabText(TENANT_ID, runId, tableId, title, caption);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Turns a plain-English request into a table setup for the researcher to review. Nothing is built here. */
export async function askCrosstabAction(
  runId: string,
  documentId: string,
  text: string,
  earlier: unknown = [],
): Promise<{ ok: true; plan: AskPlan } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    // The panel's earlier requests come from the client: kept to the last few, as plain capped
    // strings, and only ever shown to the model as context.
    const list = (Array.isArray(earlier) ? earlier : [])
      .filter((e): e is { request: unknown; summary: unknown } => !!e && typeof e === "object")
      .map((e) => ({ request: String(e.request ?? "").slice(0, 600), summary: String(e.summary ?? "").slice(0, 400) }))
      .filter((e) => e.request.trim().length > 0)
      .slice(-ASK_MEMORY_REQUESTS);
    return { ok: true, plan: await planCrosstabFromText(TENANT_ID, runId, documentId, text, { earlier: list }) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** A saved table's definition, for editing in Build table. */
export async function loadTableDefinitionAction(runId: string, tableId: string): Promise<{ ok: true; definition: TableDefinition } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (!/^[0-9a-f-]{36}$/i.test(tableId)) return { ok: false, error: "That table is not in this project." };
  try {
    return { ok: true, definition: await loadTableDefinition(TENANT_ID, runId, tableId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** "Update table": replaces an edited draft with the table its edited definition builds (replaceDraftCrosstab). */
export async function replaceDraftCrosstabAction(
  runId: string,
  documentId: string,
  oldTableId: string,
  request: CrosstabRequest,
): Promise<{ ok: true; tableId: string; questions: number; skipped: { variable: string; reason: string }[]; replaced: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (!/^[0-9a-f-]{36}$/i.test(oldTableId)) return { ok: false, error: "That table is not in this project." };
  try {
    const r = await replaceDraftCrosstab(TENANT_ID, runId, documentId, oldTableId, request);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
