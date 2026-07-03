alter table funnels
  add column if not exists phone_pulse_enabled boolean not null default true;
