/**
 * Admin integrations dashboard.
 *
 * Server Component: it runs all integration health checks on the server (so no
 * secret ever reaches the browser) and renders a status card per service —
 * Vercel, Clerk, Neon, n8n, Stripe. Each card shows status, a message,
 * non-secret config, and actions to re-check or re-configure.
 *
 * Access control: the Clerk middleware protects `/admin` once Clerk is
 * configured. Until then (scaffold/local without keys), the page is open so it
 * can be developed. A `TODO(auth)` marks where an `isAdmin` check is enforced.
 */
import { checkAllIntegrations } from "@/lib/integrations/registry";
import { integrationAdapters } from "@/lib/integrations/registry";
import { IntegrationCard } from "./IntegrationCard";

// Always render fresh — integration status must never be cached.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // TODO(auth): once Clerk is wired, verify the current user has users.isAdmin
  // and 403 otherwise. The middleware already requires *authentication*; this
  // is the *authorization* (admin-only) layer.

  const healths = await checkAllIntegrations();
  const byService = new Map(healths.map((h) => [h.service, h]));

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "56px 24px" }}>
      <p
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "var(--brand)",
        }}
      >
        Admin
      </p>
      <h1 style={{ fontSize: 34, margin: "10px 0 4px" }}>
        Integration connections
      </h1>
      <p style={{ color: "var(--muted)", margin: 0, fontSize: 15 }}>
        Authenticate, monitor, and re-configure the services that power the
        platform. Status is checked live on each load.
      </p>

      <section
        style={{
          marginTop: 32,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 18,
        }}
      >
        {integrationAdapters.map((adapter) => {
          const h = byService.get(adapter.service);
          if (!h) return null;
          return (
            <IntegrationCard
              key={adapter.service}
              health={h}
              label={adapter.label}
              description={adapter.description}
            />
          );
        })}
      </section>

      <section id="setup" style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>Configure a service</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          Credentials live in environment variables (local: <code>.env.local</code>
          , production: Vercel project settings), never in the database or the
          browser. To (re-)authenticate a service, set or rotate its keys — see{" "}
          <code>.env.example</code> and <code>docs/INTEGRATIONS.md</code> — then
          use <strong>Re-check</strong> on its card to confirm the new
          connection.
        </p>
      </section>
    </main>
  );
}
