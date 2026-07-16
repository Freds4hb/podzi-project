/**
 * Landing page (scaffold placeholder).
 *
 * The production marketing site (the existing Podzi.ai UI kit) will be merged in
 * here later. For now this is a minimal signpost with a link to the admin
 * integrations dashboard so the scaffold is navigable.
 */
export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "80px 24px",
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "var(--brand)",
        }}
      >
        Podzi.ai Platform
      </p>
      <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: "12px 0 0" }}>
        Every podcast, one seamless listen.
      </h1>
      <p style={{ fontSize: 18, color: "var(--muted)", lineHeight: 1.6 }}>
        Application scaffold: Next.js on Vercel, Neon Postgres, Clerk auth, Stripe
        billing, and a direct-code podcast concatenation engine. Integrations are
        managed from the admin dashboard.
      </p>
      <p style={{ marginTop: 28 }}>
        <a
          href="/admin"
          style={{
            display: "inline-block",
            background: "var(--brand)",
            color: "#fff",
            padding: "12px 22px",
            borderRadius: 999,
            fontWeight: 700,
          }}
        >
          Open admin dashboard →
        </a>
      </p>
    </main>
  );
}
