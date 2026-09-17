/**
 * Browser check: the real React UI driving the real backend.
 *
 * Run: `npm run verify:ui` against a server already listening (or use
 * `npm run verify:live`, which handles the whole cycle).
 *
 * `verify-e2e.mts` proves the shared *client module* talks to the routes. This
 * goes one layer further out and proves the rendered UI does: it drives Chromium
 * through the flow a person would follow — open /podcasts, switch to the feed-URL
 * tab, paste a feed, press Preview — and asserts the episode titles the server
 * returned actually appear on screen.
 *
 * That closes the last gap where the UI could compile, the API could work, and
 * the two could still fail to be connected.
 *
 * Writes a screenshot to .next/verify-ui.png for eyeballing.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SHOT_DIR = ".next";
const SHOT_PATH = `${SHOT_DIR}/verify-ui.png`;

/**
 * Chromium to drive.
 *
 * CI images commonly ship a Chromium build that doesn't match the one the
 * installed Playwright expects, and `playwright install` may be unavailable or
 * blocked. `CHROMIUM_PATH` lets the caller point at whatever is on the machine;
 * when unset, Playwright's own managed browser is used.
 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "";

const FIXTURE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Browser Fixture Cast</title>
    <description>Served by verify-ui.mts</description>
    <itunes:author>Podzi UI Check</itunes:author>
    <item>
      <title>Clicked Through To The Backend</title>
      <guid>ui-1</guid>
      <pubDate>Fri, 05 Sep 2025 09:00:00 GMT</pubDate>
      <itunes:duration>18:20</itunes:duration>
      <enclosure url="https://example.com/ui1.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Second Rendered Episode</title>
      <guid>ui-2</guid>
      <itunes:duration>2:05:00</itunes:duration>
      <enclosure url="https://example.com/ui2.mp3" type="audio/mpeg" length="1"/>
    </item>
  </channel>
</rss>`;

function step(message: string) {
  console.log(`• ${message}`);
}

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
        reject(new Error("Fixture server did not bind."));
        return;
      }
      resolve({ server, feedUrl: `http://127.0.0.1:${address.port}/feed.xml` });
    });
  });
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const { server, feedUrl } = await startFixtureServer();
  const browser = await chromium.launch(
    CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
  );

  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

    // Surface browser-side failures instead of letting them pass silently.
    // Failed responses are recorded with their URL: "Failed to load resource"
    // on its own is useless for diagnosis.
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
      }
    });

    /* 1 — the page loads and renders its server-side status ---------------- */
    const response = await page.goto(`${BASE_URL}/podcasts`, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 200, "/podcasts must return 200");
    await page.getByRole("heading", { name: "Find podcasts" }).waitFor();
    // The server component reports whether search is configured; with no keys
    // set it must say so rather than implying search will work.
    await page
      .getByText("Directory search: not configured", { exact: false })
      .waitFor();
    step("/podcasts rendered, server-side search status shown");

    /* 2 — the interactive client component is hydrated --------------------- */
    const feedTab = page.getByRole("tab", { name: "Add by feed URL" });
    await feedTab.click();
    const input = page.getByLabel("Podcast RSS feed URL");
    await input.waitFor();
    step("client component hydrated; switched to the feed-URL tab");

    /* 3 — the real flow: paste a feed, press Preview ----------------------- */
    await input.fill(feedUrl);
    await page.getByRole("button", { name: "Preview" }).click();

    // These strings exist only in the fixture the server just fetched and
    // parsed, so seeing them on screen proves the whole chain:
    // browser → shared client → /api/podcasts/preview → RSS parser → render.
    await page.getByText("Browser Fixture Cast").waitFor({ timeout: 15_000 });
    await page.getByText("Clicked Through To The Backend").waitFor();
    await page.getByText("Second Rendered Episode").waitFor();
    step("preview rendered feed data fetched live by the server");

    /* 4 — durations formatted by the shared helper ------------------------- */
    // 18:20 → "18m" and 2:05:00 → "2h 5m", via formatDuration in the shared
    // package — so the client's own logic is exercised in the browser too.
    await page.getByText("18m", { exact: true }).waitFor();
    await page.getByText("2h 5m", { exact: true }).waitFor();
    step("durations formatted by the shared client helper (18m, 2h 5m)");

    /* 5 — nothing failed to load ------------------------------------------ */
    assert.deepEqual(
      failedRequests,
      [],
      `requests failed during the flow:\n${failedRequests.join("\n")}`,
    );
    assert.deepEqual(
      consoleErrors,
      [],
      `browser reported console errors:\n${consoleErrors.join("\n")}\n` +
        `failed requests:\n${failedRequests.join("\n") || "(none)"}`,
    );
    step("no failed requests and no console errors during the flow");

    await page.screenshot({ path: SHOT_PATH, fullPage: true });
    step(`screenshot written to ${SHOT_PATH}`);

    console.log("\n✅ UI verified in a real browser: render → fetch → display");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("\n❌ UI verification failed:", err);
  process.exit(1);
});
