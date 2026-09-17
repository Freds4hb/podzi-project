/**
 * Next.js configuration.
 *
 * Kept intentionally minimal for the scaffold. Integration-specific config
 * (image domains for podcast artwork, headers, redirects) is added as those
 * features land. Deployed to Vercel; the Neon Postgres URL and all third-party
 * keys are provided via environment variables (see `.env.example`).
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // Server Actions and Route Handlers that touch the audio pipeline can run
  // long; heavy concatenation/transcription work is designed to run in a
  // background worker/queue rather than inline request handlers (see
  // src/lib/concat/pipeline.ts for the rationale).
  experimental: {},
};

export default nextConfig;
