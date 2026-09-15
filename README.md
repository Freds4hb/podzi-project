# Podzi.ai

Podcast **concatenation** ("the stitch") — pull the moments that matter from the
shows a listener follows and hand back one continuous episode, with auth,
billing, and an integration admin dashboard around it.

- **Framework:** Next.js (App Router) + TypeScript, targeted at **Vercel**
- **Database:** **Neon** Postgres via Drizzle ORM
- **Auth:** **Clerk** (web + planned native mobile)
- **Payments:** **Stripe** (Free / Pro / Family Pro)
- **Automation:** **n8n** (low-volume ops only — deliberately out of the audio hot path)
- **Concat engine:** direct-code pipeline (chosen on cost — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md))
- **Design system:** brand tokens, logo lockups, and website UI kit in [`tokens/`](tokens/), [`assets/`](assets/), [`ui_kits/`](ui_kits/)

This branch is the **collected main**: the two previously separate work streams
(platform scaffold + design system/pricing page) plus the podcast-identification
layer and both clients, rebased into one linear history. It also records a
verified status audit across every system the project touches.

---

## Status at a glance

Audited **2026-08-17**, re-verified **2026-09-14**. The two ❌ rows that were
"not built" are now built and tested — see
[`docs/IDENTIFICATION.md`](docs/IDENTIFICATION.md). Everything requiring *your*
credentials is still unconnected, because it needs keys this session cannot hold.
Detail and method in [Verification log](#verification-log).

| Area | Claim | Verified state |
|------|-------|----------------|
| Application code | Complete | ✅ **Real and working** — 48 files, typechecks clean, production build succeeds |
| Concat engine | Working | ✅ **Verified end-to-end** — produced a correct stitched MP3 from real audio |
| Design system | Complete | ⚠️ **Partial in git** — tokens + logo + **1 of 13** website pages |
| GitHub | Up to date across the board | ❌ **No** — `master` still has no app code; all work sits in unmerged draft PRs |
| Vercel ↔ Clerk ↔ Neon | Connected | ❌ **Not for this repo** — accounts exist, nothing wired to `podzi-project` |
| Devin.ai | Has performance reports | ⚠️ **Yes, but elsewhere** — reports are on two *other* DS4-Design repos |
| Drive / Cowork data | On the desktop drive | ✅ **Substantial material exists** in Google Drive (design deck, app flow, SOPs) |
| Podcast identification | New code exists | ✅ **Built and verified** — RSS/Atom reader (no keys) + Podcast Index search; ingest, idempotence and profile gate tested against real Postgres |
| Mobile / desktop clients | Wired to the engine | ⚠️ **Built, partly verified** — web UI verified in a browser end-to-end; Expo client typechecks against real RN types but has not been run on a device |

**Bottom line:** the engineering is in better shape than the delivery pipeline,
but the pipeline is now prepared rather than absent. Both core algorithms —
concatenation and identification — are verified end-to-end against real inputs;
migrations are committed and proven to apply; CI runs every suite without
credentials; and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) is a step-by-step
runbook. What remains is the part only you can do: provisioning Neon, Clerk and
Vercel. One structural caveat worth knowing before you start — the stitch worker
needs `ffmpeg` and so cannot run on Vercel; a Vercel-only deploy gives you the
whole product *except* producing stitched audio.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in values as you connect each service
npm run dev                  # http://localhost:3000  (admin: /admin)
```

The app builds and renders the admin dashboard with **no credentials present** —
every integration reports "not configured" rather than crashing.

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:concat` | End-to-end concat check (needs ffmpeg; no DB/cloud) |
| `npm run verify:podcasts` | Identification check — feed parsing, auth signing, ingest + profile gate against in-process Postgres |
| `npm run verify:live` | Builds, starts the server, runs the HTTP + browser suites, stops |
| `npm run verify:all` | typecheck + concat + podcasts (no server needed) |
| `npm run check:env` | Report which variables are set and what each missing one turns off |
| `npm run check:env -- --require-core` | Same, but exit 1 if the database/auth core is incomplete |
| `npm run worker:process -- <stitchId>` | Run the worker for one stitch |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations + browser |

