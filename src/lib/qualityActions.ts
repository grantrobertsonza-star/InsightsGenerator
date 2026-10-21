"use server";

import { revalidatePath } from "next/cache";
import { scoreObjectiveQuality } from "./objectiveQualityScorer";
import { scoreRecommendationQuality } from "./recommendationQualityScorer";
import { requireTenantId } from "./requestContext";

export type QualityActionResult =
  { ok: true; message: string } | { ok: false; error: string };

/** Scores the objective list now. `force` rescores even if nothing changed, for when more data has been uploaded. */
export async function scoreObjectivesAction(
  runId: string,
  force: boolean,
): Promise<QualityActionResult> {
  const TENANT_ID = await requireTenantId();
  try {
    const r = await scoreObjectiveQuality(TENANT_ID, runId, { force });
    revalidatePath(`/runs/${runId}`);
    // OBJ-REV-M04: objectives are scored in batches; past the scorer's hard bound of 200 the rest
    // are not scored, and that is said here rather than left for the researcher to notice.
    const truncatedNote = r.truncated
      ? " Only the first 200 were scored; there are more than that in the list."
      : "";
    const unscoredNote =
      r.unscored > 0
        ? ` ${r.unscored} could not be scored this time; the reason is shown on each, and the next change or Rescore tries again.`
        : "";
    if (r.skipped)
      return {
        ok: true,
        message:
          "Nothing to score yet, or the objectives are unchanged since they were last scored." + truncatedNote,
      };
    return {
      ok: true,
      message: `${r.scored} objective${r.scored === 1 ? "" : "s"} scored.${unscoredNote}${truncatedNote}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function scoreRecommendationsAction(
  runId: string,
): Promise<QualityActionResult> {
  const TENANT_ID = await requireTenantId();
  try {
    const n = await scoreRecommendationQuality(TENANT_ID, runId);
    revalidatePath(`/runs/${runId}`);
    return {
      ok: true,
      message:
        n === 0
          ? "Every recommendation is already scored."
          : `${n} recommendation${n === 1 ? "" : "s"} scored.`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
