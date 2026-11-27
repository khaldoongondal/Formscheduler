-- FormBook Sprint 2 P4: fire held Meta events, match key coverage, demo seed marks.
-- Additive and safe to run twice.

alter table public.funnels add column if not exists demo_seed_batch text;
alter table public.split_tests add column if not exists demo_seed_batch text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnels_demo_seed_batch_length') then
    alter table public.funnels add constraint funnels_demo_seed_batch_length
      check (demo_seed_batch is null or char_length(demo_seed_batch) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'split_tests_demo_seed_batch_length') then
    alter table public.split_tests add constraint split_tests_demo_seed_batch_length
      check (demo_seed_batch is null or char_length(demo_seed_batch) <= 60);
  end if;
end $$;

-- Fire: release held rows (one lead, or every held row of a pixel) and mark the leads released.
-- Rows older than 7 days minus 1 hour are not released (housekeeping expires them),
-- and neither are rows of a form that no longer sends to this pixel.
create or replace function public.meta_release_held(
  p_tenant_id uuid, p_pixel_id uuid, p_lead_session_id uuid, p_by text
) returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or (p_pixel_id is null and p_lead_session_id is null) then
    raise exception 'meta_release_held: tenant and a pixel or a lead are required' using errcode = '22023';
  end if;

  if p_lead_session_id is not null then
    update public.lead_sessions
    set meta_released_at = coalesce(meta_released_at, now()),
        meta_released_by = coalesce(meta_released_by, left(p_by, 254))
    where id = p_lead_session_id and tenant_id = p_tenant_id;
  end if;

  return query
  with released as (
    update public.meta_event_deliveries q
    set status = 'pending', next_attempt_at = now(), fired_by = left(p_by, 254), fired_at = now(), updated_at = now()
    where q.tenant_id = p_tenant_id
      and q.status = 'held'
      and q.event_time > now() - interval '7 days' + interval '1 hour'
      and (p_pixel_id is null or q.pixel_id = p_pixel_id)
      and (p_lead_session_id is null or q.lead_session_id = p_lead_session_id)
      -- Only rows whose form still uses this pixel with the customer's consent
      -- confirmation, is live, and belongs to a tenant that is not suspended.
      and exists (
        select 1 from public.funnels f
        join public.tenants t on t.id = f.tenant_id
        where f.id = q.funnel_id
          and f.tenant_id = q.tenant_id
          and f.meta_pixel_id = q.pixel_id
          and f.meta_consent_confirmed_at is not null
          and f.is_published
          and f.taken_down_at is null
          and t.plan <> 'suspended'
      )
    returning q.id, q.lead_session_id
  ), marked as (
    update public.lead_sessions ls
    set meta_released_at = coalesce(ls.meta_released_at, now()),
        meta_released_by = coalesce(ls.meta_released_by, left(p_by, 254))
    where ls.tenant_id = p_tenant_id
      and ls.id in (select r.lead_session_id from released r where r.lead_session_id is not null)
    returning ls.id
  )
  select r.id from released r;
end;
$$;

-- Match key coverage per event for one pixel and date range (scope E).
create or replace function public.meta_match_key_coverage(
  p_tenant_id uuid, p_pixel_id uuid, p_from timestamptz, p_to timestamptz
) returns table (
  event_key text, events integer, with_em integer, with_ph integer, with_fn integer, with_ln integer,
  with_ip integer, with_ua integer, with_fbp integer, with_fbc integer, with_external_id integer, with_location integer
)
language sql
stable
security definer
set search_path = public
as $$
  select d.event_key,
         count(*)::int,
         count(*) filter (where 'em' = any(d.match_keys))::int,
         count(*) filter (where 'ph' = any(d.match_keys))::int,
         count(*) filter (where 'fn' = any(d.match_keys))::int,
         count(*) filter (where 'ln' = any(d.match_keys))::int,
         count(*) filter (where 'client_ip_address' = any(d.match_keys))::int,
         count(*) filter (where 'client_user_agent' = any(d.match_keys))::int,
         count(*) filter (where 'fbp' = any(d.match_keys))::int,
         count(*) filter (where 'fbc' = any(d.match_keys))::int,
         count(*) filter (where 'external_id' = any(d.match_keys))::int,
         count(*) filter (where d.match_keys && array['ct', 'st', 'country']::text[])::int
  from public.meta_event_deliveries d
  where d.tenant_id = p_tenant_id and d.pixel_id = p_pixel_id
    and d.event_key <> 'test_event'
    and d.status in ('pending', 'held', 'sent', 'failed')
    and d.event_time >= p_from and d.event_time < p_to
  group by d.event_key
$$;

revoke all on function public.meta_release_held(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.meta_match_key_coverage(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.meta_release_held(uuid, uuid, uuid, text) to service_role;
grant execute on function public.meta_match_key_coverage(uuid, uuid, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
