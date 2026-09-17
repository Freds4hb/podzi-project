/**
 * Transcription factory — selects the implementation from the environment.
 *
 * The pipeline transcribes each source episode ONCE and caches the result (the
 * single biggest cost lever — see docs/ARCHITECTURE.md). When no provider key is
 * set, `getTranscriber()` returns a NullTranscriber and the pipeline runs in
 * audio-only mode (still stitches audio; skips transcript-dependent features).
 */
import { env } from "@/lib/env";
import {
  NullTranscriber,
  WhisperTranscriber,
  type Transcriber,
} from "./types";

export * from "./types";

export function getTranscriber(): Transcriber {
  if (env.TRANSCRIPTION_API_KEY) {
    return new WhisperTranscriber({
      apiKey: env.TRANSCRIPTION_API_KEY,
      baseUrl: env.TRANSCRIPTION_BASE_URL || "https://api.openai.com/v1",
      model: env.TRANSCRIPTION_MODEL || "whisper-1",
    });
  }
  return new NullTranscriber();
}
