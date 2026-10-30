"use server";
// R5story: server entry points for the brand tracking dashboard's story (post a card as a finding, AI insights, the
// executive summary and conclusions). Each re-checks the signed-in tenant and the project at its entry (SEC2); the
// library functions they call scope every read and write to the tenant and check the data file inside the write.
// Ids from the browser (page, card, draft) are checked against the registry or the database, never trusted.
import { revalidatePath } from "next/cache";
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { dashboardFindingStatuses, postDashboardCard, syncDashboardFindingFreshness, type DashboardFindingStatus } from "./dashboardFindings";
import {
  decideDraft,
  draftModuleStory,
  editDraft,
  generatePageInsights,
  loadModuleStory,
  loadPageInsights,
  MODULE_PAGE,
  pageHashesOf,
  postInsightAsFinding,
  storyInputsHash,
  loadStoryInputs,
  type AiDraft,
  type DecideResult,
  type GenerateResult,
  type StoryInput,
} from "./dashboardInsights";
import { dashboardPages, loadPageFigures } from "./trackerDashboardCards";
import { figuresHashOf } from "./dashboardFindings";
import { withTenantRead } from "./db";

type Fail = { ok: false; error: string };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Posts one card as a finding (dashboardFindings.postDashboardCard). */
export async function postDashboardCardAction(runId: string, documentId: string, page: unknown, card: unknown): Promise<{ ok: true; added: boolean; findingId: string; superseded: number } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await postDashboardCard(ctx.tenantId, runId, documentId, page, card);
    if (!r.ok) return r;
    revalidatePath(`/runs/${runId}`);
    return { ok: true, added: r.added, findingId: r.findingId, superseded: r.superseded };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** What has been posted from this data file's dashboard, after checking the posted findings' sources. A failed
 * freshness check is reported with the statuses, never hidden. */
export async function dashboardFindingStatusAction(runId: string, documentId: string): Promise<{ ok: true; statuses: DashboardFindingStatus[]; freshnessError: string | null } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    let freshnessError: string | null = null;
    try {
      await syncDashboardFindingFreshness(ctx.tenantId, runId);
    } catch (e) {
      freshnessError = `Whether posted findings are still current could not be checked: ${message(e)}`;
    }
    return { ok: true, statuses: await dashboardFindingStatuses(ctx.tenantId, runId, documentId), freshnessError };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function loadPageInsightsAction(runId: string, documentId: string, page: unknown): Promise<{ ok: true; drafts: AiDraft[] } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await loadPageInsights(ctx.tenantId, runId, documentId, page);
    return r.ok ? { ok: true, drafts: r.drafts } : r;
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function generatePageInsightsAction(runId: string, documentId: string, page: unknown): Promise<GenerateResult> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return await generatePageInsights(ctx.tenantId, runId, documentId, page);
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The figures hash a draft is judged against now: its page's figures, or for the module's summary and conclusions,
 * the accepted inputs. */
async function currentHashOf(tenantId: string, runId: string, documentId: string, page: string): Promise<string> {
  if (page !== MODULE_PAGE) {
    const p = await loadPageFigures(tenantId, runId, documentId, page);
    return figuresHashOf(p.cards.filter((c) => c.status === "ok").flatMap((c) => c.figures), p.ctx);
  }
  const pages = await Promise.all(dashboardPages().map((p) => loadPageFigures(tenantId, runId, documentId, p.id)));
  return storyInputsHash(await loadStoryInputs(tenantId, runId, documentId, pageHashesOf(pages)));
}

async function draftPage(tenantId: string, runId: string, documentId: string, id: string): Promise<string | null> {
  return withTenantRead(tenantId, async (client) => {
    const exists = (await client.query<{ ok: boolean }>("select to_regclass('tracker_dashboard_ai') is not null as ok")).rows[0]?.ok === true;
    if (!exists) return null;
    const r = await client.query<{ page: string }>("select page from tracker_dashboard_ai where id = $1 and run_id = $2 and document_id = $3 and tenant_id = $4", [id, runId, documentId, tenantId]);
    return r.rows[0]?.page ?? null;
  });
}

/** Accept, discard or reopen a draft (compare-and-swap on its revision). */
export async function decideDraftAction(runId: string, documentId: string, id: string, action: unknown, revision: unknown): Promise<DecideResult> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const page = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? await draftPage(ctx.tenantId, runId, documentId, id) : null;
    if (!page) return { ok: false, error: "That draft no longer exists. Reload to see the current drafts." };
    const current = action === "accept" ? await currentHashOf(ctx.tenantId, runId, documentId, page) : null;
    return await decideDraft(ctx.tenantId, runId, id, action, revision, current);
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function editDraftAction(runId: string, documentId: string, id: string, text: unknown, revision: unknown): Promise<DecideResult> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const page = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? await draftPage(ctx.tenantId, runId, documentId, id) : null;
    if (!page) return { ok: false, error: "That draft no longer exists. Reload to see the current drafts." };
    return await editDraft(ctx.tenantId, runId, id, text, revision);
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function postInsightAsFindingAction(runId: string, documentId: string, id: string): Promise<{ ok: true; findingId: string; added: boolean } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await postInsightAsFinding(ctx.tenantId, runId, documentId, id);
    if (r.ok) revalidatePath(`/runs/${runId}`);
    return r;
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** The executive summary and conclusions drafts, with the accepted material they may be drafted from. */
export async function loadModuleStoryAction(runId: string, documentId: string): Promise<{ ok: true; drafts: AiDraft[]; inputs: StoryInput[] } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const pages = await Promise.all(dashboardPages().map((p) => loadPageFigures(ctx.tenantId, runId, documentId, p.id)));
    return await loadModuleStory(ctx.tenantId, runId, documentId, pageHashesOf(pages));
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function draftModuleStoryAction(runId: string, documentId: string, kind: unknown): Promise<GenerateResult> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const pages = await Promise.all(dashboardPages().map((p) => loadPageFigures(ctx.tenantId, runId, documentId, p.id)));
    return await draftModuleStory(ctx.tenantId, runId, documentId, kind, pageHashesOf(pages));
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
