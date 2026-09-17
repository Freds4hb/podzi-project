/**
 * Clerk authentication integration adapter.
 *
 * Health check calls Clerk's Backend API (`GET /v1/users?limit=1`) with the
 * secret key. A 200 confirms the key is valid and Clerk is reachable. We only
 * report the count-shaped result, never user data.
 */
import { env } from "@/lib/env";
import { health, type IntegrationAdapter } from "./types";

const CLERK_API = "https://api.clerk.com/v1";

export const clerkAdapter: IntegrationAdapter = {
  service: "clerk",
  label: "Clerk",
  description: "Authentication and user management (web + mobile).",

  isConfigured() {
    return Boolean(
      env.CLERK_SECRET_KEY && env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    );
  },

  async healthCheck() {
    if (!this.isConfigured()) {
      return health(
        "clerk",
        "not_configured",
        "Clerk keys are not set (publishable + secret required).",
      );
    }
    try {
      const res = await fetch(`${CLERK_API}/users?limit=1`, {
        headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        // Never cache admin health probes.
        cache: "no-store",
      });
      if (!res.ok) {
        return health("clerk", "error", `Clerk API returned ${res.status}.`, {
          error: `HTTP ${res.status}`,
        });
      }
      // Report the environment (test/live) inferred from the key prefix.
      const mode = env.CLERK_SECRET_KEY.startsWith("sk_live") ? "live" : "test";
      return health("clerk", "connected", "Clerk API reachable.", {
        config: { mode },
      });
    } catch (err) {
      return health("clerk", "error", "Could not reach Clerk.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
