alter table funnels
  add column if not exists logo_alignment text not null default 'left'
  check (logo_alignment in ('left', 'center'));

notify pgrst, 'reload schema';
