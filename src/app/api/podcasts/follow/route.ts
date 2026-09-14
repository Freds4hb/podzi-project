/**
 * POST /api/podcasts/follow — ingest a feed into the catalogue and follow it.
 *
 * This is the write that opens the profile gate. After it succeeds, the show's
 * episodes become eligible for that user's stitches; before it, they are not
 * reachable at all (see `getCandidateEpisodesForUser` in
 * src/lib/concat/repository.ts and `getRecentEpisodesForUser` in
 * src/lib/podcasts/ingest.ts — both join through `followed_shows`).
 *
 * Auth: TODO(auth) — mirrors /api/stitches. Once Clerk is wired, derive the user
 * from the session instead of trusting a body field. Until then the route takes
 * an explicit userId for local testing and is gated on DATABASE_URL.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { followShow, ingestFeed, readFeed, userExists } from "@/lib/podcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEED_TIMEOUT_MS = 15_000;

const bodySchema = z.object({
  // TODO(auth): replace with the authenticated Clerk user's app id.
  userId: z.string().uuid(),
  feedUrl: z.string().url(),
});

export async function POST(req: NextRequest) {
  if (!env.DATABASE_URL) {
    return NextResponse.json(
      {
        error: "Database is not configured.",
        hint: "Set DATABASE_URL. /api/podcasts/preview works without it.",
      },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { userId, feedUrl } = parsed.data;

  const db = getDb();
  if (!(await userExists(db, userId))) {
    return NextResponse.json({ error: "Unknown user." }, { status: 404 });
  }

  // Read the feed first: if it's unreadable, write nothing.
  let contents;
  try {
    contents = await readFeed(feedUrl, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Could not read that feed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }

  const { showId, episodeCount } = await ingestFeed(db, contents);
  await followShow(db, userId, showId);

  return NextResponse.json(
    {
      showId,
      title: contents.show.title,
      episodeCount,
      following: true,
    },
    { status: 201 },
  );
}
