import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, failPublic, ok } from "@/lib/api/responses";
import { ACCOUNT_REF_PATTERN } from "@/lib/billing/account-ref";
import { parsePlanState } from "@/lib/billing/plans";
import { provisionByAccountRef, provisionTenant } from "@/lib/provisioning/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const provisionSchema = z
  .object({
    email: z.string().email().optional(),
    // Opaque account reference from the upgrade link. When sent, it wins and email is ignored.
    account_ref: z.string().trim().toLowerCase().regex(ACCOUNT_REF_PATTERN, "account_ref is not valid.").optional(),
    tenant_name: z.string().min(1).max(120).optional(),
    // Legacy tier1/tier2/tier3 from older GoHighLevel workflows map to "scaling".
    plan: z
      .enum(["free", "scaling", "suspended", "tier1", "tier2", "tier3"])
      .optional()
      .transform((p) => (p === undefined ? undefined : parsePlanState(p)))
  })
  .refine((value) => Boolean(value.email || value.account_ref), {
    message: "Send email or account_ref.",
    path: ["email"]
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
  const limited = await enforceRateLimit(request, "provision");
  if (limited) return limited;

  if (!isAuthorized(request)) {
    return fail(new Error("Unauthorized"), 401);
  }

  try {
    const parsed = provisionSchema.parse(await request.json());
    if (parsed.account_ref) {
      const result = await provisionByAccountRef({ account_ref: parsed.account_ref, plan: parsed.plan });
      return ok(result, 200);
    }
    // The refine above guarantees an email here.
    const result = await provisionTenant({ email: parsed.email as string, tenant_name: parsed.tenant_name, plan: parsed.plan });
    return ok(result, result.tenant_created ? 201 : 200);
  } catch (error) {
    return failPublic(error);
  }
}
