/**
 * Summarization factory — selects the implementation from the environment.
 *
 * When no key is set, `getSummarizer()` returns a NullSummarizer and the
 * pipeline simply produces no recap.
 */
import { env } from "@/lib/env";
import { NullSummarizer, LLMSummarizer, type Summarizer } from "./types";

export * from "./types";

export function getSummarizer(): Summarizer {
  if (env.SUMMARIZATION_API_KEY) {
    return new LLMSummarizer({
      apiKey: env.SUMMARIZATION_API_KEY,
      baseUrl: env.SUMMARIZATION_BASE_URL || "https://api.openai.com/v1",
      model: env.SUMMARIZATION_MODEL || "gpt-4o-mini",
    });
  }
  return new NullSummarizer();
}
