alter table funnels
  alter column opportunity_name_template set default '{{lead_name}}';

update funnels
set opportunity_name_template = '{{lead_name}}'
where opportunity_name_template = '{{funnel_name}} - {{lead_name}}';
