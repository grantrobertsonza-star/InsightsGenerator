import type { Pool } from "pg";
import { normalizeObjectiveLine, parseObjectiveLines, setupLineCandidateIds } from "../../objectiveLines";

/**
 * The target the Set objectives page gives an editor opened now on `text` (page.tsx passes
 * setupLineCandidateIds to StatedObjectivesList), so tests edit the way the page does (R500-02).
 * An objective with no Setup line (added on Review) is targeted by its candidate, as the Review list
 * would be.
 */
export async function setupTarget(pool: Pool, runId: string, text: string): Promise<{ candidateId: string | null }> {
  const run = (await pool.query<{ stated_objectives_text: string | null }>("select stated_objectives_text from runs where id = $1", [runId])).rows[0];
  const lines = parseObjectiveLines(run?.stated_objectives_text ?? null);
  const candidates = (
    await pool.query<{ id: string; candidate_text: string; source: string }>(
      "select id, candidate_text, source from objective_candidates where run_id = $1 order by created_at, id",
      [runId],
    )
  ).rows;
  const wanted = normalizeObjectiveLine(text);
  const i = lines.indexOf(wanted);
  if (i >= 0) return { candidateId: setupLineCandidateIds(lines, candidates)[i] };
  const reviewOnly = candidates.find((c) => c.source === "researcher_authored" && normalizeObjectiveLine(c.candidate_text) === wanted);
  return { candidateId: reviewOnly?.id ?? null };
}
