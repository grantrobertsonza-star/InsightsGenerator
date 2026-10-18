"use server";

// Research Quality Review v1: the server actions (brief sections 2, 6 and 7). Each validates its
// input, resolves the signed-in tenant and researcher (G6) itself and returns a result the screen
// can show; none trusts a tenant, author or status from the client. Opening the section or reading
// the view makes no model call; only startResearchQualityReview and retryResearchQualityReview do,
// and they run after the response (next/server after) so the click returns at once.
import { after } from "next/server";
import { requireRequestContext } from "./requestContext";
import { loadResearchQualityView, type ResearchQualityView } from "./researchQualityView";
import { prepareReview, retryFailedTasks, runReview, validateStartInput } from "./researchQualityReview";
import { purgeSourceText, recordResearcherEntry, replaceSourceDocument, saveSourceRoles } from "./researchQualityRepository";
import { ResearchQualityConflictError, ResearchQualityError, ResearchQualitySetupError, SOURCE_ROLES, type ResearcherEntryKind, type SourceRole } from "./researchQualityTypes";
import { estimateReviewCost } from "./researchQualityRules";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean; setup?: boolean };

function failure(error: unknown): { ok: false; error: string; conflict?: boolean; setup?: boolean } {
  if (error instanceof ResearchQualityConflictError) return { ok: false, error: error.message, conflict: true };
  if (error instanceof ResearchQualityError) return { ok: false, error: error.message, setup: error instanceof ResearchQualitySetupError };
  // Navigation (sign-in redirect) must propagate.
  if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) throw error;
  console.error("[researchQualityActions]", error);
  return { ok: false, error: "The server could not complete this. Nothing was changed by the failed step; try again." };
}

export async function loadResearchQualityViewAction(runId: string, reviewId: string | null): Promise<Result<{ view: ResearchQualityView }>> {
  const ctx = await requireRequestContext();
  try {
    return { ok: true, view: await loadResearchQualityView(ctx.tenantId, runId, reviewId) };
  } catch (error) {
    return failure(error);
  }
}

export async function saveResearchQualityRolesAction(runId: string, documentId: string, roles: string[], expectedRevision: number | null): Promise<Result<{ revision: number }>> {
  const ctx = await requireRequestContext();
  try {
    const clean = [...new Set(roles)];
    if (clean.length === 0 || clean.some((r) => !SOURCE_ROLES.includes(r as SourceRole))) throw new ResearchQualityError("Choose at least one valid role.");
    const r = await saveSourceRoles(ctx.tenantId, runId, documentId, clean as SourceRole[], expectedRevision);
    return { ok: true, revision: r.revision };
  } catch (error) {
    return failure(error);
  }
}

/** The estimate shown before the explicit start; no write, no model call. */
export async function estimateResearchQualityReviewAction(totalChars: number, documents: number): Promise<Result<{ estimateUsd: number }>> {
  await requireRequestContext();
  const chars = Math.max(0, Math.min(Number(totalChars) || 0, 120_000));
  return { ok: true, estimateUsd: estimateReviewCost(chars, 5, Math.max(1, Math.ceil(chars / 20_000)) + Math.max(0, Number(documents) - 1)) };
}

export async function startResearchQualityReviewAction(runId: string, raw: unknown): Promise<Result<{ reviewId: string; created: boolean }>> {
  const ctx = await requireRequestContext();
  try {
    const input = validateStartInput(raw);
    const r = await prepareReview(ctx.tenantId, runId, input, { userId: ctx.userId, email: ctx.email });
    if (r.created) {
      const tenantId = ctx.tenantId;
      after(() => runReview(tenantId, runId, r.reviewId).catch((e) => console.error("[researchQuality] review run failed:", e)));
    }
    return { ok: true, reviewId: r.reviewId, created: r.created };
  } catch (error) {
    return failure(error);
  }
}

export async function retryResearchQualityReviewAction(runId: string, reviewId: string): Promise<Result<{ note: string | null }>> {
  const ctx = await requireRequestContext();
  try {
    const tenantId = ctx.tenantId;
    // Validate ownership synchronously, then run in the background.
    await loadResearchQualityView(tenantId, runId, reviewId);
    after(() => retryFailedTasks(tenantId, runId, reviewId).catch((e) => console.error("[researchQuality] retry failed:", e)));
    return { ok: true, note: null };
  } catch (error) {
    return failure(error);
  }
}

export async function recordResearchQualityEntryAction(
  runId: string,
  e: { kind: ResearcherEntryKind; observationId: string | null; observationVersionId: string | null; body: string | null; expectedRevision: number | null; idempotencyKey: string },
): Promise<Result<{ revision: number | null }>> {
  const ctx = await requireRequestContext();
  try {
    if (!["accept", "dismiss", "reopen", "comment", "wording", "clarification"].includes(e.kind)) throw new ResearchQualityError("Unknown action.");
    const body = typeof e.body === "string" ? e.body.trim() : null;
    if ((e.kind === "comment" || e.kind === "clarification" || e.kind === "wording") && !body) throw new ResearchQualityError("Write something first.");
    if (body && body.length > 8000) throw new ResearchQualityError("That text is too long (8,000 characters at most).");
    const r = await recordResearcherEntry(ctx.tenantId, runId, { ...e, body, actor: { userId: ctx.userId, email: ctx.email } });
    return { ok: true, revision: r.revision };
  } catch (error) {
    return failure(error);
  }
}

export async function replaceResearchQualitySourceAction(runId: string, sourceId: string, documentId: string): Promise<Result<object>> {
  const ctx = await requireRequestContext();
  try {
    await replaceSourceDocument(ctx.tenantId, runId, sourceId, documentId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function purgeResearchQualitySourceAction(runId: string, sourceId: string): Promise<Result<{ versions: number }>> {
  const ctx = await requireRequestContext();
  try {
    return { ok: true, ...(await purgeSourceText(ctx.tenantId, runId, sourceId)) };
  } catch (error) {
    return failure(error);
  }
}
