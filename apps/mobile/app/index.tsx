/**
 * Mobile "Find podcasts" screen — the identification flow on iOS/Android.
 *
 * Deliberately the same two paths as the web screen (src/app/podcasts), calling
 * the same endpoints through the same shared client:
 *
 *   - search the directory, and
 *   - preview any feed by URL, which needs no credentials.
 *
 * When search returns 503 (no Podcast Index keys on the deployment) the screen
 * switches to the feed-URL mode and explains why, rather than showing an error —
 * identical behaviour to web, because the branch is driven by
 * `ApiError.isSearchUnconfigured` from the shared package.
 */
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ApiError,
  formatDuration,
  type PreviewResponse,
  type ShowSummary,
} from "@podzi/api-client";
import { api, getApiBaseUrl } from "../src/client";
import { theme } from "../src/theme";

type Mode = "search" | "feed";

export default function FindPodcastsScreen() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ShowSummary[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchOff, setSearchOff] = useState(false);

  const reset = () => {
    setResults([]);
    setPreview(null);
    setMessage(null);
  };

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) return;
    reset();
    setBusy(true);
    try {
      const response = await api.searchShows(term);
      setResults(response.results);
      if (response.results.length === 0) {
        setMessage(`No shows matched “${response.query}”.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.isSearchUnconfigured) {
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
  }, [query]);

  const runPreview = useCallback(async (url: string) => {
    const target = url.trim();
    if (!target) return;
    reset();
    setBusy(true);
    try {
      setPreview(await api.previewFeed(target, 10));
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? `${err.message}${err.detail ? ` (${err.detail})` : ""}`
          : "Could not read that feed.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        <Pressable
          onPress={() => {
            if (searchOff) return;
            setMode("search");
            reset();
          }}
          style={[
            styles.tab,
            mode === "search" && styles.tabOn,
            searchOff && styles.tabDisabled,
          ]}
        >
          <Text style={[styles.tabText, mode === "search" && styles.tabTextOn]}>
            Search
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setMode("feed");
            reset();
          }}
          style={[styles.tab, mode === "feed" && styles.tabOn]}
        >
          <Text style={[styles.tabText, mode === "feed" && styles.tabTextOn]}>
            Feed URL
          </Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={mode === "search" ? query : feedUrl}
          onChangeText={mode === "search" ? setQuery : setFeedUrl}
          placeholder={
            mode === "search"
              ? "Search shows — e.g. “history”"
              : "https://example.com/feed.xml"
          }
          placeholderTextColor={theme.slate500}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={mode === "feed" ? "url" : "default"}
          onSubmitEditing={() =>
            void (mode === "search" ? runSearch() : runPreview(feedUrl))
          }
          returnKeyType="search"
        />
        <Pressable
          onPress={() =>
            void (mode === "search" ? runSearch() : runPreview(feedUrl))
          }
          disabled={busy}
          style={[styles.btn, busy && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>
            {mode === "search" ? "Go" : "Read"}
          </Text>
        </Pressable>
      </View>

      {busy && <ActivityIndicator color={theme.red500} style={styles.spinner} />}

      {message !== null && (
        <View style={styles.note}>
          <Text style={styles.noteText}>{message}</Text>
        </View>
      )}

      {preview !== null ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{preview.show.title}</Text>
          {preview.show.author !== null && (
            <Text style={styles.muted}>{preview.show.author}</Text>
          )}
          <Text style={styles.muted}>
            {preview.episodeCount} episode
            {preview.episodeCount === 1 ? "" : "s"} in feed
          </Text>
          <View style={styles.divider} />
          {preview.episodes.map((episode) => (
            <View key={episode.externalId} style={styles.episodeRow}>
              <Text style={styles.episodeTitle} numberOfLines={1}>
                {episode.title}
              </Text>
              <Text style={styles.muted}>
                {formatDuration(episode.durationSeconds)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(show) => show.externalId}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => {
                setFeedUrl(item.feedUrl);
                setMode("feed");
                void runPreview(item.feedUrl);
              }}
            >
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.author !== null && (
                <Text style={styles.muted}>{item.author}</Text>
              )}
            </Pressable>
          )}
          ListEmptyComponent={null}
        />
      )}

      {/* Makes the API target visible while developing against a LAN address. */}
      <Text style={styles.footer}>API: {getApiBaseUrl()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: theme.paper },
  tabs: { flexDirection: "row", gap: 8 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.slate200,
    backgroundColor: theme.white,
  },
  tabOn: { backgroundColor: theme.red500, borderColor: theme.red500 },
  tabDisabled: { opacity: 0.45 },
  tabText: { color: theme.ink700, fontWeight: "600" },
  tabTextOn: { color: theme.white },
  row: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.slate200,
    borderRadius: 10,
    backgroundColor: theme.white,
    color: theme.ink700,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: theme.red500,
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: theme.white, fontWeight: "700" },
  spinner: { marginTop: 4 },
  note: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.slate50,
  },
  noteText: { color: theme.ink700 },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.slate200,
    backgroundColor: theme.white,
    marginBottom: 8,
    gap: 2,
  },
  cardTitle: { fontWeight: "700", color: theme.ink900 },
  muted: { color: theme.slate500, fontSize: 13 },
  divider: {
    height: 1,
    backgroundColor: theme.slate200,
    marginVertical: 8,
  },
  episodeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  episodeTitle: { flex: 1, color: theme.ink700 },
  footer: { fontSize: 11, color: theme.slate500, textAlign: "center" },
});
