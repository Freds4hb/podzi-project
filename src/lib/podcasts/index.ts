/**
 * Podcast identification — public surface.
 *
 * Two capabilities, with deliberately different credential requirements:
 *
 *   - `readFeed(url)` — always works. No keys, no account. This is why "add a
 *     show by feed URL" functions on a bare checkout.
 *   - `getDirectory()` — keyword search. Needs Podcast Index credentials; when
 *     they are absent the returned directory reports `isConfigured() === false`
 *     and searches resolve to `[]`, so callers render "search unavailable"
 *     instead of crashing.
 *
 * Routes and the worker should import from here rather than reaching into the
 * individual provider modules, so swapping or adding a directory is a one-line
 * change in this file.
 */
import { podcastIndexDirectory } from "./podcastindex";
import type { PodcastDirectory } from "./types";

export { readFeed, parseFeed, parseDuration, feedExternalId } from "./rss";
export {
  ingestFeed,
  upsertShow,
  upsertEpisodes,
  followShow,
  unfollowShow,
  getFollowedShows,
  getRecentEpisodesForUser,
  userExists,
} from "./ingest";
export type {
  PodcastDatabase,
  IngestResult,
  FollowedShow,
  EpisodeSummary,
} from "./ingest";
export type {
  ShowCandidate,
  EpisodeCandidate,
  FeedContents,
  PodcastDirectory,
  PodcastSourceName,
} from "./types";

/**
 * The active search directory.
 *
 * Only one provider exists today. The indirection is here so a second (iTunes,
 * Taddy) can be added without touching every call site — and so tests can
 * substitute a stub.
 */
export function getDirectory(): PodcastDirectory {
  return podcastIndexDirectory;
}
