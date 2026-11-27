"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import { CALCOM_COPY, CALCOM_KEY_PATTERN } from "@/lib/calcom/constants";
import { getMe } from "@/lib/calcom/client";
import { checkCalcomConnection } from "@/lib/connections/calcom";
import {
  checkCalendlyConnection,
  removeCalendlySubscription,
  setupCalendlyConfirmations,
  verifyCalendlyToken
} from "@/lib/connections/calendly";
import { checkHubspotConnection, verifyHubspotToken } from "@/lib/connections/hubspot";
import { postWebhookEvent, webhookContext } from "@/lib/connections/webhook";
import { CALENDLY_COPY } from "@/lib/calendly/constants";
import { DELIVERIES_COPY } from "@/lib/crm/copy";
import { drainCrmDeliveriesByIds } from "@/lib/crm/drain";
import { buildTestEvent } from "@/lib/crm/event-payload";
import { getAccountDetails } from "@/lib/hubspot/client";
import { HUBSPOT_COPY, HUBSPOT_TOKEN_PATTERN } from "@/lib/hubspot/constants";
import { getGhlConnectionForTenant } from "@/lib/ghl/connections";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import { WEBHOOK_SECRET_PATTERN } from "@/lib/webhooks/signing";
import { checkWebhookUrl, URL_SAFETY_MESSAGES } from "@/lib/webhooks/url-safety";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { checkGoogleConnection } from "@/lib/connections/google-calendar";
import { ProviderHttpError } from "@/lib/connections/http";
import { isUuid } from "@/lib/connections/registry";
import {
  connectionMessageFromError,
  deleteConnection,
  getConnectionRowForTenant,
  lastFour,
  recordConnectionCheck,
  renameConnection,
  setConnectionDisabled
} from "@/lib/connections/service";
import { availabilitySchema } from "@/lib/google/availability";
import { revokeConnectionTokens } from "@/lib/google/oauth";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { encryptSecret } from "@/lib/security/encryption";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

const CONNECTIONS_PATH = "/admin/connections";

function detailPath(id: string) {
  return `${CONNECTIONS_PATH}/${id}`;
}

function withParam(path: string, key: string, value: string) {
  return `${path}?${key}=${encodeURIComponent(value)}`;
}

function failTo(path: string, message: string): never {
  redirect(withParam(path, "error", message));
}

/** Only our own messages reach the URL; anything else becomes a generic line. */
function safeMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return connectionMessageFromError(message) ?? (OWN_MESSAGES.has(message) ? message : fallback);
}

const OWN_MESSAGES = new Set<string>([
  CONNECTIONS_COPY.notFound,
  CONNECTIONS_COPY.checkLimit,
  "Please enter a name.",
  ...[CALCOM_COPY, CALENDLY_COPY, HUBSPOT_COPY, WEBHOOK_COPY, URL_SAFETY_MESSAGES].flatMap((copy) =>
    (Object.values(copy) as unknown[]).filter((value): value is string => typeof value === "string")
  )
]);

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Decision C26: checks, creations and token replacements share 10 per hour per tenant. */
async function assertCheckAllowed(tenantId: string) {
  const { allowed } = await hitRateLimit({ scope: "connection-test", subject: tenantId, limit: 10, windowSeconds: 3600 });
  if (!allowed) throw new Error(CONNECTIONS_COPY.checkLimit);
}

async function ownedRow(tenantId: string, id: string) {
  if (!isUuid(id)) throw new Error(CONNECTIONS_COPY.notFound);
  const row = await getConnectionRowForTenant(tenantId, id);
  if (!row) throw new Error(CONNECTIONS_COPY.notFound);
  return row;
}

/** Calls Cal.com /v2/me with the key; maps refusals to fixed messages. */
async function verifyCalcomKey(key: string) {
  if (!CALCOM_KEY_PATTERN.test(key)) throw new Error(CALCOM_COPY.keyPattern);
  try {
    return await getMe(key);
  } catch (error) {
    if (error instanceof ProviderHttpError && (error.status === 401 || error.status === 403)) {
      throw new Error(CALCOM_COPY.keyRejected);
    }
    console.error("[calcom] key check failed", error instanceof ProviderHttpError ? error.status : "unknown");
    throw new Error(CALCOM_COPY.keyCheckFailed);
  }
}

