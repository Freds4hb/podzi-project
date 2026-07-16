/**
 * Drizzle Kit configuration — drives schema migrations against Neon Postgres.
 *
 * Usage:
 *   npm run db:generate   # generate SQL migrations from src/db/schema.ts
 *   npm run db:migrate    # apply pending migrations to the database
 *   npm run db:studio     # open Drizzle Studio to browse data
 *
 * DATABASE_URL is the Neon connection string (pooled connection recommended
 * for serverless). It is never committed — set it in .env.local locally and in
 * the Vercel project's environment variables for deploys.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Non-null assertion is safe here because drizzle-kit only runs from the
    // CLI (never in the edge/runtime bundle), where the env var is required.
    url: process.env.DATABASE_URL!,
  },
  // Verbose output makes the review of generated migrations easier.
  verbose: true,
  strict: true,
});
