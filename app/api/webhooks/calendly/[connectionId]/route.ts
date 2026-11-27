import { NextRequest, NextResponse } from "next/server";
import { handleCalendlyWebhook } from "@/lib/bookings/calendly-confirm";
import { CALENDLY_WEBHOOK_MAX_BYTES } from "@/lib/calendly/constants";
import { CALENDLY_SIGNATURE_HEADER } from "@/lib/calendly/signature";
import { scheduleMetaDrain } from "@/lib/meta/hooks";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reads at most `max` bytes; null when the body is larger. */
async function readLimited(request: NextRequest, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Durable confirmation: Calendly's signed invitee.created and invitee.canceled notifications. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const limited = await enforceRateLimit(request, "calendly-webhook");
  if (limited) return limited;

  const raw = await readLimited(request, CALENDLY_WEBHOOK_MAX_BYTES);
  if (raw === null) return NextResponse.json({ error: "Too large" }, { status: 413 });

  const { connectionId } = await params;
  try {
    const result = await handleCalendlyWebhook(connectionId, raw, request.headers.get(CALENDLY_SIGNATURE_HEADER));
    if (result.status !== 200) {
      return NextResponse.json({ error: result.status === 404 ? "Not found" : "Unauthorized" }, { status: result.status });
    }
    scheduleMetaDrain(result.metaEvents);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
