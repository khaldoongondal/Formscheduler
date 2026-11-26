-- FormBook owner tools: badge switch, suspension details, owner audit log and
-- the client list used by /admin/clients. Additive and safe to run twice.

alter table public.tenants
  add column if not exists badge_enabled boolean not null default true,
  add column if not exists plan_before_suspension text,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_plan_before_suspension_check') then
    alter table public.tenants add constraint tenants_plan_before_suspension_check
      check (plan_before_suspension is null or plan_before_suspension in ('free', 'scaling'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_suspension_reason_length') then
    alter table public.tenants add constraint tenants_suspension_reason_length
      check (suspension_reason is null or char_length(suspension_reason) <= 500);
  end if;
end $$;

-- Service role only (RLS on, no policies).
create table if not exists public.owner_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null check (char_length(actor_email) <= 254),
  action text not null check (action in (
    'set_plan', 'set_badge', 'suspend', 'restore', 'take_down_form', 'restore_form', 'resolve_report'
  )),
  target_type text not null check (target_type in ('tenant', 'funnel', 'report')),
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owner_audit_log_created_idx on public.owner_audit_log (created_at desc);
alter table public.owner_audit_log enable row level security;

-- One row per tenant for the owner's Client Management page.
-- "Leads" are lead_sessions rows (each one has an email or phone).
create or replace function public.owner_list_clients()
returns table (
  tenant_id uuid,
  tenant_name text,
  business_name text,
  contact_name text,
  contact_email text,
  owner_email text,
  plan text,
  badge_enabled boolean,
  active_forms integer,
  draft_forms integer,
  leads_30d integer,
  open_reports integer,
  last_activity_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    t.id,
    t.name,
    t.business_name,
    t.contact_name,
    t.contact_email,
    (select u.email::text from public.tenant_members tm join auth.users u on u.id = tm.user_id
      where tm.tenant_id = t.id and tm.role = 'owner' order by tm.created_at limit 1),
    t.plan,
    t.badge_enabled,
    (select count(*)::int from public.funnels f where f.tenant_id = t.id and f.is_published),
    (select count(*)::int from public.funnels f where f.tenant_id = t.id and not f.is_published),
    (select count(*)::int from public.lead_sessions ls
      where ls.tenant_id = t.id and ls.created_at >= now() - interval '30 days'),
    (select count(*)::int from public.form_reports r where r.tenant_id = t.id and r.status = 'open'),
    greatest(
      (select max(ls.created_at) from public.lead_sessions ls where ls.tenant_id = t.id),
      (select max(f.updated_at) from public.funnels f where f.tenant_id = t.id),
      (select max(u.last_sign_in_at) from public.tenant_members tm join auth.users u on u.id = tm.user_id
        where tm.tenant_id = t.id)
    ),
    t.created_at
  from public.tenants t
  order by t.created_at desc
$$;
revoke all on function public.owner_list_clients() from public, anon, authenticated;
grant execute on function public.owner_list_clients() to service_role;

notify pgrst, 'reload schema';
