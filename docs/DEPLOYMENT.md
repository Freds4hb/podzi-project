# Deployment

Everything in this repository builds and serves with **no credentials**. That is
useful for development and it is why CI needs no secrets — but it also means a
deployment can come up looking healthy while most of the product is switched
off. This runbook exists so that does not happen quietly.

Run `npm run check:env` at any point to see exactly what is configured, what is
missing, and what each missing variable turns off. It never prints a secret.

## The one thing to decide before you start

**The web app and the stitch worker cannot run in the same place.**

| Component | What it is | Where it runs | Why |
|-----------|------------|---------------|-----|
| Web app | Next.js — pages + `/api/*` routes | **Vercel** | Ordinary serverless Next.js app |
| Stitch worker | `processStitch` in `src/lib/concat/worker.ts` | **A container host** (Fly.io, Railway, Render, ECS, a VM…) | Spawns `ffmpeg` as a child process, and a full-episode concat routinely exceeds serverless request limits |

This split is not a preference; it follows from two facts already recorded in
[`ARCHITECTURE.md`](ARCHITECTURE.md). `ffmpeg` is a binary the pipeline shells
out to (`src/lib/concat/audio/ffmpeg.ts`), and Vercel's serverless runtime does
not provide it. Transcription-plus-concat for a real episode also runs far
longer than a request should.

**What this means in practice:** deploying only to Vercel gives you a working
product for everything *except* producing stitched audio. Finding, previewing,
following and browsing podcasts all work — those routes never touch ffmpeg.
`POST /api/stitches` will happily enqueue a job; nothing will process it until a
worker exists. That is a coherent first milestone, as long as you know that is
what you shipped.

## Order of operations

Each step is independently verifiable, so do them in order and check as you go.

### 1 · Neon — the database

Without this, nothing persists.

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **pooled** connection string (the host contains `-pooler`). The
   pooled endpoint is what the serverless driver in `src/db/index.ts` expects;
   the direct one will exhaust connections under many short-lived invocations.
3. Put it in `.env.local` as `DATABASE_URL`.
4. Apply the schema:

   ```bash
   npm run db:migrate
   ```

   The migrations in `drizzle/` are committed and are the same SQL that
   `npm run verify:podcasts` applies to an in-process Postgres on every CI run —
   so they are known to apply cleanly to an empty database before you point them
   at Neon.

**Verify:** `npm run dev`, open `/admin`, and the **Neon** card should read
*Connected*.

### 2 · Clerk — authentication

Until this is done, two things are true and both matter:

- `/admin` is **not protected**. `src/middleware.ts` deliberately becomes a
  pass-through when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is absent, so the
  scaffold runs locally — which means an unconfigured *public* deployment leaves
  the admin dashboard open. Do not expose one publicly.
- No request can be attributed to a user, so `/api/podcasts/follow` and
  `/api/stitches` still take an explicit `userId` (marked `TODO(auth)` in both).
  The web Follow action is disabled rather than inventing a user.

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
3. Point Clerk's allowed origins at your Vercel domain.

**Verify:** the **Clerk** card on `/admin` reads *Connected*, and `/admin` now
requires a sign-in.

> Wiring sessions through to the two routes is still outstanding work — see
> Known gaps in the [README](../README.md). Setting the keys protects `/admin`
> and enables sign-in; it does not by itself make the follow flow user-scoped.

### 3 · Vercel — the web app

1. Import the repository at [vercel.com/new](https://vercel.com/new). Framework
   detection handles the rest; there is no `vercel.json`, and none is needed.
2. Add the environment variables from steps 1–2 under **Settings →
   Environment Variables**, for Production *and* Preview. A preview deployment
   with no `DATABASE_URL` will build fine and then 503 on every DB route.
3. Deploy.

**Verify:** `curl https://<your-domain>/api/health` returns
`{"ok":true,...}`, and `/podcasts` loads and can preview a feed.

Two notes specific to this app:

- The build needs no credentials, so a missing variable will **not** fail the
  build. `npm run check:env -- --require-core` is the way to make incomplete
  configuration loud; consider it as a pre-deploy step.
- `/api/stitches` imports `planStitch` from `@/lib/concat/pipeline`, not from
  the `@/lib/concat` barrel. That is deliberate — the barrel re-exports the
  worker, which would pull ffmpeg's child-process code into the route's bundle.
  Keep it that way.

### 4 · Podcast Index — search (optional)

Free developer key at [api.podcastindex.org](https://api.podcastindex.org). Set
`PODCAST_INDEX_API_KEY` and `PODCAST_INDEX_API_SECRET`.

Skipping this is a real option: adding a show by feed URL needs no credentials
at all, and `/api/podcasts/search` returns a 503 that the UI explains and routes
around. See [`IDENTIFICATION.md`](IDENTIFICATION.md).

### 5 · Object storage — durable audio (needed before the worker is useful)

Cloudflare R2 is the recommended default; the cost model in
[`ARCHITECTURE.md`](ARCHITECTURE.md) assumes its zero egress, which is the
difference between roughly $0 and roughly $2.3k/month at scale.

Set `AUDIO_STORAGE_ENDPOINT`, `AUDIO_STORAGE_BUCKET`,
`AUDIO_STORAGE_ACCESS_KEY_ID`, `AUDIO_STORAGE_SECRET_ACCESS_KEY`,
`AUDIO_STORAGE_REGION=auto`, and `AUDIO_STORAGE_PUBLIC_URL`.

Without these the storage client falls back to local disk (`.storage/`), which
is ephemeral on every host worth deploying to — fine for development, useless in
production.

### 6 · The worker — stitched audio

Not yet a deployable unit: there is a CLI entry point
(`npm run worker:process -- <stitchId>`) but **no queue consumer and no
container image**. To finish it you need a host with `ffmpeg` on `PATH` (or
`FFMPEG_PATH` / `FFPROBE_PATH` set), the same `DATABASE_URL` and storage
credentials as the web app, and a loop or queue that picks up `stitches` rows in
`queued` state. Until then, enqueued jobs simply wait.

### 7 · Stripe — billing (optional)

Set `STRIPE_SECRET_KEY`, then add a webhook endpoint pointing at
`https://<your-domain>/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET` to
its signing secret. The route verifies signatures against the raw body and
rejects everything if the secret is absent, so subscriptions will not sync until
both are set.

## Pre-deploy checklist

```bash
npm run check:env -- --require-core   # fails if DB/auth are incomplete
npm run verify:all                    # typecheck + concat + identification
npm run verify:live                   # build, serve, HTTP + browser suites
```

`verify:concat` needs ffmpeg locally (install it, or `npm i ffmpeg-static
ffprobe-static` and point `FFMPEG_PATH`/`FFPROBE_PATH` at them). CI installs
system ffmpeg for exactly this reason.

## What "deployed" will and will not mean

After steps 1–3, honestly:

| Works | Does not work |
|-------|---------------|
| Find, preview and browse podcasts | Producing stitched audio (no worker) |
| The catalogue and follow list | User-scoped follow from the UI (no session wiring) |
| `/admin`, protected, with live health | Billing (until Stripe is set) |
| Health and integration status | Directory search (until Podcast Index is set) |

That is a real, useful deployment. It is not the whole product, and the table
above is the accurate version of "it's live".
