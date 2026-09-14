/**
 * /podcasts — the identification screen on web.
 *
 * A server component wrapper that reports, at request time, whether directory
 * search is configured, then hands off to the interactive client component. The
 * status is read on the server so the page never ships the answer as a
 * credential-shaped hint to the browser — it only says "on" or "off".
 */
import { getDirectory } from "@/lib/podcasts";
import PodcastFinder from "./PodcastFinder";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Find podcasts · Podzi",
  description:
    "Search the podcast directory or add any show by its RSS feed URL.",
};

export default function PodcastsPage() {
  const searchConfigured = getDirectory().isConfigured();

  return (
    <main
      style={{
        maxWidth: 780,
        margin: "0 auto",
        padding: "32px 20px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Find podcasts</h1>
        <p style={{ margin: 0, color: "var(--slate-500, #5b6373)" }}>
          Identification is the step that fills the catalogue the stitch engine
          reads from. Search needs a directory key; adding a show by feed URL
          needs nothing.
        </p>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--slate-500, #5b6373)" }}>
          Directory search:{" "}
          <strong>{searchConfigured ? "configured" : "not configured"}</strong>
        </p>
      </header>

      <PodcastFinder />
    </main>
  );
}
