/**
 * Transcription — interface and implementations (env-free).
 *
 * Kept independent of the env layer so it can be constructed with explicit
 * config and unit-tested. The env-driven factory lives in ./index.ts.
 */
export interface Transcriber {
  readonly name: string;
  /** Whether a real provider is configured. */
  isEnabled(): boolean;
  /**
   * Transcribe an audio file (local path or URL) to plain text.
   * Implementations must throw a clear error if called while not enabled.
   */
  transcribe(audioPathOrUrl: string): Promise<string>;
}

/** No-op transcriber used when no provider is configured (audio-only mode). */
export class NullTranscriber implements Transcriber {
  readonly name = "null";
  isEnabled() {
    return false;
  }
  async transcribe(): Promise<string> {
    throw new Error(
      "Transcription is not configured (set TRANSCRIPTION_API_KEY).",
    );
  }
}

/**
 * OpenAI-compatible Whisper transcriber. Posts the audio file as multipart form
 * data to `${baseUrl}/audio/transcriptions`. Works with OpenAI or any
 * API-compatible/self-hosted endpoint (the cost-optimal path at scale is a
 * self-hosted Whisper behind this same interface).
 */
export class WhisperTranscriber implements Transcriber {
  readonly name = "whisper";
  constructor(
    private readonly cfg: { apiKey: string; baseUrl: string; model: string },
  ) {}

  isEnabled() {
    return Boolean(this.cfg.apiKey);
  }

  async transcribe(audioPathOrUrl: string): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error("WhisperTranscriber called without an API key.");
    }
    const bytes = await loadBytes(audioPathOrUrl);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", this.cfg.model);
    form.append("response_format", "text");

    const res = await fetch(
      `${this.cfg.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        body: form,
      },
    );
    if (!res.ok) throw new Error(`Transcription failed: HTTP ${res.status}`);
    return (await res.text()).trim();
  }
}

/** Load audio bytes as an ArrayBuffer (a valid, well-typed BlobPart). */
async function loadBytes(pathOrUrl: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) throw new Error(`Could not fetch audio: HTTP ${res.status}`);
    return res.arrayBuffer();
  }
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(pathOrUrl);
  // Return a standalone ArrayBuffer slice (avoids SharedArrayBuffer typing).
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}
