# GHL Live Test Plan

This plan validates the exact GHL calls used by Leadder Scheduler. Use a non-production GHL sub-account first.

Required Private Integration Token scopes:

- `contacts.write`
- `opportunities.readonly`
- `opportunities.write`
- `calendars.readonly`
- `calendars/events.write`

Reference docs:

- Contact upsert: https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/
- Opportunity search: https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity/
- Opportunity create: https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity/
- Opportunity update: https://marketplace.gohighlevel.com/docs/ghl/opportunities/update-opportunity/
- Free slots: https://marketplace.gohighlevel.com/docs/ghl/calendars/get-slots/
- Create appointment: https://marketplace.gohighlevel.com/docs/ghl/calendars/create-appointment/

## Test Data Required

- Location ID for the GHL sub-account.
- Private Integration Token for that location.
- Calendar ID with available slots in the next 14 days.
- Opt-in pipeline ID and stage ID.
- Booked-call pipeline ID and stage ID.
- Test contact email and phone.
- Optional GHL custom field IDs/keys for mapped questions.

## Endpoint Validation

### Contact Upsert

Code path:

- `lib/lead-sessions/service.ts`
- `lib/bookings/service.ts`
- `lib/ghl/service.ts`
- `lib/ghl/client.ts`

Request:

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "phone": "+15555550123",
  "locationId": "GHL_LOCATION_ID",
  "customFields": [
    {
      "id": "GHL_CUSTOM_FIELD_ID",
      "key": "optional_field_key",
      "field_value": "answer value"
    }
  ]
}
```

Expected response:

```json
{
  "contact": {
    "id": "GHL_CONTACT_ID"
  }
}
```

Validate:

- Same email/phone updates the same contact according to the location duplicate-contact settings.
- Response includes `contact.id`.
- Custom field mapping accepts `id` or `key` values used in configured questions.

### Opportunity Search

Request query:

```text
GET /opportunities/search?location_id=GHL_LOCATION_ID&contact_id=GHL_CONTACT_ID&pipeline_id=PIPELINE_ID&status=open&limit=20&page=1
```

Expected response:

```json
{
  "opportunities": [
    {
      "id": "GHL_OPPORTUNITY_ID",
      "contactId": "GHL_CONTACT_ID",
      "pipelineId": "PIPELINE_ID",
      "pipelineStageId": "STAGE_ID",
      "status": "open"
    }
  ]
}
```

Validate:

- Search by `contact_id` returns opportunities for the same contact.
- Filtering by `pipeline_id` does not hide an existing opportunity after it moves to the booked pipeline.
- If booked and opt-in destinations are different pipelines, local `ghl_opportunity_id` remains the primary duplicate-prevention key.

### Opportunity Create

Request:

```json
{
  "contactId": "GHL_CONTACT_ID",
  "pipelineId": "OPT_IN_PIPELINE_ID",
  "pipelineStageId": "OPT_IN_STAGE_ID",
  "locationId": "GHL_LOCATION_ID",
  "name": "Funnel Name - Ada Lovelace",
  "status": "open",
  "source": "Leadder:funnel-slug"
}
```

Expected response:

```json
{
  "opportunity": {
    "id": "GHL_OPPORTUNITY_ID",
    "contactId": "GHL_CONTACT_ID",
    "pipelineId": "OPT_IN_PIPELINE_ID",
    "pipelineStageId": "OPT_IN_STAGE_ID",
    "status": "open"
  }
}
```

Validate:

- Opportunity appears in the configured opt-in pipeline and stage.
- Response includes `opportunity.id`.
- Source is accepted and visible enough for operational debugging.

### Opportunity Update

Request:

```json
{
  "pipelineId": "BOOKED_PIPELINE_ID",
  "pipelineStageId": "BOOKED_STAGE_ID",
  "name": "Funnel Name - Ada Lovelace",
  "status": "open",
  "source": "Leadder:funnel-slug"
}
```

Expected response:

```json
{
  "opportunity": {
    "id": "GHL_OPPORTUNITY_ID",
    "pipelineId": "BOOKED_PIPELINE_ID",
    "pipelineStageId": "BOOKED_STAGE_ID",
    "status": "open"
  }
}
```

Validate:

- Existing opportunity moves instead of creating a duplicate.
- Moving across pipelines is accepted by the GHL account.
- Response shape includes either `opportunity.id` or top-level `id`.

### Free Slot Lookup

Request query:

```text
GET /calendars/CALENDAR_ID/free-slots?startDate=START_MS&endDate=END_MS&timezone=America/Toronto
```

Expected response:

```json
{
  "2026-06-01": {
    "slots": [
      "2026-06-01T14:00:00.000Z"
    ]
  }
}
```

Validate:

- Date range under 31 days.
- Returned object is keyed by date and each value has a `slots` array.
- Timezone returns expected local availability.
- Empty availability is handled without booking errors.

### Appointment Create

Request:

```json
{
  "calendarId": "CALENDAR_ID",
  "locationId": "GHL_LOCATION_ID",
  "contactId": "GHL_CONTACT_ID",
  "startTime": "2026-06-01T14:00:00.000Z",
  "endTime": "2026-06-01T14:30:00.000Z",
  "timezone": "America/Toronto",
  "title": "Configured Funnel Appointment Title",
  "meetingLocationType": "custom",
  "appointmentStatus": "confirmed"
}
```

Expected response can vary by GHL response shape. Leadder accepts:

```json
{
  "id": "GHL_APPOINTMENT_ID"
}
```

or:

```json
{
  "appointment": {
    "id": "GHL_APPOINTMENT_ID"
  }
}
```

or:

```json
{
  "event": {
    "id": "GHL_APPOINTMENT_ID"
  }
}
```

Validate:

- Appointment appears on the configured GHL calendar.
- GHL workflows/reminders trigger as expected.
- Response includes one accepted appointment ID shape.
- `toNotify` default behavior is acceptable for the customer workflow.

## Current Code Assumptions

- Private Integration Token is a sub-account token for the configured location.
- API base URL is `https://services.leadconnectorhq.com`.
- API version is `2023-02-21`.
- Free-slot lookup response is an object whose values contain `slots`.
- Slot duration is locally calculated from `funnels.slot_duration_minutes`.
- Appointment status should be `confirmed`.
- Meeting location type should be `custom`.
- Opportunity duplicate prevention relies first on local `lead_sessions.ghl_opportunity_id`, then GHL search by contact and current pipeline.
- GHL contact upsert behavior depends on the location duplicate-contact setting.
