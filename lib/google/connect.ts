/**
 * Saves a Google Calendar connection after sign-in (P2.5). One row per
 * tenant and Google account (the id token `sub`). Tokens are stored encrypted.
 */
import { DEFAULT_AVAILABILITY } from "@/lib/google/availability";
import type { ParsedTokens } from "@/lib/google/oauth-core";
import { encryptSecret } from "@/lib/security/encryption";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

export class MissingRefreshTokenError extends Error {
  constructor() {
    super("google_no_refresh_token");
    this.name = "MissingRefreshTokenError";
  }
}

export async function saveGoogleConnection(input: {
  tenantId: string;
  sub: string;
  email: string | null;
  tokens: ParsedTokens;
}): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const findExisting = async () => {
    const { data, error } = await supabase
      .from("connections")
      .select("id,availability,settings,refresh_token_ciphertext")
      .eq("tenant_id", input.tenantId)
      .eq("provider", "google_calendar")
      .eq("external_account_id", input.sub)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; availability: Json | null; settings: Json; refresh_token_ciphertext: string | null } | null;
  };

  const tokenFields = {
    secret_ciphertext: encryptSecret(input.tokens.accessToken),
    token_expires_at: new Date(input.tokens.expiresAt).toISOString(),
    account_label: input.email,
    status: "connected" as const,
    status_message: null,
    ...(input.tokens.refreshToken
      ? {
          refresh_token_ciphertext: encryptSecret(input.tokens.refreshToken)
        }
      : {})
  };

  const update = async (existing: NonNullable<Awaited<ReturnType<typeof findExisting>>>) => {
    if (!existing.refresh_token_ciphertext && !input.tokens.refreshToken) throw new MissingRefreshTokenError();
    const settings =
      existing.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
        ? (existing.settings as Record<string, Json>)
        : {};
    const { error } = await supabase
      .from("connections")
      .update({
        ...tokenFields,
        settings: { ...settings, calendar_id: "primary" },
        ...(existing.availability ? {} : { availability: DEFAULT_AVAILABILITY as unknown as Json })
      })
      .eq("id", existing.id)
      .eq("tenant_id", input.tenantId);
    if (error) throw new Error(error.message);
    return { id: existing.id };
  };

  const existing = await findExisting();
  if (existing) return update(existing);

  if (!input.tokens.refreshToken) throw new MissingRefreshTokenError();
  const { data, error } = await supabase
    .from("connections")
    .insert({
      tenant_id: input.tenantId,
      provider: "google_calendar",
      name: `Google Calendar (${input.email ?? "Google account"})`.slice(0, 120),
      external_account_id: input.sub,
      ...tokenFields,
      settings: { calendar_id: "primary" },
      availability: DEFAULT_AVAILABILITY as unknown as Json
    })
    .select("id")
    .single();
  if (error) {
    // Two callbacks at once: the other one inserted the row first.
    if (error.code === "23505") {
      const raced = await findExisting();
      if (raced) return update(raced);
    }
    throw new Error(error.message);
  }
  return { id: data.id as string };
}
