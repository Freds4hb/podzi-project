/**
 * GET /api/integrations/status[?service=<name>] — integration health.
 *
 * With no query param: returns health for ALL services.
 * With `?service=stripe` (etc.): returns just that service's health, used by the
 * admin card's "Re-check" button.
 *
 * All checks run server-side; the response contains only non-secret fields.
 *
 * Access control: listed in `isProtectedRoute` in `src/middleware.ts`, so Clerk
 * gates it once configured and a credential-free production build closes it
 * outright. The payload is non-secret but it does describe the infrastructure
 * (database host, Clerk mode, n8n URL), which is not anonymous-caller material.
 * A `TODO(auth)` marks where admin-*role* authorization goes once Clerk is
 * wired — being signed in is not the same as being an admin.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  checkAllIntegrations,
  integrationAdapters,
} from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // TODO(auth): require an authenticated admin user before returning status.

  const service = req.nextUrl.searchParams.get("service");

  if (service) {
    const adapter = integrationAdapters.find((a) => a.service === service);
    if (!adapter) {
      return NextResponse.json(
        { error: `Unknown service "${service}".` },
        { status: 400 },
      );
    }
    const health = await adapter.healthCheck();
    return NextResponse.json({ health });
  }

  const healths = await checkAllIntegrations();
  return NextResponse.json({ healths });
}
