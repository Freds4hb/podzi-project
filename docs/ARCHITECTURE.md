# Architecture

## Concatenation method — decision & cost rationale

**Decision: direct-code concatenation.** Evaluated at production scale
(~100,000 users, 85% mobile) against the two alternatives.

The key insight is that the three candidate "methods" are **not substitutes with
different costs** — n8n and API-ranking are *additive layers on top of the same
core costs*. At scale, cost is dominated by two centers, neither affected by the
method choice:

| Cost center | Naïve | Optimized (direct code) |
|-------------|-------|--------------------------|
| Transcription (summaries, smart-trim, sponsor-skip) | ~$160k/mo if done per-stitch | ~$3–13k/mo by transcribing each episode **once** and caching |
| Mobile CDN egress (~27 TB/mo audio) | ~$2.3k/mo (S3/CloudFront) | ~$0 (Cloudflare R2 + CDN) |
| Concat compute (ffmpeg normalize → **stream-copy** concat) | — | ~$0.5–1.5k/mo |
| Storage / LLM summaries / Neon / Clerk@100k | — | ~$5–8k/mo combined |

*(Order-of-magnitude figures to compare structure, not a budget. Assumes ~35k
weekly-active users, ~4 stitches/week × ~45 min, transcripts cached per episode.)*

Overlaying the three methods on that identical base:

| Method | Cost vs. base | Verdict |
|--------|---------------|---------|
| **Direct code** | Base cost; the only option that can apply all four savings levers | ✅ Lowest cost |
| n8n workflow | Base **+** per-execution overhead (~560k stitch-workflows/mo × N nodes); saves nothing on transcription/egress | ❌ Strictly higher |
| API ranking ("most shared/liked") | Base **+** paid social-data APIs, rate-limited, ToS-fragile; additive, not a concat engine | ❌ Strictly higher |

### The four savings levers (all require direct code)

1. **Transcribe once, cache per episode** — the single biggest lever. An episode
   is transcribed the first time any stitch touches it and reused forever after
   (`episodes.transcript_status` / `transcript_url`).
2. **Zero-egress delivery** — serve stitched audio from Cloudflare R2 + CDN.
3. **ffmpeg normalize → stream-copy concat** — each (optionally trimmed)
   segment gets one lightweight re-encode to a uniform MP3, then the parts are
   joined with a `-c copy` stream-copy concat (the join itself is trivial CPU).
   A future fast-path can skip normalization when all sources already share a
   codec/bitrate.
4. **Cheap/self-hosted transcription + small summarization model.**

### Re-scoping the other two (not discarded)

- **n8n** stays **out of the audio hot path**; it's a fine choice for *low-volume*
  ops automation (admin alerts, billing follow-ups, digests) where execution
  counts are tiny. Wired as an adapter for admin visibility.
- **"Most-shared / most-liked" ranking** becomes an **optional enrichment layer**
  added later (rank/trim segments by social signal), budgeted separately — never
  the core engine.

## Profile-driven processing

Requirement: only search/fetch/process podcasts a user explicitly follows. This
is enforced **structurally**, not by convention:

- `followed_shows` is the explicit allow-list (user → show).
- The concat planner (`src/lib/concat/pipeline.ts`) is a **pure function** that
  takes an already-restricted candidate pool. The data layer builds that pool by
  joining `followed_shows → episodes`, so episodes from unfollowed shows can
  never enter a stitch.

## Why a background worker

First-time transcription and full-episode concatenation routinely exceed
serverless request time limits. Therefore:

- The web request only **enqueues** a job (`stitches` row, status `queued`) —
  `POST /api/stitches`.
- A separate worker/queue consumer runs `processStitch` (transcribe-if-needed →
  trim → ffmpeg concat → upload → summarize → mark `ready`). Locally:
  `npm run worker:process -- <stitchId>`.

This keeps API latency low and cost bounded, and makes each job auditable and
re-runnable from its stored segment plan.

## Pipeline implementation (wired)

The engine lives in `src/lib/concat/` and is dependency-injected so each layer is
swappable and testable:

- `audio/ffmpeg.ts` — normalize + stream-copy concat + duration probe (pure).
- `storage/` — `StorageClient` with `LocalStorage` (dev) and `S3Storage`
  (Cloudflare R2 / S3, production); `getStorage()` picks by env.
- `transcription/` + `summarization/` — pluggable, OpenAI-compatible providers
  with Null implementations so the pipeline runs **audio-only** when no keys are
  set. Transcripts are cached per episode via `StorageClient.get/put`.
- `repository.ts` — profile-gated candidate query + stitch/transcript persistence.
- `pipeline.ts` — pure `planStitch` + injected `runStitchJob`.
- `worker.ts` — `processStitch` orchestrates the above.

**Verification:** `npm run verify:concat` exercises the real path end-to-end
(ffmpeg → concat → storage) with generated tones — no DB or cloud creds needed.

### Not yet wired
- Smart-stitch trimming / sponsor-skip (transcript-driven segment ranges — the
  data model and trim support already exist; the segment-selection logic is next).
- A production queue/consumer (currently a CLI runner + enqueue API).
- Stripe→entitlement persistence and Clerk-derived auth on `/api/stitches`.

## Cross-platform

Clerk provides auth for both web and the upcoming native mobile apps (shared
identity, one user record keyed by `clerk_user_id`). The API routes here are the
shared backend for web and mobile; the stitched-audio CDN URLs are consumed
identically by any client.
