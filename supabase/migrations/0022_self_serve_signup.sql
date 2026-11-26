-- FormBook Sprint 1, P3: self-serve signup.
-- Additive and safe to run twice. Existing tenants keep signup_source 'legacy'.

alter table public.tenants
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists business_name text,
  add column if not exists website text,
  add column if not exists signup_source text not null default 'legacy';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_signup_source_check') then
    alter table public.tenants add constraint tenants_signup_source_check
      check (signup_source in ('legacy', 'provisioned', 'self_serve'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_profile_lengths') then
    alter table public.tenants add constraint tenants_profile_lengths check (
      (contact_name is null or char_length(contact_name) <= 120) and
      (contact_email is null or char_length(contact_email) <= 254) and
      (contact_phone is null or char_length(contact_phone) <= 32) and
      (business_name is null or char_length(business_name) <= 160) and
      (website is null or char_length(website) <= 300)
    );
  end if;
end $$;

-- Pending self-serve profiles. Service role only (RLS on, no policies).
create table if not exists public.signup_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (char_length(email) <= 254),
  full_name text not null check (char_length(full_name) between 1 and 120),
  phone text not null check (char_length(phone) <= 32),
  business_name text not null check (char_length(business_name) between 1 and 160),
  website text not null check (char_length(website) <= 300),
  plan text not null default 'free' check (plan in ('free', 'scaling')),
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.signup_requests enable row level security;
drop trigger if exists signup_requests_set_updated_at on public.signup_requests;
create trigger signup_requests_set_updated_at before update on public.signup_requests
for each row execute function public.set_updated_at();

-- Direct lookup that replaces the paged listUsers scan.
create or replace function public.get_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at
  limit 1
$$;
revoke all on function public.get_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;

create or replace function public.is_auth_user_confirmed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null)
$$;
revoke all on function public.is_auth_user_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.is_auth_user_confirmed(uuid) to service_role;

-- Creates the tenant and owner membership once the email is confirmed. Idempotent.
create or replace function public.complete_signup(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r public.signup_requests%rowtype;
  v_tenant uuid;
  v_base text;
  v_slug text;
begin
  select * into r from public.signup_requests where user_id = p_user_id for update;
  if not found then
    return null;
  end if;
  if r.tenant_id is not null then
    return r.tenant_id;
  end if;
  if not public.is_auth_user_confirmed(p_user_id) then
    raise exception 'FORMBOOK_SIGNUP:email_not_verified' using errcode = 'P0001';
  end if;

  select tm.tenant_id into v_tenant from public.tenant_members tm
  where tm.user_id = p_user_id order by tm.created_at limit 1;

  if v_tenant is null then
    v_base := left(trim(both '-' from regexp_replace(lower(r.business_name), '[^a-z0-9]+', '-', 'g')), 40);
    v_base := trim(both '-' from coalesce(v_base, ''));
    if v_base = '' then
      v_base := 'tenant';
    end if;
    loop
      v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit when not exists (select 1 from public.tenants t where t.slug = v_slug);
    end loop;

    insert into public.tenants (name, slug, plan, contact_name, contact_email, contact_phone, business_name, website, signup_source)
    values (r.business_name, v_slug, r.plan, r.full_name, r.email, r.phone, r.business_name, r.website, 'self_serve')
    returning id into v_tenant;

    insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, p_user_id, 'owner');
  end if;

  update public.signup_requests
  set tenant_id = v_tenant, completed_at = now()
  where user_id = p_user_id;

  return v_tenant;
end;
$$;
revoke all on function public.complete_signup(uuid) from public, anon, authenticated;
grant execute on function public.complete_signup(uuid) to service_role;

notify pgrst, 'reload schema';