**ffmpeg is a hard requirement** for the audio pipeline and is *not* bundled.
Install it system-wide, or point `FFMPEG_PATH` / `FFPROBE_PATH` at binaries
(e.g. the `ffmpeg-static` / `ffprobe-static` npm packages — that is how the
verification below was run).

---

## Project structure

```
src/
  app/
    page.tsx                     Landing (placeholder — UI kit not yet wired in)
    admin/                       Integration admin dashboard (server component)
    podcasts/                    Find-podcasts screen (client component + CSS module)
    api/
      health/                    Liveness probe
      integrations/status/       Live per-service health (feeds admin cards)
      podcasts/preview/          Read a feed — no DB, no API key required
      podcasts/search/           Directory search (503 when unconfigured)
      podcasts/follow/           Ingest a feed + open the profile gate
      podcasts/library/          Followed shows + recent episodes
      stitches/                  Enqueue a stitch job
      stripe/webhook/            Stripe receiver (signature-verified)
  db/schema.ts                   users, subs, shows, episodes, stitches, admin
  lib/
    env.ts                       Central env access + isConfigured/requireEnv
    integrations/                One adapter per service + registry
    podcasts/                    Identification — see docs/IDENTIFICATION.md
      rss.ts                     RSS/Atom reader + duration parsing (pure)
      podcastindex.ts            Directory search + request signing
      ingest.ts                  Upserts, follow list, profile-gated reads
    concat/                      Direct-code concatenation engine
      pipeline.ts                Pure planStitch + injected runStitchJob
      audio/ffmpeg.ts            Normalize + stream-copy concat + probe
      storage/                   LocalStorage (dev) + S3/R2 (prod)
      transcription/ summarization/   Pluggable, Null-safe providers
      repository.ts              Profile-gated queries + transcript cache
      worker.ts                  processStitch orchestration
  middleware.ts                  Clerk auth gate (no-op until keys are set)

drizzle/       Generated SQL migrations (committed; applied by db:migrate)
.github/       CI workflow — typecheck, build, and every verify suite
packages/
  api-client/    Shared, dependency-free typed HTTP client — used by BOTH clients
apps/
  mobile/        Expo / React Native client (expo-router)
tokens/        Design tokens — colors, typography, spacing, effects, fonts
assets/logo/   Logo lockups + favicon (SVG)
ui_kits/       Website UI kit (currently: pricing page)
docs/          ARCHITECTURE.md (cost model) · INTEGRATIONS.md (wiring)
               IDENTIFICATION.md (how shows get into the catalogue)
               DEPLOYMENT.md (provisioning runbook + the worker split)
```

---

## Performance & cost model

The concat method was chosen on **cost at production scale** (~100k users, 85%
mobile), not convenience. Full derivation in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

The decisive insight: the three candidate methods are **not substitutes** — n8n
and API-ranking are *additive layers on the same core costs*. Cost is dominated
by two centers, neither affected by the method choice.

| Cost center | Naïve | Optimized (direct code) |
|-------------|-------|--------------------------|
| Transcription | ~$160k/mo per-stitch | **~$3–13k/mo** transcribe-once + cache |
| Mobile CDN egress (~27 TB/mo) | ~$2.3k/mo (S3/CloudFront) | **~$0** (Cloudflare R2 + CDN) |
| Concat compute | — | ~$0.5–1.5k/mo (normalize → stream-copy) |
| Storage / LLM / Neon / Clerk @100k | — | ~$5–8k/mo combined |

*Order-of-magnitude figures to compare structure, not a budget.*

| Method | Cost vs. base | Verdict |
|--------|---------------|---------|
| **Direct code** | Base — the only option that can apply all four savings levers | ✅ Lowest |
| n8n workflow | Base **+** ~560k workflow executions/mo × N nodes | ❌ Strictly higher |
| API ranking | Base **+** paid social APIs, rate-limited, ToS-fragile | ❌ Strictly higher |

**The four levers:** (1) transcribe each episode once and cache forever —
the single biggest saving; (2) zero-egress delivery via R2 + CDN;
(3) ffmpeg normalize → **stream-copy** concat, so the join itself is trivial CPU;
(4) cheap/self-hosted transcription + a small summarization model.

### Measured performance

