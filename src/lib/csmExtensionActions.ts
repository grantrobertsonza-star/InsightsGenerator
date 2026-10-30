"use server";
// R6 CSM extension: the server entry point for the CSM dashboard's added sections (csmExtension.ts). Re-checks the
// signed-in tenant and the project; the section and filters are checked at this boundary (parseExtensionRequest)
// and each code against the file's own answer list when the population is built. Nothing is saved.
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadCsmExtension, parseExtensionRequest, type CsmExtensionView } from "./csmExtension";

export async function loadCsmExtensionAction(runId: string, documentId: string, request: unknown): Promise<{ ok: true; view: CsmExtensionView } | { ok: false; error: string }> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const parsed = parseExtensionRequest(request);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true, view: await loadCsmExtension(ctx.tenantId, runId, documentId, parsed.section, parsed.filters) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
