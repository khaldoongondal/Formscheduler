alter table funnels
  add column if not exists show_intro_headline boolean not null default true,
  add column if not exists show_intro_description boolean not null default true;

notify pgrst, 'reload schema';
