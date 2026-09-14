/**
 * Central registry of all integration adapters.
 *
 * The admin dashboard and the status API iterate this list, so a new service
 * becomes visible everywhere just by adding its adapter here.
 */
import type { IntegrationAdapter, IntegrationHealth } from "./types";
import { vercelAdapter } from "./vercel";
import { clerkAdapter } from "./clerk";
import { neonAdapter } from "./neon";
import { n8nAdapter } from "./n8n";
import { stripeAdapter } from "./stripe";
import { podcastIndexAdapter } from "./podcastindex";

/** Order here is the display order in the admin dashboard. */
export const integrationAdapters: IntegrationAdapter[] = [
  vercelAdapter,
  clerkAdapter,
  neonAdapter,
  n8nAdapter,
  stripeAdapter,
  podcastIndexAdapter,
];

/**
 * Run every adapter's health check in parallel. Each adapter is contractually
 * required not to throw, but we still guard here so one misbehaving adapter
 * cannot break the whole dashboard.
 */
export async function checkAllIntegrations(): Promise<IntegrationHealth[]> {
  return Promise.all(
    integrationAdapters.map(async (adapter) => {
      try {
        return await adapter.healthCheck();
      } catch (err) {
        return {
          service: adapter.service,
          status: "error" as const,
          message: "Health check threw unexpectedly.",
          error: err instanceof Error ? err.message : String(err),
          checkedAt: new Date().toISOString(),
        };
      }
    }),
  );
}
