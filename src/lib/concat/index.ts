/**
 * Podcast concatenation — public module surface.
 *
 * METHOD DECISION (see docs/ARCHITECTURE.md for the full cost analysis):
 * we use the **direct-code** path. At 100k users / 85% mobile it is the
 * lowest-cost option because the two dominant cost centers — transcription and
 * mobile CDN egress — are identical across every method, and only direct code
 * lets us apply the savings levers:
 *   1. Transcribe each episode ONCE and cache it (see episodes.transcriptStatus).
 *   2. Serve stitched audio from zero-egress object storage + CDN (R2).
 *   3. Concatenate with ffmpeg stream-copy (no re-encode) → trivial CPU.
 *   4. Cheap/self-hosted transcription + a small summarization model.
 *
 * PROFILE-DRIVEN RULE: we only ever search/fetch/process episodes from shows the
 * user explicitly follows. `planStitch` enforces this by taking the user's
 * followed-show episodes as its only candidate pool.
 */
export * from "./pipeline";
