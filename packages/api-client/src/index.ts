/**
 * Podzi API client — the single typed description of the HTTP surface.
 *
 * This package is shared verbatim by the web app (`src/app/**`) and the Expo
 * mobile app (`apps/mobile`). That is the point: both clients speak to the same
 * routes through the same types, so a change to a response shape breaks
 * compilation on both platforms instead of only being discovered at runtime on
 * one of them.
 *
 * Constraints that keep it portable — please preserve them:
 *   - **Zero dependencies.** Uses only global `fetch`, which exists in browsers,
 *     Node 18+, and React Native (via Hermes' polyfill).
 *   - **No Next.js, no React, no `node:` imports.** Nothing here may assume a
 *     server, a bundler, or a DOM.
 *   - **Dates cross the wire as ISO strings**, not `Date`, because that is what
 *     JSON actually carries. Parse at the edge of the UI if you need objects.
 */

/* -------------------------------------------------------------------------- */
/* Wire types — must mirror the route handlers in src/app/api/**              */
/* -------------------------------------------------------------------------- */

export interface ShowSummary {
  externalId: string;
  title: string;
  author: string | null;
  feedUrl: string;
  artworkUrl: string | null;
  description: string | null;
  source: "podcastindex" | "feed";
}

export interface EpisodePreview {
  externalId: string;
  title: string;
  durationSeconds: number | null;
  /** ISO 8601, or null when the feed omitted a date. */
  publishedAt: string | null;
  audioUrl: string;
}

export interface PreviewResponse {
  show: ShowSummary;
  episodeCount: number;
  episodes: EpisodePreview[];
}

export interface SearchResponse {
  searchAvailable: true;
  provider: string;
  query: string;
  count: number;
  results: ShowSummary[];
}

export interface FollowResponse {
  showId: string;
  title: string;
  episodeCount: number;
  following: true;
}

export interface LibraryShow {
  showId: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  feedUrl: string;
}

export interface LibraryEpisode {
  episodeId: string;
  showId: string;
  showTitle: string;
  title: string;
  durationSeconds: number | null;
  publishedAt: string | null;
}

export interface LibraryResponse {
  shows: LibraryShow[];
  episodes: LibraryEpisode[];
}

/** Shape returned by `GET /api/health` (src/app/api/health/route.ts). */
export interface HealthResponse {
  ok: boolean;
  service: string;
  /** ISO 8601 server time. */
  time: string;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A non-2xx response, carrying the status and the server's message.
 *
 * `status` is deliberately exposed because the UI branches on it: 503 from
 * `/search` means "search isn't configured, offer the feed-URL path", which is a
 * different screen state from a 502 "the provider is down".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /** True when directory search is unavailable because it has no credentials. */
  get isSearchUnconfigured(): boolean {
    return this.status === 503;
  }
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

export interface ClientOptions {
  /**
   * Base URL of the API, without a trailing slash — e.g. "http://localhost:3000".
   * Required on mobile (the app is not served from the API's origin). On web,
   * pass "" to use same-origin relative paths.
   */
  baseUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

export function createPodziClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;

  if (typeof doFetch !== "function") {
    throw new Error(
      "No fetch implementation available. Pass one via ClientOptions.fetch.",
    );
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    // Read the body once; it may be an error envelope or the payload.
    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const envelope = (body ?? {}) as { error?: string; detail?: string };
      throw new ApiError(
        res.status,
        envelope.error ?? `Request failed with HTTP ${res.status}.`,
        envelope.detail,
      );
    }
    return body as T;
  }

  return {
    /** Liveness probe. */
    health(): Promise<HealthResponse> {
      return request<HealthResponse>("/api/health");
    },

    /**
     * Read a feed without saving anything. Works with no credentials at all —
     * use this to show the user what they're about to follow.
     */
    previewFeed(feedUrl: string, limit?: number): Promise<PreviewResponse> {
      return request<PreviewResponse>("/api/podcasts/preview", {
        method: "POST",
        body: JSON.stringify({ feedUrl, ...(limit ? { limit } : {}) }),
      });
    },

    /**
     * Keyword-search the directory.
     * @throws ApiError with `isSearchUnconfigured` when Podcast Index keys are absent.
     */
    searchShows(query: string, limit?: number): Promise<SearchResponse> {
      const params = new URLSearchParams({ q: query });
      if (limit) params.set("limit", String(limit));
      return request<SearchResponse>(`/api/podcasts/search?${params}`);
    },

    /** Ingest a feed and add it to the user's follow list. Requires a database. */
    followFeed(userId: string, feedUrl: string): Promise<FollowResponse> {
      return request<FollowResponse>("/api/podcasts/follow", {
        method: "POST",
        body: JSON.stringify({ userId, feedUrl }),
      });
    },

    /** Followed shows plus recent episodes — the Library screen's data. */
    library(userId: string, episodeLimit?: number): Promise<LibraryResponse> {
      const params = new URLSearchParams({ userId });
      if (episodeLimit) params.set("episodeLimit", String(episodeLimit));
      return request<LibraryResponse>(`/api/podcasts/library?${params}`);
    },
  };
}

export type PodziClient = ReturnType<typeof createPodziClient>;

/** Format a duration for display: 3661 → "1h 1m", 90 → "1m". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(minutes, 1)}m`;
}
