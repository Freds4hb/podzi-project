/**
 * Persistence for identified podcasts: catalogue upserts and the follow list.
 *
 * Every function takes the database as its first argument rather than reaching
 * for `getDb()`. That mirrors the dependency injection the concat pipeline uses
 * and is what makes this layer testable — `scripts/verify-podcasts.mts` runs the
 * real queries against an in-process Postgres, with no Neon credentials.
 *
 * ## Why upserts
 *
 * `shows.external_id` and `episodes.external_id` are uniquely indexed, and the
 * catalogue is global (shared across users). Re-reading a feed must therefore
 * refresh the existing rows rather than fail or duplicate: a show's artwork and
 * an episode's title do get edited after publication.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { schema } from "@/db";
import type { EpisodeCandidate, FeedContents, ShowCandidate } from "./types";

const { shows, episodes, followedShows, users } = schema;

/**
 * The database handle this layer needs.
 *
 * Typed as the production Neon client so production code is checked exactly;
 * the verification script casts its in-process Postgres to this, which is sound
 * because both are Drizzle `PgDatabase` instances over the same schema.
 */
export type PodcastDatabase = NeonHttpDatabase<typeof schema>;

export interface IngestResult {
  showId: string;
  /** Rows written to `episodes` (inserted or refreshed). */
  episodeCount: number;
}

/**
 * Insert a show, or refresh it if we have seen its `externalId` before.
 * Returns the row id either way, so callers can follow it immediately.
 */
export async function upsertShow(
  db: PodcastDatabase,
  candidate: ShowCandidate,
): Promise<string> {
  const rows = await db
    .insert(shows)
    .values({
      externalId: candidate.externalId,
      title: candidate.title,
      author: candidate.author,
      feedUrl: candidate.feedUrl,
      artworkUrl: candidate.artworkUrl,
      description: candidate.description,
    })
    .onConflictDoUpdate({
      target: shows.externalId,
      set: {
        title: candidate.title,
        author: candidate.author,
        feedUrl: candidate.feedUrl,
        artworkUrl: candidate.artworkUrl,
        description: candidate.description,
      },
    })
    .returning({ id: shows.id });

  return rows[0].id;
}

/**
 * Upsert a batch of episodes for one show.
 *
 * `transcriptStatus` and `transcriptUrl` are deliberately NOT in the update set:
 * re-reading a feed must never discard a cached transcript, which is the single
 * biggest cost lever in the architecture (see docs/ARCHITECTURE.md).
 */
export async function upsertEpisodes(
  db: PodcastDatabase,
  showId: string,
  candidates: EpisodeCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;

  // De-duplicate within the batch: a malformed feed can repeat a GUID, and
  // Postgres rejects an ON CONFLICT batch that hits the same key twice.
  const byExternalId = new Map<string, EpisodeCandidate>();
  for (const candidate of candidates) {
    byExternalId.set(candidate.externalId, candidate);
  }

  const rows = await db
    .insert(episodes)
    .values(
      [...byExternalId.values()].map((episode) => ({
        showId,
        externalId: episode.externalId,
        title: episode.title,
        description: episode.description,
        audioUrl: episode.audioUrl,
        durationSeconds: episode.durationSeconds,
        publishedAt: episode.publishedAt,
      })),
    )
    .onConflictDoUpdate({
      target: episodes.externalId,
      set: {
        title: sqlExcluded("title"),
        description: sqlExcluded("description"),
        audioUrl: sqlExcluded("audio_url"),
        durationSeconds: sqlExcluded("duration_seconds"),
        publishedAt: sqlExcluded("published_at"),
      },
    })
    .returning({ id: episodes.id });

  return rows.length;
}

/**
 * Reference the incoming row inside ON CONFLICT DO UPDATE.
 *
 * A batch upsert needs per-row values, so the update set cannot use a constant —
 * it has to read from Postgres's `excluded` pseudo-table. Callers pass the
 * *column* name (snake_case), not the Drizzle property name.
 */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/** Read a feed's contents into the catalogue in one step. */
export async function ingestFeed(
  db: PodcastDatabase,
  contents: FeedContents,
): Promise<IngestResult> {
  const showId = await upsertShow(db, contents.show);
  const episodeCount = await upsertEpisodes(db, showId, contents.episodes);
  return { showId, episodeCount };
}

/**
 * Add a show to a user's follow list. Idempotent — following twice is a no-op.
 *
 * This is the write that opens the profile gate: `followed_shows` is the only
 * thing that makes a show's episodes eligible for that user's stitches.
 */
export async function followShow(
  db: PodcastDatabase,
  userId: string,
  showId: string,
): Promise<void> {
  await db
    .insert(followedShows)
    .values({ userId, showId })
    .onConflictDoNothing({
      target: [followedShows.userId, followedShows.showId],
    });
}

/** Remove a show from a user's follow list. */
export async function unfollowShow(
  db: PodcastDatabase,
  userId: string,
  showId: string,
): Promise<void> {
  await db
    .delete(followedShows)
    .where(
      and(eq(followedShows.userId, userId), eq(followedShows.showId, showId)),
    );
}

export interface FollowedShow {
  showId: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  feedUrl: string;
}

/** The shows a user follows — the data behind the Library screen. */
export async function getFollowedShows(
  db: PodcastDatabase,
  userId: string,
): Promise<FollowedShow[]> {
  return db
    .select({
      showId: shows.id,
      title: shows.title,
      author: shows.author,
      artworkUrl: shows.artworkUrl,
      feedUrl: shows.feedUrl,
    })
    .from(followedShows)
    .innerJoin(shows, eq(shows.id, followedShows.showId))
    .where(eq(followedShows.userId, userId))
    .orderBy(shows.title);
}

export interface EpisodeSummary {
  episodeId: string;
  showId: string;
  showTitle: string;
  title: string;
  durationSeconds: number | null;
  publishedAt: Date | null;
}

/**
 * Recent episodes from the shows a user follows — the data behind the Home feed.
 *
 * PROFILE GATE: the join starts at `followed_shows`, so an episode from an
 * unfollowed show is structurally unable to appear here. Same rule the concat
 * planner relies on.
 */
export async function getRecentEpisodesForUser(
  db: PodcastDatabase,
  userId: string,
  limit = 50,
): Promise<EpisodeSummary[]> {
  return db
    .select({
      episodeId: episodes.id,
      showId: shows.id,
      showTitle: shows.title,
      title: episodes.title,
      durationSeconds: episodes.durationSeconds,
      publishedAt: episodes.publishedAt,
    })
    .from(followedShows)
    .innerJoin(shows, eq(shows.id, followedShows.showId))
    .innerJoin(episodes, eq(episodes.showId, shows.id))
    .where(eq(followedShows.userId, userId))
    .orderBy(desc(episodes.publishedAt))
    .limit(limit);
}

/** Resolve app user ids that exist, so routes can reject unknown users clearly. */
export async function userExists(
  db: PodcastDatabase,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, [userId]))
    .limit(1);
  return rows.length > 0;
}
