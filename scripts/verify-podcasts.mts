/**
 * End-to-end verification for podcast identification — no credentials required.
 *
 * Run: `npm run verify:podcasts`
 *
 * Mirrors what `verify-concat.mts` does for the audio pipeline: exercise the real
 * code paths, not mocks, on a bare checkout. Five stages:
 *
 *   1. Parse a synthetic RSS feed (iTunes namespace, mixed duration formats,
 *      one item with no enclosure that must be skipped).
 *   2. Parse a one-item feed, guarding the XML-to-JSON single-node collapse that
 *      would otherwise turn a lone <item> into per-character garbage.
 *   3. Parse an Atom feed.
 *   4. Check the Podcast Index request signature against a known-good SHA-1,
 *      with a fixed timestamp, so the auth scheme is verified without a key.
 *   5. Run the real ingest + profile-gate queries against an in-process Postgres
 *      (PGlite): upsert a show and episodes, re-ingest to prove idempotence,
 *      follow, and confirm an unfollowed show's episodes are unreachable.
 *
 * Exits non-zero on the first failure.
 */
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { parseFeed, parseDuration, feedExternalId } from "../src/lib/podcasts/rss.ts";
import { buildAuthHeaders, mapFeedToCandidate } from "../src/lib/podcasts/podcastindex.ts";
import {
  ingestFeed,
  followShow,
  getFollowedShows,
  getRecentEpisodesForUser,
  type PodcastDatabase,
} from "../src/lib/podcasts/ingest.ts";
import * as schema from "../src/db/schema.ts";
import { integrationAdapters } from "../src/lib/integrations/registry.ts";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Verify Cast</title>
    <description>A feed used only by the verification script.</description>
    <itunes:author>Podzi QA</itunes:author>
    <itunes:image href="https://example.com/art.jpg"/>
    <item>
      <title>Episode One</title>
      <guid>verify-ep-1</guid>
      <pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate>
      <itunes:duration>1830</itunes:duration>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Episode Two</title>
      <guid>verify-ep-2</guid>
      <pubDate>Tue, 02 Sep 2025 10:00:00 GMT</pubDate>
      <itunes:duration>30:30</itunes:duration>
      <enclosure url="https://example.com/ep2.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Episode Three (1h)</title>
      <guid>verify-ep-3</guid>
      <itunes:duration>1:00:30</itunes:duration>
      <enclosure url="https://example.com/ep3.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Notes post with no audio</title>
      <guid>verify-no-audio</guid>
    </item>
  </channel>
</rss>`;

const SINGLE_ITEM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Lonely Cast</title>
    <item>
      <title>The Only Episode</title>
      <guid>lonely-1</guid>
      <itunes:duration>600</itunes:duration>
      <enclosure url="https://example.com/only.mp3" type="audio/mpeg" length="1"/>
    </item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Cast</title>
  <subtitle>Atom-formatted podcast</subtitle>
  <author><name>Atom Author</name></author>
  <entry>
    <id>atom-ep-1</id>
    <title>Atom Episode</title>
    <published>2025-09-03T10:00:00Z</published>
    <link rel="enclosure" href="https://example.com/atom1.mp3" type="audio/mpeg"/>
  </entry>
</feed>`;

/* -------------------------------------------------------------------------- */

function step(message: string) {
  console.log(`• ${message}`);
}

/** Directory drizzle-kit writes migrations to (see drizzle.config.ts `out`). */
const MIGRATIONS_DIR = "drizzle";

/**
 * Apply every generated migration, in order, to a fresh database.
 *
 * Statements are separated by drizzle's `--> statement-breakpoint` marker
 * rather than by `;`, because splitting on semicolons would break any function
 * body or quoted literal containing one.
 */
async function applyMigrations(pg: PGlite): Promise<number> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  assert.ok(
    files.length > 0,
    `No migrations found in ${MIGRATIONS_DIR}/. Run "npm run db:generate".`,
  );

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await pg.exec(trimmed);
    }
  }
  return files.length;
}

