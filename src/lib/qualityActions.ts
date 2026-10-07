"use server";

import { revalidatePath } from "next/cache";
import { scoreObjectiveQuality } from "./objectiveQualityScorer";
import { scoreRecommendationQuality } from "./recommendationQualityScorer";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export type QualityActionResult =
  { ok: true; message: string } | { ok: false; error: string };

/** Scores the objective list now. `force` rescores even if nothing changed, for when more data has been uploaded. */
export async function scoreObjectivesAction(
  runId: string,
  force: boolean,
): Promise<QualityActionResult> {
  try {
    const r = await scoreObjectiveQuality(TENANT_ID, runId, { force });
    revalidatePath(`/runs/${runId}`);
    if (r.skipped)
      return {
        ok: true,
        message:
          "Nothing to score yet, or the objectives are unchanged since they were last scored.",
      };
    return {
      ok: true,
      message: `${r.scored} objective${r.scored === 1 ? "" : "s"} scored.`,
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
