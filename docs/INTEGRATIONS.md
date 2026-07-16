# Integrations

Every third-party service is wired as an **adapter** implementing a common
contract (`src/lib/integrations/types.ts`): `isConfigured()` and a read-only
`healthCheck()`. The admin dashboard (`/admin`) and the status API
(`/api/integrations/status`) iterate the adapter registry, so adding a service is
just adding one adapter + one registry entry.

Secrets live **only** in environment variables (`.env.local` locally, Vercel
project settings in production). They are never stored in the database, sent to
the browser, or committed. See `.env.example` for the full list.

| Service | Purpose | Required env | Health probe |
|---------|---------|--------------|--------------|
| **Vercel** | Hosting / deploys | `VERCEL_API_TOKEN` (+ optional `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`) | `GET /v2/user` |
| **Clerk** | Auth (web + mobile) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `GET /v1/users?limit=1` |
| **Neon** | Postgres database | `DATABASE_URL` (pooled) | `SELECT 1` |
| **n8n** | Low-volume ops automation | `N8N_BASE_URL`, `N8N_API_KEY` | `GET /api/v1/workflows?limit=1` |
| **Stripe** | Payments / billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `GET /v1/balance` |

## (Re-)authenticating a service

For all current services, "authentication" is key-based, so connecting or
re-authenticating means setting or rotating the credential:

1. Obtain the key from the service's dashboard.
2. Set it in `.env.local` (local) or Vercel → Project → Settings → Environment
   Variables (production), then redeploy.
3. On `/admin`, click **Re-check** on the service's card to confirm the new
   connection turns **Connected**.

When a service later supports OAuth, its card's "Re-auth" action becomes a real
reconnect flow instead of a docs link.

## Network egress note

Health checks make outbound calls to each provider's API. In restricted
environments the host must be allow-listed (e.g. `api.clerk.com`,
`api.stripe.com`, `api.vercel.com`, the Neon host, and your n8n instance).

## Stripe webhook

`POST /api/stripe/webhook` verifies the `stripe-signature` header against
`STRIPE_WEBHOOK_SECRET` using the raw request body, then routes subscription
lifecycle events to keep `subscriptions` and `users.plan_tier` in sync. Point a
Stripe webhook endpoint (Dashboard or `stripe listen`) at this route and set the
signing secret.
