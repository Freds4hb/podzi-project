/**
 * RSS / Atom podcast feed reader.
 *
 * This is the zero-credential half of identification: given a feed URL, produce
 * the show and its episodes. It handles the shapes real podcast feeds actually
 * use, which are messier than the spec suggests:
 *
 *   - RSS 2.0 with the iTunes namespace (the overwhelming majority), and Atom;
 *   - `<itunes:duration>` as seconds ("1830"), M:SS ("30:30") or H:MM:SS;
 *   - artwork from `<itunes:image href>` or `<image><url>`;
 *   - a single item arriving as an object rather than an array (the classic
 *     XML-to-JSON footgun — a one-episode feed must not become 1 char-per-field).
 *
 * Parsing is separated from fetching (`parseFeed` vs `readFeed`) so the parser is
 * a pure function over a string and can be tested without a network.
 */
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type {
  EpisodeCandidate,
  FeedContents,
  ShowCandidate,
} from "./types";

/** Cap on episodes taken from one feed, so a 10-year archive can't blow up a request. */
export const MAX_EPISODES_PER_FEED = 200;

/**
 * `externalId` for a show known only by its feed URL. Hashing the URL (rather
 * than storing it raw) keeps the id a fixed length and stable under the unique
 * index on `shows.external_id`.
 */
export function feedExternalId(feedUrl: string): string {
  const digest = createHash("sha1").update(feedUrl.trim()).digest("hex");
  return `feed:${digest}`;
}

/**
 * Parse an `<itunes:duration>` value into seconds.
 * Accepts "1830", "30:30" and "1:30:30". Returns null for anything else, since a
 * wrong duration is worse than no duration — the stitch planner treats a missing
 * duration as "skip", but would silently mis-plan around a bogus one.
 */
export function parseDuration(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  // Plain seconds.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Math.round(Number(text));
    return seconds > 0 ? seconds : null;
  }

  // H:MM:SS or M:SS.
  const parts = text.split(":");
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number(p.trim()));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    const seconds =
      parts.length === 3
        ? nums[0] * 3600 + nums[1] * 60 + nums[2]
        : nums[0] * 60 + nums[1];
    return seconds > 0 ? Math.round(seconds) : null;
  }

  return null;
}

/** Parse a feed date; returns null rather than an Invalid Date. */
function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const date = new Date(String(raw).trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Normalize a value that may be a single object or an array into an array.
 * fast-xml-parser collapses a lone `<item>` to an object, so without this a
 * one-episode feed would be iterated character-by-character.
 */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Read text from a node that may be a scalar or `{ "#text": ... }`. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const inner = (value as Record<string, unknown>)["#text"];
    return inner === undefined ? null : String(inner).trim() || null;
  }
  const str = String(value).trim();
  return str || null;
}

/** Pull an attribute off a node parsed with attributeNamePrefix "@_". */
function attr(node: unknown, name: string): string | null {
  if (!node || typeof node !== "object") return null;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value === undefined ? null : String(value).trim() || null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep values as strings: durations and GUIDs must not be coerced to numbers
  // (a numeric GUID would stringify differently and break de-duplication).
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Parse feed XML into a show and its episodes. Pure — no network, no clock.
 *
 * @param xml       Raw feed body.
 * @param feedUrl   The URL it came from; used for identity and as a fallback
 *                  when the feed omits its own link.
 * @throws if the document is not a recognizable RSS or Atom feed.
 */
export function parseFeed(xml: string, feedUrl: string): FeedContents {
  const doc = parser.parse(xml) as Record<string, any>;

  const channel = doc?.rss?.channel ?? doc?.channel ?? null;
  const atomFeed = doc?.feed ?? null;
  if (!channel && !atomFeed) {
    throw new Error(
      "Not a podcast feed: no <rss><channel> or Atom <feed> element found.",
    );
  }

  return channel
    ? parseRssChannel(channel, feedUrl)
    : parseAtomFeed(atomFeed, feedUrl);
}

function parseRssChannel(
  channel: Record<string, any>,
  feedUrl: string,
): FeedContents {
  const title = text(channel.title) ?? "Untitled podcast";
  const artwork =
    attr(channel["itunes:image"], "href") ?? text(channel.image?.url) ?? null;

  const show: ShowCandidate = {
    externalId: feedExternalId(feedUrl),
    title,
    author: text(channel["itunes:author"]) ?? text(channel.managingEditor),
    feedUrl,
    artworkUrl: artwork,
    description: text(channel.description) ?? text(channel["itunes:summary"]),
    source: "feed",
  };

  const episodes: EpisodeCandidate[] = [];
  for (const item of asArray<Record<string, any>>(channel.item)) {
    // An item with no playable enclosure is not an episode we can stitch.
    const audioUrl = attr(item.enclosure, "url");
    if (!audioUrl) continue;

    const guid = text(item.guid) ?? audioUrl;
    episodes.push({
      externalId: guid,
      title: text(item.title) ?? "Untitled episode",
      description: text(item.description) ?? text(item["itunes:summary"]),
      audioUrl,
      durationSeconds: parseDuration(text(item["itunes:duration"])),
      publishedAt: parseDate(text(item.pubDate)),
    });
    if (episodes.length >= MAX_EPISODES_PER_FEED) break;
  }

  return { show, episodes };
}

function parseAtomFeed(
  feed: Record<string, any>,
  feedUrl: string,
): FeedContents {
  const show: ShowCandidate = {
    externalId: feedExternalId(feedUrl),
    title: text(feed.title) ?? "Untitled podcast",
    author: text(feed.author?.name),
    feedUrl,
    artworkUrl: text(feed.logo) ?? text(feed.icon),
    description: text(feed.subtitle) ?? text(feed.summary),
    source: "feed",
  };

  const episodes: EpisodeCandidate[] = [];
  for (const entry of asArray<Record<string, any>>(feed.entry)) {
    // Atom carries audio in a <link rel="enclosure">.
    const audioUrl = asArray<Record<string, any>>(entry.link)
      .map((link) =>
        attr(link, "rel") === "enclosure" ? attr(link, "href") : null,
      )
      .find((href): href is string => Boolean(href));
    if (!audioUrl) continue;

    episodes.push({
      externalId: text(entry.id) ?? audioUrl,
      title: text(entry.title) ?? "Untitled episode",
      description: text(entry.summary) ?? text(entry.content),
      audioUrl,
      durationSeconds: parseDuration(text(entry["itunes:duration"])),
      publishedAt: parseDate(text(entry.published) ?? text(entry.updated)),
    });
    if (episodes.length >= MAX_EPISODES_PER_FEED) break;
  }

  return { show, episodes };
}

/**
 * Fetch a feed URL and parse it.
 *
 * Only http(s) is accepted, which blocks the obvious SSRF shapes (`file://`,
 * `gopher://`) reachable if a feed URL ever arrives from an untrusted caller —
 * which it does: `POST /api/podcasts/preview` takes one from the client.
 */
export async function readFeed(
  feedUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<FeedContents> {
  let url: URL;
  try {
    url = new URL(feedUrl);
  } catch {
    throw new Error(`Not a valid URL: ${feedUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Feed URL must be http(s), got "${url.protocol}".`);
  }

  const res = await fetch(url, {
    headers: { accept: "application/rss+xml, application/xml, text/xml, */*" },
    cache: "no-store",
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`Feed fetch failed: HTTP ${res.status} from ${url.host}.`);
  }

  return parseFeed(await res.text(), url.toString());
}
