"use server";

import { revalidatePath } from "next/cache";
import { loadVariableDictionary } from "./crosstabs";
import {
  chooseInstrumentLink,
  chooseInstrumentLinkFamily,
  recordInstrumentReadFailure,
  getInstrumentItems,
  InstrumentLinkTakenError as LinkTaken,
  InstrumentReadInFlightError,
  confirmInstrumentLinks,
  setInstrumentLinkStatus,
  isInstrumentReadInFlight,
  getInstrumentLinks,
  readInstrumentItems,
  suggestInstrumentLinks,
  chooseMatchTarget,
  matchCodebookToDataFiles,
  instrumentTypeOf,
  type InstrumentItem,
  type InstrumentReadResult,
  type InstrumentLink,
  AUTO_CONFIRM_MIN,
} from "./instruments";
import { getGuideCoverage, type GuideReport } from "./guides";
import { loadLabelDocumentation, type LabelDocumentation } from "./labelDocumentation";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import type { DataFileMatch } from "./instrumentMatchMessage";

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

const explain = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return /instrument_(items|links)|instrument_type|instrument_for/.test(m) && /(does not exist|column)/.test(m)
    ? "Apply migration 0060 first (npm run migrate), then try again."
    : m;
};

export async function readInstrumentAction(
  runId: string,
  documentId: string,
): Promise<Ok<{ items: number; complete: boolean; failedChunks: number; incompleteItems: number; questionMetaNotStored?: boolean; automaticRecheck?: InstrumentReadResult["automaticRecheck"] }> | (Fail & { inFlight?: true })> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await readInstrumentItems(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, items: r.count, complete: r.complete, failedChunks: r.failedChunks, incompleteItems: r.incompleteItems, ...(r.questionMetaNotStored ? { questionMetaNotStored: true } : {}), ...(r.automaticRecheck ? { automaticRecheck: r.automaticRecheck } : {}) };
  } catch (e) {
    // Another session holds the read (IR-05): nothing was paid for and nothing failed, so it is not
    // recorded as a failure; the caller shows that a read is under way.
    // The same holds for a read that outlived its claim (RR-03, InstrumentReadSupersededError): its
    // results were discarded and a newer read owns the document.
    if (e instanceof InstrumentReadInFlightError) return { ok: false, error: e.message, inFlight: true };
    const error = explain(e);
    // Recorded, so the Import screen's automatic first read (useInstrumentAutoStart) does not pay to
    // try again on every visit; the card shows the reason, and "Read" again is the researcher's retry.
    await recordInstrumentReadFailure(TENANT_ID, runId, documentId, error).catch(() => {});
    revalidatePath(`/runs/${runId}`);
    return { ok: false, error };
  }
}

/**
 * Whether another session is reading this questionnaire or guide now (IR-05), for a page that was
 * told so to wait on. When the read is over the page is revalidated, so its summary shows the result.
 */
export async function instrumentReadInFlightAction(runId: string, documentId: string): Promise<Ok<{ inFlight: boolean }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const inFlight = await isInstrumentReadInFlight(TENANT_ID, runId, documentId);
    if (!inFlight) revalidatePath(`/runs/${runId}`);
    return { ok: true, inFlight };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function setInstrumentTargetAction(
  runId: string,
  instrumentId: string,
  dataDocumentId: string,
): Promise<Ok<{ suggested: number; fromCodebook: number; codebookUnavailable: boolean; autoConfirmed: number; autoUnavailable: boolean }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await suggestInstrumentLinks(TENANT_ID, runId, instrumentId, dataDocumentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/**
 * The first match after a read, with no data file chosen yet. A codebook is matched to every data file it
 * describes (matchCodebookToDataFiles, CB1: every wave, without a click), with each file's outcome. A
 * questionnaire goes to the file that clearly fits (chooseMatchTarget), or, when several fit equally (waves of
 * one tracker) or a file cannot be compared, nothing is matched and the files are returned for the researcher
 * to choose.
 */
export async function matchInstrumentAutomaticallyAction(
  runId: string,
  instrumentId: string,
): Promise<
  | Ok<
      | { matchedTo: string; suggested: number; fromCodebook: number; codebookUnavailable: boolean; autoConfirmed: number; autoUnavailable: boolean }
      | { files: DataFileMatch[]; suggested: number; autoConfirmed: number; autoUnavailable: boolean }
      | { choose: { dataDocumentId: string; filename: string; matched: number | null; error?: string }[] }
      | { none: true }
    >
  | Fail
> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    if ((await instrumentTypeOf(TENANT_ID, runId, instrumentId)) === "codebook") {
      const r = await matchCodebookToDataFiles(TENANT_ID, runId, instrumentId);
      revalidatePath(`/runs/${runId}`);
      if (r.files.length === 0) return { ok: true, none: true };
      return { ok: true, ...r };
    }
    const choice = await chooseMatchTarget(TENANT_ID, runId, instrumentId);
    if (choice.kind === "none") return { ok: true, none: true };
    if (choice.kind === "choose") return { ok: true, choose: choice.candidates };
    const r = await suggestInstrumentLinks(TENANT_ID, runId, instrumentId, choice.dataDocumentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, matchedTo: choice.dataDocumentId, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/**
 * CB1: a codebook already matched is matched to the data files added since (a new wave), without a click. Only
 * files with no link from this codebook are touched; each file's outcome is returned.
 */
export async function matchCodebookToNewDataFilesAction(
  runId: string,
  instrumentId: string,
): Promise<Ok<{ files: DataFileMatch[]; suggested: number; autoConfirmed: number; autoUnavailable: boolean }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await matchCodebookToDataFiles(TENANT_ID, runId, instrumentId, { onlyUnlinked: true });
    if (r.files.some((f) => f.status === "matched")) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** The Labels and documentation tab of a raw data file (LBL-01). Read only. */
export async function loadLabelDocumentationAction(runId: string, dataDocumentId: string): Promise<Ok<{ documentation: LabelDocumentation }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, documentation: await loadLabelDocumentation(TENANT_ID, runId, dataDocumentId) };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function loadInstrumentReviewAction(
  instrumentId: string,
): Promise<Ok<{ items: InstrumentItem[]; links: InstrumentLink[] }> | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const [items, links] = await Promise.all([getInstrumentItems(TENANT_ID, instrumentId), getInstrumentLinks(TENANT_ID, instrumentId)]);
    return { ok: true, items, links };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function setLinkStatusAction(
  runId: string,
  linkId: string,
  status: "suggested" | "confirmed" | "rejected",
): Promise<Ok | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    // Confirming follows the one rule every confirmation path shares (IR-04): a variable confirmed
    // for another question of the same data file is refused, with that question named.
    await setInstrumentLinkStatus(TENANT_ID, runId, linkId, status);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof LinkTaken ? e.message : explain(e) };
  }
}

