export interface GhlRuntimeConfig {
  token: string;
  locationId: string;
  baseUrl: string;
  apiVersion: string;
}

export interface GhlContactInput {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  customFields?: Array<{
    id?: string;
    key?: string;
    fieldValue: string | number | string[];
  }>;
}

export interface GhlContactResponse {
  contact: {
    id: string;
  };
}

export interface GhlSlot {
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface GhlOpportunity {
  id: string;
  name?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  status?: string;
}

export interface GhlOpportunitySearchResponse {
  opportunities: GhlOpportunity[];
}

export interface GhlOpportunityResponse {
  opportunity?: GhlOpportunity;
  id?: string;
}

export interface GhlAppointmentResponse {
  id?: string;
  appointment?: {
    id?: string;
  };
  event?: {
    id?: string;
  };
}

export type GhlCalendarSlotsResponse = Record<string, unknown>;

export interface GhlContactNoteResponse {
  note?: {
    id?: string;
  };
}

const GHL_REQUEST_TIMEOUT_MS = 12_000;

async function ghlFetch<T>(config: GhlRuntimeConfig, path: string, init?: RequestInit): Promise<T> {
  if (!config.token) throw new Error("Missing GHL connection token.");
  if (!config.locationId) throw new Error("Missing GHL connection location ID.");

  const method = init?.method ?? "GET";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GHL_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        Version: config.apiVersion,
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GHL request timed out after ${GHL_REQUEST_TIMEOUT_MS / 1000}s (${method} ${path}).`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GHL request failed (${method} ${path}): ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

export async function upsertContact(config: GhlRuntimeConfig, input: GhlContactInput) {
  return ghlFetch<GhlContactResponse>(config, "/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      locationId: config.locationId
    })
  });
}

export async function updateContact(config: GhlRuntimeConfig, contactId: string, input: GhlContactInput) {
  return ghlFetch<GhlContactResponse>(config, `/contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function createContactNote(
  config: GhlRuntimeConfig,
  input: {
    contactId: string;
    body: string;
    title?: string;
    color?: string;
    pinned?: boolean;
  }
) {
  return ghlFetch<GhlContactNoteResponse>(config, `/contacts/${encodeURIComponent(input.contactId)}/notes`, {
    method: "POST",
    body: JSON.stringify({
      body: input.body,
      title: input.title,
      color: input.color,
      pinned: input.pinned ?? false
    })
  });
}

export async function searchOpportunities(
  config: GhlRuntimeConfig,
  input: {
    contactId: string;
    pipelineId?: string | null;
    status?: "open" | "won" | "lost" | "abandoned" | "all";
  }
) {
  const params = new URLSearchParams({
    location_id: config.locationId,
    contact_id: input.contactId,
    status: input.status ?? "open",
    limit: "20",
    page: "1"
  });

  if (input.pipelineId) {
    params.set("pipeline_id", input.pipelineId);
  }

  return ghlFetch<GhlOpportunitySearchResponse>(config, `/opportunities/search?${params.toString()}`);
}

export async function createOpportunity(
  config: GhlRuntimeConfig,
  input: {
    contactId: string;
    pipelineId: string;
    pipelineStageId: string;
    name: string;
    status?: "open" | "won" | "lost" | "abandoned";
    source?: string;
  }
) {
  return ghlFetch<GhlOpportunityResponse>(config, "/opportunities/", {
    method: "POST",
    body: JSON.stringify({
      contactId: input.contactId,
      pipelineId: input.pipelineId,
      pipelineStageId: input.pipelineStageId,
      locationId: config.locationId,
      name: input.name,
      status: input.status ?? "open",
      source: input.source ?? "Leadder Scheduler"
    })
  });
}

export async function updateOpportunity(
  config: GhlRuntimeConfig,
  input: {
    id: string;
    pipelineId: string;
    pipelineStageId: string;
    name: string;
    status?: "open" | "won" | "lost" | "abandoned";
    source?: string;
  }
) {
  return ghlFetch<GhlOpportunityResponse>(config, `/opportunities/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      pipelineId: input.pipelineId,
      pipelineStageId: input.pipelineStageId,
      name: input.name,
      status: input.status ?? "open",
      source: input.source ?? "Leadder Scheduler"
    })
  });
}

export async function getCalendarSlots(
  config: GhlRuntimeConfig,
  calendarId: string,
  startDate: string,
  endDate: string,
  timezone: string
) {
  const params = new URLSearchParams({ startDate, endDate, timezone });
  return ghlFetch<GhlCalendarSlotsResponse>(
    config,
    `/calendars/${encodeURIComponent(calendarId)}/free-slots?${params.toString()}`
  );
}

export async function createAppointment(
  config: GhlRuntimeConfig,
  input: {
    calendarId: string;
    contactId: string;
    startTime: string;
    endTime: string;
    timezone: string;
    title?: string;
  }
) {
  return ghlFetch<GhlAppointmentResponse>(config, "/calendars/events/appointments", {
    method: "POST",
    body: JSON.stringify({
      calendarId: input.calendarId,
      locationId: config.locationId,
      contactId: input.contactId,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone,
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      meetingLocationType: "custom",
      appointmentStatus: "confirmed"
    })
  });
}
