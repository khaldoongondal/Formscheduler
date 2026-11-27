import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/api/cron-auth";
import { drainCrmDeliveries } from "@/lib/crm/drain";
import { drainLifecycleDeliveries } from "@/lib/lifecycle/drain";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lifecycle drain budget. shouldStopClaiming keeps 14 s in reserve, so this leaves about 6 s to start sends. */
const LIFECYCLE_BUDGET_MS = 20000;

/** Account lifecycle events to the owner's CRM. Never fails the CRM response. */
async function runLifecycle() {
  try {
    const supabase = createServiceClient();
    const { data: housekeeping, error } = await supabase.rpc("lifecycle_housekeeping");
    if (error) throw new Error(`lifecycle_housekeeping: ${error.code ?? "error"}`);
    const drain = await drainLifecycleDeliveries(randomUUID(), { budgetMs: LIFECYCLE_BUDGET_MS, limit: 100 });
    return { housekeeping, drain };
  } catch (error) {
    console.error("[lifecycle] cron drain failed", error instanceof Error ? error.message.slice(0, 200) : "unknown error");
    return { error: "Lifecycle drain failed" };
  }
}

/**
 * CRM event queue: housekeeping, then a drain within the time budget, then the
 * account lifecycle queue. Vercel cron calls it with
 * `Authorization: Bearer $CRON_SECRET`. Responds with counts only.
 */
export async function GET(request: Request): Promise<Response> {
  if (
    !isCronAuthorized(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
      process.env.NODE_ENV === "production"
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { data: housekeeping, error } = await supabase.rpc("crm_housekeeping");
    if (error) throw new Error(`crm_housekeeping: ${error.message}`);
    const drain = await drainCrmDeliveries(randomUUID(), { budgetMs: 30000, limit: 200 });
    const lifecycle = await runLifecycle();
    return NextResponse.json({ housekeeping, drain, lifecycle });
  } catch (error) {
    console.error("[crm] cron drain failed", error instanceof Error ? error.message.slice(0, 200) : "unknown error");
    const lifecycle = await runLifecycle();
    return NextResponse.json({ error: "Drain failed", lifecycle }, { status: 500 });
  }
}
