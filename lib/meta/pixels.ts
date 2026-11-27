import { unstable_noStore as noStore } from "next/cache";
import { getTenantPlanState, planLimitMessageForTenant } from "@/lib/billing/plan-service";
import { checkPixelLimit } from "@/lib/billing/plans";
import type { PixelSwitches } from "@/lib/meta/events";
import type { SendingMode } from "@/lib/meta/gating";
import {
  PIXEL_MESSAGES,
  firstZodMessage,
  pixelCreateSchema,
  pixelUpdateSchema,
  tokenLastFour
} from "@/lib/meta/pixel-input";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { createServiceClient } from "@/lib/supabase/server";
import type { MetaPixel } from "@/lib/types/database";

/**
 * Meta pixels of a tenant. Every function takes the tenant id and filters by
 * it. The encrypted token is read only by loadPixelSendConfig, for sending.
 */

export type PixelSummary = Omit<MetaPixel, "access_token_ciphertext">;

export const PIXEL_SUMMARY_COLUMNS =
  "id,tenant_id,name,dataset_id,token_last_four,test_event_code,sending_mode,send_form_view,send_form_start,send_lead,send_qualified_lead,send_disqualified_lead,send_booked_call,last_test_at,last_test_ok,last_test_summary,created_at,updated_at";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UserFacingError extends Error {}

/** Thrown when a stored token cannot be decrypted (key changed or data damaged). */
export class TokenUnreadableError extends Error {
  constructor() {
    super("The saved access token could not be read. Paste the token again.");
    this.name = "TokenUnreadableError";
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

async function run<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UserFacingError) throw new Error(error.message);
    const zodMessage = firstZodMessage(error);
    if (zodMessage) throw new Error(zodMessage);
    const message = error instanceof Error ? error.message : String(error ?? "");
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505" || /meta_pixels_tenant_id_dataset_id_key|duplicate key/.test(message)) {
      throw new Error(PIXEL_MESSAGES.duplicate);
    }
    const limitMessage = await planLimitMessageForTenant(message, tenantId);
    if (limitMessage) throw new Error(limitMessage);
    console.error("[meta] pixel action failed", message);
    throw new Error(GENERIC_MESSAGE);
  }
}

/** Supabase errors carry `code`; keep it when rethrowing. */
function dbError(error: { message: string; code?: string }) {
  const wrapped = new Error(error.message) as Error & { code?: string };
  wrapped.code = error.code;
  return wrapped;
}

export async function listPixels(tenantId: string): Promise<PixelSummary[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("meta_pixels")
    .select(PIXEL_SUMMARY_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PixelSummary[];
}

export async function getPixel(tenantId: string, pixelId: string): Promise<PixelSummary | null> {
  noStore();
  if (!isUuid(pixelId)) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("meta_pixels")
    .select(PIXEL_SUMMARY_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", pixelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as PixelSummary | null) ?? null;
}

export async function getTenantPixelCount(tenantId: string): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("meta_pixels")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Forms of the tenant per pixel id (for the pixel list and settings page). */
export async function listFormsByPixel(
  tenantId: string
): Promise<Map<string, Array<{ id: string; name: string; isPublished: boolean }>>> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("id,name,is_published,meta_pixel_id")
    .eq("tenant_id", tenantId)
    .not("meta_pixel_id", "is", null)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  const byPixel = new Map<string, Array<{ id: string; name: string; isPublished: boolean }>>();
  for (const row of (data ?? []) as Array<{ id: string; name: string; is_published: boolean; meta_pixel_id: string | null }>) {
    if (!row.meta_pixel_id) continue;
    const list = byPixel.get(row.meta_pixel_id) ?? [];
    list.push({ id: row.id, name: row.name, isPublished: row.is_published });
    byPixel.set(row.meta_pixel_id, list);
  }
  return byPixel;
}

export async function createPixel(tenantId: string, input: unknown): Promise<string> {
  return run(tenantId, async () => {
    const parsed = pixelCreateSchema.parse(input);
    const [state, count] = await Promise.all([getTenantPlanState(tenantId), getTenantPixelCount(tenantId)]);
    const limit = checkPixelLimit(state, count);
    if (!limit.allowed) throw new UserFacingError(limit.message);

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("meta_pixels")
      .insert({
        tenant_id: tenantId,
        name: parsed.name,
        dataset_id: parsed.dataset_id,
        access_token_ciphertext: encryptSecret(parsed.access_token),
        token_last_four: tokenLastFour(parsed.access_token),
        test_event_code: parsed.test_event_code
      })
      .select("id")
      .single();
    if (error) throw dbError(error);
    return data.id as string;
  });
}

export async function updatePixel(tenantId: string, pixelId: string, input: unknown): Promise<void> {
  return run(tenantId, async () => {
    const existing = await getPixel(tenantId, pixelId);
    if (!existing) throw new UserFacingError(PIXEL_MESSAGES.notFound);
    const parsed = pixelUpdateSchema.parse(input);
    const update: Record<string, unknown> = {
      name: parsed.name,
      dataset_id: parsed.dataset_id,
      test_event_code: parsed.test_event_code
    };
    if (parsed.access_token) {
      update.access_token_ciphertext = encryptSecret(parsed.access_token);
      update.token_last_four = tokenLastFour(parsed.access_token);
    }
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("meta_pixels")
      .update(update)
      .eq("tenant_id", tenantId)
      .eq("id", pixelId);
    if (error) throw dbError(error);
  });
}

/** Forms using the pixel fall back to no pixel (on delete set null); its event log goes with it. */
export async function deletePixel(tenantId: string, pixelId: string): Promise<void> {
  return run(tenantId, async () => {
    const existing = await getPixel(tenantId, pixelId);
    if (!existing) throw new UserFacingError(PIXEL_MESSAGES.notFound);
    const supabase = createServiceClient();
    const { error } = await supabase.from("meta_pixels").delete().eq("tenant_id", tenantId).eq("id", pixelId);
    if (error) throw dbError(error);
  });
}

export type PixelSendConfig = {
  id: string;
  tenantId: string;
  datasetId: string;
  accessToken: string;
  testEventCode: string | null;
  sendingMode: SendingMode;
  switches: PixelSwitches;
};

/**
 * Server only: the decrypted config for sending. Null when the pixel no
 * longer exists; throws TokenUnreadableError when the token cannot be read.
 */
export async function loadPixelSendConfig(pixelId: string): Promise<PixelSendConfig | null> {
  if (!isUuid(pixelId)) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("meta_pixels")
    .select(
      "id,tenant_id,dataset_id,access_token_ciphertext,test_event_code,sending_mode,send_form_view,send_form_start,send_lead,send_qualified_lead,send_disqualified_lead,send_booked_call"
    )
    .eq("id", pixelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as MetaPixel;

  let accessToken: string;
  try {
    accessToken = decryptSecret(row.access_token_ciphertext);
  } catch {
    throw new TokenUnreadableError();
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    datasetId: row.dataset_id,
    accessToken,
    testEventCode: row.test_event_code,
    sendingMode: row.sending_mode === "hold" ? "hold" : "automatic",
    switches: {
      send_form_view: row.send_form_view,
      send_form_start: row.send_form_start,
      send_lead: row.send_lead,
      send_qualified_lead: row.send_qualified_lead,
      send_disqualified_lead: row.send_disqualified_lead,
      send_booked_call: row.send_booked_call
    }
  };
}
