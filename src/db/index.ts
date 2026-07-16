/**
 * Database client (Drizzle + Neon serverless driver).
 *
 * The Neon HTTP driver is a good fit for Vercel's serverless/edge runtime: each
 * query is a stateless HTTP request, so there's no connection-pool exhaustion
 * across many short-lived function invocations. Use the POOLED connection
 * string (…-pooler.neon.tech) in DATABASE_URL.
 *
 * The client is created lazily so that importing this module never throws when
 * DATABASE_URL is unset (the scaffold must build without a database). Call
 * `getDb()` from within a handler/worker where the connection is actually
 * needed.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

/** Returns a singleton Drizzle client, creating it on first use. */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const sql = neon(requireEnv("DATABASE_URL"));
  _db = drizzle(sql, { schema });
  return _db;
}

export { schema };
