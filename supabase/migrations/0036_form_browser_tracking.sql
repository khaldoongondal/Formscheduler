-- Only public vendor identifiers are stored. Existing forms have no browser tags.
alter table public.funnels
  add column if not exists browser_tracking jsonb constraint funnels_browser_tracking_valid check (
    browser_tracking is null or (
      jsonb_typeof(browser_tracking) = 'object'
      and (browser_tracking - array['meta_pixel_id','gtm_container_id','ga4_measurement_id','clarity_project_id']) = '{}'::jsonb
      and (not (browser_tracking ? 'meta_pixel_id') or
        (jsonb_typeof(browser_tracking->'meta_pixel_id') = 'string' and browser_tracking->>'meta_pixel_id' ~ '^[0-9]{5,20}$'))
      and (not (browser_tracking ? 'gtm_container_id') or
        (jsonb_typeof(browser_tracking->'gtm_container_id') = 'string' and browser_tracking->>'gtm_container_id' ~ '^GTM-[A-Z0-9]{1,32}$'))
      and (not (browser_tracking ? 'ga4_measurement_id') or
        (jsonb_typeof(browser_tracking->'ga4_measurement_id') = 'string' and browser_tracking->>'ga4_measurement_id' ~ '^G-[A-Z0-9]{1,32}$'))
      and (not (browser_tracking ? 'clarity_project_id') or
        (jsonb_typeof(browser_tracking->'clarity_project_id') = 'string' and browser_tracking->>'clarity_project_id' ~ '^[a-zA-Z0-9]{1,40}$'))
    )
  );
