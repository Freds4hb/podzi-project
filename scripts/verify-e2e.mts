/**
 * Live end-to-end check: the shared client against a running server.
 *
 * Run: `npm run verify:e2e` with the app already serving (see the script in
 * package.json, which builds, starts, waits, and tears down).
 *
 * What makes this worth having: it drives `@podzi/api-client` — the *exact*
 * module both the web UI and the Expo app import — over real HTTP against real
 * route handlers. A contract drift between UI and backend fails here, rather
 * than in a user's hands.
 *
 * It also stands up a throwaway HTTP server to host a fixture RSS feed, so the
 * identification path is exercised against a genuine network fetch without
 * depending on any third party being up.
 *
 * Runs with no credentials. Endpoints that legitimately require configuration
 * (directory search, anything touching the database) are asserted to fail in the
 * *documented* way — 503 with a useful message — which is itself behaviour worth
 * locking down, since the UI branches on it.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { ApiError, createPodziClient } from "../packages/api-client/src/index.ts";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

const FIXTURE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>E2E Fixture Cast</title>
    <description>Served by verify-e2e.mts</description>
    <itunes:author>Podzi E2E</itunes:author>
    <item>
      <title>Fixture Episode A</title>
      <guid>e2e-a</guid>
      <pubDate>Wed, 03 Sep 2025 09:00:00 GMT</pubDate>
      <itunes:duration>25:00</itunes:duration>
      <enclosure url="https://example.com/a.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Fixture Episode B</title>
      <guid>e2e-b</guid>
      <pubDate>Thu, 04 Sep 2025 09:00:00 GMT</pubDate>
      <itunes:duration>3600</itunes:duration>
      <enclosure url="https://example.com/b.mp3" type="audio/mpeg" length="1"/>
    </item>
  </channel>
</rss>`;

function step(message: string) {
  console.log(`• ${message}`);
}

/** Serve the fixture feed on an ephemeral port; resolve with its URL. */
function startFixtureServer(): Promise<{ server: Server; feedUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === "/feed.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml" });
        res.end(FIXTURE_FEED);
        return;
      }
      res.writeHead(404).end();
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Fixture server did not bind to a port."));
        return;
      }
      resolve({
        server,
        feedUrl: `http://127.0.0.1:${address.port}/feed.xml`,
      });
    });
  });
}

async function main() {
  const client = createPodziClient({ baseUrl: BASE_URL });
  const { server, feedUrl } = await startFixtureServer();
  step(`fixture feed served at ${feedUrl}`);

  try {
    /* 1 — liveness --------------------------------------------------------- */
    const health = await client.health();
    assert.equal(health.ok, true, "health must report ok:true");
    assert.equal(health.service, "podzi-platform");
    assert.ok(
      !Number.isNaN(Date.parse(health.time)),
      "health.time must be a parseable ISO timestamp",
    );
    step(`health: ok, service "${health.service}"`);

    /* 2 — identification through the real route ---------------------------- */
    const preview = await client.previewFeed(feedUrl);
    assert.equal(preview.show.title, "E2E Fixture Cast");
    assert.equal(preview.show.author, "Podzi E2E");
    assert.equal(preview.show.source, "feed");
    assert.equal(preview.episodeCount, 2);
    assert.equal(preview.episodes[0].title, "Fixture Episode A");
    assert.equal(preview.episodes[0].durationSeconds, 1500, "25:00 → 1500s");
    assert.equal(preview.episodes[1].durationSeconds, 3600);
    // Dates must arrive as ISO strings, not Date objects, per the client contract.
    assert.equal(typeof preview.episodes[0].publishedAt, "string");
    step(
      `POST /api/podcasts/preview → "${preview.show.title}", ${preview.episodeCount} episodes`,
    );

    /* 3 — preview limit is honoured ---------------------------------------- */
    const limited = await client.previewFeed(feedUrl, 1);
    assert.equal(limited.episodes.length, 1, "limit must cap the episode array");
    assert.equal(limited.episodeCount, 2, "episodeCount reports the whole feed");
    step("preview limit caps the array without lying about the feed size");

    /* 4 — a bad feed is a 422, not a 500 ----------------------------------- */
    await assert.rejects(
      () => client.previewFeed(`${BASE_URL}/api/health`),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 422, "non-feed content must be 422");
        return true;
      },
      "pointing preview at non-feed content must fail cleanly",
    );
    step("non-feed URL → 422 with a message (not a 500)");

    /* 5 — unconfigured search reports itself as such ----------------------- */
    await assert.rejects(
      () => client.searchShows("history"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 503, "search without keys must be 503");
        assert.ok(
          err.isSearchUnconfigured,
          "the client flag the UI branches on must be true",
        );
        return true;
      },
    );
    step("GET /api/podcasts/search → 503 isSearchUnconfigured (no keys set)");

    /* 6 — DB-backed reads degrade the documented way ----------------------- */
    await assert.rejects(
      () => client.library("00000000-0000-0000-0000-000000000000"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 503, "library without DATABASE_URL must be 503");
        return true;
      },
    );
    step("GET /api/podcasts/library → 503 (no DATABASE_URL), no crash");

    /* 7 — the public UI actually renders ----------------------------------- */
    {
      const res = await fetch(`${BASE_URL}/podcasts`);
      assert.equal(res.status, 200, "/podcasts must return 200");
      const html = await res.text();
      assert.ok(
        html.includes("Find podcasts"),
        '/podcasts must render "Find podcasts" — UI is not wired to the backend',
      );
      step('GET /podcasts → 200, rendered "Find podcasts"');
    }

    /* 8 — the admin surface is CLOSED, because this build has no Clerk keys --
       This suite runs against a production build (`verify:live` does
       `next build && next start`), which is the configuration the assertion is
       about: `src/middleware.ts` serves the admin surface only when Clerk can
       authenticate someone. A 200 here would mean a deployment made before
       Clerk was provisioned exposes the dashboard and the infrastructure
       description behind it.

       This replaces an earlier assertion that `/admin` renders its integration
       cards. That coverage is deliberately given up: the render is exercised by
       anyone running `npm run dev`, whereas nothing but this guards the security
       property, and CI never has Clerk keys. */
    for (const path of ["/admin", "/api/integrations/status"] as const) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert.equal(
        res.status,
        503,
        `${path} must be closed (503) on a production build with no Clerk keys, got ${res.status}`,
      );
      const body = await res.text();
      assert.ok(
        !body.includes("Podcast Index"),
        `${path} must not leak admin content in its refusal body`,
      );
      step(`GET ${path} → 503, admin surface closed without Clerk`);
    }

    console.log("\n✅ live end-to-end verified: shared client ↔ routes ↔ UI");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error("\n❌ e2e verification failed:", err);
  process.exit(1);
});
