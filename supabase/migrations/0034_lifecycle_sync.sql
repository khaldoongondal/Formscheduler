-- FormBook Sprint 4 P3: account milestones and the lifecycle event queue to the owner's CRM.
-- Additive and safe to run twice. Triggers never block the write that fires them.
-- Requires 0029 (connections) and 0032 (tenant_plan_changes, tenants.account_ref).

-- 1. Milestones (decision D23).
alter table public.tenants
  add column if not exists first_connection_at timestamptz,
  add column if not exists first_form_activated_at timestamptz,
  add column if not exists first_lead_at timestamptz,
  add column if not exists first_booking_at timestamptz;

-- Backfill once from existing rows (no events are queued for these: the triggers below do not exist yet
-- on a first run, and on a rerun every guarded update matches only rows that are still null).
update public.tenants t set first_connection_at = s.first_at
from (
  select x.tenant_id, min(x.created_at) as first_at from (
    select g.tenant_id, g.created_at from public.ghl_connections g
    union all
    select c.tenant_id, c.created_at from public.connections c
  ) x group by x.tenant_id
) s
where s.tenant_id = t.id and t.first_connection_at is null;

-- Approximation: no earlier activation history exists (noted on the owner page).
update public.tenants t set first_form_activated_at = s.first_at
from (
  select f.tenant_id, min(f.created_at) as first_at from public.funnels f
  where f.is_published or f.frozen_at is not null
  group by f.tenant_id
) s
where s.tenant_id = t.id and t.first_form_activated_at is null;

update public.tenants t set first_lead_at = s.first_at
from (select ls.tenant_id, min(ls.created_at) as first_at from public.lead_sessions ls group by ls.tenant_id) s
where s.tenant_id = t.id and t.first_lead_at is null;

update public.tenants t set first_booking_at = s.first_at
from (
  select b.tenant_id, min(b.created_at) as first_at from public.booking_attempts b
  where b.status = 'booked' group by b.tenant_id
) s
where s.tenant_id = t.id and t.first_booking_at is null;

-- 2. Queue (decision D20). No contact data is stored here; the payload is built at send time.
create table if not exists public.lifecycle_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event text not null check (event in (
    'signup_verified', 'first_connection_added', 'first_form_activated', 'first_lead', 'first_booking',
    'plan_changed', 'account_suspended', 'account_restored', 'test_ping'
  )),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 120),
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 2048),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 60),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  response_status integer,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  sent_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);
create index if not exists lifecycle_deliveries_claimable_idx
  on public.lifecycle_event_deliveries (next_attempt_at) where status = 'pending';
create index if not exists lifecycle_deliveries_tenant_order_idx
  on public.lifecycle_event_deliveries (tenant_id, created_at) where status = 'pending';
create index if not exists lifecycle_deliveries_settled_idx
  on public.lifecycle_event_deliveries (settled_at) where settled_at is not null;
alter table public.lifecycle_event_deliveries enable row level security;
drop trigger if exists lifecycle_event_deliveries_set_updated_at on public.lifecycle_event_deliveries;
create trigger lifecycle_event_deliveries_set_updated_at before update on public.lifecycle_event_deliveries
for each row execute function public.set_updated_at();

