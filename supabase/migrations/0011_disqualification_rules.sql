-- Add option-level disqualification and a dedicated GHL destination.

alter type lead_session_status add value if not exists 'disqualified';

alter type analytics_event_type add value if not exists 'disqualified_lead';

alter table funnels
  add column if not exists disqualified_pipeline_id text,
  add column if not exists disqualified_pipeline_stage_id text;

alter table question_options
  add column if not exists is_disqualifying boolean not null default false;

alter table lead_sessions
  add column if not exists disqualified_at timestamptz;

notify pgrst, 'reload schema';
