-- Leadder Scheduler MVP
-- GHL remains the system of record for contacts and appointments.

create extension if not exists pgcrypto;

create type lead_session_status as enum (
  'started',
  'potential',
  'qualified',
  'slots_shown',
  'booked',
  'abandoned',
  'error'
);

create type question_type as enum (
  'text',
  'email',
  'phone',
  'url',
  'number',
  'single_select',
  'multi_select'
);

create type analytics_event_type as enum (
  'page_view',
  'funnel_start',
  'lead_captured',
  'qualified_lead',
  'slots_shown',
  'appointment_booked',
  'booking_error',
  'abandoned'
);

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenant_members (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants(id) on delete cascade,
    user_id uuid not null,
    role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table ghl_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  location_id text not null,
  calendar_id text,
  private_token_ciphertext text,
  token_last_four text,
  api_base_url text not null default 'https://services.leadconnectorhq.com',
  api_version text not null default '2023-02-21',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, location_id)
);

create table funnels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ghl_connection_id uuid references ghl_connections(id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  is_published boolean not null default false,
  logo_url text,
  primary_color text not null default '#2563eb',
  accent_color text not null default '#059669',
  button_color text not null default '#2563eb',
  border_radius integer not null default 8 check (border_radius between 0 and 32),
  phone_pulse_enabled boolean not null default true,
  slot_duration_minutes integer not null default 30 check (slot_duration_minutes between 15 and 240),
  availability_window_days integer not null default 14 check (availability_window_days between 1 and 60),
    calendar_id text,
    appointment_title text not null default '',
    redirect_url text check (redirect_url is null or redirect_url ~* '^https?://'),
    opt_in_pipeline_id text,
  opt_in_pipeline_stage_id text,
  booked_pipeline_id text,
  booked_pipeline_stage_id text,
  opportunity_name_template text not null default '{{lead_name}}',
  qualification_rule jsonb not null default '{"mode":"all_required_answered"}'::jsonb,
  embed_settings jsonb not null default '{}'::jsonb,
  popup_settings jsonb not null default '{}'::jsonb,
  routing_rules jsonb not null default '[]'::jsonb,
  scoring_rules jsonb not null default '[]'::jsonb,
  disqualification_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funnel_id uuid not null references funnels(id) on delete cascade,
  stable_key text not null,
  label text not null,
  help_text text,
  question_type question_type not null,
  placeholder text,
  is_required boolean not null default true,
  display_order integer not null default 0,
  ghl_field_key text,
  ghl_custom_field_id text,
  ghl_custom_field_key text,
  conditional_logic jsonb not null default '{}'::jsonb,
  branching_logic jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, stable_key)
);

create table question_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  stable_key text not null,
  label text not null,
  value text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, stable_key)
);

create table lead_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funnel_id uuid not null references funnels(id) on delete cascade,
  status lead_session_status not null default 'started',
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  visitor_id text,
  ghl_connection_id uuid references ghl_connections(id) on delete set null,
  ghl_contact_id text,
  ghl_opportunity_id text,
  source_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  user_agent text,
  ip_address inet,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  qualified_at timestamptz,
  slots_shown_at timestamptz,
  booked_at timestamptz,
  abandoned_at timestamptz,
  errored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_session_id uuid not null references lead_sessions(id) on delete cascade,
  from_status lead_session_status,
  to_status lead_session_status not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table lead_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_session_id uuid not null references lead_sessions(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  question_stable_key text not null,
  answer_text text,
  answer_number numeric,
  answer_options text[] not null default '{}',
  raw_value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_session_id, question_id)
);

create table booking_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funnel_id uuid not null references funnels(id) on delete cascade,
  lead_session_id uuid not null references lead_sessions(id) on delete cascade,
  ghl_contact_id text,
  ghl_opportunity_id text,
  ghl_calendar_id text,
  ghl_appointment_id text,
  slot_start timestamptz,
  slot_end timestamptz,
  timezone text,
  status text not null default 'pending',
  error_code text,
  error_message text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funnel_id uuid references funnels(id) on delete cascade,
  lead_session_id uuid references lead_sessions(id) on delete set null,
  visitor_id text,
  event_type analytics_event_type not null,
  source text not null default 'app',
  source_url text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index funnels_tenant_published_idx on funnels (tenant_id, is_published);
create unique index funnels_slug_unique_idx on funnels (slug);
create index tenant_members_user_idx on tenant_members (user_id);
create index questions_funnel_order_idx on questions (funnel_id, display_order);
create index question_options_question_order_idx on question_options (question_id, display_order);
create index lead_sessions_funnel_status_idx on lead_sessions (funnel_id, status);
create index lead_sessions_tenant_created_idx on lead_sessions (tenant_id, created_at desc);
create index lead_sessions_funnel_visitor_idx on lead_sessions (funnel_id, visitor_id);
create index lead_sessions_funnel_opportunity_idx on lead_sessions (funnel_id, ghl_opportunity_id);
create index lead_answers_session_idx on lead_answers (lead_session_id);
create index booking_attempts_session_idx on booking_attempts (lead_session_id);
create index analytics_events_funnel_type_time_idx on analytics_events (funnel_id, event_type, occurred_at desc);
create index analytics_events_funnel_visitor_time_idx on analytics_events (funnel_id, visitor_id, occurred_at desc);
create index lead_status_history_funnel_status_time_idx on lead_status_history (tenant_id, to_status, created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_set_updated_at before update on tenants
for each row execute function set_updated_at();
create trigger ghl_connections_set_updated_at before update on ghl_connections
for each row execute function set_updated_at();
create trigger funnels_set_updated_at before update on funnels
for each row execute function set_updated_at();
create trigger questions_set_updated_at before update on questions
for each row execute function set_updated_at();
create trigger question_options_set_updated_at before update on question_options
for each row execute function set_updated_at();
create trigger lead_sessions_set_updated_at before update on lead_sessions
for each row execute function set_updated_at();
create trigger lead_answers_set_updated_at before update on lead_answers
for each row execute function set_updated_at();
create trigger booking_attempts_set_updated_at before update on booking_attempts
for each row execute function set_updated_at();

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

create trigger lead_sessions_record_status_insert after insert on lead_sessions
for each row execute function record_lead_status_change();
create trigger lead_sessions_record_status_update after update of status on lead_sessions
for each row execute function record_lead_status_change();
