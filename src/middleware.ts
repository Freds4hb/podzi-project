/**
 * Next.js middleware — Clerk auth gate.
 *
 * Clerk is optional so that a bare checkout runs with no credentials. That
 * convenience must not follow the app into production: a deployment made before
 * Clerk is provisioned would otherwise serve `/admin` to anyone who guessed the
 * path. So the pass-through is scoped to development, and a production build
 * with no Clerk keys *closes* the protected routes rather than opening them.
 *
 * | Clerk keys | NODE_ENV    | /admin and /api/admin              |
 * |------------|-------------|------------------------------------|
 * | present    | any         | Clerk decides — sign-in required    |
 * | absent     | development | open, for local convenience        |
 * | absent     | production  | closed: 503, nothing is served     |
 *
 * `ALLOW_UNAUTHENTICATED_ADMIN=1` overrides the last row. It exists so that
 * serving an unprotected admin area is always a deliberate, greppable act
 * instead of the accidental consequence of a missing variable.
 *
 * The 503 body is deliberately terse — an anonymous prober learns nothing about
 * why — while the full, actionable reason goes to the server log, which is where
 * the operator is looking. `docs/DEPLOYMENT.md` step 2 documents both halves.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

/**
 * Routes that require an authenticated user. Extend as the app grows.
 *
 * `/api/integrations/status` belongs here even though it is not under `/admin`:
 * it returns every integration's health, and those payloads carry the database
 * host, the Clerk live/test mode, the n8n instance URL and the Vercel project
 * id. No credentials, but it is a description of the infrastructure and it has
 * no business answering anonymous callers.
 */
const isProtectedRoute = createRouteMatcher([
  "/admin(.*)",
  "/api/admin(.*)",
  "/api/integrations/status",
]);

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const isProduction = process.env.NODE_ENV === "production";
const allowUnauthenticatedAdmin =
  process.env.ALLOW_UNAUTHENTICATED_ADMIN === "1";

const activeMiddleware = clerkMiddleware(async (auth, req) => {
  // Protect selected routes; public routes fall through untouched.
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

/**
 * Fail closed. Returned when a protected route is requested on a production
 * build that has no way to authenticate anyone.
 */
function authUnavailable(pathname: string): NextResponse {
  console.warn(
    `[middleware] Refused ${pathname}: no Clerk credentials in this ` +
      `deployment, so no request can be authenticated. Set ` +
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY (see ` +
      `docs/DEPLOYMENT.md step 2), or set ALLOW_UNAUTHENTICATED_ADMIN=1 to ` +
      `serve the admin area unprotected on purpose.`,
  );
  return new NextResponse("Service unavailable.\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!clerkConfigured) {
    if (isProduction && !allowUnauthenticatedAdmin && isProtectedRoute(req)) {
      return authUnavailable(req.nextUrl.pathname);
    }
    return NextResponse.next();
  }
  return activeMiddleware(req, event);
}

export const config = {
  // Standard Clerk matcher: run on all routes except static assets and _next.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|png|gif|svg|ico|webp|woff2?)).*)",
    "/(api|trpc)(.*)",
  ],
};
