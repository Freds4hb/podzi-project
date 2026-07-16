/**
 * Concatenation pipeline — types, the profile-gated segment planner, and the
 * real stitch executor.
 *
 * WHY A BACKGROUND WORKER (not an inline request handler):
 * Stitching and (first-time) transcription of full episodes routinely exceed
 * serverless request time limits. The web request only ENQUEUES a stitch job
 * (writing a `stitches` row with status "queued"); a separate worker
 * (src/lib/concat/worker.ts) resolves it and calls `runStitchJob`. This keeps
 * the API fast and the costs bounded.
 *
 * `runStitchJob` is dependency-injected (storage, summarizer, transcripts) so it
 * can be exercised end-to-end without a database or cloud credentials — see
 * scripts/verify-concat.mts.
 */
import path from "node:path";
import os from "node:os";
import { readFile, rm } from "node:fs/promises";
import { buildConcatenatedAudio } from "./audio/ffmpeg";
import type { StorageClient } from "./storage/types";
import type { Summarizer } from "./summarization/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** A candidate episode from a show the user follows (the ONLY allowed input). */
export interface CandidateEpisode {
  episodeId: string;
  showId: string;
  title: string;
  audioUrl: string;
  durationSeconds: number | null;
  hasCachedTranscript: boolean;
  publishedAt: Date | null;
}

/** One ordered segment of the final stitched stream (planning output). */
export interface StitchSegment {
  episodeId: string;
  startSec: number;
  endSec: number;
}

export interface StitchPlan {
  segments: StitchSegment[];
  estimatedDurationSec: number;
}

export interface StitchOptions {
  targetDurationSec?: number;
  order?: "newest" | "oldest";
}

/* -------------------------------------------------------------------------- */
/* Planning (pure, deterministic, unit-testable)                               */
/* -------------------------------------------------------------------------- */

const DEFAULT_TARGET_SEC = 45 * 60; // 45 minutes

/**
 * Build an ordered segment plan from the user's followed-show episodes.
 *
 * IMPORTANT: `candidates` MUST already be restricted to episodes from shows the
 * user follows (the data layer enforces this — see repository.ts). This function
 * is pure so it can be unit-tested and audited.
 *
 * v0 heuristic: whole-episode concatenation in the requested order, packing
 * until the target duration budget is reached. The [startSec, endSec] shape
 * already supports transcript-derived trimming/sponsor-skip without a change.
 */
export function planStitch(
  candidates: CandidateEpisode[],
  options: StitchOptions = {},
): StitchPlan {
  const target = options.targetDurationSec ?? DEFAULT_TARGET_SEC;
  const order = options.order ?? "newest";

  const sorted = [...candidates].sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    return order === "newest" ? bt - at : at - bt;
  });

  const segments: StitchSegment[] = [];
  let total = 0;
  for (const ep of sorted) {
    if (total >= target) break;
    const dur = ep.durationSeconds ?? 0;
    if (dur <= 0) continue;
    segments.push({ episodeId: ep.episodeId, startSec: 0, endSec: dur });
    total += dur;
  }

  return { segments, estimatedDurationSec: total };
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

/** A plan segment resolved to a concrete source audio URL. */
export interface ResolvedSegment {
  episodeId: string;
  audioUrl: string;
  startSec: number;
  endSec: number;
}

export interface RunStitchResult {
  status: "ready" | "failed";
  outputAudioUrl?: string;
  durationSec?: number;
  summary?: string;
  error?: string;
}

/** Injected collaborators for a stitch run. */
export interface ConcatDeps {
  storage: StorageClient;
  summarizer: Summarizer;
  /** Cached transcript text per episodeId; enables summary generation. */
  transcripts?: Record<string, string>;
  /** Scratch root for intermediates (default: OS temp dir). */
  workRoot?: string;
  /** Storage key prefix for the output object (default "stitches"). */
  keyPrefix?: string;
}

/**
 * Execute a resolved stitch: concatenate the source segments into one MP3,
 * upload it, and (when transcripts + a summarizer are available) produce a
 * recap. Never throws — always resolves to a RunStitchResult so callers/workers
 * can persist the outcome.
 */
export async function runStitchJob(
  input: { stitchId: string; segments: ResolvedSegment[] },
  deps: ConcatDeps,
): Promise<RunStitchResult> {
  const { stitchId, segments } = input;
  if (segments.length === 0) {
    return { status: "failed", error: "Stitch has no segments." };
  }

  const workDir = path.join(
    deps.workRoot ?? os.tmpdir(),
    `podzi-stitch-${stitchId}`,
  );

  try {
    // 1. Concatenate audio (ffmpeg: normalize → stream-copy concat).
    const concat = await buildConcatenatedAudio(
      segments.map((s) => ({
        source: s.audioUrl,
        startSec: s.startSec,
        endSec: s.endSec,
      })),
      workDir,
    );

    // 2. Upload the stitched file to object storage → public/CDN URL.
    const bytes = await readFile(concat.outputPath);
    const key = `${deps.keyPrefix ?? "stitches"}/${stitchId}.mp3`;
    const stored = await deps.storage.put(key, bytes, "audio/mpeg");

    // 3. Optional recap: only when we have transcripts AND a real summarizer.
    let summary: string | undefined;
    if (deps.transcripts && deps.summarizer.isEnabled()) {
      const combined = segments
        .map((s) => deps.transcripts?.[s.episodeId] ?? "")
        .filter(Boolean)
        .join("\n\n");
      if (combined) {
        summary = await deps.summarizer.summarize(combined);
      }
    }

    return {
      status: "ready",
      outputAudioUrl: stored.url,
      durationSec: concat.durationSec,
      summary,
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Best-effort scratch cleanup; ignore errors.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
