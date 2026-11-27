import { isUuid } from "@/lib/meta/pixels";
import { createServiceClient } from "@/lib/supabase/server";

/** Fail-soft read of the demo seed marker on a form or split test (null before migration 0028). */
export async function getDemoSeedBatch(
  tenantId: string,
  table: "funnels" | "split_tests",
  id: string
): Promise<string | null> {
  if (!isUuid(id)) return null;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from(table)
      .select("demo_seed_batch")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    const value = (data as { demo_seed_batch?: string | null } | null)?.demo_seed_batch;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}
