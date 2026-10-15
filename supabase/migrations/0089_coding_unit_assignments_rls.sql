-- ANA-QUAL-002 (counter-review item: "migration lacks explicit RLS/policies"): migration
-- 0085 created coding_unit_assignments with a tenant_id column but never enabled row-level
-- security on it or added the tenant_isolation policy every other tenant-scoped table in
-- this codebase carries (see 0043_qualitative_coding.sql's own do-block for the pattern
-- this copies). Without this, the table's only tenant protection was the application code
-- remembering to filter by tenant_id itself - exactly the gap RLS exists to remove.
--
-- Run npm run backup before applying.
alter table coding_unit_assignments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'coding_unit_assignments' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_unit_assignments
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;
