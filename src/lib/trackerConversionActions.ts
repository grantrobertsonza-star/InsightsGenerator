"use server";
// Server entry point for the Conversion view of the brand dashboard's page 01 (trackerConversion.ts). Re-checks the
// signed-in tenant's access to the project; figures are computed, nothing is saved. Kept apart from
// trackerDashboardActions.ts so the view can be added without touching the other pages' actions.
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadBrandConversion, type BrandConversion } from "./trackerConversion";

export async function loadBrandConversionAction(runId: string, documentId: string): Promise<{ ok: true; conversion: BrandConversion } | { ok: false; error: string }> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (typeof documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(documentId)) return { ok: false, error: "Choose a data file." };
  try {
    return { ok: true, conversion: await loadBrandConversion(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
