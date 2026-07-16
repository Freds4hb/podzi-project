/**
 * Summarization — interface and implementations (env-free).
 *
 * Kept independent of the env layer so it can be constructed with explicit
 * config and unit-tested. The env-driven factory lives in ./index.ts.
 */
export interface Summarizer {
  readonly name: string;
  isEnabled(): boolean;
  /** Summarize a (possibly long) transcript into a short recap. */
  summarize(transcript: string): Promise<string>;
}

/** No-op summarizer used when no provider is configured. */
export class NullSummarizer implements Summarizer {
  readonly name = "null";
  isEnabled() {
    return false;
  }
  async summarize(): Promise<string> {
    throw new Error(
      "Summarization is not configured (set SUMMARIZATION_API_KEY).",
    );
  }
}

/** OpenAI-compatible chat-completions summarizer using a small, cheap model. */
export class LLMSummarizer implements Summarizer {
  readonly name = "llm";
  constructor(
    private readonly cfg: { apiKey: string; baseUrl: string; model: string },
  ) {}

  isEnabled() {
    return Boolean(this.cfg.apiKey);
  }

  async summarize(transcript: string): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error("LLMSummarizer called without an API key.");
    }
    // Cap the transcript to keep token cost bounded; a production version would
    // chunk-and-reduce very long transcripts.
    const clipped = transcript.slice(0, 24_000);
    const res = await fetch(
      `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            {
              role: "system",
              content:
                "You write concise, friendly catch-up recaps of stitched " +
                "podcast episodes. 4-6 sentences, no preamble.",
            },
            { role: "user", content: clipped },
          ],
          temperature: 0.4,
        }),
      },
    );
    if (!res.ok) throw new Error(`Summarization failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }
}
