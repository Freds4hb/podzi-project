/**
 * Stitch worker — resolves a queued stitch job and runs the pipeline.
 *
 * In production a queue consumer (or cron) calls `processStitch(stitchId)` off
 * the request path. For local dev, `scripts/process-stitch.mts` invokes it
 * directly. Steps:
 *   1. Load the job; mark it "processing".
 *   2. Resolve each plan segment to its source audio URL.
 *   3. Ensure a cached transcript per episode (transcribe-once) — only when a
 *      transcription provider is configured; otherwise run audio-only.
 *   4. Run the concat + upload + (optional) summary via `runStitchJob`.
 *   5. Persist the result back onto the stitch row.
 */
import { getStorage } from "./storage";
import { getTranscriber, type Transcriber } from "./transcription";
import { getSummarizer } from "./summarization";
import { runStitchJob, type ResolvedSegment, type RunStitchResult } from "./pipeline";
import type { StorageClient } from "./storage/types";
import * as repo from "./repository";

export async function processStitch(stitchId: string): Promise<RunStitchResult> {
  const stitch = await repo.loadStitch(stitchId);
  if (!stitch) {
    return { status: "failed", error: `Stitch ${stitchId} not found.` };
  }

  await repo.updateStitch(stitchId, { status: "processing" });

  const storage = getStorage();
  const transcriber = getTranscriber();

  // 2 + 3: resolve sources and (optionally) gather transcripts.
  const resolved: ResolvedSegment[] = [];
  const transcripts: Record<string, string> = {};

  for (const seg of stitch.segments) {
    const ep = await repo.getEpisodeById(seg.episodeId);
    if (!ep) {
      const error = `Episode ${seg.episodeId} not found for stitch ${stitchId}.`;
      await repo.updateStitch(stitchId, {
        status: "failed",
        errorMessage: error,
        completedAt: new Date(),
      });
      return { status: "failed", error };
    }
    resolved.push({
      episodeId: ep.id,
      audioUrl: ep.audioUrl,
      startSec: seg.startSec,
      endSec: seg.endSec,
    });

    if (transcriber.isEnabled() && !transcripts[ep.id]) {
      const text = await ensureTranscript(ep, transcriber, storage);
      if (text) transcripts[ep.id] = text;
    }
  }

  // 4: run the actual pipeline.
  const result = await runStitchJob(
    { stitchId, segments: resolved },
    {
      storage,
      summarizer: getSummarizer(),
      transcripts,
      keyPrefix: "stitches",
    },
  );

  // 5: persist outcome.
  await repo.updateStitch(stitchId, {
    status: result.status,
    outputAudioUrl: result.outputAudioUrl ?? null,
    summary: result.summary ?? null,
    errorMessage: result.error ?? null,
    completedAt: new Date(),
  });

  return result;
}

/**
 * Transcribe-once cache: reuse a stored transcript if present, otherwise
 * transcribe the source audio and cache it. Returns "" on failure so the stitch
 * can still complete as audio-only.
 */
async function ensureTranscript(
  ep: { id: string; audioUrl: string; transcriptStatus: string },
  transcriber: Transcriber,
  storage: StorageClient,
): Promise<string> {
  const key = `transcripts/${ep.id}.txt`;

  // Cache hit: reuse the stored transcript, no re-transcription.
  if (ep.transcriptStatus === "ready") {
    const cached = await storage.get(key);
    if (cached) return cached.toString("utf8");
  }

  // Cache miss: transcribe, then cache both the text and the bookkeeping.
  await repo.setEpisodeTranscript(ep.id, { status: "pending" });
  try {
    const text = await transcriber.transcribe(ep.audioUrl);
    const stored = await storage.put(key, Buffer.from(text, "utf8"), "text/plain");
    await repo.setEpisodeTranscript(ep.id, { status: "ready", url: stored.url });
    return text;
  } catch {
    await repo.setEpisodeTranscript(ep.id, { status: "failed" });
    return "";
  }
}
