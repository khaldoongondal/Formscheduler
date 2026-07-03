-- Demo tenant and funnel for local visual QA.
-- These records are safe placeholders and do not contain real GHL credentials.

insert into tenants (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Demo Growth Agency', 'demo-agency')
on conflict (id) do update
set
  name = excluded.name,
  slug = excluded.slug;

insert into ghl_connections (
  id,
  tenant_id,
  name,
  location_id,
  calendar_id,
  private_token_ciphertext,
  token_last_four,
  api_base_url,
  api_version,
  is_active
)
values (
  '01000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Demo GHL Connection',
  'demo-location',
  'demo-calendar',
  null,
  null,
  'https://services.leadconnectorhq.com',
  '2023-02-21',
  true
)
on conflict (id) do update
set
  name = excluded.name,
  location_id = excluded.location_id,
  calendar_id = excluded.calendar_id,
  api_base_url = excluded.api_base_url,
  api_version = excluded.api_version,
  is_active = excluded.is_active;

insert into funnels (
  id,
  tenant_id,
  name,
  slug,
  description,
  is_published,
  ghl_connection_id,
  primary_color,
  accent_color,
  button_color,
  border_radius,
  slot_duration_minutes,
  calendar_id,
  appointment_title,
  opt_in_pipeline_id,
  opt_in_pipeline_stage_id,
  booked_pipeline_id,
  booked_pipeline_stage_id,
  opportunity_name_template,
  qualification_rule,
  embed_settings,
  popup_settings
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Growth Strategy Consultation',
  'demo-consultation',
  'Answer a few quick questions so we can route you to the right strategy call and show the best available times.',
  true,
  '01000000-0000-0000-0000-000000000001',
  '#173f2d',
  '#4f9a78',
  '#173f2d',
  10,
  30,
  'demo-calendar',
  '',
  'demo-opt-in-pipeline',
  'demo-opt-in-stage',
  'demo-booked-pipeline',
  'demo-booked-stage',
  '{{lead_name}}',
  '{"mode":"all_required_answered"}'::jsonb,
  '{"height":720,"width":"100%"}'::jsonb,
  '{"trigger":"button","button_label":"Book a strategy call"}'::jsonb
)
on conflict (id) do update
set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  is_published = excluded.is_published,
  ghl_connection_id = excluded.ghl_connection_id,
  primary_color = excluded.primary_color,
  accent_color = excluded.accent_color,
  button_color = excluded.button_color,
  border_radius = excluded.border_radius,
  slot_duration_minutes = excluded.slot_duration_minutes,
  calendar_id = excluded.calendar_id,
  appointment_title = excluded.appointment_title,
  opt_in_pipeline_id = excluded.opt_in_pipeline_id,
  opt_in_pipeline_stage_id = excluded.opt_in_pipeline_stage_id,
  booked_pipeline_id = excluded.booked_pipeline_id,
  booked_pipeline_stage_id = excluded.booked_pipeline_stage_id,
  opportunity_name_template = excluded.opportunity_name_template,
  qualification_rule = excluded.qualification_rule,
  embed_settings = excluded.embed_settings,
  popup_settings = excluded.popup_settings;

insert into questions (
  id,
  tenant_id,
  funnel_id,
  stable_key,
  label,
  help_text,
  question_type,
  placeholder,
  is_required,
  display_order,
  ghl_field_key,
  ghl_custom_field_key
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'monthly_revenue',
    'What is your current monthly revenue?',
    'This helps us understand the stage of the business.',
    'single_select',
    null,
    true,
    1,
    'monthly_revenue',
    'monthly_revenue'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'growth_goal',
    'What are you trying to improve first?',
    'Choose every option that applies.',
    'multi_select',
    null,
    true,
    2,
    'growth_goal',
    'growth_goal'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'timeline',
    'When would you like to make a change?',
    null,
    'single_select',
    null,
    true,
    3,
    'timeline',
    'timeline'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'website',
    'What is your website?',
    'Optional, but helpful before the call.',
    'url',
    'https://example.com',
    false,
    4,
    'website',
    'website'
  )
on conflict (id) do update
set
  label = excluded.label,
  help_text = excluded.help_text,
  question_type = excluded.question_type,
  placeholder = excluded.placeholder,
  is_required = excluded.is_required,
  display_order = excluded.display_order,
  ghl_field_key = excluded.ghl_field_key,
  ghl_custom_field_key = excluded.ghl_custom_field_key;

insert into question_options (
  tenant_id,
  question_id,
  stable_key,
  label,
  value,
  display_order
)
values
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'under_25k', 'Under $25k/mo', 'under_25k', 1),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '25k_100k', '$25k - $100k/mo', '25k_100k', 2),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '100k_plus', '$100k+/mo', '100k_plus', 3),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'more_qualified_leads', 'More qualified leads', 'more_qualified_leads', 1),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'better_booking_rate', 'Better booking rate', 'better_booking_rate', 2),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'sales_process', 'Cleaner sales process', 'sales_process', 3),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'tracking', 'Better funnel tracking', 'tracking', 4),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'asap', 'As soon as possible', 'asap', 1),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'this_quarter', 'This quarter', 'this_quarter', 2),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'exploring', 'Just exploring', 'exploring', 3)
on conflict (question_id, stable_key) do update
set
  label = excluded.label,
  value = excluded.value,
  display_order = excluded.display_order;
