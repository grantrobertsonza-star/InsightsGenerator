import type { PoolClient } from "pg";

/**
 * REP-IN-002: explicit provenance for researcher actions on findings (migration
 * 0094_finding_review_provenance.sql).
 *
 * This records that an explicit researcher ACTION happened. The app has no authenticated user, so
 * it is action provenance, not person attribution. Review (a status decision) and edit (a content
 * change) are recorded separately and never imply each other.
 *
 * Every function here must run on a client inside the same withTenant transaction as the change it
 * describes, so the change and its provenance commit or roll back together.
 */

export type HumanReviewAction =
  | "accept"
  | "reject"
  | "pending"
  | "bulk_accept"
  | "bulk_reject"
  | "tool_add"
  | "tool_remove";

export type HumanEditField = "theme" | "finding_kind" | "researcher_note" | "finding_text";

const PROVENANCE_COLUMNS = [
  "human_reviewed_at",
  "human_review_action",
  "human_edited_at",
  "human_edited_fields",
  "provenance_tracked",
];

// Only a positive answer is cached: a database migrated while the server runs is picked up on the
// next call, and a negative answer is never remembered.
let confirmedAvailable = false;

/**
 * Whether 0094 has been applied (all five columns on BOTH findings and finding_history). Before it
 * is, edits still save but leave no provenance; replacement then treats every existing finding as
 * provenance unknown (see extractFindings.planReplacement), so the missing record never turns into
 * an assumption that a finding was untouched.
 */
export async function findingProvenanceAvailable(client: PoolClient): Promise<boolean> {
  if (confirmedAvailable) return true;
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public'
        and table_name in ('findings', 'finding_history')
        and column_name = any($1::text[])`,
    [PROVENANCE_COLUMNS],
  );
  confirmedAvailable = r.rows[0]?.n === PROVENANCE_COLUMNS.length * 2;
  return confirmedAvailable;
}

export type ProvenanceWrite = "recorded" | "migration_pending";

/** Records an explicit status decision on exactly these findings. */
export async function recordHumanReview(
  client: PoolClient,
  findingIds: string[],
  action: HumanReviewAction,
): Promise<ProvenanceWrite> {
  if (findingIds.length === 0) return "recorded";
  if (!(await findingProvenanceAvailable(client))) return "migration_pending";
  await client.query(
    `update findings set human_reviewed_at = now(), human_review_action = $2 where id = any($1::uuid[])`,
    [findingIds, action],
  );
  return "recorded";
}

/** Records an explicit content edit; `human_edited_fields` accumulates and never loses a field. */
export async function recordHumanEdit(
  client: PoolClient,
  findingIds: string[],
  field: HumanEditField,
): Promise<ProvenanceWrite> {
  if (findingIds.length === 0) return "recorded";
  if (!(await findingProvenanceAvailable(client))) return "migration_pending";
  await client.query(
    `update findings
        set human_edited_at = now(),
            human_edited_fields = array(
              select distinct f from unnest(array_append(human_edited_fields, $2::text)) as f order by f
            )
      where id = any($1::uuid[])`,
    [findingIds, field],
  );
  return "recorded";
}

/** Maps a findings-table status choice to the review action it represents. */
export function reviewActionForStatus(
  status: "accepted" | "rejected" | "pending",
  bulk: boolean,
): HumanReviewAction {
  if (status === "pending") return "pending";
  if (status === "accepted") return bulk ? "bulk_accept" : "accept";
  return bulk ? "bulk_reject" : "reject";
}
