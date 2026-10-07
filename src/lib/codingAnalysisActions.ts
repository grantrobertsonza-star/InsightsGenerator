"use server";

import { revalidatePath } from "next/cache";
import { resegmentTranscript } from "./extractThemes";
import type { SegmentMode } from "./qualCoding";
import { checkMeaningSaturation } from "./meaningCheck";
import {
  addResearcherCode,
  changeTurnCode,
  restoreCodebookVersion,
} from "./codingOverrides";
import { saveTranscriptSetup, type InterviewStyle } from "./transcriptSetup";
import {
  addVariableLink,
  proposeVariableLinks,
  resetCalibration,
  saveCalibrationTurn,
  searchNegativeCases,
  setCaseMapping,
  setLinkStatus,
  setNegativeCaseStatus,
  setRespondentKey,
  setSessionType,
  startCalibration,
} from "./codingAnalysis";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export type ActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

async function guard(
  runId: string,
  fn: () => Promise<string | void>,
): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath(`/runs/${runId}`);
    return message ? { ok: true, message } : { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function setSessionTypeAction(
  runId: string,
  documentId: string,
  sessionType: "individual" | "focus_group",
) {
  return guard(runId, () =>
    setSessionType(TENANT_ID, runId, documentId, sessionType),
  );
}

export async function startCalibrationAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  return guard(runId, () =>
    startCalibration(TENANT_ID, documentId, codebookId),
  );
}

export async function resetCalibrationAction(
  runId: string,
  codebookId: string,
) {
  return guard(runId, () => resetCalibration(TENANT_ID, codebookId));
}

export async function saveCalibrationTurnAction(
  runId: string,
  codebookId: string,
  segmentId: string,
  appliedCodeIds: string[],
) {
  return guard(runId, () =>
    saveCalibrationTurn(TENANT_ID, codebookId, segmentId, appliedCodeIds),
  );
}

export async function setCaseMappingAction(
  runId: string,
  documentId: string,
  tableId: string | null,
  column: string | null,
) {
  return guard(runId, () =>
    setCaseMapping(TENANT_ID, runId, documentId, tableId, column),
  );
}

export async function setRespondentKeyAction(
  runId: string,
  documentId: string,
  speakerKey: string,
  caseKey: string,
) {
  return guard(runId, () =>
    setRespondentKey(TENANT_ID, documentId, speakerKey, caseKey),
  );
}

export async function proposeLinksAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  return guard(runId, async () => {
    const { proposed } = await proposeVariableLinks(
      TENANT_ID,
      runId,
      documentId,
      codebookId,
    );
    return proposed === 0
      ? "The model found no theme with a clear counterpart in the survey."
      : `${proposed} link${proposed === 1 ? "" : "s"} proposed for review.`;
  });
}

export async function addLinkAction(
  runId: string,
  documentId: string,
  link: { codeName: string; variable: string; direction: "higher" | "lower" },
) {
  return guard(runId, () =>
    addVariableLink(TENANT_ID, runId, documentId, link),
  );
}

export async function setLinkStatusAction(
  runId: string,
  linkIds: string[],
  status: "proposed" | "accepted" | "rejected",
) {
  return guard(runId, () => setLinkStatus(TENANT_ID, runId, linkIds, status));
}

export async function searchNegativeCasesAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  return guard(runId, async () => {
    const r = await searchNegativeCases(
      TENANT_ID,
      runId,
      documentId,
      codebookId,
    );
    const failed =
      r.failedBatches > 0
        ? ` ${r.failedBatches} of ${r.totalBatches} batches failed, so the search is incomplete.`
        : "";
    return `${r.found} possible negative case${r.found === 1 ? "" : "s"} found.${failed}`;
  });
}

export async function setNegativeCaseStatusAction(
  runId: string,
  id: string,
  status: "pending" | "confirmed" | "dismissed",
) {
  return guard(runId, () =>
    setNegativeCaseStatus(TENANT_ID, runId, id, status),
  );
}

export async function resegmentTranscriptAction(
  runId: string,
  documentId: string,
  mode: SegmentMode,
  moderators: string[],
) {
  return guard(runId, async () => {
    const rows = await resegmentTranscript(
      TENANT_ID,
      runId,
      documentId,
      mode,
      moderators,
    );
    return `Read the transcript again and re-applied the codebook. ${rows.length} coded finding${rows.length === 1 ? "" : "s"} now.`;
  });
}

export async function saveTranscriptSetupAction(
  runId: string,
  documentId: string,
  setup: {
    sessionType: "individual" | "focus_group";
    mode: SegmentMode;
    style: InterviewStyle | null;
  },
) {
  // No revalidatePath: the setup grid keeps its own state, and re-rendering
  // this whole page for three dropdowns is what made it feel slow.
  try {
    await saveTranscriptSetup(TENANT_ID, runId, documentId, setup);
    return { ok: true } as ActionResult;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } as ActionResult;
  }
}

export async function checkMeaningSaturationAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  return guard(runId, async () => {
    const r = await checkMeaningSaturation(
      TENANT_ID,
      runId,
      documentId,
      codebookId,
    );
    return (
      `Checked ${r.checked} theme${r.checked === 1 ? "" : "s"}; ` +
      `${r.newMeaning} had later respondents adding something new.` +
      (r.failed > 0 ? ` ${r.failed} could not be checked, try again.` : "")
    );
  });
}

export async function changeTurnCodeAction(
  runId: string,
  documentId: string,
  segmentId: string,
  codeId: string,
  action: "add" | "remove",
) {
  return guard(runId, () =>
    changeTurnCode(TENANT_ID, runId, documentId, segmentId, codeId, action),
  );
}

export async function addResearcherCodeAction(
  runId: string,
  documentId: string,
  codebookId: string,
  name: string,
  definition: string,
  segmentId: string | null,
) {
  return guard(runId, () =>
    addResearcherCode(
      TENANT_ID,
      runId,
      documentId,
      codebookId,
      name,
      definition,
      segmentId,
    ),
  );
}

export async function restoreCodebookVersionAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  return guard(runId, async () => {
    const v = await restoreCodebookVersion(
      TENANT_ID,
      runId,
      documentId,
      codebookId,
    );
    return `Restored as version ${v}.`;
  });
}
