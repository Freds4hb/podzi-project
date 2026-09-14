/**
 * Podcast Index integration adapter — surfaces directory-search health in /admin.
 *
 * Unlike the other adapters, this service is *optional by design*: identification
 * still works without it, because a user can add a show by pasting its feed URL
 * (see src/lib/podcasts/rss.ts). So "not configured" here means "search is
 * unavailable", not "the app is broken" — the card's message says so.
 *
 * Health probe is a cheap search for a term certain to match ("podcast"), which
 * simultaneously validates the key, the secret, and the per-request signature.
 */
import { env } from "@/lib/env";
import { podcastIndexDirectory } from "@/lib/podcasts/podcastindex";
import { health, type IntegrationAdapter } from "./types";

export const podcastIndexAdapter: IntegrationAdapter = {
  service: "podcastindex",
  label: "Podcast Index",
  description: "Podcast directory search (identification). Optional.",

  isConfigured() {
    return podcastIndexDirectory.isConfigured();
  },

  async healthCheck() {
    if (!this.isConfigured()) {
      return health(
        "podcastindex",
        "not_configured",
        "PODCAST_INDEX_API_KEY / _SECRET not set — search is off, feed-URL ingest still works.",
      );
    }
    try {
      const results = await podcastIndexDirectory.search("podcast", 1);
      return health(
        "podcastindex",
        "connected",
        `Directory search reachable (${results.length} result for probe query).`,
        { config: { keyId: `${env.PODCAST_INDEX_API_KEY.slice(0, 4)}…` } },
      );
    } catch (err) {
      return health("podcastindex", "error", "Directory search failed.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
