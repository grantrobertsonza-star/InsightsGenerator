"use server";
// D2: server entry points for a tracker dashboard's configuration (trackerDashboards.ts). Each re-checks the
// signed-in tenant; the project, file and revision are checked again inside the write.
import { revalidatePath } from "next/cache";
import { requireRequestContext } from "./requestContext";
import { loadTrackerDashboard, resetTrackerChoices, saveTrackerChoices, type SaveResult, type TrackerDashboardView } from "./trackerDashboards";

type Fail = { ok: false; error: string };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const validRevision = (r: unknown): r is number | null => r === null || (Number.isInteger(r) && (r as number) >= 1);

export async function loadTrackerDashboardAction(runId: string, documentId: string): Promise<{ ok: true; view: TrackerDashboardView } | Fail> {
  const ctx = await requireRequestContext();
  try {
    return { ok: true, view: await loadTrackerDashboard(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function saveTrackerChoicesAction(runId: string, documentId: string, expectedRevision: number | null, choices: unknown): Promise<({ ok: true } & SaveResult) | Fail> {
  const ctx = await requireRequestContext();
  if (!validRevision(expectedRevision)) return { ok: false, error: "The dashboard's revision is not valid. Reload and try again." };
  try {
    const r = await saveTrackerChoices(ctx.tenantId, runId, documentId, expectedRevision, choices, ctx.email ?? ctx.userId);
    if (r.saved) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function resetTrackerChoicesAction(runId: string, expectedRevision: number): Promise<({ ok: true } & SaveResult) | Fail> {
  const ctx = await requireRequestContext();
  if (!validRevision(expectedRevision) || expectedRevision === null) return { ok: false, error: "The dashboard's revision is not valid. Reload and try again." };
  try {
    const r = await resetTrackerChoices(ctx.tenantId, runId, expectedRevision, ctx.email ?? ctx.userId);
    if (r.saved) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
