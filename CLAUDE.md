# Gesture Synth Weld

> Public repo for [gesturesynthweld.com](https://gesturesynthweld.com) — the free, MIT-licensed build.

Hand gesture-controlled music synthesizer. Left hand controls harmony (chords, key, mode), right hand controls expression (volume, tone, octave, chord style).

## Scope

Deliberately minimal: a single sawtooth synth and 120-second recording. This repo stays lean on purpose — more instruments and timbres, cloud features, MIDI and collaboration are out of scope here.

## For Claude — Docs Map

> `docs/` is fully gitignored (local only). Claude sessions start by reading this table.

| What to read | Where | When |
|---|---|---|
| Current state / next step | `docs/PROJECT-STATE.md` top `📌` | Every new session, first |
| How to start / commands | `docs/STARTUP.md` + `docs/OPERATIONS.md` | Before work |
| Long discussion drafts | `docs/sessions/YYYY-MM-DD-*.md` (append every 3-5 turns) | Resume after compaction |
| Decisions (ADR) | `docs/decisions/ADR-*.md` (index: `decisions/README.md`) | Need background |
| Daily log | `docs/memory/YYYY-MM-DD.md` | Check yesterday's breakpoint |
| Bridge (free→pro) | `docs/BRIDGE.md` + `bridge/contract.md` + `bridge/sync-log.md` | Cross-repo |
| Task queue | `docs/bridge/inbox/*.md` (one file per task, `to: peer`) | Scan for new work |
| After change (write map) | `docs/CLOSEOUT.md` | After every change |
| Handbook (handover/multi-agent) | `docs/handbook/continuity-kit.md` | New project / multi-agent |

Rules: >10 turns discussion → create a `sessions/` file and append incrementally (anti-compaction); update `PROJECT-STATE` + `memory/` immediately after each verifiable unit (session may die anytime); after any change walk the `docs/CLOSEOUT.md` write map.

## Tech Base

- Stack: Vite + React + TypeScript + Tone.js + MediaPipe Tasks Vision (HandLandmarker).
- Pipeline: every input source emits a `HandFrame` down one shared audio chain (filter → masterGain). Engine methods are idempotent with smooth ramps; the App layer dedupes by chord fingerprint.
- Inputs: CameraSource (detection + presence smoothing) / KeyboardSource (desktop hold-to-play; `src/input/keymap.ts` is the single source of bindings). UX details live in the source, not here.
- Recording: domain `src/recording/` (chooser → countdown → record → result; audio / full-video / skeleton modes, 9:16 default). The mic feeds only the recording tap, never the speakers; finished recordings auto-save to IndexedDB (My recordings, browser-local, zero upload).
- Reusable layers (one-way cherry-pick, ledger in `docs/bridge/sync-log.md`): `src/input/` `src/recording/` `src/hud/` `src/works/` `src/chords.ts` `src/types.ts`.
- File map: `src/` + `public/` (favicon/og/robots/sitemap + `vX.Y.Z/` model-version sources) + `index.html` (SEO + JSON-LD) + `gesture-synth.html` (category page) + `vercel.json` (build/cache/301s) + `mediapipe-version.json`. Tests: `npm test` (count = what actually runs).

## Pages (SEO + ad surfaces)

- `/` (Vite SPA): brand-keyword home; a full-viewport (100svh) instrument first, SEO reading area below the fold.
- `/gesture-synth` (Vite multi-entry, same `src/main.tsx`): category-keyword landing; text hero → live instrument → READ body; the Play button dispatches `gsw:seo-play` (scroll + start, one click).
- AdSense: manual units in the reading areas only — `gsw-read-1` (homepage, mid reading area) + `gsw-read-2` (`/gesture-synth`, top of the READ section after the TOC); the two units are attributed separately. Auto/Anchor stay off. The play area / `app-root` / interactive flows never carry ads.

## Deployment

- Single deploy target: Vercel (push to main = production; `vercel.json`: build + immutable cache headers + `.studio`/`.app` 301 → `.com`). The one branch/release path lives in `docs/OPERATIONS.md`; `main` only accepts merges.
- DNS on Cloudflare (Free); the main-site records are **DNS-only** straight to Vercel (no proxy — mainland reachability quality is an invariant).
- Dual model source: CF worker `gsw-media` (`assets.gesturesynthweld.com`, unmetered bandwidth, 1-year immutable cache) primary + same-origin `/vX.Y.Z/` as the mainland fallback. `handTracker.ts` picks via a 3s HEAD probe (downloads only from the winner, no racing); hover/touch prefetches CF only.
- Env: `VITE_ENABLE_EXTERNAL_SCRIPTS`; GA4/Clarity IDs in index.html (hostname-guarded — forks must swap them).

## MediaPipe Version Updates (quarterly)

**CRITICAL: 1-year immutable cache — updating a URL in place never reaches existing users.** Every upgrade needs a NEW URL (new `v<version>` dir + `handTracker.ts` path + CF redeploy). Never overwrite an old dir.

1. `node scripts/check-mediapipe-version.mjs` for updates → 2. read release notes → 3. `npm install @mediapipe/tasks-vision@<new>`, copy wasm to `public/v<new>/wasm/` + download the new model → 4. update `handTracker.ts` paths → 5. `wrangler pages deploy <dir with v<new> + _headers> --project-name gsw-media` (`CLOUDFLARE_API_TOKEN` created temporarily, deleted after) → 6. update `mediapipe-version.json` → 7. branch → preview gesture regression (VI/VII, fist/mute, left/right hand, thumb 8vb) → 8. maintainer signs off → merge to main.

## Known Gotchas

- **vercel.json redirects**: a destination param (`:path*`) must exist with the same name in the source, or the whole site deploy dies silently (GitHub status shows `vercel.link/invalid-route-destination-segment`; the dashboard shows nothing).
- **Mainland reachability**: avoid `*.workers.dev` / `*.vercel.app` / Google CDN (DNS pollution / wall). Models go via our own domain + same-origin fallback.
- **Under a TUN proxy `dig` is untrustworthy** (fake-ip `198.18.x.x`) — check DNS state via DoH (dns.google / alidns.com).
- **New CF deploys** land on `*.workers.dev` (Pages merged into Workers; the "Upload assets" entry is gone) — confirm the actual URL via the API.

## Current Version

**v2.3** — 120s recording (timeout-driven; the whatsNew entry carries it). Live state always in `docs/PROJECT-STATE.md`; roadmap freeze docs in `docs/roadmap/`.
