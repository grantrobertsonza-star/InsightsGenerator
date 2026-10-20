"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { loadVariableDictionary } from "./crosstabs";
import {
  InstrumentLinkTakenError,
  chooseInstrumentLink,
  recordInstrumentReadFailure,
  getInstrumentItems,
  getInstrumentLinks,
  readInstrumentItems,
  suggestInstrumentLinks,
  type InstrumentItem,
  type InstrumentLink,
  AUTO_CONFIRM_MIN,
} from "./instruments";
import { getGuideCoverage, type GuideReport } from "./guides";
import { requireTenantId } from "./requestContext";

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
): Promise<Ok<{ items: number; complete: boolean; failedChunks: number; incompleteItems: number }> | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const r = await readInstrumentItems(TENANT_ID, runId, documentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, items: r.count, complete: r.complete, failedChunks: r.failedChunks, incompleteItems: r.incompleteItems };
  } catch (e) {
    const error = explain(e);
    // Recorded, so the Import screen's automatic first read (useInstrumentAutoStart) does not pay to
    // try again on every visit; the card shows the reason, and "Read" again is the researcher's retry.
    await recordInstrumentReadFailure(TENANT_ID, runId, documentId, error).catch(() => {});
    revalidatePath(`/runs/${runId}`);
    return { ok: false, error };
  }
}

export async function setInstrumentTargetAction(
  runId: string,
  instrumentId: string,
  dataDocumentId: string,
): Promise<Ok<{ suggested: number }> | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const r = await suggestInstrumentLinks(TENANT_ID, runId, instrumentId, dataDocumentId);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
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
  try {
    await withTenant(TENANT_ID, async (client) => {
      await client.query("update instrument_links set status = $1 where id = $2 and run_id = $3", [status, linkId, runId]);
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** Confirms every suggested link at or above the confidence given. */
export async function confirmLinksAction(
  runId: string,
  instrumentId: string,
  minConfidence: number = AUTO_CONFIRM_MIN,
): Promise<Ok<{ confirmed: number }> | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const n = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query(
        `update instrument_links set status = 'confirmed'
         where run_id = $1 and status = 'suggested' and confidence >= $3
           and item_id in (select id from instrument_items where document_id = $2)`,
        [runId, instrumentId, minConfidence],
      );
      return r.rowCount ?? 0;
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, confirmed: n };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

/** How well the sessions in this run followed a guide. Computed from the stored text, nothing is saved. */
export async function guideCoverageAction(runId: string, guideId: string, onlyDocumentId?: string): Promise<Ok<{ report: GuideReport }> | Fail> {
  const TENANT_ID = await requireTenantId();
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
  try {
    const d = await loadVariableDictionary(TENANT_ID, runId, dataDocumentId);
    return { ok: true, variables: d.variables.map((v) => ({ name: v.name, label: v.label })) };
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
  try {
    await chooseInstrumentLink(TENANT_ID, runId, instrumentId, itemId, dataDocumentId, variable);
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof InstrumentLinkTakenError ? e.message : explain(e) };
  }
}
