alter table funnels
  add column if not exists availability_window_days integer not null default 14
  check (availability_window_days between 1 and 60);

notify pgrst, 'reload schema';
