import { unstable_noStore as noStore } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
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
