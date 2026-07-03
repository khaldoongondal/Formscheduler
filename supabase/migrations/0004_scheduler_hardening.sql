alter table ghl_connections
  add column if not exists name text;

update ghl_connections
set name = coalesce(name, location_id)
where name is null;

alter table ghl_connections
  alter column name set not null,
  alter column api_version set default '2023-02-21';

alter table funnels
  add column if not exists opt_in_pipeline_id text,
  add column if not exists opt_in_pipeline_stage_id text,
  add column if not exists booked_pipeline_id text,
  add column if not exists booked_pipeline_stage_id text,
  add column if not exists appointment_title text not null default '',
  add column if not exists opportunity_name_template text not null default '{{lead_name}}',
  add column if not exists embed_settings jsonb not null default '{}'::jsonb,
  add column if not exists popup_settings jsonb not null default '{}'::jsonb,
  add column if not exists routing_rules jsonb not null default '[]'::jsonb,
  add column if not exists scoring_rules jsonb not null default '[]'::jsonb,
  add column if not exists disqualification_rules jsonb not null default '[]'::jsonb;

alter table questions
  add column if not exists ghl_custom_field_id text,
  add column if not exists ghl_custom_field_key text,
  add column if not exists conditional_logic jsonb not null default '{}'::jsonb,
  add column if not exists branching_logic jsonb not null default '{}'::jsonb;

alter table lead_sessions
  add column if not exists visitor_id text,
  add column if not exists ghl_connection_id uuid references ghl_connections(id) on delete set null,
  add column if not exists ghl_opportunity_id text;

create table if not exists lead_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_session_id uuid not null references lead_sessions(id) on delete cascade,
  from_status lead_session_status,
  to_status lead_session_status not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table booking_attempts
  add column if not exists ghl_opportunity_id text;

alter table analytics_events
  add column if not exists visitor_id text,
  add column if not exists source_url text,
  add column if not exists user_agent text;

create index if not exists lead_sessions_funnel_visitor_idx on lead_sessions (funnel_id, visitor_id);
create index if not exists lead_sessions_funnel_opportunity_idx on lead_sessions (funnel_id, ghl_opportunity_id);
create index if not exists analytics_events_funnel_visitor_time_idx on analytics_events (funnel_id, visitor_id, occurred_at desc);
create index if not exists lead_status_history_funnel_status_time_idx on lead_status_history (tenant_id, to_status, created_at desc);
create unique index if not exists funnels_slug_unique_idx on funnels (slug);

create or replace function record_lead_status_change()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_status_history (tenant_id, lead_session_id, to_status, reason)
    values (new.tenant_id, new.id, new.status, 'session_created');
  elsif old.status is distinct from new.status then
    insert into lead_status_history (tenant_id, lead_session_id, from_status, to_status, reason)
    values (new.tenant_id, new.id, old.status, new.status, 'status_updated');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists lead_sessions_record_status_insert on lead_sessions;
create trigger lead_sessions_record_status_insert after insert on lead_sessions
for each row execute function record_lead_status_change();

drop trigger if exists lead_sessions_record_status_update on lead_sessions;
create trigger lead_sessions_record_status_update after update of status on lead_sessions
for each row execute function record_lead_status_change();
