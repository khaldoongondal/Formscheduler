import { unstable_noStore as noStore } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshOauthTokens, type GhlOauthTokens } from "@/lib/ghl/oauth";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/security/encryption";
import type { GhlConnection } from "@/lib/types/database";
import { ghlConnectionSchema, updateGhlConnectionSchema } from "@/lib/validation/funnels";

function lastFour(value: string) {
  return value.length >= 4 ? value.slice(-4) : value;
}

function normalizeToken(value: string | undefined) {
  const token = value?.trim();
  return token && token.length > 0 ? token : undefined;
}

export async function listGhlConnections(tenantId: string) {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getGhlConnection(id: string) {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("ghl_connections").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function createGhlConnection(input: unknown) {
  const parsed = ghlConnectionSchema.parse(input);
  const token = normalizeToken(parsed.private_token);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_connections")
    .insert({
      tenant_id: parsed.tenant_id,
      name: parsed.name,
      location_id: parsed.location_id,
      calendar_id: parsed.calendar_id || null,
      private_token_ciphertext: token ? encryptSecret(token) : null,
      token_last_four: token ? lastFour(token) : null,
      api_base_url: parsed.api_base_url,
      api_version: parsed.api_version,
      is_active: parsed.is_active
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateGhlConnection(input: unknown) {
  const parsed = updateGhlConnectionSchema.parse(input);
  const token = normalizeToken(parsed.private_token);
  const supabase = createServiceClient();
  const { id } = parsed;
  const { data, error } = await supabase
    .from("ghl_connections")
    .update({
      tenant_id: parsed.tenant_id,
        name: parsed.name,
        location_id: parsed.location_id,
        calendar_id: parsed.calendar_id || null,
        api_base_url: parsed.api_base_url,
        api_version: parsed.api_version,
        is_active: parsed.is_active,
        ...(token
          ? {
              private_token_ciphertext: encryptSecret(token),
              token_last_four: lastFour(token)
            }
          : {})
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteGhlConnection(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("ghl_connections").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function toGhlRuntimeConfig(connection: GhlConnection) {
  if (!connection.private_token_ciphertext) {
    throw new Error(`GHL connection "${connection.name}" is missing a private integration token.`);
  }
  if (!isEncryptedSecret(connection.private_token_ciphertext)) {
    throw new Error(`GHL connection "${connection.name}" token must be rotated before use.`);
  }

  return {
    token: decryptSecret(connection.private_token_ciphertext),
    locationId: connection.location_id,
    baseUrl: connection.api_base_url,
    apiVersion: connection.api_version
  };
}

const TOKEN_REFRESH_LEEWAY_MS = 5 * 60 * 1000;

export async function upsertOauthGhlConnection(input: {
  tenantId: string;
  name: string;
  tokens: GhlOauthTokens;
}) {
  const supabase = createServiceClient();
  const record = {
    tenant_id: input.tenantId,
    name: input.name,
    location_id: input.tokens.locationId,
    company_id: input.tokens.companyId,
    auth_type: "oauth" as const,
    access_token_ciphertext: encryptSecret(input.tokens.accessToken),
    refresh_token_ciphertext: encryptSecret(input.tokens.refreshToken),
    token_expires_at: input.tokens.expiresAt.toISOString(),
    api_base_url: "https://services.leadconnectorhq.com",
    api_version: "2023-02-21",
    is_active: true
  };

  const { data, error } = await supabase
    .from("ghl_connections")
    .upsert(record, { onConflict: "tenant_id,location_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Refreshes an OAuth connection's tokens. GHL rotates refresh tokens on every
 * use, so two concurrent refreshes would invalidate each other. The update is
 * a compare-and-set on the previous refresh-token ciphertext: the loser of a
 * race detects zero updated rows, re-reads the row, and uses the winner's
 * fresh tokens instead of stomping them.
 */
async function refreshOauthConnection(connection: GhlConnection): Promise<GhlConnection> {
  const supabase = createServiceClient();
  const previousCiphertext = connection.refresh_token_ciphertext;
  if (!previousCiphertext) {
    throw new Error(`GHL connection "${connection.name}" is missing OAuth tokens. Reconnect it from the admin.`);
  }

  let tokens: GhlOauthTokens;
  try {
    tokens = await refreshOauthTokens(decryptSecret(previousCiphertext));
  } catch (error) {
    // Another process may have refreshed (rotating the token) between our read
    // and this request. If the stored token changed, use it; otherwise the
    // connection genuinely needs to be reauthorized.
    const current = await getGhlConnection(connection.id);
    if (
      current.refresh_token_ciphertext !== previousCiphertext &&
      current.token_expires_at &&
      new Date(current.token_expires_at).getTime() > Date.now()
    ) {
      return current;
    }
    throw error;
  }

  const { data, error } = await supabase
    .from("ghl_connections")
    .update({
      access_token_ciphertext: encryptSecret(tokens.accessToken),
      refresh_token_ciphertext: encryptSecret(tokens.refreshToken),
      token_expires_at: tokens.expiresAt.toISOString()
    })
    .eq("id", connection.id)
    .eq("refresh_token_ciphertext", previousCiphertext)
    .select("*");

  if (error) throw new Error(error.message);
  if (data && data.length > 0) return data[0];

  // Lost the compare-and-set race: someone else stored fresh tokens first.
  return getGhlConnection(connection.id);
}

export async function resolveGhlRuntimeConfig(connection: GhlConnection) {
  if (connection.auth_type !== "oauth") {
    return toGhlRuntimeConfig(connection);
  }

  let current = connection;
  const expiresAt = current.token_expires_at ? new Date(current.token_expires_at).getTime() : 0;
  if (expiresAt < Date.now() + TOKEN_REFRESH_LEEWAY_MS) {
    current = await refreshOauthConnection(current);
  }

  if (!current.access_token_ciphertext) {
    throw new Error(`GHL connection "${current.name}" is missing OAuth tokens. Reconnect it from the admin.`);
  }

  return {
    token: decryptSecret(current.access_token_ciphertext),
    locationId: current.location_id,
    baseUrl: current.api_base_url,
    apiVersion: current.api_version
  };
}
