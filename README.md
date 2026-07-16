# Podzi.ai Platform

Full-stack application for Podzi.ai: podcast **concatenation** (the "stitch"),
authentication, database, payments, and an admin dashboard for managing
third-party integrations.

- **Framework:** Next.js (App Router) + TypeScript, deployed on **Vercel**
- **Database:** **Neon** Postgres via Drizzle ORM
- **Auth:** **Clerk** (web + upcoming mobile)
- **Payments:** **Stripe** (Free / Pro / Family Pro tiers)
- **Automation:** **n8n** (low-volume ops automation only — see below)
- **Concatenation engine:** direct-code pipeline (chosen on cost — see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md))

> **Scaffold status.** This is the initial foundation. Integrations are wired as
> *adapters* with live health checks, but no live credentials are included and
> the audio pipeline's ffmpeg/transcription/storage steps are stubbed. Every
> stubbed spot is marked `TODO(wire)`. The app builds, typechecks, and renders
> the admin dashboard with **no** credentials present.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in values as you connect each service
npm run dev                  # http://localhost:3000  (admin: /admin)
```

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` type check |
| `npm run db:generate` | Generate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run db:studio` | Browse the database in Drizzle Studio |

## Project structure

```
src/
  app/
    page.tsx                     Landing (placeholder; UI kit merges in later)
    admin/                       Integration admin dashboard (server component)
    api/
      health/                    Liveness probe
      integrations/status/       Live per-service health (feeds admin cards)
      stripe/webhook/            Stripe event receiver (signature-verified)
  db/
    schema.ts                    Drizzle schema (users, subs, shows, episodes, stitches, admin)
    index.ts                     Neon client (lazy singleton)
  lib/
    env.ts                       Central env access + isConfigured/requireEnv
    integrations/                One adapter per service + registry
    concat/                      Direct-code concatenation engine (profile-gated)
  middleware.ts                  Clerk auth gate (no-op until keys are set)
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — concat method decision +
  cost analysis, transcribe-once strategy, background-worker rationale.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — how each integration is wired,
  required env vars, and how to (re-)authenticate from the admin dashboard.

## Security notes

- Secrets live only in environment variables (`.env.local` / Vercel settings) —
  never in the database, the browser, commits, or PRs.
- The Stripe webhook verifies signatures before processing.
- Admin health checks run server-side and return only non-secret fields.
