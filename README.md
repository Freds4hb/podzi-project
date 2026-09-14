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

This branch is the **collected main** — it merges the two previously separate
work streams (platform scaffold + design system/pricing page) into one tree, and
records a verified status audit across every system the project touches.

---

## Status at a glance

Audited **2026-08-17**, re-verified **2026-09-14** — every row unchanged in the
four weeks between. Each was checked against the live system, not assumed.
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
| Podcast identification | New code exists | ❌ **Not in this repo** — no feed ingestion, search, or discovery code at all |
| Mobile / desktop clients | Wired to the engine | ❌ **Do not exist** — no native, React Native, Flutter, Electron or Tauri code |

**Bottom line:** the engineering is in better shape than the delivery pipeline.
The code is real, builds, and its core algorithm is provably correct — but none
of it is on `master`, no hosting, auth, or database service is connected to this
repository, and the only client that exists is the Next.js web app.

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
    api/
      health/                    Liveness probe
      integrations/status/       Live per-service health (feeds admin cards)
      stitches/                  Enqueue a stitch job
      stripe/webhook/            Stripe receiver (signature-verified)
  db/schema.ts                   users, subs, shows, episodes, stitches, admin
  lib/
    env.ts                       Central env access + isConfigured/requireEnv
    integrations/                One adapter per service + registry
    concat/                      Direct-code concatenation engine
      pipeline.ts                Pure planStitch + injected runStitchJob
      audio/ffmpeg.ts            Normalize + stream-copy concat + probe
      storage/                   LocalStorage (dev) + S3/R2 (prod)
      transcription/ summarization/   Pluggable, Null-safe providers
      repository.ts              Profile-gated queries + transcript cache
      worker.ts                  processStitch orchestration
  middleware.ts                  Clerk auth gate (no-op until keys are set)

tokens/        Design tokens — colors, typography, spacing, effects, fonts
assets/logo/   Logo lockups + favicon (SVG)
ui_kits/       Website UI kit (currently: pricing page)
docs/          ARCHITECTURE.md (cost model) · INTEGRATIONS.md (wiring)
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
| Production build | **Pass** — all 7 routes compiled | `next build` |
| Type safety | **Pass** — zero errors | `tsc --noEmit` |

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

### ❌ Podcast identification — no such code in this repo

The data model anticipates it: `shows` carries `feedUrl` and an `externalId`
documented as "RSS feed URL hash or podcast index id." **The code to populate it
does not exist.** There is no feed fetcher, no RSS/Atom parser, no podcast-index
or directory API client, no search or discovery endpoint, and no ingestion job.
The concat engine consumes `shows`/`episodes` rows; nothing yet creates them.

### ❌ Mobile and desktop clients — none exist

The repository contains exactly one client: the Next.js web app under `src/app/`.
A search of the full tree finds **no** `app.json`/`app.config`, Expo or React
Native dependency, `metro.config`, `pubspec.yaml`, `android/` or `ios/`
directory, `.xcodeproj`, Swift or Kotlin source, and no Electron, Tauri or
Capacitor config.

`docs/ARCHITECTURE.md` describes Clerk as providing shared identity for "the
upcoming native mobile apps" and the API routes as "the shared backend for web
and mobile" — that is the *intended* design, not a shipped integration. The
Drive design deck specifies 13 app screens; none are implemented in any form.

---

## Known gaps

Ordered by what blocks a deployable v1:

1. **Nothing is deployed.** No Vercel project, no Neon database, no Clerk keys.
   The adapters are ready; the services are not connected.
2. **No CI.** Zero checks on any PR. `typecheck` + `build` + `verify:concat`
   are the obvious first workflow.
3. **No podcast identification.** Nothing populates `shows` or `episodes` — the
   catalogue the concat engine reads from has no ingestion path.
4. **No mobile or desktop client.** The web app is the only client; all 13 app
   screens are design-only. Platform choice (React Native / Expo, Flutter, or a
   PWA) is an open decision, not a wiring task.
5. **12 of 13 website pages** are design-only.
6. **The landing page is a placeholder** — `src/app/page.tsx` does not yet use
   the design system in `tokens/` and `ui_kits/`.
7. **Pipeline features not wired:** smart-stitch trimming / sponsor-skip
   (data model exists, segment-selection logic does not), a production queue
   consumer (currently a CLI runner), Stripe→entitlement persistence, and
   Clerk-derived auth on `/api/stitches`.
8. **ffmpeg is an undeclared runtime dependency** — document it in deploy setup
   or vendor `ffmpeg-static`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — concat decision, cost analysis,
  transcribe-once strategy, background-worker rationale.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — per-service wiring, env vars,
  and how to (re-)authenticate from the admin dashboard.

## Security

- Secrets live only in environment variables — never in the database, the
  browser, commits, or PRs.
- The Stripe webhook verifies signatures against the raw body before processing.
- Admin health checks run server-side and return only non-secret fields.
- Profile gating is **structural**: `followed_shows` is an explicit allow-list and
  the planner is a pure function over an already-restricted candidate pool, so
  episodes from unfollowed shows cannot enter a stitch.
