create table if not exists coding_code_meta (
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references documents(id) on delete cascade,
  code_key text not null,
  theme text not null default '',
  note text not null default '',
  keywords text not null default '',
  updated_at timestamptz not null default now(),
  primary key (document_id, code_key)
);

alter table coding_code_meta enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'coding_code_meta' and policyname = 'tenant_isolation'
  ) then
    create policy tenant_isolation on coding_code_meta
      using (tenant_id = current_setting('app.current_tenant_id')::uuid);
  end if;
end $$;

select to_regclass('public.coding_code_meta'), to_regclass('public.coding_turn_notes');