-- Local development seed. Runs after the migrations on `supabase start` for
-- the first time and on `supabase db reset`. Not used on the cloud project.

-- The one tenant the app runs as (DEFAULT_TENANT_ID in .env.development.local).
insert into tenants (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Local development')
on conflict (id) do nothing;

-- The private bucket every upload goes to.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
