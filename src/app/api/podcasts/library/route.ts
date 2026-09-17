/**
 * GET /api/podcasts/library?userId=… — the shows a user follows and their
 * recent episodes. This is the single read behind the Library screen on both
 * web and mobile.
 *
 * Both queries join through `followed_shows`, so the response cannot contain a
 * show the user doesn't follow — the profile gate is enforced in SQL, not by
 * filtering after the fact.
 *
 * Auth: TODO(auth) — takes an explicit userId until Clerk sessions are wired.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { getFollowedShows, getRecentEpisodesForUser } from "@/lib/podcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  // TODO(auth): derive from the Clerk session instead.
  userId: z.string().uuid(),
  episodeLimit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest) {
  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    userId: req.nextUrl.searchParams.get("userId") ?? undefined,
    episodeLimit: req.nextUrl.searchParams.get("episodeLimit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { userId, episodeLimit } = parsed.data;

  const db = getDb();
  const [shows, episodes] = await Promise.all([
    getFollowedShows(db, userId),
    getRecentEpisodesForUser(db, userId, episodeLimit),
  ]);

  return NextResponse.json({
    shows,
    episodes: episodes.map((episode) => ({
      ...episode,
      publishedAt: episode.publishedAt?.toISOString() ?? null,
    })),
  });
}