export async function createCalcomConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || CALCOM_COPY.defaultName;
  const key = String(formData.get("api_key") ?? "").trim();
  let id: string;
  try {
    await assertCheckAllowed(tenantId);
    const me = await verifyCalcomKey(key);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("connections")
      .insert({
        tenant_id: tenantId,
        provider: "calcom",
        name,
        status: "connected",
        account_label: me.username,
        external_account_id: String(me.id),
        secret_ciphertext: encryptSecret(key),
        secret_last_four: lastFour(key),
        settings: { username: me.username },
        last_checked_at: new Date().toISOString(),
        last_check_ok: true,
        last_check_summary: CALCOM_COPY.checkOk
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(CALCOM_COPY.alreadyConnected);
      throw new Error(error.message);
    }
    id = data.id as string;
  } catch (error) {
    failTo(`${CONNECTIONS_PATH}/new/calcom`, safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  redirect(withParam(detailPath(id), "saved", "created"));
}

export async function replaceCalcomKeyAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("api_key") ?? "").trim();
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "calcom") throw new Error(CONNECTIONS_COPY.notFound);
    await assertCheckAllowed(tenantId);
    const me = await verifyCalcomKey(key);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("connections")
      .update({
        secret_ciphertext: encryptSecret(key),
        secret_last_four: lastFour(key),
        account_label: me.username,
        external_account_id: String(me.id),
        settings: { ...(row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {}), username: me.username },
        // A new working key clears a needs-attention state, never a switched-off one.
        ...(row.status === "needs_attention" ? { status: "connected" as const, status_message: null } : {}),
        last_checked_at: new Date().toISOString(),
        last_check_ok: true,
        last_check_summary: CALCOM_COPY.checkOk
      })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (error) {
      if (error.code === "23505") throw new Error(CALCOM_COPY.alreadyConnected);
      throw new Error(error.message);
    }
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "key"));
}

export async function saveAvailabilityAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "google_calendar") throw new Error(CONNECTIONS_COPY.notFound);
    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("availability_json") ?? ""));
    } catch {
      raw = null;
    }
    const parsed = availabilitySchema.safeParse(raw);
    if (!parsed.success) throw new Error(`availability:${parsed.error.issues[0]?.message ?? ""}`);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("connections")
      .update({ availability: parsed.data as unknown as Json, availability_confirmed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("availability:") ? error.message.slice(13) : "";
    failTo(detailPath(id), message || safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(`${withParam(detailPath(id), "saved", "availability")}#availability`);
}

export async function renameConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  try {
    await ownedRow(tenantId, id);
    await renameConnection(tenantId, id, String(formData.get("name") ?? ""));
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "renamed"));
}

export async function setConnectionDisabledAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  const disabled = formData.get("disabled") === "true";
  try {
    await ownedRow(tenantId, id);
    await setConnectionDisabled(tenantId, id, disabled);
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", disabled ? "disabled" : "enabled"));
}

export async function checkConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  try {
    const row = await ownedRow(tenantId, id);
    await assertCheckAllowed(tenantId);
    let result: { ok: boolean; summary: string };
    if (row.provider === "google_calendar") result = await checkGoogleConnection(row);
    else if (row.provider === "calcom") result = await checkCalcomConnection(row);
    else if (row.provider === "calendly") result = await checkCalendlyConnection(row);
    else if (row.provider === "hubspot") result = await checkHubspotConnection(row);
    else throw new Error(CONNECTIONS_COPY.notFound);
    await recordConnectionCheck(row.id, result.ok, result.summary);
    // Calendly stays needs-attention until its booking confirmations are set up (C16).
    const confirmationsMissing = row.provider === "calendly" && !calendlyHasSubscription(row.settings);
    if (result.ok && row.status === "needs_attention" && !confirmationsMissing) {
      // The provider answered with the stored credentials again: clear the warning.
      const supabase = createServiceClient();
      await supabase
        .from("connections")
        .update({ status: "connected", status_message: null })
        .eq("id", row.id)
        .eq("tenant_id", tenantId)
        .eq("status", "needs_attention");
    }
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "checked"));
}

