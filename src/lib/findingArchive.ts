import type { PoolClient } from "pg";

export type ArchiveReason =
  "regenerate_unreviewed" | "full_reprocess" | "manual_reextract";

/**
 * Before any delete that would remove findings (and, by cascade, their
 * verdicts, insights, and recommendations), this snapshots exactly what's
 * about to be lost into the *_history tables (see
 * 0021_finding_history.sql), then performs the delete. Must be called with
 * a client already inside a withTenant transaction: the caller's own
 * begin/commit is what makes the snapshot and the delete atomic, so if
 * anything later in that transaction fails and rolls back, the snapshot
 * rolls back with it rather than leaving a record of something that was
 * never actually removed.
 *
 * documentColumn/documentId scope this to one document's findings, the
 * same scope every call site already used for its own delete. onlyRejected
 * narrows it to findings still at status 'rejected' ("Regenerate
 * rejected" -- findings insert as 'accepted' by default now, so a
 * researcher reviews by exception, rejecting the ones that are wrong);
 * false archives and replaces everything regardless of review status
 * ("Reprocess all documents", or a single-document manual re-extract).
 *
 * insight_history.original_finding_id is unique (see 0021), but the live
 * `insights` table has no equivalent constraint stopping two insight rows
 * from ever pointing at the same finding_id (a race between two generation
 * passes on the same run is the way that actually happens). Without a
 * safeguard, archiving a finding with duplicate insights would throw a
 * unique-violation on the insight_history insert and roll back this entire
 * function, findings and all, with no visible error and nothing archived.
 * `picked_insights` below picks one insight per finding deterministically
 * (the oldest, as the one most likely to be the "real" one) before either
 * insert touches it, so a duplicate can't abort the archive; the insight
 * that loses the pick is still deleted via cascade when findings are
 * deleted below, it just isn't the one kept in history. `on conflict do
 * nothing` on the insight_history insert is a second line of defense for
 * the same failure mode, in case of a concurrent archive on the same
 * document somehow racing this one.
 */
export async function archiveAndReplaceFindings(
  client: PoolClient,
  params: {
    documentColumn: "source_document_id" | "source_table_id";
    documentId: string;
    onlyRejected: boolean;
    archiveReason: ArchiveReason;
  },
): Promise<void> {
  const { documentColumn, documentId, onlyRejected, archiveReason } = params;
  const statusClause = onlyRejected ? "and status = 'rejected'" : "";
  const statusClauseAliased = onlyRejected ? "and f.status = 'rejected'" : "";

  await client.query(
    `insert into finding_history (
       tenant_id, run_id, original_finding_id, origin, finding_text, finding_kind, theme, status,
       source_document_id, source_table_id, source_page, source_quote, data_type, original_created_at,
       archived_reason
     )
     select tenant_id, run_id, id, origin, finding_text, finding_kind, theme, status,
            source_document_id, source_table_id, source_page, source_quote, data_type, created_at, $2
     from findings
     where ${documentColumn} = $1 ${statusClause}
     on conflict (original_finding_id) do nothing`,
    [documentId, archiveReason],
  );

  await client.query(
    `insert into verdict_history (
       tenant_id, run_id, original_finding_id, original_verdict_id, verdict_tier, rationale,
       verification_method, corroboration_level, original_created_at
     )
     select v.tenant_id, f.run_id, v.finding_id, v.id, v.verdict_tier, v.rationale,
            v.verification_method, v.corroboration_level, v.created_at
     from verdicts v
     join findings f on f.id = v.finding_id
     where f.${documentColumn} = $1 ${statusClauseAliased}`,
    [documentId],
  );

  await client.query(
    `with picked_insights as (
       select distinct on (i.finding_id)
         i.tenant_id, i.run_id, i.finding_id, i.id, i.headline, i.observation, i.tension,
         i.implication, i.decision_context, i.quality_score, i.quality_tier, i.quality_rationale, i.created_at
       from insights i
       join findings f on f.id = i.finding_id
       where f.${documentColumn} = $1 ${statusClauseAliased}
       order by i.finding_id, i.created_at asc, i.id asc
     )
     insert into insight_history (
       tenant_id, run_id, original_finding_id, original_insight_id, headline, observation, tension,
       implication, decision_context, quality_score, quality_tier, quality_rationale, original_created_at
     )
     select tenant_id, run_id, finding_id, id, headline, observation, tension,
            implication, decision_context, quality_score, quality_tier, quality_rationale, created_at
     from picked_insights
     on conflict (original_finding_id) do nothing`,
    [documentId],
  );

  await client.query(
    `with picked_insights as (
       select distinct on (i.finding_id) i.id as insight_id
       from insights i
       join findings f on f.id = i.finding_id
       where f.${documentColumn} = $1 ${statusClauseAliased}
       order by i.finding_id, i.created_at asc, i.id asc
     )
     insert into recommendation_history (
       tenant_id, run_id, original_insight_id, original_recommendation_id, action_text, owner_role,
       timeline, metric, priority, status, original_created_at
     )
     select r.tenant_id, r.run_id, r.insight_id, r.id, r.action_text, r.owner_role,
            r.timeline, r.metric, r.priority, r.status, r.created_at
     from recommendations r
     join picked_insights pi on pi.insight_id = r.insight_id`,
    [documentId],
  );

  await client.query(
    `delete from findings where ${documentColumn} = $1 ${statusClause}`,
    [documentId],
  );
}
