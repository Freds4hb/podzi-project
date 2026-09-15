/**
 * Database schema (Drizzle ORM → Neon Postgres).
 *
 * Design notes:
 *  - Clerk owns identity. We mirror only the Clerk user id here (`clerk_user_id`)
 *    plus app-specific profile data, so the DB never becomes a second source of
 *    truth for auth. All tables that belong to a user reference `users.id`.
 *  - The "user profile drives everything" requirement (only process podcasts a
 *    user explicitly follows) is enforced structurally: the concat pipeline
 *    reads candidate episodes only through `followed_shows` → `episodes`.
 *  - Transcripts are cached per-episode (see `episodes.transcript_status`) so an
 *    episode is transcribed once and reused across every stitch — the single
 *    biggest cost lever at scale (see docs/ARCHITECTURE.md).
 *  - `integration_connections` + `activity_logs` back the /admin dashboard.
 */
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/** Subscription tiers mirror the marketing pricing page (Free / Pro / Family). */
export const planTier = pgEnum("plan_tier", ["free", "pro", "family"]);

/** Lifecycle of a Stripe subscription, kept in sync via webhooks. */
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

/** Per-episode transcript cache state (drives the transcribe-once strategy). */
export const transcriptStatus = pgEnum("transcript_status", [
  "absent", // never transcribed
  "pending", // queued/in-progress
  "ready", // cached transcript available for reuse
  "failed",
]);

/** Lifecycle of a stitched-stream job. */
export const stitchStatus = pgEnum("stitch_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);

/**
 * Services surfaced on the admin integrations dashboard.
 *
 * MUST stay in sync with `IntegrationServiceName` in
 * src/lib/integrations/types.ts. The TypeScript union drives the adapter
 * registry; this enum constrains `integration_connections.service` and
 * `activity_logs.service`. A name present in one but not the other compiles
 * fine and then fails at runtime as a Postgres enum error, so adding a service
 * means editing both — and generating a migration.
 */
export const integrationService = pgEnum("integration_service", [
  "vercel",
  "clerk",
  "neon",
  "n8n",
  "stripe",
  "podcastindex",
]);

/* -------------------------------------------------------------------------- */
/* Core identity + billing                                                     */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Identity is owned by Clerk; this is the join key to Clerk's user id.
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    // Current entitlement, denormalized from the active subscription for fast
    // reads on hot paths (e.g. enforcing free-tier stitch limits).
    planTier: planTier("plan_tier").notNull().default("free"),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clerkIdx: uniqueIndex("users_clerk_user_id_idx").on(t.clerkUserId),
    emailIdx: index("users_email_idx").on(t.email),
  }),
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    tier: planTier("tier").notNull(),
    status: subscriptionStatus("status").notNull(),
    // For Family Pro seat billing (base seats + add-on members).
    seats: integer("seats").notNull().default(1),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("subscriptions_user_id_idx").on(t.userId),
    stripeSubIdx: uniqueIndex("subscriptions_stripe_sub_id_idx").on(
      t.stripeSubscriptionId,
    ),
  }),
);

/* -------------------------------------------------------------------------- */
/* Podcast domain                                                              */
/* -------------------------------------------------------------------------- */

/** A show (podcast feed). Global catalog, shared across users. */
export const shows = pgTable(
  "shows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stable external id (e.g. RSS feed URL hash or podcast index id).
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    feedUrl: text("feed_url").notNull(),
    artworkUrl: text("artwork_url"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    externalIdx: uniqueIndex("shows_external_id_idx").on(t.externalId),
  }),
);

/**
 * The explicit follow list. THIS is the gate for the "profile drives
 * everything" rule: the concat pipeline only ever considers episodes from shows
 * a user appears in here.
 */
export const followedShows = pgTable(
  "followed_shows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A user follows a given show at most once.
    uniqueFollow: uniqueIndex("followed_shows_user_show_idx").on(
      t.userId,
      t.showId,
    ),
    userIdx: index("followed_shows_user_id_idx").on(t.userId),
  }),
);

/** An episode of a show, plus its cached-transcript bookkeeping. */
export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    audioUrl: text("audio_url").notNull(),
    durationSeconds: integer("duration_seconds"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Transcribe-once cache: when `ready`, `transcriptUrl` points at the stored
    // transcript reused by every stitch/summary that touches this episode.
    transcriptStatus: transcriptStatus("transcript_status")
      .notNull()
      .default("absent"),
    transcriptUrl: text("transcript_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    showIdx: index("episodes_show_id_idx").on(t.showId),
    externalIdx: uniqueIndex("episodes_external_id_idx").on(t.externalId),
  }),
);

/* -------------------------------------------------------------------------- */
/* Concatenation ("stitch") jobs                                               */
/* -------------------------------------------------------------------------- */

/**
 * A stitched stream: an ordered concatenation of (segments of) episodes the
 * user follows, plus an optional summary/recap. Heavy work runs in a background
 * worker (see src/lib/concat/pipeline.ts) — this row is the job + result record.
 */
export const stitches = pgTable(
  "stitches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    status: stitchStatus("status").notNull().default("queued"),
    // Ordered list of source segments: [{ episodeId, startSec, endSec }, ...].
    // Stored as JSON so the segment plan is auditable and re-runnable.
    segments: jsonb("segments")
      .$type<Array<{ episodeId: string; startSec: number; endSec: number }>>()
      .notNull()
      .default([]),
    outputAudioUrl: text("output_audio_url"),
    summary: text("summary"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("stitches_user_id_idx").on(t.userId),
    statusIdx: index("stitches_status_idx").on(t.status),
  }),
);

/* -------------------------------------------------------------------------- */
/* Integration admin (backs the /admin dashboard)                              */
/* -------------------------------------------------------------------------- */

/**
 * Per-service connection metadata for the admin integrations page. Secrets
 * themselves live in environment variables, NEVER here — this table only tracks
 * connection status, last check, and non-secret config so admins can monitor
 * and trigger re-authentication.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    service: integrationService("service").notNull(),
    // Free-form, non-secret config (instance URL, project id, region, ...).
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastStatus: text("last_status"), // "connected" | "error" | "not_configured"
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    serviceIdx: uniqueIndex("integration_connections_service_idx").on(t.service),
  }),
);

/** Append-only activity log surfaced per-service in the admin dashboard. */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    service: integrationService("service"),
    // Actor is the Clerk user id when a human triggered the action, else null
    // for system/automation events.
    actorClerkUserId: text("actor_clerk_user_id"),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    serviceIdx: index("activity_logs_service_idx").on(t.service),
    createdIdx: index("activity_logs_created_at_idx").on(t.createdAt),
  }),
);
