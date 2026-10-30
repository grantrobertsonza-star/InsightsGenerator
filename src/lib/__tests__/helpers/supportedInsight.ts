import type { Pool } from "pg";

/**
 * An accepted synthesized insight resting on one accepted finding, linked through its pre-insight with
 * the finding's support recorded the way synthesis records it (finding_support_parts at drafting), so the
 * support reader (supportStatus.ts) reads it as current until the finding changes or is rejected. An
 * insight inserted with no finding behind it is, correctly, unsupported.
 */
export async function insertSupportedInsight(
  pool: Pool,
  tenant: string,
  run: string,
  headline = "Synthetic",
): Promise<{ insightId: string; findingId: string }> {
  const q = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0].id as string;
  const insightId = await q(
    "insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,$3,'Observed','Uncertain','Review','accepted') returning id",
    [tenant, run, headline],
  );
  const findingId = await q("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'stated',$3,'accepted') returning id", [tenant, run, `${headline} (finding)`]);
  const pre = await q("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,$4,'o','t','i') returning id", [tenant, run, findingId, headline]);
  await pool.query("insert into synthesized_insight_sources(tenant_id,synthesized_insight_id,pre_insight_id,support_snapshot) values($1,$2,$3,finding_support_parts($4))", [tenant, insightId, pre, findingId]);
  return { insightId, findingId };
}
