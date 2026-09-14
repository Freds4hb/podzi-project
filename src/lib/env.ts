/**
 * Centralized environment access.
 *
 * We deliberately do NOT hard-fail at import time when a variable is missing,
 * because the scaffold must build, typecheck, and render the admin dashboard
 * even before any integration is wired up. Instead:
 *
 *   - `env` exposes raw values (possibly empty strings).
 *   - `isConfigured(service)` tells the admin UI which integrations have the
 *     minimum credentials present, so it can show "Connected" vs "Not set up".
 *
 * When a feature actually needs a credential at runtime, it calls
 * `requireEnv(...)` which throws a clear, actionable error if it is absent.
 */

/** Every environment key the platform reads. Keep in sync with .env.example. */
export const env = {
  // Database (Neon)
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED ?? "",

  // Auth (Clerk)
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "",

  // Payments (Stripe)
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",

  // Workflow automation (n8n)
  N8N_BASE_URL: process.env.N8N_BASE_URL ?? "",
  N8N_API_KEY: process.env.N8N_API_KEY ?? "",

  // Hosting (Vercel)
  VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN ?? "",
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID ?? "",
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID ?? "",

  // Podcast identification (Podcast Index directory search)
  PODCAST_INDEX_API_KEY: process.env.PODCAST_INDEX_API_KEY ?? "",
  PODCAST_INDEX_API_SECRET: process.env.PODCAST_INDEX_API_SECRET ?? "",

  // Concatenation pipeline — transcription + summarization providers
  TRANSCRIPTION_API_KEY: process.env.TRANSCRIPTION_API_KEY ?? "",
  TRANSCRIPTION_BASE_URL: process.env.TRANSCRIPTION_BASE_URL ?? "",
  TRANSCRIPTION_MODEL: process.env.TRANSCRIPTION_MODEL ?? "",
  SUMMARIZATION_API_KEY: process.env.SUMMARIZATION_API_KEY ?? "",
  SUMMARIZATION_BASE_URL: process.env.SUMMARIZATION_BASE_URL ?? "",
  SUMMARIZATION_MODEL: process.env.SUMMARIZATION_MODEL ?? "",

  // Concatenation pipeline — object storage (Cloudflare R2 / S3-compatible)
  AUDIO_STORAGE_ENDPOINT: process.env.AUDIO_STORAGE_ENDPOINT ?? "",
  AUDIO_STORAGE_BUCKET: process.env.AUDIO_STORAGE_BUCKET ?? "",
  AUDIO_STORAGE_ACCESS_KEY_ID: process.env.AUDIO_STORAGE_ACCESS_KEY_ID ?? "",
  AUDIO_STORAGE_SECRET_ACCESS_KEY:
    process.env.AUDIO_STORAGE_SECRET_ACCESS_KEY ?? "",
  AUDIO_STORAGE_REGION: process.env.AUDIO_STORAGE_REGION ?? "",
  AUDIO_STORAGE_PUBLIC_URL: process.env.AUDIO_STORAGE_PUBLIC_URL ?? "",

  // App
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;

export type EnvKey = keyof typeof env;

/**
 * Read a required variable or throw a descriptive error. Call this at the point
 * of use (inside a handler or worker), never at module top-level, so that
 * unconfigured integrations don't crash the whole app.
 */
export function requireEnv(key: EnvKey): string {
  const value = env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${key}". ` +
        `Add it to .env.local (local) or the Vercel project settings (deploy). ` +
        `See .env.example for the full list.`,
    );
  }
  return value;
}
