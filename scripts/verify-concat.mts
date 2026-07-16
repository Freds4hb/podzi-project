/**
 * End-to-end verification of the concat engine WITHOUT a database or cloud creds.
 *
 *   npx tsx scripts/verify-concat.mts
 *
 * It synthesizes two short MP3 tones with ffmpeg, runs the real pipeline
 * (ffmpeg normalize → stream-copy concat → LocalStorage upload), and asserts the
 * output exists with the expected total duration. Exercises the exact code path
 * the worker uses, minus the DB/provider layers (which need external services).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runStitchJob } from "../src/lib/concat/pipeline.ts";
import { LocalStorage } from "../src/lib/concat/storage/local.ts";
import { NullSummarizer } from "../src/lib/concat/summarization/types.ts";
import { probeDurationSec } from "../src/lib/concat/audio/ffmpeg.ts";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(err.slice(-800))),
    );
  });
}

function makeTone(outPath: string, freq: number, seconds: number) {
  return ffmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=${seconds}`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outPath,
  ]);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const work = await mkdtemp(path.join(os.tmpdir(), "podzi-verify-"));
try {
  // 1. Synthesize two source episodes: 2s @440Hz and 3s @880Hz.
  const tone1 = path.join(work, "ep1.mp3");
  const tone2 = path.join(work, "ep2.mp3");
  await makeTone(tone1, 440, 2);
  await makeTone(tone2, 880, 3);
  console.log("• generated two source tones (2s + 3s)");

  // 2. Run the real pipeline with local storage and no summarizer.
  const storageDir = path.join(work, "storage");
  const storage = new LocalStorage({
    baseDir: storageDir,
    publicBaseUrl: "http://localhost:3000/_storage",
  });

  const result = await runStitchJob(
    {
      stitchId: "verify-1",
      segments: [
        { episodeId: "ep1", audioUrl: tone1, startSec: 0, endSec: 2 },
        { episodeId: "ep2", audioUrl: tone2, startSec: 0, endSec: 3 },
      ],
    },
    { storage, summarizer: new NullSummarizer(), keyPrefix: "stitches", workRoot: work },
  );

  console.log("• pipeline result:", JSON.stringify(result));

  // 3. Assertions.
  assert(result.status === "ready", `expected ready, got ${result.status} (${result.error ?? ""})`);
  assert(
    result.outputAudioUrl === "http://localhost:3000/_storage/stitches/verify-1.mp3",
    `unexpected output URL: ${result.outputAudioUrl}`,
  );
  assert(
    !!result.durationSec && result.durationSec > 4.5 && result.durationSec < 5.6,
    `expected ~5s total, got ${result.durationSec}`,
  );

  // 4. Confirm the object physically landed in storage with the right duration.
  const stored = path.join(storageDir, "stitches", "verify-1.mp3");
  const info = await stat(stored);
  assert(info.size > 1000, `stored file too small: ${info.size} bytes`);
  const storedDuration = await probeDurationSec(stored);
  assert(
    storedDuration > 4.5 && storedDuration < 5.6,
    `stored file duration off: ${storedDuration}`,
  );

  console.log(
    `• stored ${info.size} bytes, duration ${storedDuration.toFixed(2)}s`,
  );
  console.log("\n✅ concat pipeline verified end-to-end");
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
