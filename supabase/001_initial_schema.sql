-- Leadder Mission Control - initial Supabase schema draft
-- V1 assumption: internal app, server-only database access from Next.js.

create extension if not exists pgcrypto;

create type pipeline_event_type as enum (
  'lead',
  'appointment_booked',
  'appointment_shown',
  'deal_closed'
);

create type client_status as enum (
  'active',
  'at_risk',
  'churned',
  'paused'
);

create type creative_type as enum (
  'hook',
  'angle',
  'mechanism',
  'offer',
  'image_ad',
  'video_script',
  'vsl_hook',
  'email'
);

create type creative_status as enum (
  'idea',
  'draft',
  'final',
  'in_build',
  'live',
  'retired'
);

create type config_scope as enum (
  'default',
  'monthly_override',
  'actual'
);

create type sync_status as enum (
  'success',
  'error',
  'running'
);

create table page_view_events (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  event_id text unique,
  event_name text not null default 'PageView',
  page_url text not null,
  page_slug text,
  referrer text,
  fbclid text,
  fbc text,
  fbp text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  ip_address inet,
  user_agent text,
  browser text,
  os text,
  device_type text,
  screen_resolution text,
  city text,
  region text,
  country text,
  clarity_session_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table ghl_contacts (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null unique,
  visitor_id text,
  email text,
  email_hash text,
  phone text,
  phone_hash text,
  first_name text,
  last_name text,
  company_name text,
  fbclid text,
  fbc text,
  fbp text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  billing_status text,
  last_payment_date date,
  ghl_created_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ghl_pipeline_events (
  id uuid primary key default gen_random_uuid(),
  ghl_event_id text unique,
  ghl_contact_id text not null references ghl_contacts(ghl_contact_id) on delete cascade,
  event_type pipeline_event_type not null,
  pipeline_id text,
  pipeline_name text,
  stage_id text,
  stage_name text,
  opportunity_id text,
  appointment_id text,
  rep_id text,
  rep_name text,
  rep_email text,
  deal_value_cents integer not null default 0,
  currency text not null default 'CAD',
  capi_sent boolean not null default false,
  capi_sent_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table meta_ad_performance (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  status text,
  date_start date not null,
  date_stop date,
  spend_cents integer not null default 0,
  currency text not null default 'CAD',
  impressions integer not null default 0,
  reach integer not null default 0,
  clicks integer not null default 0,
  unique_outbound_clicks integer not null default 0,
  video_3s_views integer not null default 0,
  cpc numeric,
  cpm numeric,
  ctr numeric,
  unique_outbound_ctr numeric,
  cost_per_unique_click numeric,
  meta_reported_cpl numeric,
  source_hash text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, date_start)
);

create table funnel_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  page_slug text not null,
  page_url text,
  ga4_sessions integer not null default 0,
  ga4_unique_visitors integer not null default 0,
  ga4_avg_time_sec numeric,
  ga4_bounce_rate numeric,
  pixel_page_views integer not null default 0,
  pixel_cta_clicks integer not null default 0,
  pixel_opt_ins integer not null default 0,
  pixel_bookings integer not null default 0,
  clarity_heatmap_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_date, page_slug)
);

create table sales_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  rep_id text not null,
  rep_name text not null,
  rep_email text,
  intro_calls integer not null default 0,
  live_intros integer not null default 0,
  offers_made integer not null default 0,
  deposits integer not null default 0,
  closes integer not null default 0,
  total_collected_cents integer not null default 0,
  total_revenue_cents integer not null default 0,
  source text not null default 'ghl',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric_date, rep_id)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text unique references ghl_contacts(ghl_contact_id) on delete set null,
  company_name text not null,
  contact_name text,
  email text,
  rep_id text,
  rep_name text,
  status client_status not null default 'active',
  mrr_cents integer not null default 29700,
  currency text not null default 'CAD',
  started_at date,
  at_risk_at timestamptz,
  churned_at timestamptz,
  churn_reason text,
  tenure_months integer,
  health_score integer not null default 0 check (health_score between 0 and 100),
  last_payment_date date,
  ghl_subaccount_id text,
  last_ghl_login_at timestamptz,
  campaign_live boolean not null default false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table creative_assets (
  id uuid primary key default gen_random_uuid(),
  creative_type creative_type not null,
  status creative_status not null default 'idea',
  title text,
  body text not null,
  hook_text text,
  angle_text text,
  mechanism_text text,
  offer_text text,
  linked_ad_id text,
  linked_campaign_id text,
  ai_model_run_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table competitor_observations (
  id uuid primary key default gen_random_uuid(),
  competitor_name text not null,
  ad_hook text,
  angle text,
  offer text,
  notes text,
  source_url text,
  spotted_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table expense_config (
  id uuid primary key default gen_random_uuid(),
  config_key text not null,
  label text not null,
  scope config_scope not null default 'default',
  month date,
  value_numeric numeric not null,
  value_type text not null default 'currency',
  currency text default 'CAD',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cash_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_hash text not null unique,
  transaction_date date not null,
  description text not null,
  category text,
  expense_key text,
  amount_cents integer not null,
  currency text not null default 'CAD',
  account_name text,
  source_row jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table monthly_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  snapshot_type text not null default 'actual',
  active_clients integer not null default 0,
  new_clients integer not null default 0,
  churned_clients integer not null default 0,
  net_new_clients integer not null default 0,
  mrr_cents integer not null default 0,
  mrr_growth_cents integer not null default 0,
  mom_growth_pct numeric,
  ad_spend_cents integer not null default 0,
  cac_cents integer,
  revenue_cents integer not null default 0,
  tech_cost_cents integer not null default 0,
  setup_costs_cents integer not null default 0,
  appt_setter_costs_cents integer not null default 0,
  csm_costs_cents integer not null default 0,
  closer_commission_cents integer not null default 0,
  total_expenses_cents integer not null default 0,
  profit_before_kd_cents integer not null default 0,
  kd_profit_share_cents integer not null default 0,
  net_profit_cents integer not null default 0,
  ltv_cents integer,
  ltv_cac_ratio numeric,
  cac_payback_months numeric,
  gross_margin_pct numeric,
  net_margin_pct numeric,
  config_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month, snapshot_type)
);

create table ai_model_runs (
  id uuid primary key default gen_random_uuid(),
  task_key text not null,
  model_key text not null,
  model_name text,
  section text,
  date_from date,
  date_to date,
  prompt text not null,
  raw_response text,
  structured_output jsonb not null default '{}'::jsonb,
  input_context jsonb not null default '{}'::jsonb,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now()
);

alter table creative_assets
  add constraint creative_assets_ai_model_run_id_fkey
  foreign key (ai_model_run_id) references ai_model_runs(id) on delete set null;

create table capi_event_log (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid references ghl_pipeline_events(id) on delete set null,
  event_name text not null,
  ghl_contact_id text,
  contact_email text,
  event_id text not null,
  value_cents integer,
  currency text default 'CAD',
  payload jsonb not null,
  status text not null,
  events_received integer,
  fb_trace_id text,
  response jsonb not null default '{}'::jsonb,
  error_message text,
  sent_at timestamptz not null default now(),
  unique (event_name, event_id)
);

create table client_checklist_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  item_key text not null,
  label text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, item_key)
);