create or replace function public.enqueue_lifecycle_event(
  p_tenant_id uuid, p_event text, p_dedupe_key text,
  p_details jsonb default '{}'::jsonb, p_occurred_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.lifecycle_event_deliveries (tenant_id, event, dedupe_key, details, occurred_at)
  values (p_tenant_id, p_event, p_dedupe_key, coalesce(p_details, '{}'::jsonb), coalesce(p_occurred_at, now()))
  on conflict (tenant_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- 3. Triggers. Each is wrapped so a failure only logs a warning (decision D20).
create or replace function public.lifecycle_on_tenant_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.enqueue_lifecycle_event(new.id, 'signup_verified', 'signup_verified', '{}'::jsonb, new.created_at);
  exception when others then
    raise warning 'lifecycle signup_verified skipped (%)', sqlstate;
  end;
  return null;
end;
$$;
drop trigger if exists tenants_lifecycle_signup on public.tenants;
create trigger tenants_lifecycle_signup after insert on public.tenants
for each row when (new.signup_source = 'self_serve') execute function public.lifecycle_on_tenant_insert();

create or replace function public.lifecycle_on_connection_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_provider text;
begin
  begin
    v_provider := case when tg_table_name = 'ghl_connections' then 'ghl' else to_jsonb(new) ->> 'provider' end;
    update public.tenants set first_connection_at = coalesce(new.created_at, now())
    where id = new.tenant_id and first_connection_at is null;
    if found then
      perform public.enqueue_lifecycle_event(new.tenant_id, 'first_connection_added', 'first_connection_added',
        jsonb_build_object('provider', v_provider), coalesce(new.created_at, now()));
    end if;
  exception when others then
    raise warning 'lifecycle first_connection_added skipped (%)', sqlstate;
  end;
  return null;
end;
$$;
drop trigger if exists ghl_connections_lifecycle on public.ghl_connections;
create trigger ghl_connections_lifecycle after insert on public.ghl_connections
for each row execute function public.lifecycle_on_connection_insert();
drop trigger if exists connections_lifecycle on public.connections;
create trigger connections_lifecycle after insert on public.connections
for each row execute function public.lifecycle_on_connection_insert();

create or replace function public.lifecycle_on_form_activated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    update public.tenants set first_form_activated_at = now()
    where id = new.tenant_id and first_form_activated_at is null;
    if found then
      perform public.enqueue_lifecycle_event(new.tenant_id, 'first_form_activated', 'first_form_activated', '{}'::jsonb, now());
    end if;
  exception when others then
    raise warning 'lifecycle first_form_activated skipped (%)', sqlstate;
  end;
  return null;
end;
$$;
drop trigger if exists funnels_lifecycle_activated on public.funnels;
create trigger funnels_lifecycle_activated after insert or update of is_published on public.funnels
for each row when (new.is_published) execute function public.lifecycle_on_form_activated();

create or replace function public.lifecycle_on_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    update public.tenants set first_lead_at = coalesce(new.created_at, now())
    where id = new.tenant_id and first_lead_at is null;
    if found then
      perform public.enqueue_lifecycle_event(new.tenant_id, 'first_lead', 'first_lead', '{}'::jsonb, coalesce(new.created_at, now()));
    end if;
  exception when others then
    raise warning 'lifecycle first_lead skipped (%)', sqlstate;
  end;
  return null;
end;
$$;
drop trigger if exists lead_sessions_lifecycle on public.lead_sessions;
create trigger lead_sessions_lifecycle after insert on public.lead_sessions
for each row execute function public.lifecycle_on_lead();

create or replace function public.lifecycle_on_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    update public.tenants set first_booking_at = now()
    where id = new.tenant_id and first_booking_at is null;
    if found then
      perform public.enqueue_lifecycle_event(new.tenant_id, 'first_booking', 'first_booking', '{}'::jsonb, now());
    end if;
  exception when others then
    raise warning 'lifecycle first_booking skipped (%)', sqlstate;
  end;
  return null;
end;
$$;
drop trigger if exists booking_attempts_lifecycle on public.booking_attempts;
create trigger booking_attempts_lifecycle after insert or update of status on public.booking_attempts
for each row when (new.status = 'booked') execute function public.lifecycle_on_booking();

-- Mirror of lifecycleEventForPlanChange in lib/lifecycle/events.ts (decision D21).
create or replace function public.lifecycle_on_plan_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event text;
begin
  begin
    v_event := case
      when new.from_plan is null or new.from_plan = new.to_plan then null
      when new.to_plan = 'suspended' then 'account_suspended'
      when new.from_plan = 'suspended' then 'account_restored'
      else 'plan_changed'
    end;
    if v_event is not null then
      perform public.enqueue_lifecycle_event(new.tenant_id, v_event, 'plan:' || new.id::text,
        jsonb_build_object(
          'from_plan', new.from_plan, 'to_plan', new.to_plan,
          'frozen_forms', new.frozen_forms, 'frozen_pixels', new.frozen_pixels,
          'restored_forms', new.restored_forms, 'restored_pixels', new.restored_pixels
        ), new.created_at);
    end if;
  exception when others then
    raise warning 'lifecycle plan event skipped (%)', sqlstate;
  end;
  return null;
end;
$$;
drop trigger if exists tenant_plan_changes_lifecycle on public.tenant_plan_changes;
create trigger tenant_plan_changes_lifecycle after insert on public.tenant_plan_changes
for each row execute function public.lifecycle_on_plan_change();

-- 4. Claim (in order per tenant), settle, release, housekeeping. Same backoff as settle_crm_delivery.
create or replace function public.claim_lifecycle_deliveries(p_owner uuid, p_limit integer default 20, p_lease_seconds integer default 60)
returns setof public.lifecycle_event_deliveries
language plpgsql security definer set search_path = public as $$
begin
  update public.lifecycle_event_deliveries
  set status = 'failed', status_reason = 'retry_budget', settled_at = now(), lease_owner = null, lease_expires_at = null
  where status = 'pending' and attempts >= max_attempts
    and (lease_expires_at is null or lease_expires_at < now());
  return query
  update public.lifecycle_event_deliveries q
  set lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      attempts = q.attempts + 1
  where q.id in (
    select c.id from public.lifecycle_event_deliveries c
    where c.status = 'pending' and c.attempts < c.max_attempts and c.next_attempt_at <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and not exists (
        select 1 from public.lifecycle_event_deliveries e
        where e.tenant_id = c.tenant_id and e.status = 'pending' and e.created_at < c.created_at
      )
    order by c.created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning q.*;
end;
$$;

create or replace function public.claim_lifecycle_deliveries_by_ids(p_ids uuid[], p_owner uuid, p_lease_seconds integer default 60)
returns setof public.lifecycle_event_deliveries
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.lifecycle_event_deliveries q
  set lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      attempts = q.attempts + 1
  where q.id in (
    select c.id from public.lifecycle_event_deliveries c
    where c.id = any(p_ids) and c.status = 'pending' and c.attempts < c.max_attempts
      and (c.lease_expires_at is null or c.lease_expires_at < now())
    limit 5
    for update skip locked
  )
  returning q.*;
end;
$$;

create or replace function public.settle_lifecycle_delivery(
  p_id uuid, p_owner uuid, p_outcome text, p_status integer default null, p_error text default null, p_reason text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_attempts integer;
  v_max integer;
begin
  if p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'settle_lifecycle_delivery: unknown outcome %', p_outcome;
  end if;
  select attempts, max_attempts into v_attempts, v_max
  from public.lifecycle_event_deliveries where id = p_id and lease_owner = p_owner for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'retry' and v_attempts < v_max then
    update public.lifecycle_event_deliveries
    set status = 'pending',
        next_attempt_at = now() + make_interval(secs => least(60 * power(2, greatest(v_attempts - 1, 0))::integer, 21600)),
        response_status = p_status, last_error = left(p_error, 500),
        lease_owner = null, lease_expires_at = null
    where id = p_id;
  else
    update public.lifecycle_event_deliveries
    set status = case when p_outcome = 'retry' then 'failed' else p_outcome end,
        status_reason = case when p_outcome = 'retry' then 'retry_budget' else left(p_reason, 60) end,
        response_status = p_status, last_error = left(p_error, 500),
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        settled_at = now(), lease_owner = null, lease_expires_at = null
    where id = p_id;
  end if;
  return true;
end;
$$;

create or replace function public.release_lifecycle_delivery(p_id uuid, p_owner uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.lifecycle_event_deliveries
  set attempts = greatest(attempts - 1, 0), lease_owner = null, lease_expires_at = null
  where id = p_id and lease_owner = p_owner and status = 'pending';
  return found;
end;
$$;

create or replace function public.lifecycle_housekeeping()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired integer;
  v_deleted integer;
begin
  update public.lifecycle_event_deliveries
  set status = 'failed', status_reason = 'expired', settled_at = now(), lease_owner = null, lease_expires_at = null
  where status = 'pending' and created_at < now() - interval '7 days'
    and (lease_expires_at is null or lease_expires_at < now());
  get diagnostics v_expired = row_count;
  delete from public.lifecycle_event_deliveries where settled_at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('expired', v_expired, 'deleted', v_deleted);
end;
$$;

-- 5. Send-time snapshot (decision D22). Reads auth.users for the owner email fallback.
create or replace function public.lifecycle_tenant_snapshot(p_tenant_id uuid)
returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'account_ref', t.account_ref,
    'contact_name', t.contact_name,
    'email', coalesce(t.contact_email, (
      select u.email::text from public.tenant_members tm join auth.users u on u.id = tm.user_id
      where tm.tenant_id = t.id and tm.role = 'owner' order by tm.created_at limit 1)),
    'phone', t.contact_phone,
    'business_name', coalesce(t.business_name, t.name),
    'website', t.website,
    'plan', t.plan,
    'signed_up_at', t.created_at,
    'active_forms', (select count(*) from public.funnels f where f.tenant_id = t.id and f.is_published),
    'draft_forms', (select count(*) from public.funnels f where f.tenant_id = t.id and not f.is_published and f.frozen_at is null),
    'frozen_forms', (select count(*) from public.funnels f where f.tenant_id = t.id and f.frozen_at is not null),
    'meta_pixels', (select count(*) from public.meta_pixels p where p.tenant_id = t.id),
    'connections', (select count(*) from public.ghl_connections g where g.tenant_id = t.id)
                   + (select count(*) from public.connections c where c.tenant_id = t.id),
    'leads_total', (select count(*) from public.lead_sessions ls where ls.tenant_id = t.id),
    'bookings_total', (select count(*) from public.booking_attempts b where b.tenant_id = t.id and b.status = 'booked')
  )
  from public.tenants t where t.id = p_tenant_id
$$;

-- 6. Owner reads (decision D24).
create or replace function public.owner_activation_rows()
returns table (
  tenant_id uuid, signup_source text, plan text, created_at timestamptz,
  first_connection_at timestamptz, first_form_activated_at timestamptz,
  first_lead_at timestamptz, first_booking_at timestamptz, ever_scaling boolean
)
language sql stable security definer set search_path = public as $$
  select t.id, t.signup_source, t.plan, t.created_at,
    t.first_connection_at, t.first_form_activated_at, t.first_lead_at, t.first_booking_at,
    (t.plan = 'scaling' or t.plan_before_suspension = 'scaling'
      or exists (select 1 from public.tenant_plan_changes c where c.tenant_id = t.id and c.to_plan = 'scaling'))
  from public.tenants t
$$;

create or replace function public.owner_pending_signups()
returns table (created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.created_at from public.signup_requests r where r.tenant_id is null and r.completed_at is null
$$;

create or replace function public.owner_lifecycle_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pending', (select count(*) from public.lifecycle_event_deliveries where status = 'pending'),
    'failed_7d', (select count(*) from public.lifecycle_event_deliveries where status = 'failed' and settled_at > now() - interval '7 days'),
    'last_sent_at', (select max(sent_at) from public.lifecycle_event_deliveries where status = 'sent'),
    'last_error', (select left(last_error, 200) from public.lifecycle_event_deliveries where last_error is not null order by updated_at desc limit 1)
  )
$$;

-- 7. Service role only.
revoke all on table public.lifecycle_event_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.lifecycle_event_deliveries to service_role;

revoke all on function public.enqueue_lifecycle_event(uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.lifecycle_on_tenant_insert() from public, anon, authenticated;
revoke all on function public.lifecycle_on_connection_insert() from public, anon, authenticated;
revoke all on function public.lifecycle_on_form_activated() from public, anon, authenticated;
revoke all on function public.lifecycle_on_lead() from public, anon, authenticated;
revoke all on function public.lifecycle_on_booking() from public, anon, authenticated;
revoke all on function public.lifecycle_on_plan_change() from public, anon, authenticated;
revoke all on function public.claim_lifecycle_deliveries(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_lifecycle_deliveries_by_ids(uuid[], uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_lifecycle_delivery(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.release_lifecycle_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lifecycle_housekeeping() from public, anon, authenticated;
revoke all on function public.lifecycle_tenant_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.owner_activation_rows() from public, anon, authenticated;
revoke all on function public.owner_pending_signups() from public, anon, authenticated;
revoke all on function public.owner_lifecycle_status() from public, anon, authenticated;

grant execute on function public.enqueue_lifecycle_event(uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.lifecycle_on_tenant_insert() to service_role;
grant execute on function public.lifecycle_on_connection_insert() to service_role;
grant execute on function public.lifecycle_on_form_activated() to service_role;
grant execute on function public.lifecycle_on_lead() to service_role;
grant execute on function public.lifecycle_on_booking() to service_role;
grant execute on function public.lifecycle_on_plan_change() to service_role;
grant execute on function public.claim_lifecycle_deliveries(uuid, integer, integer) to service_role;
grant execute on function public.claim_lifecycle_deliveries_by_ids(uuid[], uuid, integer) to service_role;
grant execute on function public.settle_lifecycle_delivery(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.release_lifecycle_delivery(uuid, uuid) to service_role;
grant execute on function public.lifecycle_housekeeping() to service_role;
grant execute on function public.lifecycle_tenant_snapshot(uuid) to service_role;
grant execute on function public.owner_activation_rows() to service_role;
grant execute on function public.owner_pending_signups() to service_role;
grant execute on function public.owner_lifecycle_status() to service_role;

notify pgrst, 'reload schema';