export async function deleteConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  try {
    await ownedRow(tenantId, id);
    await deleteConnection(tenantId, id, async (row) => {
      if (row.provider === "google_calendar") await revokeConnectionTokens(row);
      if (row.provider === "calendly") await removeCalendlySubscription(row);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    failTo(detailPath(id), message.startsWith("Turn off or move these forms first:") ? message : safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  redirect(withParam(CONNECTIONS_PATH, "saved", "connection-deleted"));
}

function asSettings(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function calendlyHasSubscription(settings: unknown): boolean {
  return typeof asSettings(settings).webhook_subscription_uri === "string";
}

const CALENDLY_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,4000}$/;

// Calendly (P3.7).

export async function createCalendlyConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || CALENDLY_COPY.defaultName;
  const token = String(formData.get("token") ?? "").trim();
  let id: string;
  try {
    await assertCheckAllowed(tenantId);
    if (!CALENDLY_TOKEN_PATTERN.test(token)) throw new Error(CALENDLY_COPY.tokenFormat);
    const user = await verifyCalendlyToken(token);
    if (!user.organization) throw new Error(CALENDLY_COPY.tokenCheckFailed);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("connections")
      .insert({
        tenant_id: tenantId,
        provider: "calendly",
        name,
        // Connected only once booking confirmations are set up just below.
        status: "needs_attention",
        status_message: CALENDLY_COPY.setupFailed,
        account_label: user.name ?? null,
        external_account_id: user.uri,
        secret_ciphertext: encryptSecret(token),
        secret_last_four: lastFour(token),
        settings: { user_uri: user.uri, organization_uri: user.organization },
        last_checked_at: new Date().toISOString(),
        last_check_ok: true,
        last_check_summary: CALENDLY_COPY.checkOk
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(CALENDLY_COPY.alreadyConnected);
      throw new Error(error.message);
    }
    id = data.id as string;
    await setupCalendlyConfirmations(data);
  } catch (error) {
    failTo(`${CONNECTIONS_PATH}/new/calendly`, safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  redirect(withParam(detailPath(id), "saved", "calendly-created"));
}

export async function replaceCalendlyTokenAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  const token = String(formData.get("token") ?? "").trim();
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "calendly") throw new Error(CONNECTIONS_COPY.notFound);
    await assertCheckAllowed(tenantId);
    if (!CALENDLY_TOKEN_PATTERN.test(token)) throw new Error(CALENDLY_COPY.tokenFormat);
    const user = await verifyCalendlyToken(token);
    if (!user.organization) throw new Error(CALENDLY_COPY.tokenCheckFailed);
    if (row.external_account_id && row.external_account_id !== user.uri) throw new Error(CALENDLY_COPY.otherAccount);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("connections")
      .update({
        secret_ciphertext: encryptSecret(token),
        secret_last_four: lastFour(token),
        account_label: user.name ?? row.account_label,
        settings: { ...asSettings(row.settings), user_uri: user.uri, organization_uri: user.organization },
        last_checked_at: new Date().toISOString(),
        last_check_ok: true,
        last_check_summary: CALENDLY_COPY.checkOk
      })
      .eq("id", row.id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    // A new token reruns the setup, so notifications are signed with a key FormBook knows.
    await setupCalendlyConfirmations(data);
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "calendly-token"));
}

export async function setupCalendlyConfirmationsAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  let result = { ok: false, message: GENERIC_ERROR };
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "calendly") throw new Error(CONNECTIONS_COPY.notFound);
    await assertCheckAllowed(tenantId);
    result = await setupCalendlyConfirmations(row);
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  revalidatePath(detailPath(id));
  if (!result.ok) failTo(detailPath(id), result.message);
  redirect(withParam(detailPath(id), "saved", "calendly-confirmations"));
}

// HubSpot (P3.4).

