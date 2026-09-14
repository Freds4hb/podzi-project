/**
 * Shared contract for podcast *identification* — finding shows and reading their
 * episode lists.
 *
 * This is the layer that populates the catalogue (`shows` / `episodes`) the
 * concatenation engine reads from. It is deliberately split from the concat
 * pipeline: identification is network-bound and provider-specific, concatenation
 * is CPU-bound and provider-agnostic.
 *
 * Two shapes of provider implement this, and both are always available:
 *
 *   - a **directory** (`PodcastDirectory`) — keyword search across a catalogue,
 *     which needs a third-party API and therefore credentials;
 *   - a **feed reader** (`readFeed` in ./rss) — fetch and parse one RSS/Atom
 *     feed by URL, which needs nothing at all.
 *
 * Because the feed reader needs no credentials, "add a show by pasting its feed
 * URL" works on a bare checkout with no keys set. Search degrades to a clear
 * "not configured" rather than breaking the app — the same philosophy as the
 * integration adapters in src/lib/integrations.
 */

/** A show as returned by identification, before it is persisted. */
export interface ShowCandidate {
  /**
   * Stable identity for de-duplication, written to `shows.external_id`.
   * Directory results use `"<provider>:<providerId>"`; feed-only results use
   * `"feed:<sha1(feedUrl)>"` so the same feed always resolves to one row.
   */
  externalId: string;
  title: string;
  author: string | null;
  feedUrl: string;
  artworkUrl: string | null;
  description: string | null;
  /** Which provider produced this result — for display and debugging. */
  source: PodcastSourceName;
}

/** An episode as returned by identification, before it is persisted. */
export interface EpisodeCandidate {
  /** Stable identity, written to `episodes.external_id`. Prefer the feed GUID. */
  externalId: string;
  title: string;
  description: string | null;
  /** Direct audio URL from the feed enclosure. Required — no audio, no episode. */
  audioUrl: string;
  durationSeconds: number | null;
  publishedAt: Date | null;
}

/** A show plus the episodes read from its feed. */
export interface FeedContents {
  show: ShowCandidate;
  episodes: EpisodeCandidate[];
}

export type PodcastSourceName = "podcastindex" | "feed";

/**
 * Keyword search over a podcast catalogue.
 *
 * Implementations must never throw for an ordinary "no results" or
 * "misconfigured" case — they return an empty array or report via
 * `isConfigured()` so callers can render a useful message.
 */
export interface PodcastDirectory {
  name: PodcastSourceName;
  /** True when the minimum credentials are present. */
  isConfigured(): boolean;
  /** Keyword search. Returns [] when unconfigured or when nothing matches. */
  search(query: string, limit?: number): Promise<ShowCandidate[]>;
}