async function main() {
  /* 1 — RSS with the iTunes namespace ------------------------------------- */
  const feedUrl = "https://example.com/feed.xml";
  const rss = parseFeed(RSS_FEED, feedUrl);

  assert.equal(rss.show.title, "Verify Cast");
  assert.equal(rss.show.author, "Podzi QA");
  assert.equal(rss.show.artworkUrl, "https://example.com/art.jpg");
  assert.equal(rss.show.externalId, feedExternalId(feedUrl));
  // The enclosure-less item must be dropped: 4 items in, 3 episodes out.
  assert.equal(rss.episodes.length, 3, "item without <enclosure> must be skipped");
  assert.equal(rss.episodes[0].durationSeconds, 1830, "plain seconds");
  assert.equal(rss.episodes[1].durationSeconds, 1830, "M:SS → seconds");
  assert.equal(rss.episodes[2].durationSeconds, 3630, "H:MM:SS → seconds");
  assert.ok(rss.episodes[0].publishedAt instanceof Date);
  assert.equal(rss.episodes[2].publishedAt, null, "missing pubDate stays null");
  step(`RSS: parsed ${rss.episodes.length} episodes, durations + dates correct`);

  // Duration parser edge cases, including the ones that must NOT produce a number.
  assert.equal(parseDuration("00:00"), null, "zero duration is not a duration");
  assert.equal(parseDuration("garbage"), null);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration("90"), 90);
  step("duration parser: rejects junk, accepts seconds / M:SS / H:MM:SS");

  /* 2 — single-item feed -------------------------------------------------- */
  const lonely = parseFeed(SINGLE_ITEM_FEED, "https://example.com/lonely.xml");
  assert.equal(lonely.episodes.length, 1, "a one-item feed must yield one episode");
  assert.equal(lonely.episodes[0].title, "The Only Episode");
  step("single-item feed: no XML single-node collapse");

  /* 3 — Atom -------------------------------------------------------------- */
  const atom = parseFeed(ATOM_FEED, "https://example.com/atom.xml");
  assert.equal(atom.show.title, "Atom Cast");
  assert.equal(atom.show.author, "Atom Author");
  assert.equal(atom.episodes.length, 1);
  assert.equal(atom.episodes[0].audioUrl, "https://example.com/atom1.mp3");
  step("Atom: show + enclosure link parsed");

  /* 4 — Podcast Index auth signature -------------------------------------- */
  const headers = buildAuthHeaders("testkey", "testsecret", 1_700_000_000);
  const expected = createHash("sha1")
    .update("testkey" + "testsecret" + "1700000000")
    .digest("hex");
  assert.equal(headers["X-Auth-Key"], "testkey");
  assert.equal(headers["X-Auth-Date"], "1700000000");
  assert.equal(headers.Authorization, expected, "signature must be sha1(key+secret+date)");
  assert.ok(!JSON.stringify(headers).includes("testsecret"), "secret must never be sent");
  step("Podcast Index auth: signature correct, secret never transmitted");

  // Result mapping, including the rejection of an unusable entry.
  const mapped = mapFeedToCandidate({
    id: 42,
    title: "Mapped Show",
    url: "https://example.com/mapped.xml",
    author: "A",
  });
  assert.equal(mapped?.externalId, "podcastindex:42");
  assert.equal(mapped?.source, "podcastindex");
  assert.equal(
    mapFeedToCandidate({ title: "No feed url" }),
    null,
    "an entry with no feed URL is unusable and must map to null",
  );
  step("Podcast Index mapping: ids namespaced, unusable entries rejected");

  /* 5 — real ingest + profile gate against in-process Postgres ------------ */
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as PodcastDatabase;

  // Build the schema by applying the REAL generated migrations from drizzle/.
  //
  // This deliberately does not hand-write DDL. An earlier version did, and it
  // had already drifted from the schema it was meant to mirror (it declared the
  // plan_tier enum as 'family_pro' where the schema says 'family'), which is
  // exactly the class of bug a duplicated schema invites. Applying the real
  // migration means this script also proves `npm run db:migrate` will work
  // before it is ever pointed at Neon.
  const migrationCount = await applyMigrations(pg);
  step(`applied ${migrationCount} real migration(s) from ${MIGRATIONS_DIR}/`);

  // The enum backing integration_connections.service must list every service
  // the adapter registry exposes, or writing that row fails at runtime.
  const enumValues = await pg.query<{ enumlabel: string }>(
    `SELECT enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'integration_service' ORDER BY enumlabel`,
  );
  const dbServices = enumValues.rows.map((r) => r.enumlabel).sort();
  const registryServices = integrationAdapters.map((a) => a.service).sort();
  for (const service of registryServices) {
    assert.ok(
      dbServices.includes(service),
      `adapter "${service}" is not in the integration_service enum — ` +
        `add it to src/db/schema.ts and generate a migration`,
    );
  }
  step(
    `integration_service enum covers all ${registryServices.length} registered adapters`,
  );

  const [user] = await pg
    .query<{ id: string }>(
      `INSERT INTO users (clerk_user_id, email) VALUES ('clerk_verify', 'qa@podzi.ai') RETURNING id`,
    )
    .then((r) => r.rows);

  const first = await ingestFeed(db, rss);
  assert.equal(first.episodeCount, 3);
  step(`ingest: show ${first.showId.slice(0, 8)}… + ${first.episodeCount} episodes`);

  // Re-ingesting the same feed must refresh, not duplicate or throw.
  const second = await ingestFeed(db, rss);
  assert.equal(second.showId, first.showId, "same feed must resolve to the same show row");
  const showCount = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM shows`);
  const epCount = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM episodes`);
  assert.equal(showCount.rows[0].n, 1, "re-ingest must not duplicate the show");
  assert.equal(epCount.rows[0].n, 3, "re-ingest must not duplicate episodes");
  step("re-ingest is idempotent: 1 show, 3 episodes after two passes");

  // A transcript already cached must survive a feed refresh — the cost lever.
  await pg.exec(
    `UPDATE episodes SET transcript_status='ready', transcript_url='s3://t/1' WHERE external_id='verify-ep-1'`,
  );
  await ingestFeed(db, rss);
  const kept = await pg.query<{ transcript_status: string; transcript_url: string }>(
    `SELECT transcript_status, transcript_url FROM episodes WHERE external_id='verify-ep-1'`,
  );
  assert.equal(kept.rows[0].transcript_status, "ready", "re-ingest must not reset a transcript");
  assert.equal(kept.rows[0].transcript_url, "s3://t/1");
  step("re-ingest preserves cached transcripts");

  // PROFILE GATE: before following, nothing is visible.
  assert.equal((await getFollowedShows(db, user.id)).length, 0);
  assert.equal((await getRecentEpisodesForUser(db, user.id)).length, 0);
  step("profile gate: unfollowed show yields 0 shows, 0 episodes");

  await followShow(db, user.id, first.showId);
  await followShow(db, user.id, first.showId); // idempotent
  const followed = await getFollowedShows(db, user.id);
  const recent = await getRecentEpisodesForUser(db, user.id);
  assert.equal(followed.length, 1, "following twice must not duplicate");
  assert.equal(followed[0].title, "Verify Cast");
  assert.equal(recent.length, 3);
  assert.equal(recent[0].showTitle, "Verify Cast");
  step(`after follow: ${followed.length} show, ${recent.length} episodes visible`);

  // An episode belonging to a show the user does NOT follow stays invisible.
  const other = await ingestFeed(db, lonely);
  const stillRecent = await getRecentEpisodesForUser(db, user.id);
  assert.equal(
    stillRecent.length,
    3,
    "an unfollowed show's episodes must not leak into the feed",
  );
  assert.ok(other.showId !== first.showId);
  step("profile gate holds: second, unfollowed show does not leak in");

  await pg.close();
  console.log("\n✅ podcast identification verified end-to-end");
}

main().catch((err) => {
  console.error("\n❌ verification failed:", err);
  process.exit(1);
});
