-- G6 / IMP-001 / IMP-016: which signed-in person belongs to which organisation (tenant).
--
-- Until now every request ran as the one organisation in DEFAULT_TENANT_ID. From this migration
-- the app takes the tenant from the signed-in user instead (src/lib/requestContext.ts): the user
-- comes from Supabase Auth, and the organisation from this table. Memberships are assigned by an
-- administrator (scripts/auth/add-member.mjs, run with an owner connection); there is no
-- self sign-up, and the application role can only read the signed-in user's own rows.
--
-- user_id is the Supabase Auth user id. It is deliberately NOT a foreign key to auth.users: the
-- disposable test databases have no auth schema, and a membership row for a deleted auth user
-- grants nothing because that user can no longer sign in.
create table if not exists tenant_memberships (
  user_id uuid not null,
  tenant_id uuid not null references tenants (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists tenant_memberships_tenant_idx on tenant_memberships (tenant_id);

-- Row-level security keyed on the USER, not the tenant: membership is what decides the tenant, so
-- it cannot itself be filtered by app.current_tenant_id. requestContext sets app.current_user_id
-- (transaction-local) from the verified Supabase user before reading. Only a SELECT policy exists,
-- so the application role's INSERT/UPDATE/DELETE grants (setup-app-role grants them on every
-- protected table) match no rows: memberships cannot be created or changed from the app.
alter table tenant_memberships enable row level security;

drop policy if exists own_memberships on tenant_memberships;
create policy own_memberships on tenant_memberships
  for select
  using (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

-- The organisation name for the signed-in user's memberships. The tenants registry stays withheld
-- from the application role (setup-app-role revokes access to tables without row-level security),
-- so this definer function returns only the names of organisations the current user belongs to.
create or replace function app_user_memberships()
returns table (tenant_id uuid, tenant_name text, member_role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.tenant_id, t.name, m.role, m.created_at
  from tenant_memberships m
  join tenants t on t.id = m.tenant_id
  where m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  order by m.created_at, m.tenant_id
$$;
