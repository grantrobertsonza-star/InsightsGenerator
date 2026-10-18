"use server";

import { revalidatePath } from "next/cache";
import {
  integrateThemes,
  resegmentTranscript,
  suggestThemes,
} from "./extractThemes";
import type { SegmentMode } from "./qualCoding";
import { checkMeaningSaturation } from "./meaningCheck";
import {
  addResearcherCode,
  changeTurnCode,
  restoreCodebookVersion,
} from "./codingOverrides";
import { saveCodeMeta, saveTurnNote, syncFindingThemes } from "./codingMeta";
import { addMemo, deleteMemo, reuseCodebook } from "./codingMemos";
import { saveTranscriptSetup, type InterviewStyle } from "./transcriptSetup";
import {
  applyMajorityCoding,
  addVariableLink,
  proposeVariableLinks,
  resetCalibration,
  resolveStabilityTurn,
  runStabilityCheck,
  saveBlindStabilityTurn,
  saveCalibrationTurn,
  searchNegativeCases,
  setCaseMapping,
  setLinkStatus,
  setNegativeCaseStatus,
  setRespondentKey,
  setSessionType,
  startCalibration,
} from "./codingAnalysis";
import { requireTenantId } from "./requestContext";

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
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    setSessionType(TENANT_ID, runId, documentId, sessionType),
  );
}

export async function startCalibrationAction(
  runId: string,
  documentId: string,
  codebookId: string,
  options?: { kind?: "targeted" | "audit"; size?: number },
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    startCalibration(TENANT_ID, documentId, codebookId, options),
  );
}

export async function runStabilityCheckAction(
  runId: string,
  documentId: string,
  codebookId: string,
  reruns: number,
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    runStabilityCheck(TENANT_ID, runId, documentId, codebookId, reruns),
  );
}

export async function applyMajorityCodingAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    const message = await applyMajorityCoding(TENANT_ID, runId, documentId, codebookId);
    await syncFindingThemes(TENANT_ID, documentId);
    return message;
  });
}

export async function saveBlindStabilityTurnAction(
  runId: string,
  codebookId: string,
  segmentId: string,
  codeIds: string[],
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    saveBlindStabilityTurn(TENANT_ID, codebookId, segmentId, codeIds),
  );
}

export async function resolveStabilityTurnAction(
  runId: string,
  documentId: string,
  codebookId: string,
  segmentId: string,
  changes: { codeId: string; action: "add" | "remove" }[],
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    resolveStabilityTurn(
      TENANT_ID,
      runId,
      documentId,
      codebookId,
      segmentId,
      changes,
    ),
  );
}

export async function resetCalibrationAction(
  runId: string,
  codebookId: string,
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, () => resetCalibration(TENANT_ID, codebookId));
}

export async function saveCalibrationTurnAction(
  runId: string,
  codebookId: string,
  segmentId: string,
  appliedCodeIds: string[],
) {
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    setRespondentKey(TENANT_ID, documentId, speakerKey, caseKey),
  );
}

export async function proposeLinksAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
  return guard(runId, () =>
    addVariableLink(TENANT_ID, runId, documentId, link),
  );
}

export async function setLinkStatusAction(
  runId: string,
  linkIds: string[],
  status: "proposed" | "accepted" | "rejected",
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, () => setLinkStatus(TENANT_ID, runId, linkIds, status));
}

export async function searchNegativeCasesAction(
  runId: string,
  documentId: string,
  codebookId: string,
) {
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    const result = await resegmentTranscript(
      TENANT_ID,
      runId,
      documentId,
      mode,
      moderators,
    );
    const n = result.findings.length;
    const persistedNote = result.statusPersisted
      ? ""
      : " (its completion status could not be saved - a database migration is pending; do not trust this document's status badge until it is applied)";
    return `Read the transcript again and re-applied the codebook. ${n} coded finding${n === 1 ? "" : "s"} now.${persistedNote}`;
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
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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
  const TENANT_ID = await requireTenantId();
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

export async function saveCodeMetaAction(
  runId: string,
  documentId: string,
  entries: { name: string; theme: string; note: string; keywords: string }[],
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    await saveCodeMeta(TENANT_ID, documentId, entries);
    await syncFindingThemes(TENANT_ID, documentId);
    return "Saved.";
  });
}

export async function saveTurnNoteAction(
  runId: string,
  documentId: string,
  segmentIndex: number,
  note: string,
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    await saveTurnNote(TENANT_ID, documentId, segmentIndex, note);
  });
}

export async function suggestThemesAction(runId: string, documentId: string) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    const r = await suggestThemes(TENANT_ID, runId, documentId);
    return `Grouped ${r.codes} codes into ${r.themes} themes. Review them, then edit as you see fit.`;
  });
}

export async function integrateThemesAction(runId: string) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    const r = await integrateThemes(TENANT_ID, runId);
    const checks: string[] = [];
    if (r.merged > 0) checks.push(`${r.merged} overlapping theme${r.merged === 1 ? "" : "s"} merged`);
    if (r.placed > 0) checks.push(`${r.placed} unplaced code${r.placed === 1 ? "" : "s"} placed`);
    return `Grouped ${r.codes} codes from ${r.documents} transcripts into ${r.themes} main themes after ${r.rounds} check${r.rounds === 1 ? "" : "s"}${checks.length ? ` (${checks.join(", ")})` : ""}.`;
  });
}

export async function addMemoAction(
  runId: string,
  documentId: string | null,
  codeName: string | null,
  kind: "analytic" | "reflexivity" | "decision",
  body: string,
) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    await addMemo(TENANT_ID, runId, { documentId, codeName, kind, body });
    return "Memo saved.";
  });
}

export async function deleteMemoAction(runId: string, memoId: string) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    await deleteMemo(TENANT_ID, runId, memoId);
  });
}

export async function reuseCodebookAction(runId: string, targetDocumentId: string, sourceDocumentId: string) {
  const TENANT_ID = await requireTenantId();
  return guard(runId, async () => {
    const r = await reuseCodebook(TENANT_ID, runId, targetDocumentId, sourceDocumentId);
    return `Applied ${r.codes} codes from the other transcript. Review the counts, then adjust the codebook if this transcript needs a code of its own.`;
  });
}
