"use server";
// D2: server entry points for a tracker dashboard's configuration (trackerDashboards.ts). Each re-checks the
// signed-in tenant; the project, file and revision are checked again inside the write.
import { revalidatePath } from "next/cache";
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadBrandOverview, type BrandOverview } from "./trackerOverview";
import { loadBrandAdvertisingWithChange, loadBrandAssociationsWithChange, loadBrandAudienceWithChange, loadBrandMomentsWithChange, loadCategoryOverviewWithChange } from "./trackerPageChanges";
import { compareChoiceFrom } from "./trackerWaveChange";
import { loadTrackerDashboard, resetTrackerChoices, saveTrackerChoices, type ExpectedDashboard, type SaveResult, type TrackerDashboardView } from "./trackerDashboards";

type Fail = { ok: false; error: string };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The scope and revision the screen read, checked at the boundary (a scope key and a revision of 1 or more, or null). */
function expectedFrom(raw: unknown): ExpectedDashboard | null {
  if (!raw || typeof raw !== "object") return null;
  const { scope, revision } = raw as { scope?: unknown; revision?: unknown };
  if (typeof scope !== "string" || !/^(programme|project):[0-9a-f-]{36}$/i.test(scope)) return null;
  if (revision !== null && !(Number.isInteger(revision) && (revision as number) >= 1)) return null;
  return { scope, revision: revision as number | null };
}
const STALE = "The dashboard's saved state is not valid. Reload and try again.";
/** R5 waves: "Compare with" as sent by the screen ("previous", "none" or a wave file's id), checked at the boundary;
 * the wave itself is checked against the project's included waves by trackerWaveChange.comparisonTarget. */
const BAD_COMPARE = "Choose the previous wave, an earlier wave or None to compare with.";

export async function loadTrackerDashboardAction(runId: string, documentId: string): Promise<{ ok: true; view: TrackerDashboardView } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, view: await loadTrackerDashboard(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** D3: one wave file's brand or CSM dashboard (figures computed, nothing saved), with the change against the compared wave (R5 waves). */
export async function loadBrandOverviewAction(runId: string, documentId: string, kindRaw: unknown, compareRaw?: unknown): Promise<{ ok: true; overview: BrandOverview } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (kindRaw !== "brand" && kindRaw !== "csm") return { ok: false, error: "Choose the brand or the CSM dashboard." };
  const choice = compareChoiceFrom(compareRaw);
  if (!choice) return { ok: false, error: BAD_COMPARE };
  try {
    return { ok: true, overview: await loadBrandOverview(ctx.tenantId, runId, documentId, kindRaw, choice) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 02 of the brand dashboard, Moments & needs (figures computed, nothing saved), with the change against the compared wave (R5 waves). */
export async function loadBrandMomentsAction(runId: string, documentId: string, compareRaw?: unknown): Promise<{ ok: true; moments: Awaited<ReturnType<typeof loadBrandMomentsWithChange>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const choice = compareChoiceFrom(compareRaw);
  if (!choice) return { ok: false, error: BAD_COMPARE };
  try {
    return { ok: true, moments: await loadBrandMomentsWithChange(ctx.tenantId, runId, documentId, choice) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 03 of the brand dashboard, Brand associations (figures computed, nothing saved), with the change against the compared wave (R5 waves). */
export async function loadBrandAssociationsAction(runId: string, documentId: string, compareRaw?: unknown): Promise<{ ok: true; associations: Awaited<ReturnType<typeof loadBrandAssociationsWithChange>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const choice = compareChoiceFrom(compareRaw);
  if (!choice) return { ok: false, error: BAD_COMPARE };
  try {
    return { ok: true, associations: await loadBrandAssociationsWithChange(ctx.tenantId, runId, documentId, choice) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 04 of the brand dashboard, Advertising & WOM (figures computed, nothing saved), with the change against the compared wave (R5 waves). */
export async function loadBrandAdvertisingAction(runId: string, documentId: string, compareRaw?: unknown): Promise<{ ok: true; advertising: Awaited<ReturnType<typeof loadBrandAdvertisingWithChange>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const choice = compareChoiceFrom(compareRaw);
  if (!choice) return { ok: false, error: BAD_COMPARE };
  try {
    return { ok: true, advertising: await loadBrandAdvertisingWithChange(ctx.tenantId, runId, documentId, choice) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 05 of the brand dashboard, Audience & media (figures computed, nothing saved), with the change against the compared wave (R5 waves). */
export async function loadBrandAudienceAction(runId: string, documentId: string, compareRaw?: unknown): Promise<{ ok: true; audience: Awaited<ReturnType<typeof loadBrandAudienceWithChange>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const choice = compareChoiceFrom(compareRaw);
  if (!choice) return { ok: false, error: BAD_COMPARE };
  try {
    return { ok: true, audience: await loadBrandAudienceWithChange(ctx.tenantId, runId, documentId, choice) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The brand dashboard's Category overview page (figures computed, nothing saved), with the change against the compared wave (R5 waves). */
export async function loadCategoryOverviewAction(runId: string, documentId: string, compareRaw?: unknown): Promise<{ ok: true; category: Awaited<ReturnType<typeof loadCategoryOverviewWithChange>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const choice = compareChoiceFrom(compareRaw);
  if (!choice) return { ok: false, error: BAD_COMPARE };
  try {
    return { ok: true, category: await loadCategoryOverviewWithChange(ctx.tenantId, runId, documentId, choice) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function saveTrackerChoicesAction(runId: string, documentId: string, expectedRaw: unknown, choices: unknown): Promise<({ ok: true } & SaveResult) | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const expected = expectedFrom(expectedRaw);
  if (!expected) return { ok: false, error: STALE };
  try {
    const r = await saveTrackerChoices(ctx.tenantId, runId, documentId, expected, choices, ctx.email ?? ctx.userId);
    if (r.saved) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function resetTrackerChoicesAction(runId: string, expectedRaw: unknown): Promise<({ ok: true } & SaveResult) | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const expected = expectedFrom(expectedRaw);
  if (!expected || expected.revision === null) return { ok: false, error: STALE };
  try {
    const r = await resetTrackerChoices(ctx.tenantId, runId, expected, ctx.email ?? ctx.userId);
    if (r.saved) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
