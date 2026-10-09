"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { ingestOutputFiles } from "./outputIngest";
import { INSTRUMENT_TYPES, storeUploadedDocument, type InstrumentTypeChoice } from "./documentUpload";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export type UploadResult = { ok: true; added: string[] } | { ok: false; error: string };

/**
 * Stores whichever of the five upload slots have files. Returns what was
 * added, or the error, so the form can say so instead of failing silently.
 */
export async function uploadDocumentsAction(runId: string, formData: FormData): Promise<UploadResult> {
  const files = (name: string) => (formData.getAll(name) as File[]).filter((f) => f instanceof File && f.size > 0);
  const reports = files("reportFiles");
  const tables = files("tableFiles");
  const raw = files("rawTableFiles");
  const transcripts = files("transcriptFiles");
  const instruments = files("instrumentFiles");
  const outputs = files("outputFiles");
  const waveRaw = formData.get("outputWave");
  const outputWave = typeof waveRaw === "string" ? waveRaw : "";
  const typeRaw = formData.get("instrumentType");
  const instrumentType: InstrumentTypeChoice =
    typeof typeRaw === "string" && (INSTRUMENT_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as InstrumentTypeChoice)
      : "questionnaire";
  const all = [...reports, ...tables, ...raw, ...transcripts, ...instruments, ...outputs];
  if (all.length === 0) return { ok: false, error: "Choose at least one file first." };

  const added: string[] = [];
  const failed: string[] = [];
  const jobs: [File, () => Promise<string>][] = [
    ...reports.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "report", f)]),
    ...tables.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "table", f, "aggregated")]),
    ...raw.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "table", f, "raw")]),
    ...transcripts.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "transcript", f)]),
    ...instruments.map((f): [File, () => Promise<string>] => [f, () => storeUploadedDocument(TENANT_ID, runId, "instrument", f, undefined, instrumentType)]),
  ];
  for (const [file, run] of jobs) {
    try {
      await run();
      added.push(file.name);
    } catch (error) {
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
  if (outputs.length > 0) {
    try {
      const r = await ingestOutputFiles(TENANT_ID, runId, outputs, { waveLabel: outputWave });
      added.push(`Statistical output, ${r.added} file${r.added === 1 ? "" : "s"}${r.skipped.length > 0 ? ` (${r.skipped.length} left out: ${r.skipped.slice(0, 3).map((x) => x.path).join(", ")}${r.skipped.length > 3 ? ", ..." : ""})` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`Statistical output: ${/output_sets|output_set_id|output_path/.test(message) ? "apply migration 0061 first (npm run migrate), then try again." : message}`);
    }
  }
  revalidatePath(`/runs/${runId}`);
  if (failed.length > 0) {
    return { ok: false, error: `Could not add ${failed.length} file(s). ${failed.join(" | ")}` };
  }
  return { ok: true, added };
}
