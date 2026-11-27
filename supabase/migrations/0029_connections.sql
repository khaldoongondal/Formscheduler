-- FormBook Sprint 3 P1: generic connections (calendars and CRMs) beside ghl_connections.
-- Additive and safe to run twice. Every existing form keeps calendar and CRM GoHighLevel.

-- 1. Connections.
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'calcom', 'calendly', 'hubspot', 'webhook')),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'connected' check (status in ('connected', 'needs_attention', 'disabled')),
  status_message text check (status_message is null or char_length(status_message) <= 300),
  account_label text check (account_label is null or char_length(account_label) <= 254),
  external_account_id text check (external_account_id is null or char_length(external_account_id) <= 300),
  secret_ciphertext text check (secret_ciphertext is null or char_length(secret_ciphertext) <= 8192),
  secret_last_four text check (secret_last_four is null or char_length(secret_last_four) <= 4),
  refresh_token_ciphertext text check (refresh_token_ciphertext is null or char_length(refresh_token_ciphertext) <= 8192),
  token_expires_at timestamptz,
  signing_secret_ciphertext text check (signing_secret_ciphertext is null or char_length(signing_secret_ciphertext) <= 8192),
  signing_secret_last_four text check (signing_secret_last_four is null or char_length(signing_secret_last_four) <= 4),
  endpoint_url text check (endpoint_url is null or (char_length(endpoint_url) <= 2048 and endpoint_url ~* '^https://')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  availability jsonb check (availability is null or (jsonb_typeof(availability) = 'object' and pg_column_size(availability) <= 8192)),
  availability_confirmed_at timestamptz,
  last_checked_at timestamptz,
  last_check_ok boolean,
  last_check_summary text check (last_check_summary is null or char_length(last_check_summary) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists connections_tenant_idx on public.connections (tenant_id, provider);
create unique index if not exists connections_tenant_account_uidx
  on public.connections (tenant_id, provider, external_account_id)
  where external_account_id is not null and provider <> 'webhook';
alter table public.connections enable row level security;
drop trigger if exists connections_set_updated_at on public.connections;
create trigger connections_set_updated_at before update on public.connections
for each row execute function set_updated_at();

create or replace function public.enforce_connection_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if tg_op = 'UPDATE' and new.tenant_id = old.tenant_id then
    return new;
  end if;
  perform 1 from public.tenants t where t.id = new.tenant_id for update;
  select count(*) into v_count from public.connections c where c.tenant_id = new.tenant_id and c.id <> new.id;
  if v_count >= 25 then
    raise exception 'FORMBOOK_LIMIT:connections' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists connections_enforce_cap on public.connections;
create trigger connections_enforce_cap
before insert or update of tenant_id on public.connections
for each row execute function public.enforce_connection_cap();

-- 2. Calendar and CRM choice per form. Defaults keep every existing form on GoHighLevel.
alter table public.funnels
  add column if not exists calendar_provider text not null default 'ghl',
  add column if not exists calendar_connection_id uuid references public.connections(id) on delete set null,
  add column if not exists crm_provider text not null default 'ghl',
  add column if not exists crm_connection_id uuid references public.connections(id) on delete set null,
  add column if not exists calendar_settings jsonb not null default '{}'::jsonb,
  add column if not exists crm_settings jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnels_calendar_provider_check') then
    alter table public.funnels add constraint funnels_calendar_provider_check
      check (calendar_provider in ('ghl', 'google_calendar', 'calcom', 'calendly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funnels_crm_provider_check') then
    alter table public.funnels add constraint funnels_crm_provider_check
      check (crm_provider in ('ghl', 'hubspot', 'webhook'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funnels_ghl_calendar_needs_ghl_crm') then
    alter table public.funnels add constraint funnels_ghl_calendar_needs_ghl_crm
      check (calendar_provider <> 'ghl' or crm_provider = 'ghl');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funnels_connection_settings_shape') then
    alter table public.funnels add constraint funnels_connection_settings_shape check (
      jsonb_typeof(calendar_settings) = 'object' and pg_column_size(calendar_settings) <= 4096 and
      jsonb_typeof(crm_settings) = 'object' and pg_column_size(crm_settings) <= 4096
    );
  end if;
end $$;
create index if not exists funnels_calendar_connection_idx on public.funnels (calendar_connection_id) where calendar_connection_id is not null;
create index if not exists funnels_crm_connection_idx on public.funnels (crm_connection_id) where crm_connection_id is not null;

create or replace function public.enforce_funnel_generic_connections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
begin
  if new.calendar_provider = 'ghl' then
    if new.calendar_connection_id is not null then
      raise exception 'FORMBOOK_INVALID:calendar_connection' using errcode = 'P0001';
    end if;
  elsif new.calendar_connection_id is not null then
    select c.provider into v_provider from public.connections c
    where c.id = new.calendar_connection_id and c.tenant_id = new.tenant_id;
    if v_provider is null or v_provider <> new.calendar_provider then
      raise exception 'FORMBOOK_INVALID:calendar_connection' using errcode = 'P0001';
    end if;
  end if;
  v_provider := null;
  if new.crm_provider = 'ghl' then
    if new.crm_connection_id is not null then
      raise exception 'FORMBOOK_INVALID:crm_connection' using errcode = 'P0001';
    end if;
  elsif new.crm_connection_id is not null then
    select c.provider into v_provider from public.connections c
    where c.id = new.crm_connection_id and c.tenant_id = new.tenant_id;
    if v_provider is null or v_provider <> new.crm_provider then
      raise exception 'FORMBOOK_INVALID:crm_connection' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists funnels_enforce_generic_connections on public.funnels;
create trigger funnels_enforce_generic_connections
before insert or update of calendar_provider, calendar_connection_id, crm_provider, crm_connection_id, tenant_id
on public.funnels
for each row execute function public.enforce_funnel_generic_connections();

-- 3. Lead references for providers (never the session id, decision C21).
alter table public.lead_sessions
  add column if not exists external_ref uuid not null default gen_random_uuid(),
  add column if not exists crm_contact_id text,
  add column if not exists crm_deal_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_sessions_crm_ids_length') then
    alter table public.lead_sessions add constraint lead_sessions_crm_ids_length check (
      (crm_contact_id is null or char_length(crm_contact_id) <= 200) and
      (crm_deal_id is null or char_length(crm_deal_id) <= 200)
    );
  end if;
end $$;
create unique index if not exists lead_sessions_external_ref_uidx on public.lead_sessions (external_ref);

-- 4. Booking attempts from any provider. Null provider = GoHighLevel rows written before this migration.
alter table public.booking_attempts
  add column if not exists provider text,
  add column if not exists calendar_connection_id uuid references public.connections(id) on delete set null,
  add column if not exists external_booking_id text,
  add column if not exists meeting_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_attempts_provider_check') then
    alter table public.booking_attempts add constraint booking_attempts_provider_check check (
      (provider is null or provider in ('ghl', 'google_calendar', 'calcom', 'calendly')) and
      (external_booking_id is null or char_length(external_booking_id) <= 500) and
      (meeting_url is null or (char_length(meeting_url) <= 2048 and meeting_url ~* '^https://'))
    );
  end if;
end $$;

-- 5. Service role only.
revoke all on table public.connections from anon, authenticated;
grant select, insert, update, delete on table public.connections to service_role;
revoke all on function public.enforce_connection_cap() from public, anon, authenticated;
revoke all on function public.enforce_funnel_generic_connections() from public, anon, authenticated;
grant execute on function public.enforce_connection_cap() to service_role;
grant execute on function public.enforce_funnel_generic_connections() to service_role;

notify pgrst, 'reload schema';
