"use server";

// Indicator Analytics (D6) server actions: inputs checked here, at the boundary, and every read scoped to the
// signed-in organisation and this project (the owner, indicatorData.ts, checks the file is this project's
// Indicator data in the same snapshot). Read-only: nothing here writes.
import { IndicatorDocumentNotFoundError } from "./indicatorData";
import { loadIndicatorAnalytics, loadIndicatorWorkspace, type IndicatorAnalyticsRequest, type IndicatorAnalyticsView, type IndicatorWorkspace } from "./indicatorAnalytics";
import { MAX_TREND_PANELS } from "./indicatorAnalyticsFigures";
import { indicatorPeriodValid } from "./indicatorLayouts";
import { requireTenantId } from "./requestContext";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (error: unknown) => (error instanceof IndicatorDocumentNotFoundError ? error.message : `The indicator dashboard could not be loaded: ${error instanceof Error ? error.message : String(error)}`);

export async function indicatorWorkspaceAction(runId: string): Promise<{ ok: true; workspace: IndicatorWorkspace } | { ok: false; error: string }> {
  if (!UUID.test(runId)) return { ok: false, error: "That project could not be found." };
  const tenantId = await requireTenantId();
  try {
    return { ok: true, workspace: await loadIndicatorWorkspace(tenantId, runId) };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

const isCode = (v: unknown) => v === null || (typeof v === "string" && v.length > 0 && v.length <= 200);
const isPeriod = (v: unknown) => v === null || (typeof v === "string" && indicatorPeriodValid(v));

/** The request, checked field by field; a malformed one is refused, never repaired. */
function checkedRequest(raw: unknown): IndicatorAnalyticsRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.documentId !== "string" || !UUID.test(r.documentId)) return null;
  if (!(r.readId === null || (typeof r.readId === "string" && UUID.test(r.readId)))) return null;
  if (!(r.seriesKey === null || (typeof r.seriesKey === "string" && r.seriesKey.length <= 4000))) return null;
  if (!(r.area === null || (typeof r.area === "object" && r.area !== null && isCode((r.area as { code?: unknown }).code)))) return null;
  if (!isPeriod(r.from) || !isPeriod(r.to) || !isPeriod(r.comparePeriod)) return null;
  if (!(r.trendAreas === null || (Array.isArray(r.trendAreas) && r.trendAreas.length <= MAX_TREND_PANELS && r.trendAreas.every(isCode) && new Set(r.trendAreas).size === r.trendAreas.length))) return null;
  return {
    documentId: r.documentId,
    readId: r.readId as string | null,
    seriesKey: r.seriesKey as string | null,
    area: r.area === null ? null : { code: (r.area as { code: string | null }).code },
    from: r.from as string | null,
    to: r.to as string | null,
    comparePeriod: r.comparePeriod as string | null,
    trendAreas: r.trendAreas as (string | null)[] | null,
  };
}

export async function indicatorAnalyticsAction(runId: string, request: IndicatorAnalyticsRequest): Promise<IndicatorAnalyticsView | { state: "error"; message: string }> {
  const checked = checkedRequest(request);
  if (!UUID.test(runId) || !checked) return { state: "error", message: "The dashboard request could not be read. Reload the page and try again." };
  const tenantId = await requireTenantId();
  try {
    return await loadIndicatorAnalytics(tenantId, runId, checked);
  } catch (error) {
    return { state: "error", message: failure(error) };
  }
}
