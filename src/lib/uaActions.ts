"use server";
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadUaWorkspace, saveUaChoices, type UaExpected } from "./uaDashboards";
import { loadUaPage } from "./uaComputation";
import { loadUaComparison } from "./uaWaves";
import { UA_PAGES, type UaPageId } from "./uaTypes";
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
export async function loadUaWorkspaceAction(runId: string, documentId: string) {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false as const, error: RUN_NOT_AVAILABLE };
  try { return { ok: true as const, view: await loadUaWorkspace(ctx.tenantId, runId, documentId) }; }
  catch (e) { return { ok: false as const, error: message(e) }; }
}
export async function loadUaPageAction(runId: string, documentId: string, page: unknown, weighted: unknown, brands: unknown) {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false as const, error: RUN_NOT_AVAILABLE };
  if (!UA_PAGES.some(p => p.id === page) || typeof weighted !== "boolean" || !Array.isArray(brands) || brands.some(b => typeof b !== "string") || brands.length > 30) return { ok: false as const, error: "Choose a U&A page, weighting and listed brands." };
  try {
    const computed = await loadUaPage(ctx.tenantId, runId, documentId, page as UaPageId, weighted, brands);
    const comparison = await loadUaComparison(ctx.tenantId, runId, computed, weighted, brands);
    return { ok: true as const, page: computed, comparison };
  }
  catch (e) { return { ok: false as const, error: message(e) }; }
}
export async function saveUaChoicesAction(runId: string, documentId: string, expected: unknown, choices: unknown) {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false as const, error: RUN_NOT_AVAILABLE };
  const x = expected as Partial<UaExpected> | null;
  if (!x || typeof x.scope !== "string" || !/^(project|programme):[0-9a-f-]{36}$/i.test(x.scope) || !(x.revision === null || Number.isInteger(x.revision) && x.revision! >= 1)) return { ok: false as const, error: "The saved view is invalid. Reload before saving." };
  try { return { ok: true as const, result: await saveUaChoices(ctx.tenantId, runId, documentId, x as UaExpected, choices, ctx.email ?? ctx.userId) }; }
  catch (e) { return { ok: false as const, error: message(e) }; }
}
