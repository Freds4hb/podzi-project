/**
 * ffmpeg audio operations for the concatenation engine.
 *
 * These functions are intentionally PURE infrastructure: they take file paths
 * and options and shell out to the system `ffmpeg`/`ffprobe` binaries. They hold
 * no env, no database, and no provider state, so they are directly unit-testable
 * (see scripts/verify-concat.mts).
 *
 * CONCAT STRATEGY (honest version):
 * Different podcasts ship different codecs/bitrates, so a naive stream-copy
 * concat of the raw sources usually fails. We therefore:
 *   1. NORMALIZE each (optionally trimmed) segment to a uniform MP3
 *      (44.1kHz stereo, 128kbps) — this is the only re-encode.
 *   2. CONCAT the normalized parts with the concat demuxer using `-c copy`
 *      (stream-copy) — MP3 concatenates reliably this way, so the join itself
 *      is trivial CPU.
 * A future fast-path can skip step 1 when all sources already share a codec
 * (see docs/ARCHITECTURE.md). Runs in a background worker, never in a request.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** A normalized, optionally trimmed source segment. */
export interface AudioSegmentInput {
  /** Local path OR http(s) URL of the source audio. */
  source: string;
  /** Trim start (seconds). 0 = from the beginning. */
  startSec: number;
  /** Trim end (seconds). Omit/0 = to the end of the source. */
  endSec?: number;
}

export interface ConcatResult {
  outputPath: string;
  durationSec: number;
  bytes: number;
}

/** Run a child process, rejecting on non-zero exit with a trimmed stderr tail. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      // Keep only the tail so errors stay readable.
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

/** Capture stdout of a command (used for ffprobe). */
function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())),
    );
  });
}

/** Probe an audio file's duration in seconds. */
export async function probeDurationSec(file: string): Promise<number> {
  const out = await capture(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const n = Number.parseFloat(out);
  return Number.isFinite(n) ? n : 0;
}

/** Ensure a source is a local file, downloading http(s) URLs into `workDir`. */
async function localizeSource(source: string, workDir: string, idx: number) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`Failed to download source ${source}: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(workDir, `src_${idx}`);
    await writeFile(dest, buf);
    return dest;
  }
  // Accept file:// URLs and bare paths.
  const p = source.startsWith("file://") ? source.slice("file://".length) : source;
  if (!existsSync(p)) throw new Error(`Source not found: ${p}`);
  return p;
}

/** Normalize (and optionally trim) one segment to a uniform MP3. */
async function normalizeSegment(
  srcPath: string,
  segment: AudioSegmentInput,
  outPath: string,
): Promise<void> {
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  // `-ss` before `-i` = fast input seek to the trim start.
  if (segment.startSec > 0) args.push("-ss", String(segment.startSec));
  args.push("-i", srcPath);
  if (segment.endSec && segment.endSec > segment.startSec) {
    args.push("-t", String(segment.endSec - segment.startSec));
  }
  args.push(
    "-vn", // drop any cover-art video stream
    "-ac",
    "2",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outPath,
  );
  await run(FFMPEG, args);
}

/**
 * Build a single concatenated MP3 from an ordered list of (trimmed) segments.
 *
 * @param segments Ordered source segments (already restricted to followed shows
 *                 by the caller — see pipeline.ts).
 * @param workDir  Scratch directory for intermediates + output.
 * @param outName  Output file name (default "stitch.mp3").
 */
export async function buildConcatenatedAudio(
  segments: AudioSegmentInput[],
  workDir: string,
  outName = "stitch.mp3",
): Promise<ConcatResult> {
  if (segments.length === 0) throw new Error("No segments to concatenate.");
  await mkdir(workDir, { recursive: true });

  // 1. Normalize each segment to a uniform MP3 part.
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const src = await localizeSource(segments[i].source, workDir, i);
    const partPath = path.join(workDir, `part_${i}.mp3`);
    await normalizeSegment(src, segments[i], partPath);
    parts.push(partPath);
  }

  // 2. Concat the normalized parts with stream-copy via the concat demuxer.
  const listPath = path.join(workDir, "concat.txt");
  // The demuxer requires each entry as: file '<absolute-path>'
  const listBody = parts
    .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, listBody + "\n");

  const outputPath = path.join(workDir, outName);
  await run(FFMPEG, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ]);

  const durationSec = await probeDurationSec(outputPath);
  const bytes = (await readFile(outputPath)).length;
  return { outputPath, durationSec, bytes };
}
