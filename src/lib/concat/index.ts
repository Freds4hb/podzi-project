/**
 * Podcast concatenation — public module surface.
 *
 * METHOD DECISION (see docs/ARCHITECTURE.md for the full cost analysis):
 * we use the **direct-code** path. At 100k users / 85% mobile it is the
 * lowest-cost option because the two dominant cost centers — transcription and
 * mobile CDN egress — are identical across every method, and only direct code
 * lets us apply the savings levers:
 *   1. Transcribe each episode ONCE and cache it (worker.ts + repository.ts).
 *   2. Serve stitched audio from zero-egress object storage + CDN (storage/).
 *   3. Concatenate with ffmpeg (normalize → stream-copy concat) (audio/).
 *   4. Cheap/self-hosted transcription + a small summarization model.
 *
 * PROFILE-DRIVEN RULE: we only ever process episodes from shows the user
 * explicitly follows. `getCandidateEpisodesForUser` (repository.ts) is the gate;
 * `planStitch` (pipeline.ts) operates only on that restricted pool.
 */
export * from "./pipeline";
export { processStitch } from "./worker";
export { getStorage } from "./storage";
export { getTranscriber } from "./transcription";
export { getSummarizer } from "./summarization";
export * as repository from "./repository";
