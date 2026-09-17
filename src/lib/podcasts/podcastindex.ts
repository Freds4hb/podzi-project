/**
 * Podcast Index directory client — keyword search over the catalogue.
 *
 * Chosen over the iTunes Search API because it is purpose-built for podcasts,
 * returns the feed URL directly (so a search result can be ingested without a
 * second lookup), and has documented rate limits rather than undocumented ones.
 *
 * ## Authentication
 *
 * Podcast Index does not use a bearer token. Each request carries three headers,
 * and the signature is recomputed per request:
 *
 *   X-Auth-Key    = the API key
 *   X-Auth-Date   = current unix time in seconds
 *   Authorization = sha1(apiKey + apiSecret + authDate)
 *
 * The secret is never sent — only the digest — and the timestamp means a captured
 * signature expires. `buildAuthHeaders` is exported so the signing scheme can be
 * tested without credentials or a network (see scripts/verify-podcasts.mts).
 */
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import type { PodcastDirectory, ShowCandidate } from "./types";

const API_BASE = "https://api.podcastindex.org/api/1.0";

/** Default page size for search. The API caps `max` far higher; this is a sane UI default. */
export const DEFAULT_SEARCH_LIMIT = 20;

/**
 * How long to wait on the directory before giving up.
 *
 * Every outbound call needs its own budget: on a serverless host a fetch with no
 * timeout holds the function open until the platform kills it, which bills the
 * full wall time and surfaces to the user as an opaque 504 rather than an error
 * the UI can explain. The feed routes already bound their reads the same way; a
 * keyword search should answer faster than a feed download, so the budget is
 * tighter.
 */
const SEARCH_TIMEOUT_MS = 8_000;

/**
 * Build the three auth headers for a Podcast Index request.
 *
 * @param key      API key.
 * @param secret   API secret — hashed, never transmitted.
 * @param nowSec   Unix seconds. Injectable so tests are deterministic.
 */
export function buildAuthHeaders(
  key: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const authDate = String(nowSec);
  const signature = createHash("sha1")
    .update(key + secret + authDate)
    .digest("hex");

  return {
    "X-Auth-Key": key,
    "X-Auth-Date": authDate,
    Authorization: signature,
    // Podcast Index asks callers to identify themselves.
    "User-Agent": "Podzi/0.1 (+https://podzi.ai)",
  };
}

/** One entry of the Podcast Index `search/byterm` response `feeds` array. */
interface PodcastIndexFeed {
  id?: number;
  title?: string;
  author?: string;
  ownerName?: string;
  url?: string;
  originalUrl?: string;
  image?: string;
  artwork?: string;
  description?: string;
}

/**
 * Map an API feed object to our provider-neutral `ShowCandidate`.
 * Returns null when the entry lacks the two things we cannot do without: a feed
 * URL to read episodes from, and an id to de-duplicate on.
 */
export function mapFeedToCandidate(
  feed: PodcastIndexFeed,
): ShowCandidate | null {
  const feedUrl = feed.url ?? feed.originalUrl;
  if (!feedUrl || feed.id === undefined || feed.id === null) return null;

  return {
    externalId: `podcastindex:${feed.id}`,
    title: feed.title?.trim() || "Untitled podcast",
    author: feed.author?.trim() || feed.ownerName?.trim() || null,
    feedUrl,
    artworkUrl: feed.artwork?.trim() || feed.image?.trim() || null,
    description: feed.description?.trim() || null,
    source: "podcastindex",
  };
}

export const podcastIndexDirectory: PodcastDirectory = {
  name: "podcastindex",

  isConfigured() {
    return Boolean(env.PODCAST_INDEX_API_KEY && env.PODCAST_INDEX_API_SECRET);
  },

  async search(query, limit = DEFAULT_SEARCH_LIMIT) {
    if (!this.isConfigured()) return [];

    const term = query.trim();
    if (!term) return [];

    const url = new URL(`${API_BASE}/search/byterm`);
    url.searchParams.set("q", term);
    url.searchParams.set("max", String(Math.min(Math.max(limit, 1), 100)));
    // Only feeds we can actually play from.
    url.searchParams.set("fulltext", "false");

    let res: Response;
    try {
      res = await fetch(url, {
        headers: buildAuthHeaders(
          env.PODCAST_INDEX_API_KEY,
          env.PODCAST_INDEX_API_SECRET,
        ),
        cache: "no-store",
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
    } catch (err) {
      // Distinguish "the directory is slow" from "the request was malformed",
      // because only the first is worth retrying.
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Podcast Index did not respond within ${SEARCH_TIMEOUT_MS}ms.`,
        );
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Podcast Index search failed: HTTP ${res.status}.`);
    }

    const body = (await res.json()) as { feeds?: PodcastIndexFeed[] };
    return (body.feeds ?? [])
      .map(mapFeedToCandidate)
      .filter((show): show is ShowCandidate => show !== null);
  },
};
