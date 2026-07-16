/**
 * GET /api/health — liveness probe.
 *
 * Returns 200 with basic build/runtime info. Intentionally does NOT touch any
 * integration so it stays fast and dependency-free (useful for uptime checks
 * and Vercel deployment health).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "podzi-platform",
    time: new Date().toISOString(),
  });
}
