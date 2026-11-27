import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/api/cron-auth";
import { drainMetaDeliveries } from "@/lib/meta/drain";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Meta event queue: housekeeping, then a drain within the time budget.
 * Vercel cron calls it with `Authorization: Bearer $CRON_SECRET`.
 * Responds with counts only.
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
    const { data: housekeeping, error } = await supabase.rpc("meta_housekeeping");
    if (error) throw new Error(`meta_housekeeping: ${error.message}`);
    const drain = await drainMetaDeliveries(randomUUID(), { budgetMs: 45000 });
    return NextResponse.json({ housekeeping, drain });
  } catch (error) {
    console.error("[meta] cron drain failed", error instanceof Error ? error.message.slice(0, 200) : "unknown error");
    return NextResponse.json({ error: "Drain failed" }, { status: 500 });
  }
}
