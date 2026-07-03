import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/responses";
import { provisionTenant } from "@/lib/provisioning/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const provisionSchema = z.object({
  email: z.string().email(),
  tenant_name: z.string().min(1).max(120).optional(),
  plan: z.enum(["tier1", "tier2", "tier3"]).optional()
});

function isAuthorized(request: NextRequest) {
  const secret = process.env.LEADDER_PROVISION_SECRET;
  const provided = request.headers.get("x-provision-secret");
  if (!secret || !provided) return false;

  const secretHash = createHash("sha256").update(secret).digest();
  const providedHash = createHash("sha256").update(provided).digest();
  return timingSafeEqual(secretHash, providedHash);
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "provision", 10);
  if (limited) return limited;

  if (!isAuthorized(request)) {
    return fail(new Error("Unauthorized"), 401);
  }

  try {
    const parsed = provisionSchema.parse(await request.json());
    const result = await provisionTenant(parsed);
    return ok(result, result.tenant_created ? 201 : 200);
  } catch (error) {
    return fail(error);
  }
}
