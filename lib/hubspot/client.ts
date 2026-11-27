/**
 * HubSpot CRM API calls (P3.4). The private app token travels only in the
 * Authorization header; ids put in paths are checked first.
 */
import { providerRequest } from "@/lib/connections/http";
import { HUBSPOT_API_BASE } from "@/lib/hubspot/constants";
import {
  parseObjectId,
  parsePipelines,
  parsePortalId,
  parseSearchFirstId,
  parseUpsertResponse,
  type HubspotPipeline
} from "@/lib/hubspot/mapping";

const ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;
const OBJECT_TYPES = new Set(["contacts", "deals", "notes"]);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function safeId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("hubspot_invalid_id");
  return id;
}

function safeType(type: string): string {
  if (!OBJECT_TYPES.has(type)) throw new Error("hubspot_invalid_type");
  return type;
}

/** U21: may fail for some tokens; callers treat a failure as "no portal id". */
export async function getAccountDetails(token: string): Promise<{ portalId: string | null }> {
  const { body } = await providerRequest({ provider: "hubspot", url: `${HUBSPOT_API_BASE}/account-info/v3/details`, headers: auth(token) });
  return { portalId: parsePortalId(body) };
}

/** Cheapest call that needs the contacts read scope. */
export async function probe(token: string): Promise<void> {
  await providerRequest({ provider: "hubspot", url: `${HUBSPOT_API_BASE}/crm/v3/objects/contacts?limit=1`, headers: auth(token) });
}

export async function listDealPipelines(token: string): Promise<HubspotPipeline[]> {
  const { body } = await providerRequest({ provider: "hubspot", url: `${HUBSPOT_API_BASE}/crm/v3/pipelines/deals`, headers: auth(token) });
  return parsePipelines(body);
}

export async function upsertContactByEmail(token: string, email: string, properties: Record<string, string>): Promise<string | null> {
  const { body } = await providerRequest({
    provider: "hubspot",
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/batch/upsert`,
    method: "POST",
    headers: auth(token),
    json: { inputs: [{ idProperty: "email", id: email, properties }] }
  });
  return parseUpsertResponse(body);
}

export async function updateContact(token: string, id: string, properties: Record<string, string>): Promise<void> {
  await providerRequest({
    provider: "hubspot",
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${safeId(id)}`,
    method: "PATCH",
    headers: auth(token),
    json: { properties }
  });
}

export async function searchContactByPhone(token: string, phone: string): Promise<string | null> {
  const { body } = await providerRequest({
    provider: "hubspot",
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
    method: "POST",
    headers: auth(token),
    json: { filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }], limit: 1, properties: ["email"] }
  });
  return parseSearchFirstId(body);
}

async function createObject(token: string, type: "contacts" | "deals" | "notes", properties: Record<string, string>): Promise<string> {
  const { body } = await providerRequest({
    provider: "hubspot",
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/${type}`,
    method: "POST",
    headers: auth(token),
    json: { properties }
  });
  const id = parseObjectId(body);
  if (!id) throw new Error(`hubspot_${type}_invalid_response`);
  return id;
}

export function createContact(token: string, properties: Record<string, string>) {
  return createObject(token, "contacts", properties);
}

export function createNote(token: string, input: { timestamp: string; body: string }) {
  return createObject(token, "notes", { hs_timestamp: input.timestamp, hs_note_body: input.body });
}

export function createDeal(token: string, input: { name: string; pipelineId: string; stageId: string }) {
  return createObject(token, "deals", { dealname: input.name, pipeline: input.pipelineId, dealstage: input.stageId });
}

export async function updateDealStage(token: string, dealId: string, stageId: string): Promise<void> {
  await providerRequest({
    provider: "hubspot",
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${safeId(dealId)}`,
    method: "PATCH",
    headers: auth(token),
    json: { properties: { dealstage: stageId } }
  });
}

/** U19: v4 default association, so no association type id is hard-coded. */
export async function associateDefault(token: string, fromType: string, fromId: string, toType: string, toId: string): Promise<void> {
  await providerRequest({
    provider: "hubspot",
    url: `${HUBSPOT_API_BASE}/crm/v4/objects/${safeType(fromType)}/${safeId(fromId)}/associations/default/${safeType(toType)}/${safeId(toId)}`,
    method: "PUT",
    headers: auth(token)
  });
}
