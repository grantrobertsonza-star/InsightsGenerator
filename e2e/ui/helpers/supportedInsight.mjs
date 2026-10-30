// An accepted synthesized insight resting on one accepted finding, linked with its support recorded the
// way synthesis records it (finding_support_parts), so the app reads its support as current (B37-F01:
// an insight with no finding behind it is unsupported, and a coverage check never cites it).
export async function insertSupportedInsight(db, tenantId, runId, headline) {
  const one = async (sql, args) => (await db.query(sql, args)).rows[0].id;
  const insightId = await one(
    "insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status) values($1,$2,$3,'Observed','Uncertain','Review','accepted') returning id",
    [tenantId, runId, headline],
  );
  const findingId = await one("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'stated',$3,'accepted') returning id", [tenantId, runId, `${headline} (finding)`]);
  const pre = await one("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,$4,'o','t','i') returning id", [tenantId, runId, findingId, headline]);
  await db.query("insert into synthesized_insight_sources(tenant_id,synthesized_insight_id,pre_insight_id,support_snapshot) values($1,$2,$3,finding_support_parts($4))", [tenantId, insightId, pre, findingId]);
  return { insightId, findingId };
}
