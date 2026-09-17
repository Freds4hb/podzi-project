/**
 * Neon Postgres integration adapter.
 *
 * Health check runs a trivial `SELECT 1` through the serverless driver. This
 * verifies both that DATABASE_URL is valid and that the database is reachable,
 * without depending on any application table existing yet.
 */
import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/env";
import { health, type IntegrationAdapter } from "./types";

export const neonAdapter: IntegrationAdapter = {
  service: "neon",
  label: "Neon Postgres",
  description: "Primary application database (users, subscriptions, podcasts).",

  isConfigured() {
    return Boolean(env.DATABASE_URL);
  },

  async healthCheck() {
    if (!this.isConfigured()) {
      return health("neon", "not_configured", "DATABASE_URL is not set.");
    }
    try {
      const sql = neon(env.DATABASE_URL);
      await sql`SELECT 1`;
      // Show the host (not credentials) so admins can confirm the right project.
      const host = safeHost(env.DATABASE_URL);
      return health("neon", "connected", "Database reachable.", {
        config: host ? { host } : undefined,
      });
    } catch (err) {
      return health("neon", "error", "Could not reach the database.", {
        error: toMessage(err),
      });
    }
  },
};

/** Extract just the hostname from a connection string, never the password. */
function safeHost(connectionString: string): string | null {
  try {
    return new URL(connectionString).host;
  } catch {
    return null;
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
