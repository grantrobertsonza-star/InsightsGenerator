import { withTenantRead } from "./db";
import { objectiveIdentityKey } from "./objectiveLines";

/**
 * The trace event one scoring pass writes (objectiveQualityScorer.ts): which objectives it could not
 * score and why. The score columns of objective_quality are NOT NULL (migration 0045), so an
 * unscored objective has no row there; its reason is read back from the latest of these events.
 */
export const OBJECTIVE_QUALITY_PASS_EVENT = "objective_quality_pass";
export type UnscoredRecord = { key: string; reason: "no_score" | "failed"; message?: string };

/**
 * Why an accepted objective has no quality score (Grant, 2026-10-21), read back from what the
 * scorer recorded (objectiveQualityScorer.ts):
 * - "failed" or "no_score": the latest scoring pass tried it and recorded the reason;
 * - "failed" for every objective when the latest pass failed as a whole (an `objective_quality_error`
 *   trace row newer than the latest pass record, written by refreshObjectiveQuality);
 * - "never": no pass has tried it since it was added or reworded.
 */
export type UnscoredReason = { kind: "never" } | { kind: "no_score" } | { kind: "failed"; message: string };

export type ObjectiveQualityStatus = {
  /** By objectiveIdentityKey: the objectives the latest pass could not score, and why. */
  unscored: Map<string, UnscoredReason>;
  /** Set when the latest attempt failed before recording anything per objective. */
  passFailure: string | null;
};

/**
 * Reads the latest scoring pass and failure for a run. A failed read returns `{ error }`, so a page
 * can say the reason could not be loaded rather than showing every objective as never attempted.
 */
export async function loadObjectiveQualityStatus(
  tenantId: string,
  runId: string,
): Promise<ObjectiveQualityStatus | { error: string }> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      // The latest row of each event; ids order them (a later failure outranks an earlier pass).
      const r = await client.query<{ event: string; id: string; detail: { unscored?: UnscoredRecord[]; message?: string } | null }>(
        `select distinct on (event) event, id::text as id, detail from trace
          where run_id = $1 and event in ($2, 'objective_quality_error')
          order by event, id desc`,
        [runId, OBJECTIVE_QUALITY_PASS_EVENT],
      );
      const pass = r.rows.find((x) => x.event === OBJECTIVE_QUALITY_PASS_EVENT);
      const failure = r.rows.find((x) => x.event === "objective_quality_error");
      const unscored = new Map<string, UnscoredReason>();
      for (const u of pass?.detail?.unscored ?? []) {
        if (!u || typeof u.key !== "string") continue;
        unscored.set(u.key, u.reason === "failed" ? { kind: "failed", message: u.message ?? "unknown reason" } : { kind: "no_score" });
      }
      const failureNewer = failure !== undefined && (!pass || BigInt(failure.id) > BigInt(pass.id));
      return { unscored, passFailure: failureNewer ? (failure.detail?.message ?? "unknown reason") : null };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The reason for one objective, by its text. */
export function unscoredReasonFor(status: ObjectiveQualityStatus, text: string): UnscoredReason {
  const recorded = status.unscored.get(objectiveIdentityKey(text));
  if (recorded) return recorded;
  if (status.passFailure) return { kind: "failed", message: status.passFailure };
  return { kind: "never" };
}

/** What the Review screen says under an objective that has no score. */
export function unscoredReasonText(reason: UnscoredReason | null, accepted: boolean): string {
  if (!accepted) return "Accept this objective to have it scored.";
  if (!reason) return "Not scored yet. Why could not be loaded; use Rescore to score it.";
  if (reason.kind === "no_score") return "The scorer returned no score for this objective. Rescore to try again.";
  if (reason.kind === "failed") return `Scoring failed: ${reason.message.replace(/\.$/, "")}. Rescore to try again.`;
  return "Not scored yet: it will be scored after your next change, or use Rescore.";
}

/**
 * Finds the stored score for an objective by objectiveIdentityKey, so a score is not lost when the
 * candidate's text and the scored item differ only by markers, case or punctuation.
 */
export function objectiveQualityLookup<T extends { item_text: string }>(rows: T[]): (text: string) => T | undefined {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = objectiveIdentityKey(row.item_text);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return (text) => byKey.get(objectiveIdentityKey(text));
}
