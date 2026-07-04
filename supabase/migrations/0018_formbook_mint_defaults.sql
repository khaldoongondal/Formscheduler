alter table funnels
  alter column primary_color set default '#2bab81',
  alter column accent_color set default '#5ac8a2',
  alter column button_color set default '#2bab81';

notify pgrst, 'reload schema';
