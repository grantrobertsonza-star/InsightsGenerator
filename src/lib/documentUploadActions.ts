"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { ingestOutputFiles } from "./outputIngest";
import { readContextDocument } from "./extractFindings";
import { DuplicateUploadError, INSTRUMENT_TYPES, storeUploadedDocument, markDocumentProcessingStatus, type InstrumentTypeChoice } from "./documentUpload";
import { requireTenantId } from "./requestContext";
import { saveSourceRoles } from "./researchQualityRepository";
import { readIndicatorDocument } from "./indicatorData";

/**
 * Stores a report or transcript and reads its text straight away, so the preview on the Import page
 * shows what was read instead of an empty panel until the project is processed. Reading is best
 * effort: if it fails the upload still stands and processing reads the file again and reports why.
 */
async function storeAndRead(runId: string, kind: "report" | "transcript" | "evidence" | "technical", file: File): Promise<string> {
  const TENANT_ID = await requireTenantId();
  const id = await storeUploadedDocument(TENANT_ID, runId, kind, file);
  try {
    await readContextDocument(TENANT_ID, runId, id);
    await markDocumentProcessingStatus(TENANT_ID, id, "ready");
  } catch {
    // Upload still stands; a later explicit processing action can retry the read. But the
    // document's own status reflects this attempt's real outcome right away, instead of
    // staying unset (indistinguishable from "never processed yet") until the researcher
    // happens to click something that reads it again.
    await markDocumentProcessingStatus(TENANT_ID, id, "failed").catch(() => {});
  }
  return id;
}

/**
 * A brief or proposal: stored as context ("evidence", as Set Objectives stores it), read straight
 * away, and its role recorded for Research quality review so it is offered as what it is. Recording
 * the role is a convenience: if the review module's tables are not there yet, the upload stands and
 * the review screen still lets the researcher choose.
 */
async function storeContext(tenantId: string, runId: string, file: File, role: "brief" | "proposal"): Promise<string> {
  const id = await storeAndRead(runId, "evidence", file);
  await saveSourceRoles(tenantId, runId, id, [role], null).catch(() => {});
  return id;
}

/**
 * Indicator data: stored, then read straight away into series and observations (indicatorData.ts), so
 * the Indicator data tab has something to show. The read is best effort like a report's: a failed read
 * leaves the upload standing with its failure recorded and shown on the file, and Read again retries.
 */
async function storeAndReadIndicators(tenantId: string, runId: string, file: File): Promise<string> {
  const id = await storeUploadedDocument(tenantId, runId, "indicator", file);
  await readIndicatorDocument(tenantId, runId, id);
  return id;
}

export type UploadResult =
  // IMP-008: `alreadyPresent` lists files whose identical content was already in this project as
  // the same kind; they are not added a second time (a retried batch imports each file once).
  | { ok: true; added: string[]; alreadyPresent?: string[]; outputSetId?: string }
  // `added` here too: a partial failure already stored some files durably (each is its
  // own try/catch in the loop below), and the caller needs their names to avoid
  // resubmitting them - a retry that resends the whole original file list, successes
  // included, stores each already-added file a second time under a new document row.
  | { ok: false; error: string; added: string[]; alreadyPresent?: string[]; outputSetId?: string };

// `outputSetId` (B52-F01): the output set this request's statistical output went into, so the dialog's next
// request for the same selection is added to it (one selection, one set, however many requests it takes).
const SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stores whichever of the upload slots have files. Returns what was
 * added, or the error, so the form can say so instead of failing silently.
 */
