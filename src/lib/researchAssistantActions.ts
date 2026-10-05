"use server";

import { revalidatePath } from "next/cache";
import { askResearchAssistant } from "./researchAssistant";
import { storeUploadedDocument } from "./documentUpload";
import { extractFindingsFromDocument } from "./extractFindings";
import { detectDuplicateFindings } from "./dedupe";
import { refreshVerdicts } from "./verifyFindings";
import { refreshStatedInsightValidations } from "./validateStatedInsights";
import { refreshInsights } from "./insightGenerator";
import { generateObjectiveCandidates } from "./objectiveFramer";
import { generateDecisionCandidates } from "./decisionFramer";
import { refreshSynthesizedInsights } from "./insightSynthesizer";
import { refreshSynthesizedInsightQuality } from "./synthesizedInsightQualityScorer";
import { refreshRecommendations } from "./recommendationAgent";
import { withTenant } from "./db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

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
  message: string
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  try {
    const { reply } = await askResearchAssistant(TENANT_ID, runId, message);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, reply };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'research_assistant_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message: messageText })]
      );
    }).catch(() => {});
    return { ok: false, error: messageText };
  }
}

// Same non-fatal, logged-to-trace resilience as page.tsx's own
// refreshObjectiveCandidates/refreshDecisionCandidates: neither framer
// having nothing to propose (or failing) should stop a document uploaded
// here from otherwise going through the full extract/verify/insight chain.
async function refreshObjectiveCandidatesQuietly(runId: string) {
  try {
    await generateObjectiveCandidates(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_framer_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
}

async function refreshDecisionCandidatesQuietly(runId: string) {
  try {
    await generateDecisionCandidates(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'decision_framer_error', $3)`,
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
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }

  try {
    const documentId = await storeUploadedDocument(TENANT_ID, runId, "report", file);
    try {
      await extractFindingsFromDocument(TENANT_ID, runId, documentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'process_run_errors', $3)`,
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
