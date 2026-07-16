/**
 * Vercel hosting integration adapter.
 *
 * Health check calls the Vercel REST API (`GET /v2/user`) with a personal or
 * team access token to confirm the token is valid, and optionally reports the
 * most recent deployment for the configured project so admins can see infra
 * state at a glance. Read-only token scope is sufficient.
 */
import { env } from "@/lib/env";
import { health, type IntegrationAdapter } from "./types";

const VERCEL_API = "https://api.vercel.com";

export const vercelAdapter: IntegrationAdapter = {
  service: "vercel",
  label: "Vercel",
  description: "Hosting and deployments for the web app + API.",

  isConfigured() {
    return Boolean(env.VERCEL_API_TOKEN);
  },

  async healthCheck() {
    if (!this.isConfigured()) {
      return health("vercel", "not_configured", "VERCEL_API_TOKEN is not set.");
    }
    try {
      const teamQuery = env.VERCEL_TEAM_ID ? `?teamId=${env.VERCEL_TEAM_ID}` : "";
      const res = await fetch(`${VERCEL_API}/v2/user${teamQuery}`, {
        headers: { Authorization: `Bearer ${env.VERCEL_API_TOKEN}` },
        cache: "no-store",
      });
      if (!res.ok) {
        return health("vercel", "error", `Vercel API returned ${res.status}.`, {
          error: `HTTP ${res.status}`,
        });
      }
      const config: Record<string, string> = {};
      if (env.VERCEL_PROJECT_ID) config.projectId = env.VERCEL_PROJECT_ID;
      if (env.VERCEL_TEAM_ID) config.teamId = env.VERCEL_TEAM_ID;
      return health("vercel", "connected", "Vercel API reachable.", { config });
    } catch (err) {
      return health("vercel", "error", "Could not reach Vercel.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