async function hubspotAccount(token: string): Promise<{ label: string | null; portalId: string | null }> {
  try {
    const { portalId } = await getAccountDetails(token);
    return { label: portalId ? HUBSPOT_COPY.portalLabel(portalId) : null, portalId };
  } catch {
    // U21: the portal id is optional; the connection works without it.
    return { label: null, portalId: null };
  }
}

export async function createHubspotConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || HUBSPOT_COPY.defaultName;
  const token = String(formData.get("token") ?? "").trim();
  let id: string;
  try {
    await assertCheckAllowed(tenantId);
    if (!HUBSPOT_TOKEN_PATTERN.test(token)) throw new Error(HUBSPOT_COPY.tokenPattern);
    await verifyHubspotToken(token);
    const account = await hubspotAccount(token);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("connections")
      .insert({
        tenant_id: tenantId,
        provider: "hubspot",
        name,
        status: "connected",
        account_label: account.label,
        external_account_id: account.portalId,
        secret_ciphertext: encryptSecret(token),
        secret_last_four: lastFour(token),
        settings: {},
        last_checked_at: new Date().toISOString(),
        last_check_ok: true,
        last_check_summary: HUBSPOT_COPY.checkOk
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(HUBSPOT_COPY.alreadyConnected);
      throw new Error(error.message);
    }
    id = data.id as string;
  } catch (error) {
    failTo(`${CONNECTIONS_PATH}/new/hubspot`, safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  redirect(withParam(detailPath(id), "saved", "hubspot-created"));
}

export async function replaceHubspotTokenAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  const token = String(formData.get("token") ?? "").trim();
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "hubspot") throw new Error(CONNECTIONS_COPY.notFound);
    await assertCheckAllowed(tenantId);
    if (!HUBSPOT_TOKEN_PATTERN.test(token)) throw new Error(HUBSPOT_COPY.tokenPattern);
    await verifyHubspotToken(token);
    const account = await hubspotAccount(token);
    if (row.external_account_id && account.portalId && row.external_account_id !== account.portalId) {
      throw new Error(HUBSPOT_COPY.otherAccount);
    }
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("connections")
      .update({
        secret_ciphertext: encryptSecret(token),
        secret_last_four: lastFour(token),
        ...(account.portalId ? { account_label: account.label, external_account_id: account.portalId } : {}),
        ...(row.status === "needs_attention" ? { status: "connected" as const, status_message: null } : {}),
        last_checked_at: new Date().toISOString(),
        last_check_ok: true,
        last_check_summary: HUBSPOT_COPY.checkOk
      })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (error) {
      if (error.code === "23505") throw new Error(HUBSPOT_COPY.alreadyConnected);
      throw new Error(error.message);
    }
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "hubspot-token"));
}

// Webhook (P3.5).

function checkedAddress(raw: string): string {
  const result = checkWebhookUrl(raw);
  if (!result.ok) throw new Error(result.message);
  return result.url.toString();
}

function checkedSecret(raw: string): string {
  if (!WEBHOOK_SECRET_PATTERN.test(raw)) throw new Error(WEBHOOK_COPY.secretPattern);
  return raw;
}

export async function createWebhookConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || WEBHOOK_COPY.defaultName;
  let id: string;
  try {
    await assertCheckAllowed(tenantId);
    const address = checkedAddress(String(formData.get("endpoint_url") ?? ""));
    const secret = checkedSecret(String(formData.get("signing_secret") ?? "").trim());
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("connections")
      .insert({
        tenant_id: tenantId,
        provider: "webhook",
        name,
        status: "connected",
        account_label: new URL(address).host,
        endpoint_url: address,
        signing_secret_ciphertext: encryptSecret(secret),
        signing_secret_last_four: lastFour(secret),
        settings: {}
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  } catch (error) {
    failTo(`${CONNECTIONS_PATH}/new/webhook`, safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  redirect(withParam(detailPath(id), "saved", "webhook-created"));
}

export async function updateWebhookAddressAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "webhook") throw new Error(CONNECTIONS_COPY.notFound);
    const address = checkedAddress(String(formData.get("endpoint_url") ?? ""));
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("connections")
      .update({ endpoint_url: address, account_label: new URL(address).host })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "webhook-address"));
}