| Metric | Result | Method |
|--------|--------|--------|
| Concat accuracy | **5.068 s** output from 2 s + 3 s inputs | `npm run verify:concat`, ffmpeg 7.0.2-static |
| Output integrity | **81,544-byte** playable MP3, duration probed | Same run |
| Production build | **Pass** — all 12 routes compiled | `next build` |
| Type safety | **Pass** — zero errors, web and mobile | `tsc --noEmit` in root and `apps/mobile` |
| Feed parsing | **Pass** — RSS + Atom, 3 duration formats, junk rejected | `npm run verify:podcasts` |
| Ingest idempotence | **Pass** — 1 show / 3 episodes after 3 ingests; cached transcript preserved | Same run, real Postgres |
| Profile gate | **Pass** — unfollowed show yields 0 episodes | Same run |
| UI ↔ backend | **Pass** — browser pasted a feed, server data rendered, 0 console errors | `npm run verify:ui` |

The 68 ms over 5.000 s is expected MP3 frame padding, not drift.

---

## Integrations

Every third-party service is an **adapter** implementing `isConfigured()` +
read-only `healthCheck()` (`src/lib/integrations/types.ts`). `/admin` and
`/api/integrations/status` iterate the registry, so adding a service is one
adapter + one registry entry. Secrets live **only** in environment variables.

| Service | Purpose | Required env | Health probe | Wired to this repo? |
|---------|---------|--------------|--------------|---------------------|
| **Vercel** | Hosting / deploys | `VERCEL_API_TOKEN` | `GET /v2/user` | ❌ Not connected |
| **Clerk** | Auth (web + mobile) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `GET /v1/users?limit=1` | ❌ No keys bound |
| **Neon** | Postgres | `DATABASE_URL` (pooled) | `SELECT 1` | ❌ No project found |
| **Stripe** | Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `GET /v1/balance` | ❌ Not configured |
| **n8n** | Ops automation | `N8N_BASE_URL`, `N8N_API_KEY` | `GET /api/v1/workflows?limit=1` | ❌ Not configured |

"Adapter written and health-checked" ≠ "service connected." Every adapter above
is code-complete and will report **Connected** the moment real credentials are
set. None currently has them. See [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)
for the connect/rotate procedure.

---

## Verification log

Audited **2026-08-17** against live systems.

### ✅ Application code — real and working

- **48 files** across app, db, integrations, and the concat engine.
- `tsc --noEmit` → **0 errors**.
- `next build` → **succeeded**, 7 routes (`/`, `/admin`, `/api/health`,
  `/api/integrations/status`, `/api/stitches`, `/api/stripe/webhook`,
  `/_not-found`) + 85.7 kB middleware.
- Merged tree (scaffold + design system) re-validated after collection.

### ✅ Concat engine — verified end-to-end

`npm run verify:concat` exercises the real path (ffmpeg → concat → storage) with
generated tones, no DB or cloud credentials:

```
• generated two source tones (2s + 3s)
• pipeline result: {"status":"ready","durationSec":5.067755}
• stored 81544 bytes, duration 5.07s
✅ concat pipeline verified end-to-end
```

This is the project's core algorithm and it demonstrably works.

### ⚠️ Design system — partial in git

- **In this repo:** 5 token files, 3 SVG logo assets, `styles.css`, and
  `ui_kits/website/pricing.html` (232 lines).
- **In Drive:** `Podzi_Design_Review___Website___App.pptx` (2026-07-24) covers
  **13 website pages and 13 app screens** — landing, shows, pricing, Stitch AI,
  download, about, blog, careers, press, help, contact, privacy, terms; plus
  login, setup, home, search, stitch, library, player, you, import, billing,
  payment, notifications, help.
- **Gap:** 1 of 13 website pages is committed. The other 12 pages and all 13 app
  screens exist as design, not as code in this repository.
- `ui_kits/website/README.md` describes `index.html`, which is **not** in the
  branch — the doc was written for a landing page that was never committed here.

### ❌ GitHub — was not up to date

- `master` contained **one** commit (`6eca0ac`, gstack tooling setup) and **no
  application code**.
