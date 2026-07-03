-- Track public funnel step views for question/contact-field drop-off reporting.
alter type analytics_event_type add value if not exists 'step_view';

