/**
 * Concatenation pipeline — types, the profile-gated segment planner, and the
 * background-worker contract.
 *
 * WHY A BACKGROUND WORKER (not an inline request handler):
 * Stitching and (first-time) transcription of full episodes routinely exceed
 * serverless request time limits. The web request only ENQUEUES a stitch job
 * (writing a `stitches` row with status "queued"); a separate worker/queue
 * consumer runs `runStitchJob`. This keeps the API fast and the costs bounded.
 *
 * This file is the wiring contract for that pipeline. The actual ffmpeg and
 * transcription calls are marked with `TODO(wire)` and guarded so the scaffold
 * builds and typechecks without ffmpeg, storage, or provider keys present.
 */

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
  /** Whether a cached transcript already exists (drives cost/latency). */
  hasCachedTranscript: boolean;
  publishedAt: Date | null;
}

/** One ordered segment of the final stitched stream. */
export interface StitchSegment {
  episodeId: string;
  startSec: number;
  endSec: number;
}

/** Result of planning: the ordered segments plus a rough duration estimate. */
export interface StitchPlan {
  segments: StitchSegment[];
  estimatedDurationSec: number;
}

/** Inputs that shape a stitch (kept small; expand as features land). */
export interface StitchOptions {
  /** Target total length; the planner packs segments up to this budget. */
  targetDurationSec?: number;
  /** Newest-first (default) or oldest-first ordering of source episodes. */
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
 * user follows. This function does not fetch anything — it is pure so it can be
 * unit-tested and audited. The profile gate lives at the data layer (a query
 * that joins `followed_shows`), and this signature makes the contract explicit.
 *
 * Current heuristic (v0): whole-episode concatenation in the requested order,
 * packing episodes until the target duration budget is reached. Smart-stitch
 * trimming and sponsor-skip will later replace whole-episode segments with
 * transcript-derived [startSec, endSec] ranges — the return shape already
 * supports that without a schema change.
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
    if (dur <= 0) continue; // skip episodes with unknown/zero duration
    segments.push({ episodeId: ep.episodeId, startSec: 0, endSec: dur });
    total += dur;
  }

  return { segments, estimatedDurationSec: total };
}

/* -------------------------------------------------------------------------- */
/* Execution (background worker contract)                                      */
/* -------------------------------------------------------------------------- */

export interface RunStitchResult {
  status: "ready" | "failed";
  outputAudioUrl?: string;
  summary?: string;
  error?: string;
}

/**
 * Execute a planned stitch. Intended to run in a background worker, NOT in a
 * request handler. Steps (each a TODO to wire against real infra):
 *
 *   1. Ensure a cached transcript for every source episode (transcribe once).
 *   2. (Later) apply smart-stitch trimming / sponsor-skip using transcripts.
 *   3. Download source audio segments and concatenate with ffmpeg stream-copy.
 *   4. Upload the stitched file to zero-egress object storage; get a CDN URL.
 *   5. Generate a recap/summary from the concatenated transcript.
 *   6. Update the `stitches` row (status "ready" + outputAudioUrl + summary).
 *
 * Guarded so the scaffold builds without ffmpeg/storage/provider keys: until the
 * pipeline is wired, it returns a clear "not implemented" failure rather than
 * pretending to succeed.
 */
export async function runStitchJob(plan: StitchPlan): Promise<RunStitchResult> {
  // TODO(wire): steps 1–6 above. Deliberately not implemented in the scaffold.
  void plan;
  return {
    status: "failed",
    error:
      "Concatenation pipeline is scaffolded but not yet wired to ffmpeg, " +
      "object storage, or transcription/summarization providers.",
  };
}
