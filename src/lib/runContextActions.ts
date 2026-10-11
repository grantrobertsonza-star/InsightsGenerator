"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import { readContextDocument } from "./extractFindings";
import { extractBriefFields } from "./briefIntake";
import { syncResearchObjective } from "./runSync";

const BUCKET = "documents";
const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

function fileOrNull(entry: FormDataEntryValue | null): File | null {
  return entry instanceof File && entry.size > 0 ? entry : null;
}

/**
 * Saves the project's context: business problem, research objective or
 * hypothesis, and audience. All optional. An uploaded brief and/or proposal
 * only fills fields the researcher left blank, it never overwrites text
 * typed by hand. The objective is also kept as the researcher's own accepted
 * candidate, so a later accept or reject on the objective list (which
 * recomputes runs.research_objective from accepted candidates) cannot wipe it.
 */
export async function saveRunContext(runId: string, formData: FormData) {
  const clean = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v.length > 0 ? v : null;
  };
  let businessProblem = clean("businessProblem");
  let objective = clean("researchObjective");
  const audience = String(formData.get("audience") ?? "").trim();
  const briefFile = fileOrNull(formData.get("briefFile"));
  const proposalFile = fileOrNull(formData.get("proposalFile"));

  if (briefFile || proposalFile) {
    try {
      // Stored as "evidence" documents: context for the project, not
      // sources to mine findings from.
      const storeAndExtractText = async (file: File): Promise<string> => {
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        const storagePath = `${TENANT_ID}/${runId}/${Date.now()}-${safeFileName}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const { error } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(storagePath, buffer, { contentType: file.type || undefined });
        if (error) throw new Error(`Upload of ${file.name} failed: ${error.message}`);
        const documentId = await withTenant(TENANT_ID, async (client) => {
          const r = await client.query<{ id: string }>(
            `insert into documents (tenant_id, run_id, kind, source_filename, storage_path)
             values ($1, $2, 'evidence', $3, $4) returning id`,
            [TENANT_ID, runId, file.name, storagePath],
          );
          return r.rows[0].id;
        });
        // Reads and stores the text (with a direct .docx fallback) so the file previews and later steps can use it.
        await readContextDocument(TENANT_ID, runId, documentId);
        const stored = await withTenant(TENANT_ID, async (client) => {
          const r = await client.query<{ extracted_text: string | null }>("select extracted_text from documents where id = $1", [documentId]);
          return r.rows[0]?.extracted_text ?? "";
        });
        return stored;
      };
      const [briefText, proposalText] = await Promise.all([
        briefFile ? storeAndExtractText(briefFile) : Promise.resolve(null),
        proposalFile ? storeAndExtractText(proposalFile) : Promise.resolve(null),
      ]);
      const extracted = await extractBriefFields(TENANT_ID, runId, { briefText, proposalText });
      businessProblem = businessProblem ?? extracted.businessProblem;
      objective = objective ?? extracted.researchObjective;
    } catch (error) {
      // An unreadable brief must not block saving what was typed.
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'brief_intake_error', $3)`,
          [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })],
        );
      }).catch(() => {});
    }
  }

  await withTenant(TENANT_ID, async (client) => {
    const prev = await client.query<{ initial_research_objective: string | null }>(
      "select initial_research_objective from runs where id = $1",
      [runId],
    );
    const prevObjective = prev.rows[0]?.initial_research_objective?.trim() ?? null;

    // The objective box only adds. Saved objectives live in the list beside
    // the form, where they are edited or deleted one by one.
    const toLines = (text: string | null) =>
      (text ?? "")
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(\d+[.)]|[-*\u2022])\s*/, "").trim())
        .filter((l) => l.length > 0);
    const prevLines = toLines(prevObjective);
    const newLines = toLines(objective).filter((l) => !prevLines.includes(l));
    const merged = [...prevLines, ...newLines].join("\n") || null;

    await client.query(
      `update runs set business_problem = $1, initial_research_objective = $2,
              audience = $3, updated_at = now() where id = $4`,
      [businessProblem, merged, audience, runId],
    );

    for (const line of newLines) {
      const exists = await client.query(
        "select 1 from objective_candidates where run_id = $1 and trim(candidate_text) = $2",
        [runId, line],
      );
      if (exists.rows.length === 0) {
        await client.query(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, 'Written or imported at project set-up.', 'researcher_authored', 'accepted')`,
          [TENANT_ID, runId, line],
        );
      }
    }
    await syncResearchObjective(client, runId);
  });

  // Setup only records objectives. Scoring and checking against the insights
  // happen later, in Objective review, once there is data to judge them by.
  revalidatePath(`/runs/${runId}`);
}

const splitObjectiveLines = (text: string | null) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 0);

/**
 * Edits or removes one stated objective (pass newText = null to remove it).
 * Keeps the project's starting-objective text and the objective list in step.
 */
export async function editStatedObjective(runId: string, oldText: string, newText: string | null) {
  const next = newText?.trim() ? newText.trim() : null;
  await withTenant(TENANT_ID, async (client) => {
    const r = await client.query<{ initial_research_objective: string | null }>(
      "select initial_research_objective from runs where id = $1",
      [runId],
    );
    const lines = splitObjectiveLines(r.rows[0]?.initial_research_objective ?? null);
    const idx = lines.indexOf(oldText.trim());
    if (idx >= 0) {
      if (next) lines[idx] = next;
      else lines.splice(idx, 1);
    } else if (next) {
      lines.push(next);
    }
    await client.query("update runs set initial_research_objective = $1, updated_at = now() where id = $2", [
      lines.length > 0 ? lines.join("\n") : null,
      runId,
    ]);

    if (next) {
      const updated = await client.query(
        `update objective_candidates set candidate_text = $1, edited = true
         where run_id = $2 and source = 'researcher_authored' and trim(candidate_text) = $3`,
        [next, runId, oldText.trim()],
      );
      if (updated.rowCount === 0) {
        await client.query(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, 'Written or imported at project set-up.', 'researcher_authored', 'accepted')`,
          [TENANT_ID, runId, next],
        );
      }
    } else {
      await client.query(
        `delete from objective_candidates
         where run_id = $1 and source = 'researcher_authored' and trim(candidate_text) = $2`,
        [runId, oldText.trim()],
      );
    }
    await syncResearchObjective(client, runId);
  });
  revalidatePath(`/runs/${runId}`);
}
