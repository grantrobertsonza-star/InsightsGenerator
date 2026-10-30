"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { verifyAfterGenerate } from "./verifyAfterGenerate";
import {
  addDriverFindings,
  driverFindingCounts,
  removeDriverFindings,
  deleteDriverAnalysis,
  listDriverAnalyses,
  runDriverAnalysisFor,
  saveDriverAnalysis,
  type DriverReport,
  type DriverRequest,
  type SavedDriverAnalysis,
} from "./drivers";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";

type Fail = { ok: false; error: string };

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // "does not exist" alone, not "exist" or "relation" (same pattern as OBJ-REV-012 in
  // objectiveEvidence.ts): a permission-denied message also contains "relation" and the
  // word "exist" is too broad as well, so either alternative alone can misclassify a real
  // permission failure as "needs this migration". "does not exist" is unique to Postgres's
  // actual missing-relation error.
  if (/driver_analyses/.test(message) && /does not exist/.test(message)) return "Saving needs migration 0072 applied first (npx.cmd supabase migration up).";
  return message;
}

export async function runDriverAnalysisAction(
  runId: string,
  documentId: string,
  request: DriverRequest,
): Promise<{ ok: true; report: DriverReport } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, report: await runDriverAnalysisFor(TENANT_ID, runId, documentId, request) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function saveDriverAnalysisAction(
  runId: string,
  documentId: string,
  title: string,
  report: DriverReport,
): Promise<{ ok: true; id: string } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const id = await saveDriverAnalysis(TENANT_ID, runId, documentId, title, report);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function listDriverAnalysesAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; items: SavedDriverAnalysis[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, items: await listDriverAnalyses(TENANT_ID, runId, documentId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function deleteDriverAnalysisAction(runId: string, id: string): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await deleteDriverAnalysis(TENANT_ID, runId, id);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function addDriverFindingsAction(
  runId: string,
  analysisId: string,
): Promise<{ ok: true; added: number; alreadyPosted: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const { added, alreadyPosted } = await addDriverFindings(TENANT_ID, runId, analysisId);
    if (added > 0) after(() => verifyAfterGenerate(TENANT_ID, runId));
    revalidatePath(`/runs/${runId}`);
    return { ok: true, added, alreadyPosted };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function removeDriverFindingsAction(runId: string, analysisId: string): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const removed = await removeDriverFindings(TENANT_ID, runId, analysisId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function driverFindingCountsAction(runId: string): Promise<{ ok: true; counts: Record<string, number> } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, counts: Object.fromEntries(await driverFindingCounts(TENANT_ID, runId)) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
