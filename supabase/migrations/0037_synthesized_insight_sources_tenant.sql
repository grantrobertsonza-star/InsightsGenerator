-- synthesized_insight_sources (0027_insight_synthesis.sql) was created
-- without a tenant_id column or an RLS policy, the one table in the schema
-- missing both. It only ever holds a (synthesized_insight_id,
-- pre_insight_id) pair, so today it leaks nothing on its own, a lookup
-- still has to join back through synthesized_insights or insights to read
-- anything tenant-scoped. But every other table in this schema carries its
-- own tenant_id and its own tenant_isolation policy rather than relying on
-- a join elsewhere to stay safe, and this is the one place that pattern
-- was skipped. Bringing it in line now, before anything else (such as a
-- future export or admin query against this table directly) comes to
-- depend on the join always being there.
alter table synthesized_insight_sources add column if not exists tenant_id uuid references tenants(id);

-- Backfill from the parent synthesized_insights row, which has always
-- carried the correct tenant_id. Safe to re-run: once a row's tenant_id is
-- already set, this simply finds nothing left to update for it.
update synthesized_insight_sources s
set tenant_id = si.tenant_id
from synthesized_insights si
where s.synthesized_insight_id = si.id
  and s.tenant_id is null;

alter table synthesized_insight_sources alter column tenant_id set not null;

alter table synthesized_insight_sources enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'synthesized_insight_sources' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on synthesized_insight_sources
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

create index if not exists synthesized_insight_sources_tenant_id_idx on synthesized_insight_sources (tenant_id);
