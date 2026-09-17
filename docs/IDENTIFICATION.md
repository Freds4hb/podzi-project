# Podcast identification

How shows and episodes get into the catalogue that the concatenation engine
reads from. This is the layer that was missing: the schema always anticipated it
(`shows.feed_url`, `shows.external_id`), but nothing populated those rows.

## Two providers, two credential stories

Identification is deliberately split so that the product is useful before any
third-party account exists.

| Path | Module | Needs credentials? | Entry point |
|------|--------|--------------------|-------------|
| Read one feed by URL | `src/lib/podcasts/rss.ts` | **No** | `POST /api/podcasts/preview`, `POST /api/podcasts/follow` |
| Keyword search a catalogue | `src/lib/podcasts/podcastindex.ts` | Yes — Podcast Index key + secret | `GET /api/podcasts/search` |

Because the feed reader needs nothing, a bare checkout can find, preview and
follow any podcast on the internet. Search is an enhancement on top. When it is
unconfigured the API answers **503** with `searchAvailable: false`, and both
clients switch to the feed-URL path and say why — they do not show an error, and
they do not silently return "no results", which would be a lie.

## Why Podcast Index

Evaluated against the iTunes Search API and direct-RSS-only:

- **Podcast Index** — returns the feed URL in the search result, so a result can
  be ingested without a second lookup; documented rate limits; free developer
  keys. Chosen.
- **iTunes Search API** — no key needed, but undocumented throttling and thinner
  metadata, and it does not reliably expose the feed URL.
- **RSS only** — zero dependencies, but no discovery at all. Retained *as well*,
  not instead: it is the no-credential path above.

### Request signing

Podcast Index does not use bearer tokens. Every request carries:

```
X-Auth-Key    = api key
X-Auth-Date   = unix seconds
Authorization = sha1(apiKey + apiSecret + authDate)
```

The secret is hashed, never transmitted, and the timestamp expires a captured
signature. `buildAuthHeaders(key, secret, nowSec)` takes the clock as an
argument so the scheme is verified against a known-good digest in
`scripts/verify-podcasts.mts` — with no key and no network.

## Parsing real feeds

`parseFeed` is a pure function from XML string to `{ show, episodes }`. Feeds in
the wild are messier than the spec, so it handles:

- RSS 2.0 with the iTunes namespace, and Atom (`<link rel="enclosure">`);
- `<itunes:duration>` as seconds, `M:SS`, or `H:MM:SS`, and **rejects** anything
  else rather than guessing — the stitch planner skips an episode with no
  duration, but would mis-plan around a bogus one;
- artwork from `<itunes:image href>` or `<image><url>`;
- items with no `<enclosure>` (show notes, trailers posted as text), which are
  skipped because they cannot be stitched;
- a single `<item>`, which XML-to-JSON parsers collapse to an object rather than
  a one-element array. Left unhandled this turns a one-episode feed into
  per-character garbage, so there is a regression test for exactly that.

Episodes per feed are capped at `MAX_EPISODES_PER_FEED` (200) so a decade-long
archive cannot blow up a single request.

### SSRF

`readFeed` accepts `http:` and `https:` only. The feed URL arrives from the
client on `POST /api/podcasts/preview`, so `file://` and friends are rejected
before any fetch happens.

## Persistence and idempotence

`src/lib/podcasts/ingest.ts` upserts on the unique `external_id` indexes, so
re-reading a feed refreshes rows instead of duplicating or failing. Two details
that matter:

1. **Transcripts survive a refresh.** `transcript_status` and `transcript_url`
   are excluded from the update set. Discarding a cached transcript would throw
   away the single biggest cost lever in the architecture (see
   `ARCHITECTURE.md`) — re-transcribing an episode costs real money.
2. **Batches are de-duplicated in memory first.** A malformed feed can repeat a
   GUID, and Postgres rejects an `ON CONFLICT` batch that touches the same key
   twice in one statement.

Identity is namespaced by provider: `podcastindex:12345` for a directory result,
`feed:<sha1(feedUrl)>` for a feed-only one — so the same show found two ways
does not become two rows.

## The profile gate

Following a show is what makes its episodes eligible for that user's stitches.
Every read that returns episodes starts its join at `followed_shows`:

- `getRecentEpisodesForUser` (this module, Home/Library screens)
- `getCandidateEpisodesForUser` (`src/lib/concat/repository.ts`, the planner)

So an unfollowed show's episodes are unreachable *in SQL*, not filtered out
afterwards. `scripts/verify-podcasts.mts` asserts this directly: it ingests a
second show, does not follow it, and confirms it cannot appear in the feed.

## Clients

Both clients import the same `@podzi/api-client` package
(`packages/api-client/`), which is the single typed description of the HTTP
surface — zero dependencies, no Next.js, no React, no `node:` imports, so it
runs unchanged in a browser, in Node, and in React Native.

| Client | Location | Notes |
|--------|----------|-------|
| Web | `src/app/podcasts/` | Same-origin (`baseUrl: ""`). Styled from `tokens/`. |
| Mobile | `apps/mobile/` | Expo + expo-router. Needs an absolute base URL, read from `extra.apiBaseUrl` in `app.json`. |

A response-shape change therefore breaks compilation on both platforms rather
than being discovered at runtime on one. This is not theoretical: the live test
caught `GET /api/health` returning `{ok, service, time}` while the client type
claimed `{status}`.

## Verifying

```bash
npm run verify:podcasts   # parser + auth + ingest + profile gate (in-process Postgres)
npm run verify:live       # builds, starts, runs the HTTP and browser suites, stops
```

Neither needs credentials.

- `scripts/verify-podcasts.mts` — pure logic plus real SQL against PGlite.
- `scripts/verify-e2e.mts` — drives the shared client over real HTTP against the
  real routes, including asserting the documented 503 degradations.
- `scripts/verify-ui.mts` — drives Chromium through the actual flow (open, paste
  a feed, press Preview) and asserts the server's data reaches the screen. Set
  `CHROMIUM_PATH` if the machine's Chromium does not match the installed
  Playwright build.

## Not done yet

- **Following from the UI.** The endpoint works and is tested, but the web
  screen's follow action is disabled: it needs a signed-in user, and Clerk
  sessions are not wired. Both routes still take an explicit `userId`, marked
  `TODO(auth)` alongside the identical marker in `/api/stitches`.
- **Scheduled refresh.** Feeds are read on demand. A cron/worker that re-reads
  followed feeds and ingests new episodes does not exist.
- **Mobile is unrun.** `apps/mobile` typechecks against real Expo/React Native
  types, and its API layer is the same tested module as web, but no simulator or
  device build has been executed in this environment.
