"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import { extractDocumentText } from "./extractFindings";
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
        const { fullText } = await extractDocumentText(storagePath, file.name, documentId);
        return fullText;
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

    await client.query(
      `update runs set business_problem = $1, initial_research_objective = $2,
              audience = $3, updated_at = now() where id = $4`,
      [businessProblem, objective, audience, runId],
    );

    // Replace the previously carried-over text (if it was edited here),
    // then make sure the current text exists as the researcher's own
    // accepted candidate.
    if (prevObjective && prevObjective !== objective) {
      await client.query(
        `delete from objective_candidates
         where run_id = $1 and source = 'researcher_authored' and trim(candidate_text) = $2`,
        [runId, prevObjective],
      );
    }
    if (objective) {
      const exists = await client.query(
        "select 1 from objective_candidates where run_id = $1 and trim(candidate_text) = $2",
        [runId, objective],
      );
      if (exists.rows.length === 0) {
        await client.query(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, 'Written or imported at project set-up.', 'researcher_authored', 'accepted')`,
          [TENANT_ID, runId, objective],
        );
      }
    }
    await syncResearchObjective(client, runId);
  });

  revalidatePath(`/runs/${runId}`);
}
