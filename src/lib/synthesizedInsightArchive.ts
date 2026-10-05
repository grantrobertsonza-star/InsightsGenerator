import type { PoolClient } from "pg";

/**
 * Snapshots one synthesized insight into synthesized_insight_history (see
 * 0028_synthesized_insight_review.sql), then deletes the live row. Must be
 * called with a client already inside a withTenant transaction, same
 * reasoning as archiveAndReplaceFindings: the snapshot and the delete need
 * to commit or roll back together, or a failure partway through could
 * leave a history row with no corresponding deletion (harmless) or, worse,
 * a deletion with no history row (exactly what this exists to prevent).
 *
 * Deleting the live row cascades synthesized_insight_sources, which is
 * what makes this insight's member pre-insights eligible again for a
 * future synthesis pass (see insightSynthesizer.ts's eligibility query):
 * deleting a synthesized insight is, from the pre-insight's point of view,
 * "this pattern didn't hold up, reconsider me next time."
 *
 * Only a synthesized insight that still exists gets archived; calling this
 * on an id that's already gone (a double-click racing itself) is a no-op,
 * not an error. tenant_id isn't passed in separately, same as
 * archiveAndReplaceFindings: RLS on the withTenant connection already
 * scopes the select, and the insert carries the row's own tenant_id
 * column through.
 */
export async function archiveAndDeleteSynthesizedInsight(
  client: PoolClient,
  params: { runId: string; synthesizedInsightId: string }
): Promise<void> {
  const { runId, synthesizedInsightId } = params;

  const result = await client.query(
    `insert into synthesized_insight_history (
       tenant_id, run_id, original_synthesized_insight_id, headline, observation, tension, implication,
       action_plan_status, triangulation_count, source_theme_count, materiality_rationale, confidence_tier,
       review_status, source_headlines, original_created_at, archived_reason
     )
     select si.tenant_id, si.run_id, si.id, si.headline, si.observation, si.tension, si.implication,
            si.action_plan_status, si.triangulation_count, si.source_theme_count, si.materiality_rationale,
            si.confidence_tier, si.review_status,
            coalesce(
              (select array_agg(pi.headline order by pi.created_at)
               from synthesized_insight_sources s
               join insights pi on pi.id = s.pre_insight_id
               where s.synthesized_insight_id = si.id),
              '{}'
            ),
            si.created_at, 'researcher_deleted'
     from synthesized_insights si
     where si.id = $1 and si.run_id = $2
     on conflict (original_synthesized_insight_id) do nothing`,
    [synthesizedInsightId, runId]
  );

  if (result.rowCount === 0) return;

  await client.query("delete from synthesized_insights where id = $1 and run_id = $2", [
    synthesizedInsightId,
    runId,
  ]);
}
