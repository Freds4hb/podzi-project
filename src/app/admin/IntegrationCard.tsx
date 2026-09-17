/**
 * Admin dashboard — a single integration's status card.
 *
 * Presentational only: it receives a health object and renders a status badge,
 * message, non-secret config, and per-service actions (re-check / re-auth).
 * Secrets are NEVER shown — the health object is built server-side and only
 * carries non-sensitive fields.
 */
"use client";

import { useState } from "react";
import type { IntegrationHealth } from "@/lib/integrations/types";

const STATUS_STYLE: Record<
  IntegrationHealth["status"],
  { label: string; bg: string; fg: string }
> = {
  connected: { label: "Connected", bg: "#e6f5ec", fg: "var(--ok)" },
  error: { label: "Error", bg: "#fce9e7", fg: "var(--err)" },
  not_configured: { label: "Not set up", bg: "#f2f4f7", fg: "var(--muted)" },
};

export function IntegrationCard({
  health,
  label,
  description,
}: {
  health: IntegrationHealth;
  label: string;
  description: string;
}) {
  const [current, setCurrent] = useState(health);
  const [checking, setChecking] = useState(false);
  const badge = STATUS_STYLE[current.status];

  /** Re-run this service's health check via the status API. */
  async function recheck() {
    setChecking(true);
    try {
      const res = await fetch(
        `/api/integrations/status?service=${current.service}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { health?: IntegrationHealth };
      if (data.health) setCurrent(data.health);
    } catch {
      // Leave the previous state in place on a transient fetch failure.
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>{label}</h3>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {description}
          </p>
        </div>
        <span
          style={{
            alignSelf: "flex-start",
            background: badge.bg,
            color: badge.fg,
            fontWeight: 700,
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {badge.label}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 14 }}>{current.message}</p>

      {current.error ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--err)" }}>
          {current.error}
        </p>
      ) : null}

      {current.config && Object.keys(current.config).length > 0 ? (
        <dl
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "2px 12px",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          {Object.entries(current.config).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt style={{ fontWeight: 700 }}>{k}</dt>
              <dd style={{ margin: 0 }}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={recheck}
          disabled={checking}
          style={{
            border: "1px solid var(--border)",
            background: "#fff",
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: checking ? "default" : "pointer",
          }}
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
        {/*
          Re-authentication is service-specific. For key-based services (Clerk,
          Stripe, Neon, n8n, Vercel) "re-auth" means rotating the credential in
          the environment/secret store, so we link to setup docs rather than
          run an OAuth flow. When a service later uses OAuth, this becomes a
          real "Reconnect" button.
        */}
        <a
          href="#setup"
          style={{
            border: "1px solid var(--border)",
            background: "#fff",
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Re-auth / configure
        </a>
      </div>
    </div>
  );
}
