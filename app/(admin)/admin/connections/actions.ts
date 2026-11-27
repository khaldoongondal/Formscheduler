"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import { CALCOM_COPY, CALCOM_KEY_PATTERN } from "@/lib/calcom/constants";
import { getMe } from "@/lib/calcom/client";
import { checkCalcomConnection } from "@/lib/connections/calcom";
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
  ...(Object.values(CALCOM_COPY) as unknown[]).filter((value): value is string => typeof value === "string")
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
    else throw new Error(CONNECTIONS_COPY.notFound);
    await recordConnectionCheck(row.id, result.ok, result.summary);
    if (result.ok && row.status === "needs_attention") {
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    failTo(detailPath(id), message.startsWith("Turn off or move these forms first:") ? message : safeMessage(error, GENERIC_ERROR));
  }
  revalidatePath(CONNECTIONS_PATH);
  redirect(withParam(CONNECTIONS_PATH, "saved", "connection-deleted"));
}
