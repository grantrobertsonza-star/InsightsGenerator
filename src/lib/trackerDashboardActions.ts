"use server";
// D2: server entry points for a tracker dashboard's configuration (trackerDashboards.ts). Each re-checks the
// signed-in tenant; the project, file and revision are checked again inside the write.
import { revalidatePath } from "next/cache";
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadBrandOverview, type BrandOverview } from "./trackerOverview";
import { loadBrandMoments } from "./trackerMoments";
import { loadBrandAssociations } from "./trackerAssociations";
import { loadBrandAdvertising } from "./trackerAdvertising";
import { loadBrandAudience, loadBrandMedia } from "./trackerAudience";
import { loadCategoryOverview } from "./trackerCategory";
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

export async function loadTrackerDashboardAction(runId: string, documentId: string): Promise<{ ok: true; view: TrackerDashboardView } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, view: await loadTrackerDashboard(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** D3: one wave file's brand or CSM dashboard (figures computed, nothing saved). */
export async function loadBrandOverviewAction(runId: string, documentId: string, kindRaw: unknown): Promise<{ ok: true; overview: BrandOverview } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (kindRaw !== "brand" && kindRaw !== "csm") return { ok: false, error: "Choose the brand or the CSM dashboard." };
  try {
    return { ok: true, overview: await loadBrandOverview(ctx.tenantId, runId, documentId, kindRaw) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 02 of the brand dashboard, Moments & needs (figures computed, nothing saved). */
export async function loadBrandMomentsAction(runId: string, documentId: string): Promise<{ ok: true; moments: Awaited<ReturnType<typeof loadBrandMoments>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, moments: await loadBrandMoments(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 03 of the brand dashboard, Brand associations (figures computed, nothing saved). */
export async function loadBrandAssociationsAction(runId: string, documentId: string): Promise<{ ok: true; associations: Awaited<ReturnType<typeof loadBrandAssociations>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, associations: await loadBrandAssociations(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Page 04 of the brand dashboard, Advertising & WOM (figures computed, nothing saved). */
export async function loadBrandAdvertisingAction(runId: string, documentId: string): Promise<{ ok: true; advertising: Awaited<ReturnType<typeof loadBrandAdvertising>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, advertising: await loadBrandAdvertising(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The brand dashboard's Audience page: profile questions of the client's brand's recent acquirers (figures computed,
 * nothing saved). */
export async function loadBrandAudienceAction(runId: string, documentId: string): Promise<{ ok: true; audience: Awaited<ReturnType<typeof loadBrandAudience>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, audience: await loadBrandAudience(ctx.tenantId, runId, documentId) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The brand dashboard's Media page (figures computed, nothing saved): compared with all eligible respondents
 * (`compareBrandRaw` null) or with another brand's recent acquirers (its code in the brand list, checked by the loader). */
export async function loadBrandMediaAction(runId: string, documentId: string, compareBrandRaw: unknown): Promise<{ ok: true; media: Awaited<ReturnType<typeof loadBrandMedia>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (compareBrandRaw !== null && (typeof compareBrandRaw !== "string" || !/^[\w.-]{1,50}$/.test(compareBrandRaw))) return { ok: false, error: "Choose a brand from the list to compare with." };
  try {
    return { ok: true, media: await loadBrandMedia(ctx.tenantId, runId, documentId, compareBrandRaw) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The brand dashboard's Category overview page (figures computed, nothing saved). */
export async function loadCategoryOverviewAction(runId: string, documentId: string): Promise<{ ok: true; category: Awaited<ReturnType<typeof loadCategoryOverview>> } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, category: await loadCategoryOverview(ctx.tenantId, runId, documentId) };
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
