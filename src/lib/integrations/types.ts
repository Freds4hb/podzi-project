/**
 * Shared contract for every integration adapter (Vercel, Clerk, Neon, n8n,
 * Stripe). The admin dashboard and status API treat all services uniformly
 * through this interface, so adding a new service is just adding one adapter
 * that implements `IntegrationAdapter`.
 */

/** Coarse health of a connection, shown as a badge in the admin UI. */
export type ConnectionStatus = "connected" | "error" | "not_configured";

export interface IntegrationHealth {
  service: IntegrationServiceName;
  status: ConnectionStatus;
  /** Human-readable one-liner for the admin card (e.g. "3 workflows active"). */
  message: string;
  /** Non-secret config echoed back for display (instance URL, project id...). */
  config?: Record<string, string>;
  /** Populated when status === "error". Never contains secrets. */
  error?: string;
  checkedAt: string; // ISO timestamp
}

export type IntegrationServiceName =
  | "vercel"
  | "clerk"
  | "neon"
  | "n8n"
  | "stripe";

export interface IntegrationAdapter {
  service: IntegrationServiceName;
  /** Display name for the admin card. */
  label: string;
  /** One-line description of what this service does in the platform. */
  description: string;
  /** True when the minimum credentials/config are present in the environment. */
  isConfigured(): boolean;
  /**
   * Actively probe the service (a cheap, read-only call). Must never throw —
   * always resolve to an IntegrationHealth, catching and reporting errors so the
   * admin dashboard degrades gracefully when one service is down.
   */
  healthCheck(): Promise<IntegrationHealth>;
}

/** Small helper so adapters build a consistent, timestamped health object. */
export function health(
  service: IntegrationServiceName,
  status: ConnectionStatus,
  message: string,
  extra?: { config?: Record<string, string>; error?: string },
): IntegrationHealth {
  return {
    service,
    status,
    message,
    config: extra?.config,
    error: extra?.error,
    checkedAt: new Date().toISOString(),
  };
}
