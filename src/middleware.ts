/**
 * Next.js middleware — Clerk auth gate.
 *
 * Scaffold behavior: if Clerk is not yet configured (no publishable key), the
 * middleware is a NO-OP pass-through so the app runs locally without keys. Once
 * the Clerk keys are present in the environment, it activates and protects the
 * admin area (and any other non-public routes we add to `isProtectedRoute`).
 */
import {
  clerkMiddleware,
  createRouteMatcher,
} from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

/** Routes that require an authenticated user. Extend as the app grows. */
const isProtectedRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const activeMiddleware = clerkMiddleware(async (auth, req) => {
  // Protect selected routes; public routes fall through untouched.
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

/**
 * Export either the real Clerk middleware or a pass-through, decided once at
 * module load from the environment.
 */
export default function middleware(req: NextRequest, event: any) {
  if (!clerkConfigured) return NextResponse.next();
  return activeMiddleware(req, event);
}

export const config = {
  // Standard Clerk matcher: run on all routes except static assets and _next.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|png|gif|svg|ico|webp|woff2?)).*)",
    "/(api|trpc)(.*)",
  ],
};
