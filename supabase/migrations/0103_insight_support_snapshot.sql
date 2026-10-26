-- FND-001 / REP-OUT-001 for pre-insights (golden-thread GT-006).
--
-- A synthesized insight records, per source link, the fingerprint of each supporting finding at
-- drafting (synthesized_insight_sources.support_snapshot, migration 0096), so a later change to
-- that finding is detected. A pre-insight (insights) is written from exactly one finding but kept
-- no such record, so its exports kept presenting it as verified after the finding was rejected
-- or changed. insights.support_snapshot records finding_support_parts(finding) as the insight
-- generator's prompt read it, and the same rule (supportStatusShared.classifyInsightSupport) then
-- classifies pre-insights.
--
-- Null means not recorded: pre-insights written before this migration. They classify as "not
-- recorded" (unknown), never current; a rejection or a change of the calculation settings behind
-- the finding is still detected, because those need no snapshot.
-- Additive and idempotent; no existing row changes.

alter table insights add column if not exists support_snapshot jsonb;
