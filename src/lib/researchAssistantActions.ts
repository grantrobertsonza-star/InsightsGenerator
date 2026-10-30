"use server";

import { revalidatePath } from "next/cache";
import { askResearchAssistant, loadAssistantConversation, RequestInProgressError, type AssistantMessage } from "./researchAssistant";
import { askGeneralAssistant, checkedHistory } from "./generalAssistant";
import { checkedPageContext } from "./assistantLoop";
import { storeUploadedDocument } from "./documentUpload";
import { extractFindingsFromDocument } from "./extractFindings";
import { detectDuplicateFindings } from "./dedupe";
import { refreshVerdicts } from "./verifyFindings";
import { refreshStatedInsightValidations } from "./validateStatedInsights";
import { refreshInsights } from "./insightGenerator";
import { generateDecisionCandidates } from "./decisionFramer";
import { refreshSynthesizedInsights } from "./insightSynthesizer";
import { refreshSynthesizedInsightQuality } from "./synthesizedInsightQualityScorer";
import { refreshRecommendations } from "./recommendationAgent";
import { withTenant } from "./db";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";

/** A database without migration 0108 (assistant_messages.request_id) says so, as the other migration checks do. */
function needsMigration0108(message: string): string {
  return /request_id/.test(message) && /(column|does not exist|constraint|ON CONFLICT)/i.test(message)
    ? "This needs migration 0108 applied first (npx.cmd supabase migration up)."
    : message;
}

/**
 * The chat-box server action behind the Research assistant card: sends one
 * researcher message to askResearchAssistant and refreshes the page so the
 * new exchange (and any narrative edit it made) shows up. Errors are caught
 * and written to trace, then returned as a plain message the card can show
 * directly, same pattern as the single-document error handling elsewhere on
 * this page.
 */
export async function sendAssistantMessage(
  runId: string,
  message: string,
  page?: unknown,
  requestId?: unknown,
): Promise<{ ok: true; reply: string } | { ok: false; error: string; stillRunning?: boolean }> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    if (requestId !== undefined && requestId !== null && typeof requestId !== "string") throw new Error("The request id is not valid.");
    const { reply } = await askResearchAssistant(TENANT_ID, runId, message, checkedPageContext(page), requestId ?? null);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, reply };
  } catch (error) {
    // Another send of this request is still answering it: nothing was run or stored by this one.
    if (error instanceof RequestInProgressError) return { ok: false, error: error.message, stillRunning: true };
    const messageText = needsMigration0108(error instanceof Error ? error.message : String(error));
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) select $1, $2, 'research_assistant_error', $3 where exists (select 1 from runs where id = $2 and tenant_id = $1)`,
        [TENANT_ID, runId, JSON.stringify({ message: messageText })]
      );
    }).catch(() => {});
    return { ok: false, error: messageText };
  }
}

/**
 * The floating drawer's copy of a project's conversation, read when it opens. A failed read is an
 * error the drawer shows; it is never shown as an empty conversation.
 */
export async function loadAssistantMessages(
  runId: string,
): Promise<{ ok: true; messages: AssistantMessage[] } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false, error: "Not a project." };
  try {
    return { ok: true, messages: await loadAssistantConversation(TENANT_ID, runId, true) };
  } catch (error) {
    return { ok: false, error: needsMigration0108(error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * The drawer outside a project (dashboard, Programs, Knowledge base, Manual): how-the-app and method
 * questions, not stored. The earlier turns come from the drawer and are checked (generalAssistant.ts).
 */
export async function sendGeneralAssistantMessage(
  message: string,
  history: unknown,
  page?: unknown,
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  try {
    const { reply } = await askGeneralAssistant(TENANT_ID, String(message ?? ""), checkedHistory(history), checkedPageContext(page));
    return { ok: true, reply };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Same non-fatal, logged-to-trace resilience as page.tsx's own
// refreshObjectiveCandidates/refreshDecisionCandidates: neither framer
// having nothing to propose (or failing) should stop a document uploaded
// here from otherwise going through the full extract/verify/insight chain.
async function refreshObjectiveCandidatesQuietly(runId: string) {
  // No-op by design: objectives are optional and never inferred automatically.
  void runId;
}

async function refreshDecisionCandidatesQuietly(runId: string) {
  const TENANT_ID = await requireTenantId();
  try {
    await generateDecisionCandidates(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) select $1, $2, 'decision_framer_error', $3 where exists (select 1 from runs where id = $2 and tenant_id = $1)`,
        [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}

/**
 * Lets a slide deck (or any report/table/transcript-shaped file) be
 * uploaded straight from the Research assistant card, so a researcher
 * comparing their own deck against this run's evidence doesn't have to
 * scroll back up to the main document uploader. Stored as an ordinary
 * "report" document and run through the exact same extract/verify/insight
 * chain a document uploaded there would get (see extractFindingsAction in
 * page.tsx) -- there's deliberately no separate, lighter-weight path for a
 * file uploaded here, so a slide deck's content becomes real, reviewable
 * evidence rather than context only the assistant can see.
 */
export async function uploadAssistantDocument(
  runId: string,
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }

  try {
    const documentId = await storeUploadedDocument(TENANT_ID, runId, "report", file);
    try {
      const result = await extractFindingsFromDocument(TENANT_ID, runId, documentId);
      // REP-IN-002: a publication that rolled back returns published: false rather than
      // throwing; route it to the same error trace as a thrown failure.
      if (!result.published) throw new Error(result.notPublishedReason ?? "the reading of this document was not saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) select $1, $2, 'process_run_errors', $3 where exists (select 1 from runs where id = $2 and tenant_id = $1)`,
          [TENANT_ID, runId, JSON.stringify({ errors: [`${file.name}: ${message}`] })]
        );
      }).catch(() => {});
      revalidatePath(`/runs/${runId}`);
      return { ok: false, error: message };
    }

    await detectDuplicateFindings(TENANT_ID, runId);
    await Promise.all([
      refreshVerdicts(TENANT_ID, runId)
        .then(() => refreshStatedInsightValidations(TENANT_ID, runId))
        .then(() => refreshInsights(TENANT_ID, runId)),
      refreshObjectiveCandidatesQuietly(runId),
    ]);
    await refreshDecisionCandidatesQuietly(runId);
    await refreshInsights(TENANT_ID, runId);
    await refreshSynthesizedInsights(TENANT_ID, runId);
    await refreshSynthesizedInsightQuality(TENANT_ID, runId);
    await refreshRecommendations(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
