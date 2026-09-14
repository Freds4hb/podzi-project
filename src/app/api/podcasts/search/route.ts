/**
 * GET /api/podcasts/search?q=…&limit=… — keyword search the podcast directory.
 *
 * Needs Podcast Index credentials. When they are absent this returns 503 with
 * `searchAvailable: false` rather than an empty result set, so the client can
 * tell "no matches" apart from "search isn't set up" and point the user at the
 * feed-URL path instead.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getDirectory } from "@/lib/podcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json(
      { error: "Missing required query parameter \"q\"." },
      { status: 400 },
    );
  }

  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const directory = getDirectory();
  if (!directory.isConfigured()) {
    return NextResponse.json(
      {
        error: "Directory search is not configured.",
        searchAvailable: false,
        hint: "Set PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET, or add a show by its feed URL.",
      },
      { status: 503 },
    );
  }

  try {
    const results = await directory.search(query, limit);
    return NextResponse.json({
      searchAvailable: true,
      provider: directory.name,
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Directory search failed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