export async function uploadDocumentsAction(runId: string, formData: FormData): Promise<UploadResult> {
  const TENANT_ID = await requireTenantId();
  const files = (name: string) => (formData.getAll(name) as File[]).filter((f) => f instanceof File && f.size > 0);
  const reports = files("reportFiles");
  const tables = files("tableFiles");
  const raw = files("rawTableFiles");
  const transcripts = files("transcriptFiles");
  // A questionnaire or guide comes under its own field per type (the Add files panel, 2026-10-20), or,
  // from older forms, under instrumentFiles with one instrumentType for the batch.
  const instruments = files("instrumentFiles");
  const typed: [File, InstrumentTypeChoice][] = [
    ...files("questionnaireFiles").map((f): [File, InstrumentTypeChoice] => [f, "questionnaire"]),
    ...files("interviewGuideFiles").map((f): [File, InstrumentTypeChoice] => [f, "interview_guide"]),
    ...files("focusGroupGuideFiles").map((f): [File, InstrumentTypeChoice] => [f, "focus_group_guide"]),
    ...files("codebookFiles").map((f): [File, InstrumentTypeChoice] => [f, "codebook"]),
  ];
  const outputs = files("outputFiles");
  const briefs = files("briefFiles");
  const proposals = files("proposalFiles");
  const technical = files("technicalFiles");
  const indicators = files("indicatorFiles");
  const setRaw = formData.get("outputSetId");
  if (setRaw !== null && setRaw !== "" && !(typeof setRaw === "string" && SET_ID.test(setRaw))) {
    return { ok: false, error: "This upload named an output set that is not valid; choose the files again.", added: [] };
  }
  const appendTo = typeof setRaw === "string" && setRaw !== "" ? setRaw : undefined;
  const waveRaw = formData.get("outputWave");
  const outputWave = typeof waveRaw === "string" ? waveRaw : "";
  const typeRaw = formData.get("instrumentType");
  const instrumentType: InstrumentTypeChoice =
    typeof typeRaw === "string" && (INSTRUMENT_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as InstrumentTypeChoice)
      : "questionnaire";
  const all = [...reports, ...tables, ...raw, ...transcripts, ...instruments, ...typed.map(([f]) => f), ...outputs, ...briefs, ...proposals, ...technical, ...indicators];
  if (all.length === 0) return { ok: false, error: "Choose at least one file first.", added: [] };

  const added: string[] = [];
  const failed: string[] = [];
  const alreadyPresent: string[] = [];
  const jobs: [File, () => Promise<string>][] = [
    ...reports.map((f): [File, () => Promise<string>] => [f, () => storeAndRead(runId, "report", f)]),
    ...tables.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "table", f, "aggregated")]),
    ...raw.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "table", f, "raw")]),
    ...transcripts.map((f): [File, () => Promise<string>] => [f, () => storeAndRead(runId, "transcript", f)]),
    ...instruments.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "instrument", f, undefined, instrumentType)]),
    ...typed.map(([f, type]): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "instrument", f, undefined, type)]),
    ...briefs.map((f): [File, () => Promise<string>] => [f, () => storeContext(TENANT_ID, runId, f, "brief")]),
    ...proposals.map((f): [File, () => Promise<string>] => [f, () => storeContext(TENANT_ID, runId, f, "proposal")]),
    // Read straight away like a brief, for the Research assistant; no Research quality role.
    ...technical.map((f): [File, () => Promise<string>] => [f, () => storeAndRead(runId, "technical", f)]),
    ...indicators.map((f): [File, () => Promise<string>] => [f, () => storeAndReadIndicators(TENANT_ID, runId, f)]),
  ];
  for (const [file, run] of jobs) {
    try {
      await run();
      added.push(file.name);
    } catch (error) {
      if (error instanceof DuplicateUploadError) {
        alreadyPresent.push(error.message);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`${file.name}: ${message}`);
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'upload_error', $3)`,
          [TENANT_ID, runId, JSON.stringify({ file: file.name, message })],
        );
      }).catch(() => {});
    }
  }
  let outputSetId: string | undefined;
  if (outputs.length > 0) {
    try {
      const r = await ingestOutputFiles(TENANT_ID, runId, outputs, { waveLabel: outputWave, appendTo });
      outputSetId = r.setId;
      added.push(`Statistical output, ${r.added} file${r.added === 1 ? "" : "s"}${r.skipped.length > 0 ? ` (${r.skipped.length} left out: ${r.skipped.slice(0, 3).map((x) => x.path).join(", ")}${r.skipped.length > 3 ? ", ..." : ""})` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`Statistical output: ${/output_sets|output_set_id|output_path/.test(message) ? "apply migration 0061 first (npm run migrate), then try again." : message}`);
    }
  }
  revalidatePath(`/runs/${runId}`);
  if (failed.length > 0) {
    return { ok: false, error: `Could not add ${failed.length} file(s). ${failed.join(" | ")}`, added, alreadyPresent, outputSetId };
  }
  return { ok: true, added, alreadyPresent, outputSetId };
}
