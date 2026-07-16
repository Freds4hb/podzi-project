/**
 * Data-access layer for the concatenation pipeline (Drizzle → Neon).
 *
 * All DB reads/writes the pipeline needs live here, so the worker and API routes
 * depend on a small, well-named surface rather than raw queries. This is also
 * where the PROFILE-DRIVEN rule is enforced: `getCandidateEpisodesForUser`
 * joins through `followed_shows`, so episodes from unfollowed shows can never
 * enter a plan.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CandidateEpisode, StitchPlan, StitchSegment } from "./pipeline";

const { users, shows, followedShows, episodes, stitches } = schema;

/** Look up an app user by their Clerk id (identity is owned by Clerk). */
export async function getUserByClerkId(clerkUserId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Episodes eligible for a stitch: ONLY those from shows the user follows.
 * This is the structural gate for the profile-driven requirement.
 */
export async function getCandidateEpisodesForUser(
  userId: string,
): Promise<CandidateEpisode[]> {
  const db = getDb();
  const rows = await db
    .select({
      episodeId: episodes.id,
      showId: shows.id,
      title: episodes.title,
      audioUrl: episodes.audioUrl,
      durationSeconds: episodes.durationSeconds,
      transcriptStatus: episodes.transcriptStatus,
      publishedAt: episodes.publishedAt,
    })
    .from(followedShows)
    .innerJoin(shows, eq(shows.id, followedShows.showId))
    .innerJoin(episodes, eq(episodes.showId, shows.id))
    .where(eq(followedShows.userId, userId));

  return rows.map((r) => ({
    episodeId: r.episodeId,
    showId: r.showId,
    title: r.title,
    audioUrl: r.audioUrl,
    durationSeconds: r.durationSeconds,
    hasCachedTranscript: r.transcriptStatus === "ready",
    publishedAt: r.publishedAt,
  }));
}

/** Insert a queued stitch job from a plan; returns the new stitch id. */
export async function enqueueStitch(
  userId: string,
  plan: StitchPlan,
  title?: string,
): Promise<string> {
  const db = getDb();
  const rows = await db
    .insert(stitches)
    .values({
      userId,
      title: title ?? null,
      status: "queued",
      segments: plan.segments,
    })
    .returning({ id: stitches.id });
  return rows[0].id;
}

/** Load a stitch job (with its segment plan). */
export async function loadStitch(stitchId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(stitches)
    .where(eq(stitches.id, stitchId))
    .limit(1);
  return rows[0] ?? null;
}

/** Patch a stitch row (status/result fields). */
export async function updateStitch(
  stitchId: string,
  patch: Partial<{
    status: "queued" | "processing" | "ready" | "failed";
    outputAudioUrl: string | null;
    summary: string | null;
    errorMessage: string | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  const db = getDb();
  await db.update(stitches).set(patch).where(eq(stitches.id, stitchId));
}

/** Fetch a single episode by id. */
export async function getEpisodeById(episodeId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  return rows[0] ?? null;
}

/** Update an episode's transcript-cache bookkeeping (transcribe-once). */
export async function setEpisodeTranscript(
  episodeId: string,
  patch: {
    status: "absent" | "pending" | "ready" | "failed";
    url?: string | null;
  },
): Promise<void> {
  const db = getDb();
  await db
    .update(episodes)
    .set({
      transcriptStatus: patch.status,
      transcriptUrl: patch.url ?? null,
    })
    .where(eq(episodes.id, episodeId));
}

/** Convenience re-export so callers can type segments without deep imports. */
export type { StitchSegment };