export async function replaceWebhookSecretAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "webhook") throw new Error(CONNECTIONS_COPY.notFound);
    await assertCheckAllowed(tenantId);
    const secret = checkedSecret(String(formData.get("signing_secret") ?? "").trim());
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("connections")
      .update({ signing_secret_ciphertext: encryptSecret(secret), signing_secret_last_four: lastFour(secret) })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(withParam(detailPath(id), "saved", "webhook-secret"));
}

/** Sends the made-up test event directly (not through the queue) and logs one settled row. */
export async function sendWebhookTestAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const id = String(formData.get("id") ?? "");
  let deliveryId: string;
  try {
    const row = await ownedRow(tenantId, id);
    if (row.provider !== "webhook") throw new Error(CONNECTIONS_COPY.notFound);
    await assertCheckAllowed(tenantId);
    const ctx = webhookContext(row);
    if (!ctx) throw new Error(WEBHOOK_COPY.blockedAddress);
    deliveryId = randomUUID();
    const nowIso = new Date().toISOString();
    const event = buildTestEvent(nowIso, randomUUID());
    const outcome = await postWebhookEvent(ctx, event, deliveryId);
    const sent = outcome.outcome === "sent";
    const supabase = createServiceClient();
    const { error } = await supabase.from("crm_event_deliveries").insert({
      id: deliveryId,
      tenant_id: tenantId,
      connection_id: row.id,
      provider: "webhook",
      funnel_id: null,
      lead_session_id: null,
      event_type: "test.ping",
      event_id: event.id,
      payload: event as unknown as Json,
      status: sent ? "sent" : "failed",
      attempts: 1,
      response_status: outcome.httpStatus,
      response_summary: outcome.summary.slice(0, 500),
      last_error: sent ? null : outcome.summary.slice(0, 500),
      sent_at: sent ? nowIso : null,
      settled_at: nowIso
    });
    if (error) console.error("[webhooks] test log failed", error.code ?? "unknown");
    await recordConnectionCheck(
      row.id,
      sent,
      sent ? WEBHOOK_COPY.testDelivered(outcome.httpStatus ?? 200) : WEBHOOK_COPY.testFailed(outcome.summary)
    );
  } catch (error) {
    failTo(detailPath(id), safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(detailPath(id));
  redirect(`${withParam(detailPath(id), "test", deliveryId)}#webhook`);
}

// Delivery log (P3.6).

/** "Send again" for a failed row of this tenant; delivered right after the response. */
export async function retryDeliveryAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const connectionId = String(formData.get("connection_id") ?? "");
  const deliveryId = String(formData.get("delivery_id") ?? "");
  const logPath = `${detailPath(connectionId)}/deliveries`;
  try {
    if (!isUuid(connectionId) || !isUuid(deliveryId)) throw new Error(CONNECTIONS_COPY.notFound);
    const owned =
      (await getConnectionRowForTenant(tenantId, connectionId)) ?? (await getGhlConnectionForTenant(connectionId, tenantId));
    if (!owned) throw new Error(CONNECTIONS_COPY.notFound);
    const supabase = createServiceClient();
    const { data: delivery, error: lookupError } = await supabase
      .from("crm_event_deliveries")
      .select("id")
      .eq("id", deliveryId)
      .eq("tenant_id", tenantId)
      .or(`connection_id.eq.${connectionId},ghl_connection_id.eq.${connectionId}`)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!delivery) throw new Error(CONNECTIONS_COPY.notFound);
    const { data: retried, error } = await supabase.rpc("retry_crm_delivery", { p_id: deliveryId, p_tenant_id: tenantId });
    if (error) throw new Error(error.message);
    if (retried !== true) throw new Error(DELIVERIES_COPY.resendFailed);
    after(() => drainCrmDeliveriesByIds([deliveryId]));
  } catch (error) {
    const message =
      error instanceof Error && error.message === DELIVERIES_COPY.resendFailed ? error.message : safeMessage(error, GENERIC_ERROR);
    failTo(logPath, message);
  }
  revalidatePath(logPath);
  redirect(withParam(logPath, "saved", "resent"));
}