- Both work streams sat in **open draft PRs**, unmerged since **2026-07-16**:
  - [#1](https://github.com/Freds4hb/podzi-project/pull/1) — pricing page from the design system
  - [#2](https://github.com/Freds4hb/podzi-project/pull/2) — platform scaffold
- **Zero CI checks** configured — no workflow, no status checks, no deploy bot.
- Last push to the repo: **2026-07-16**, ~1 month before this audit.

*This branch resolves the merge half: both branches are now collected into one
tree that typechecks and builds.*

### ❌ Vercel / Clerk / Neon — accounts exist, nothing connected here

| System | Evidence found | Connected to `podzi-project`? |
|--------|----------------|-------------------------------|
| Vercel | Active paid account, team "DS4 Design", 2FA enabled | **No** — zero check runs on both PRs; no Vercel GitHub app on this repo |
| Clerk | Account created 2026-07-14; still in evaluation | **No** — no instance keys bound |
| Neon | No project, no connection string, no account activity found | **No** |

The only Vercel projects with deployment activity are **`zeitgeist-digest`** and
**`3d-cad-library-id`**, and both are **failing** — the most recent failure was
**2026-08-14** ("Failed preview deployment on team 'DS4 Design'"), with earlier
failures on 2026-07-17, 2026-07-11, and 2026-07-06.

This matches the project's own record: a 2026-07-17 status update describes
running on Vercel with logins and security as the **next step**, not a completed
one.

### ⚠️ Devin.ai — reports exist, on different repositories

Active Cognition AI subscription confirmed. Devin's GitHub integration has
produced real work and reports, but on the **predecessor and sibling** projects:

| Repo | PR | Devin output |
|------|----|--------------|
| `DS4-Design/Zeitgeist-Digest` | #4 — Migrate from Supabase/Replit to Vercel + Neon + Clerk | Automated review + pushed fix ("Simplify vercel.json for static web export; gracefully handle missing Clerk/Domain env vars") |
| `DS4-Design/Gillian-Project-1` | #3 — Flutter web client against Vercel+Neon+Clerk | **Test Report — Flutter mobile preview** ([session](https://app.devin.ai/sessions/9e0f17f854a74003a31ee8e379d72384)) |

**No Devin activity on `Freds4hb/podzi-project`.** Zeitgeist-Digest is the
Podzi predecessor (Drive keeps it as "replit previous Zeitgeist-Digest" inside
the Podzi project folder), so its reports are relevant history — but they are not
performance data for this codebase. Those repos live under the `DS4-Design` org
and could not be attached to this session to inspect directly; the above is from
their GitHub notification records.

### ✅ Drive / Cowork data — substantial material exists

`Meeker Podzi.AI project` in Google Drive, 10 subfolders:

| Folder | Contents |
|--------|----------|
| App and Site art-UI-UX | `20260723 ppt from Claude` — design output |
| Identity and brand assets Podzi | Brand/logo source |
| Planning documents · SOP process plan | Process + planning docs |
| Meetings · Ref Data · reference articles | Research and meeting records |
| replit previous Zeitgeist-Digest | Predecessor project archive |
| Quote | Commercial |

Key documents: `Podzi_Design_Review___Website___App.pptx` (26 screens, review
notes per slide) and `Podzi App Flow and Design UPDATED` (screen-by-screen
product spec — Truth Meter™, Break It Down, discovery loop, 45+ demographic
positioning).

**Caveat on scope:** this audit covers **Google Drive**. A local desktop drive is
not reachable from this environment, so any Cowork data held only on a local
machine is outside what could be checked here.

### ✅ Podcast identification — built and verified

Full design in [`docs/IDENTIFICATION.md`](docs/IDENTIFICATION.md). Two providers:
an RSS/Atom reader that needs **no credentials**, and Podcast Index directory
search that needs a key. `npm run verify:podcasts` exercises the real code —
including real SQL against an in-process Postgres — and asserts:

```
• RSS: parsed 3 episodes, durations + dates correct
• duration parser: rejects junk, accepts seconds / M:SS / H:MM:SS
• single-item feed: no XML single-node collapse
• Atom: show + enclosure link parsed
• Podcast Index auth: signature correct, secret never transmitted
• ingest: show + 3 episodes
• re-ingest is idempotent: 1 show, 3 episodes after two passes
• re-ingest preserves cached transcripts
• profile gate: unfollowed show yields 0 shows, 0 episodes
• profile gate holds: second, unfollowed show does not leak in
```

The transcript-preservation and profile-gate assertions are the two that protect
existing invariants: a feed refresh must not discard a cached transcript (the
biggest cost lever), and an unfollowed show must stay unreachable.

### ⚠️ Clients — web verified in a browser, mobile typechecked only

Both import the same `@podzi/api-client` package, so a response-shape change
breaks compilation on both platforms. That caught a real drift during this work:
`GET /api/health` returns `{ok, service, time}` while the client type claimed
`{status}` — found by `verify-e2e`, not by a user.

**Web** is verified end-to-end in Chromium (`npm run verify:ui`): open
`/podcasts`, switch to the feed-URL tab, paste a feed, press Preview, and assert
the show title, both episode titles, and durations formatted by the shared helper
all appear — with zero failed requests and zero console errors. That last
assertion surfaced a missing app icon (`/favicon.ico` 404), now fixed by wiring
`assets/logo/favicon.svg` in as `src/app/icon.svg`.

**Mobile** (`apps/mobile`, Expo + expo-router) typechecks against real
Expo/React Native types and shares the tested API layer, but **no simulator or
device build has been run here** — that needs a macOS/Android toolchain this
environment does not have. Treat it as authored-and-typechecked, not
field-tested. The Drive design deck specifies 13 app screens; one is
implemented.

---

## Known gaps

Ordered by what blocks a deployable v1:

1. **Nothing is deployed yet, and this is the blocker for everything below.**
   The deploy path is now prepared — committed migrations, CI, an env preflight,
   and a step-by-step runbook in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) —
   but no Vercel project, Neon database or Clerk keys exist. Those need
   credentials only you can supply.
   **Note the worker split:** the web app runs on Vercel, but the stitch worker
   shells out to `ffmpeg` and cannot. It needs a container host. Deploying only
   to Vercel gives a working product for everything except producing stitched
   audio.
2. **No sign-in, so no user-scoped writes from the UI.** `/api/podcasts/follow`
   and `/api/stitches` both work and are tested, but both still take an explicit
   `userId` (`TODO(auth)`) because Clerk sessions are not wired. The web Follow
   action is deliberately disabled rather than faking a user.
3. ~~No CI.~~ **Added** — `.github/workflows/ci.yml` runs both typechecks, the
   build, the concat and identification suites, and the live HTTP + browser
   suites, all without credentials.
4. **Mobile is unrun.** `apps/mobile` typechecks and shares the tested API
   layer, but no device or simulator build has executed. 12 of the 13 designed
   app screens are not implemented.
5. **No scheduled feed refresh.** Feeds are read on demand; nothing re-reads
   followed shows to pick up new episodes.
6. **12 of 13 website pages** are design-only.
7. **The landing page is a placeholder** — `src/app/page.tsx` does not yet use
   the design system in `tokens/` and `ui_kits/`.
8. **Pipeline features not wired:** smart-stitch trimming / sponsor-skip
   (data model exists, segment-selection logic does not), a production queue
   consumer (currently a CLI runner), and Stripe→entitlement persistence.
9. **ffmpeg is an undeclared runtime dependency** — document it in deploy setup
   or vendor `ffmpeg-static`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — concat decision, cost analysis,
  transcribe-once strategy, background-worker rationale.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — per-service wiring, env vars,
  and how to (re-)authenticate from the admin dashboard.
- [`docs/IDENTIFICATION.md`](docs/IDENTIFICATION.md) — how shows and episodes get
  into the catalogue: provider choice, feed-parsing edge cases, idempotence, the
  profile gate, and how to verify all of it without credentials.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the runbook: provisioning order,
  which variable goes where, how to verify each step, why the worker needs a
  container host rather than Vercel, and an honest table of what a Vercel-only
  deployment does and does not do.

## Security

- Secrets live only in environment variables — never in the database, the
  browser, commits, or PRs.
- The Stripe webhook verifies signatures against the raw body before processing.
- Admin health checks run server-side and return only non-secret fields.
- Profile gating is **structural**: `followed_shows` is an explicit allow-list and
  the planner is a pure function over an already-restricted candidate pool, so
  episodes from unfollowed shows cannot enter a stitch.