/**
 * Confirms every suggested link at or above the confidence given, by the shared rule (IR-04). A
 * suggestion whose variable another question already has stays a suggestion and comes back in
 * `refused` with the reason; the others are confirmed.
 */
export async function confirmLinksAction(
  runId: string,
  instrumentId: string,
  minConfidence: number = AUTO_CONFIRM_MIN,
): Promise<Ok<{ confirmed: number; refused: { variable: string; reason: string }[] }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await confirmInstrumentLinks(TENANT_ID, runId, instrumentId, minConfidence);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/**
 * "Confirm all N" for one question (batch 53: a grid's rows or a multiple-response family, 27 clicks for
 * FinScope's C1 otherwise): every suggestion of that question, through the same rule as Confirm (IR-04), so a
 * variable another question already has stays a suggestion and is named in `refused`. The question must be one
 * of this questionnaire's in this project (the query joins on both).
 */
export async function confirmQuestionLinksAction(
  runId: string,
  instrumentId: string,
  itemId: string,
  /** The data file whose links the review shows: only its suggestions are confirmed. */
  dataDocumentId: string,
): Promise<Ok<{ confirmed: number; refused: { variable: string; reason: string }[] }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { ok: false, error: "That question is not in this questionnaire." };
  if (!/^[0-9a-f-]{36}$/i.test(dataDocumentId)) return { ok: false, error: "Choose the data file first." };
  try {
    const r = await confirmInstrumentLinks(TENANT_ID, runId, instrumentId, 0, itemId, dataDocumentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** How well the sessions in this run followed a guide. Computed from the stored text, nothing is saved. */
export async function guideCoverageAction(runId: string, guideId: string, onlyDocumentId?: string): Promise<Ok<{ report: GuideReport }> | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    return { ok: true, report: await getGuideCoverage(TENANT_ID, runId, guideId, onlyDocumentId) };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The variables a question can be linked to by hand: the data file's dictionary, names and labels. */
export async function listLinkableVariablesAction(
  runId: string,
  dataDocumentId: string,
): Promise<Ok<{ variables: { name: string; label: string }[] }> | Fail> {
  if (!UUID.test(runId) || !UUID.test(dataDocumentId)) return { ok: false, error: "Unknown project or data file." };
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const d = await loadVariableDictionary(TENANT_ID, runId, dataDocumentId);
    return { ok: true, variables: d.variables.map((v) => ({ name: v.name, label: v.label })) };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** "Link all N in EN20_*": the question to every variable of its multiple-response family (chooseInstrumentLinkFamily). */
export async function chooseInstrumentLinkFamilyAction(
  runId: string,
  instrumentId: string,
  itemId: string,
  dataDocumentId: string,
  variable: string,
): Promise<Ok<{ linked: number; refused: { variable: string; reason: string }[]; family: string[] }> | Fail> {
  if (![runId, instrumentId, itemId, dataDocumentId].every((x) => UUID.test(x))) return { ok: false, error: "Unknown question or data file." };
  if (typeof variable !== "string" || variable.trim() === "") return { ok: false, error: "Choose a variable." };
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await chooseInstrumentLinkFamily(TENANT_ID, runId, instrumentId, itemId, dataDocumentId, variable);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** Links a question to a variable the researcher chose; stored confirmed, as "Chosen by you" (chooseInstrumentLink). */
export async function chooseInstrumentLinkAction(
  runId: string,
  instrumentId: string,
  itemId: string,
  dataDocumentId: string,
  variable: string,
): Promise<Ok | Fail> {
  if (![runId, instrumentId, itemId, dataDocumentId].every((x) => UUID.test(x))) return { ok: false, error: "Unknown question or data file." };
  if (typeof variable !== "string" || variable.trim() === "") return { ok: false, error: "Choose a variable." };
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await chooseInstrumentLink(TENANT_ID, runId, instrumentId, itemId, dataDocumentId, variable);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof LinkTaken ? e.message : explain(e) };
  }
}
