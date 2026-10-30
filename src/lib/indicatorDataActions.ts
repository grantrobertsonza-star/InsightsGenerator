"use server";

// The Indicator data view's server actions (batch 54). Each one checks its inputs here, at the boundary,
// and scopes every read and write to the signed-in organisation and this project (indicatorData.ts
// re-checks ownership under the row lock on every write).
import { revalidatePath } from "next/cache";
import {
  IndicatorDocumentNotFoundError,
  MAX_INDICATOR_AREAS,
  loadIndicatorCatalogue,
  loadIndicatorObservations,
  readIndicatorDocument,
  type IndicatorCatalogue,
  type IndicatorObservationsResult,
  type IndicatorReadOutcome,
} from "./indicatorData";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IndicatorCatalogueResult = { ok: true; catalogue: IndicatorCatalogue } | { ok: false; error: string };

export async function indicatorCatalogueAction(runId: string, documentId: string): Promise<IndicatorCatalogueResult> {
  if (!UUID.test(runId) || !UUID.test(documentId)) return { ok: false, error: "That file is not in this project." };
  const tenantId = await requireTenantId();
  if (!(await runAccessible(tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, catalogue: await loadIndicatorCatalogue(tenantId, runId, documentId) };
  } catch (error) {
    return { ok: false, error: error instanceof IndicatorDocumentNotFoundError ? error.message : `The indicator data could not be loaded: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function indicatorObservationsAction(
  runId: string,
  documentId: string,
  request: { readId: string; seriesId: string; areaCodes: (string | null)[] },
): Promise<IndicatorObservationsResult> {
  if (!UUID.test(runId) || !UUID.test(documentId) || !UUID.test(request?.readId ?? "") || !UUID.test(request?.seriesId ?? "")) {
    return { ok: false, error: "That series is not in this file." };
  }
  const codes = Array.isArray(request.areaCodes) ? request.areaCodes : [];
  if (!codes.every((c) => c === null || (typeof c === "string" && c.length <= 200)) || new Set(codes).size !== codes.length) {
    return { ok: false, error: "The chosen areas could not be read." };
  }
  if (codes.length > MAX_INDICATOR_AREAS) return { ok: false, error: `Choose at most ${MAX_INDICATOR_AREAS} areas at once.` };
  const tenantId = await requireTenantId();
  if (!(await runAccessible(tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return await loadIndicatorObservations(tenantId, runId, documentId, { readId: request.readId, seriesId: request.seriesId, areaCodes: codes });
  } catch (error) {
    return { ok: false, error: error instanceof IndicatorDocumentNotFoundError ? error.message : `The values could not be loaded: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Reads the file again; a failure keeps the previous version and says so. */
export async function readIndicatorFileAgainAction(runId: string, documentId: string): Promise<IndicatorReadOutcome> {
  if (!UUID.test(runId) || !UUID.test(documentId)) return { ok: false, error: "That file is not in this project.", previousVersionKept: false };
  const tenantId = await requireTenantId();
  if (!(await runAccessible(tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE, previousVersionKept: false };
  const outcome = await readIndicatorDocument(tenantId, runId, documentId);
  revalidatePath(`/runs/${runId}`);
  return outcome;
}
