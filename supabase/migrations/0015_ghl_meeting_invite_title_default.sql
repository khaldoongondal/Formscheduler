alter table funnels
  alter column appointment_title set default '';

update funnels
set appointment_title = ''
where appointment_title = 'Consultation';
