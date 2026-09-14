"use client";

/**
 * Podcast finder — the web UI for identification.
 *
 * Two ways in, matching the two provider shapes in src/lib/podcasts:
 *
 *   - **Search** the directory (needs Podcast Index keys). When the API answers
 *     503 we don't show an error; we switch the panel to explain that search is
 *     unconfigured and steer the user to the feed-URL field, which always works.
 *   - **Paste a feed URL** and preview it. Zero credentials.
 *
 * Every network call goes through the shared `@podzi/api-client`, the same
 * module the mobile app uses, so the two clients cannot drift apart silently.
 *
 * Styling uses the design-system tokens in `tokens/` via CSS custom properties
 * (`--red-500`, `--ink-700`, …) rather than hard-coded hex values.
 */
import { useCallback, useMemo, useState } from "react";
import styles from "./PodcastFinder.module.css";
import {
  ApiError,
  createPodziClient,
  formatDuration,
  type PreviewResponse,
  type ShowSummary,
} from "@podzi/api-client";

type Mode = "search" | "feed";

export default function PodcastFinder() {
  // Same-origin: the browser is already on the API's host.
  const client = useMemo(() => createPodziClient({ baseUrl: "" }), []);

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ShowSummary[] | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchOff, setSearchOff] = useState(false);

  const reset = () => {
    setResults(null);
    setPreview(null);
    setMessage(null);
  };

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    reset();
    setBusy(true);
    try {
      const response = await client.searchShows(query.trim());
      setResults(response.results);
      if (response.results.length === 0) {
        setMessage(`No shows matched “${response.query}”.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.isSearchUnconfigured) {
        // Not a failure — an unconfigured optional service. Offer the path that works.
        setSearchOff(true);
        setMode("feed");
        setMessage(
          "Directory search isn’t configured on this deployment. You can still add any show by pasting its RSS feed URL.",
        );
      } else {
        setMessage(
          err instanceof ApiError ? err.message : "Search failed unexpectedly.",
        );
      }
    } finally {
      setBusy(false);
    }
  }, [client, query]);

  const runPreview = useCallback(
    async (url: string) => {
      if (!url.trim()) return;
      reset();
      setBusy(true);
      try {
        setPreview(await client.previewFeed(url.trim(), 10));
      } catch (err) {
        setMessage(
          err instanceof ApiError
            ? `${err.message}${err.detail ? ` (${err.detail})` : ""}`
            : "Could not read that feed.",
        );
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  return (
    <div className={styles.finder}>
      <div className={styles.tabs} role="tablist" aria-label="How to add a show">
        <button
          role="tab"
          aria-selected={mode === "search"}
          className={`${styles.tab} ${mode === "search" ? styles.tabOn : ""}`}
          onClick={() => {
            setMode("search");
            reset();
          }}
          disabled={searchOff}
          title={searchOff ? "Search is not configured on this deployment" : undefined}
        >
          Search the directory
        </button>
        <button
          role="tab"
          aria-selected={mode === "feed"}
          className={`${styles.tab} ${mode === "feed" ? styles.tabOn : ""}`}
          onClick={() => {
            setMode("feed");
            reset();
          }}
        >
          Add by feed URL
        </button>
      </div>

      {mode === "search" ? (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <input
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shows — e.g. “history”"
            aria-label="Search shows"
          />
          <button className={styles.btn} type="submit" disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
        </form>
      ) : (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            void runPreview(feedUrl);
          }}
        >
          <input
            className={styles.input}
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            aria-label="Podcast RSS feed URL"
            inputMode="url"
          />
          <button
            className={styles.btn}
            type="submit"
            disabled={busy || !feedUrl.trim()}
          >
            {busy ? "Reading…" : "Preview"}
          </button>
        </form>
      )}

      {message && (
        <p className={styles.note} role="status">
          {message}
        </p>
      )}

      {results && results.length > 0 && (
        <ul className={styles.list}>
          {results.map((show) => (
            <li key={show.externalId} className={styles.card}>
              <div className={styles.cardBody}>
                <strong>{show.title}</strong>
                {show.author && <span className={styles.muted}> · {show.author}</span>}
                <div className={`${styles.muted} ${styles.small}`}>{show.feedUrl}</div>
              </div>
              <button
                className={`${styles.btn} ${styles.btnQuiet}`}
                onClick={() => {
                  setFeedUrl(show.feedUrl);
                  setMode("feed");
                  void runPreview(show.feedUrl);
                }}
              >
                Preview
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <section className={`${styles.card} ${styles.preview}`}>
          <header>
            <strong>{preview.show.title}</strong>
            {preview.show.author && (
              <span className={styles.muted}> · {preview.show.author}</span>
            )}
            <div className={`${styles.muted} ${styles.small}`}>
              {preview.episodeCount} episode
              {preview.episodeCount === 1 ? "" : "s"} in feed
            </div>
          </header>
          <ol className={styles.episodes}>
            {preview.episodes.map((episode) => (
              <li key={episode.externalId}>
                <span className={styles.epTitle}>{episode.title}</span>
                <span className={`${styles.muted} ${styles.small}`}>
                  {formatDuration(episode.durationSeconds)}
                </span>
              </li>
            ))}
          </ol>
          {/*
            Following writes to the database, so it needs DATABASE_URL and a real
            user id. Until Clerk sessions are wired there is no user to attribute
            a follow to, so the action is disabled rather than pretending.
          */}
          <p className={`${styles.note} ${styles.small}`}>
            Following a show requires a signed-in user and a configured database.
            Preview above is live — it read this feed just now.
          </p>
        </section>
      )}

    </div>
  );
}
