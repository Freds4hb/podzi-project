/**
 * n8n workflow-automation integration adapter.
 *
 * Per the cost analysis, n8n is intentionally kept OUT of the high-volume audio
 * concatenation hot path (it would add per-execution overhead without reducing
 * the dominant transcription/egress costs). It is retained for LOW-volume ops
 * automation only — admin alerts, billing follow-ups, digest emails.
 *
 * Health check hits the n8n REST API (`GET /api/v1/workflows?limit=1`) using an
 * API key. A 200 confirms the instance is reachable and the key is valid.
 */
import { env } from "@/lib/env";
import { health, type IntegrationAdapter } from "./types";

export const n8nAdapter: IntegrationAdapter = {
  service: "n8n",
  label: "n8n",
  description: "Low-volume ops automation (alerts, billing follow-ups).",

  isConfigured() {
    return Boolean(env.N8N_BASE_URL && env.N8N_API_KEY);
  },

  async healthCheck() {
    if (!this.isConfigured()) {
      return health(
        "n8n",
        "not_configured",
        "N8N_BASE_URL and/or N8N_API_KEY are not set.",
      );
    }
    try {
      const base = env.N8N_BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/v1/workflows?limit=1`, {
        headers: { "X-N8N-API-KEY": env.N8N_API_KEY },
        cache: "no-store",
      });
      if (!res.ok) {
        return health("n8n", "error", `n8n API returned ${res.status}.`, {
          error: `HTTP ${res.status}`,
        });
      }
      return health("n8n", "connected", "n8n instance reachable.", {
        config: { instance: base },
      });
    } catch (err) {
      return health("n8n", "error", "Could not reach the n8n instance.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
