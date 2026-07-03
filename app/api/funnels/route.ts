import { NextRequest } from "next/server";
import { requireAdminApiUser } from "@/lib/auth/api";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { fail, ok } from "@/lib/api/responses";
import { createFunnel, listFunnels } from "@/lib/funnels/service";

export async function GET() {
  try {
      await requireAdminApiUser();
    const tenantId = await getAdminTenantId();
    return ok({ funnels: await listFunnels(tenantId) });
  } catch (error) {
    return fail(error, error instanceof Error && error.message === "Unauthorized" ? 401 : 400);
  }
}

export async function POST(request: NextRequest) {
  try {
      await requireAdminApiUser(["owner", "admin"]);
    const tenantId = await getAdminTenantId();
    const body = (await request.json()) as Record<string, unknown>;
    const funnel = await createFunnel({ ...body, tenant_id: tenantId });
    return ok({ funnel }, 201);
  } catch (error) {
    return fail(error, error instanceof Error && error.message === "Unauthorized" ? 401 : 400);
  }
}