create table sync_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  sync_type text not null,
  status sync_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_processed integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index page_view_events_occurred_at_idx on page_view_events (occurred_at desc);
create index page_view_events_visitor_id_idx on page_view_events (visitor_id);
create index page_view_events_fbclid_idx on page_view_events (fbclid);
create index ghl_contacts_visitor_id_idx on ghl_contacts (visitor_id);
create index ghl_contacts_fbclid_idx on ghl_contacts (fbclid);
create index ghl_pipeline_events_contact_idx on ghl_pipeline_events (ghl_contact_id, occurred_at desc);
create index ghl_pipeline_events_type_date_idx on ghl_pipeline_events (event_type, occurred_at desc);
create index meta_ad_performance_date_idx on meta_ad_performance (date_start desc);
create index meta_ad_performance_campaign_idx on meta_ad_performance (campaign_name, date_start desc);
create index meta_ad_performance_ad_idx on meta_ad_performance (ad_id, date_start desc);
create index funnel_events_date_slug_idx on funnel_events (event_date desc, page_slug);
create index sales_metrics_date_rep_idx on sales_metrics (metric_date desc, rep_id);
create index clients_status_idx on clients (status);
create index clients_started_at_idx on clients (started_at desc);
create index creative_assets_linked_ad_id_idx on creative_assets (linked_ad_id);
create unique index expense_config_key_scope_month_uidx
  on expense_config (config_key, scope, month) nulls not distinct;
create index cash_transactions_date_idx on cash_transactions (transaction_date desc);
create index monthly_kpi_snapshots_month_idx on monthly_kpi_snapshots (month desc);
create index ai_model_runs_task_created_idx on ai_model_runs (task_key, created_at desc);
create index capi_event_log_sent_at_idx on capi_event_log (sent_at desc);
create index sync_log_source_started_idx on sync_log (source, started_at desc);

insert into expense_config (config_key, label, value_numeric, value_type, description) values
  ('arpu', 'ARPU', 297, 'currency', 'Default monthly subscription price.'),
  ('tech_cost', 'Tech Stack Cost', 1000, 'currency', 'Fixed monthly technology cost.'),
  ('setup_cost_per_new_client', 'Setup Cost Per New Client', 50, 'currency', 'Variable setup cost per new client.'),
  ('appt_setter_cost_per_new_client', 'Appointment Setter Cost Per New Client', 25, 'currency', 'Variable appointment setter cost per new client.'),
  ('csm_cost_per_active_client', 'CSM Cost Per Active Client', 20, 'currency', 'Variable client success cost per active client.'),
  ('commission_tier_1_rate', 'Commission Tier 1 Rate', 0.10, 'percent', 'Commission rate up to first threshold.'),
  ('commission_tier_1_limit', 'Commission Tier 1 Limit', 10000, 'currency', 'Collected revenue upper bound for tier 1.'),
  ('commission_tier_2_rate', 'Commission Tier 2 Rate', 0.125, 'percent', 'Commission rate for tier 2 band.'),
  ('commission_tier_2_limit', 'Commission Tier 2 Limit', 25000, 'currency', 'Collected revenue upper bound for tier 2.'),
  ('commission_tier_3_rate', 'Commission Tier 3 Rate', 0.15, 'percent', 'Commission rate above tier 2.'),
  ('kd_profit_share_pct', 'KD Profit Share', 0.30, 'percent', 'Profit share percentage after expenses.'),
  ('ltv_assumption_months', 'LTV Assumption Months', 10, 'number', 'Default assumed subscriber lifetime.');

alter table page_view_events disable row level security;
alter table ghl_contacts disable row level security;
alter table ghl_pipeline_events disable row level security;
alter table meta_ad_performance disable row level security;
alter table funnel_events disable row level security;
alter table sales_metrics disable row level security;
alter table clients disable row level security;
alter table creative_assets disable row level security;
alter table competitor_observations disable row level security;
alter table expense_config disable row level security;
alter table cash_transactions disable row level security;
alter table monthly_kpi_snapshots disable row level security;
alter table ai_model_runs disable row level security;
alter table capi_event_log disable row level security;
alter table client_checklist_items disable row level security;
alter table sync_log disable row level security;
