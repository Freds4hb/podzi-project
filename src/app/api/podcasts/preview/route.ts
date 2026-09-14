/**
 * POST /api/podcasts/preview — read a podcast feed without persisting anything.
 *
 * This is the one identification endpoint that needs **no** credentials: no
 * database, no directory API key. It fetches the feed, parses it, and returns
 * what *would* be ingested. Two reasons it exists:
 *
 *   1. Product: the client shows the user what they're about to follow before
 *      writing anything.
 *   2. Operational: it makes the whole identification path end-to-end testable
 *      on a bare checkout — which is exactly what scripts/verify-podcasts.mts
 *      and the UI smoke test do.
 *
 * The feed URL comes from the client, so `readFeed` restricts it to http(s).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readFeed } from "@/lib/podcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Give up on a slow feed rather than holding the request open. */
const FEED_TIMEOUT_MS = 10_000;

const bodySchema = z.object({
  feedUrl: z.string().url(),
  /** Cap episodes in the response; the full set is still ingested on follow. */
  limit: z.number().int().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { feedUrl, limit } = parsed.data;

  const abort = AbortSignal.timeout(FEED_TIMEOUT_MS);
  try {
    const { show, episodes } = await readFeed(feedUrl, { signal: abort });
    return NextResponse.json({
      show,
      episodeCount: episodes.length,
      episodes: (limit ? episodes.slice(0, limit) : episodes).map((episode) => ({
        externalId: episode.externalId,
        title: episode.title,
        durationSeconds: episode.durationSeconds,
        publishedAt: episode.publishedAt?.toISOString() ?? null,
        audioUrl: episode.audioUrl,
      })),
    });
  } catch (err) {
    // A bad feed is the caller's problem (422), not a server fault.
    return NextResponse.json(
      {
        error: "Could not read that feed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }
}
