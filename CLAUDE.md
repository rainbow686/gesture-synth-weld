# Gesture Synth Weld

Hand gesture-controlled music synthesizer. Left hand controls harmony (chords, key, mode), right hand controls expression (volume, tone, octave, chord style).

## Architecture

**App-layer deduplication** (current): App checks chord fingerprint before calling Engine
- Pros: Simple, good performance, flexible
- Cons: Engine not reusable for multiple input sources

**Engine-layer deduplication** (future): Engine checks `currentChordKey` internally
- When to switch: If adding MIDI input, Beat Lock, or complex effects chains
- Migration: Make Engine methods idempotent (already done), move dedup logic to Engine

All Engine methods are idempotent and use smooth transitions:
- `setVolume()`: 50ms linearRamp
- `updateFilterSweep()`: 40ms setTargetAtTime
- `playChord()`: internal `currentChordKey` check

## Key Features

### Two-Hand Division
- **Left hand**: Scale degree (1-5 fingers → I-V), Index+Pinky=VI, Index+Pinky+Thumb=VII, wrist tilt=major/minor, key selector
- **Right hand**: Height=volume, wrist tilt=filter sweep, finger count=chord style (1=triad, 2=1st inversion, 3=7th, 4+=9th)

### Modes
- **Gesture**: Two-hand chord playing (default)
- **Theremin**: Right hand Y=pitch, left hand Y=volume (dual-hand)
- **MonoPiano**: Finger count → note interval (1=root, 2=3rd, 3=5th, 4=octave, 5=9th)

### Instruments
Single sawtooth synth — intentionally minimal

### Expression Controls
- **Arpeggiator**: 3 speeds (slow/normal/fast), sequential note triggering
- **Auto Bass**: Root note in lower octave, independent volume
- **Filter Sweep**: Real-time wrist tilt → frequency/Q changes

### Recording (B2, 2026-08)
- **3 modes**: Audio only / Full video (camera + neon skeleton) / Skeleton animation (no camera feed, privacy-friendly). **Default: Skeleton** where video is supported (share-ready + privacy-friendly), audio fallback on iOS Safari (no captureStream); saved choice wins
- **Aspect ratios**: 9:16 (TikTok·Reels·Shorts) / 16:9 (YouTube) / 1:1 (Instagram·Discord), hidden for audio mode. Default 9:16 (social-first)
- **Flow**: Record button → mode/ratio chooser (SVG previews) → 3s countdown (cyan "Get ready" 3-2-1) → 15s recording (button counts down remaining 15→0; last 3s: magenta "Wrap up" 3-2-1 overlay, DOM-only — never in the video) → result panel
- **Result panel**: Download (all); Share via Web Share API (mobile only) sending a branded message (title/text carry brand + gesturesynthweld.com); platform hint (WhatsApp/WeChat/Telegram direct, TikTok/IG/抖音 save-to-photos); non-cancel failure → "use Download" hint
- **Video engine**: MediaRecorder (mp4 preferred, webm fallback) on a composited canvas. **Unified design (all ratios/modes)**: blur-fill background; OUTSIDE the window only the brand (top-left, metallic chrome gradient, static — like a broadcast bug) and the URL (bottom-right, white bold on a pill, vertically centered — channel-watermark position); INSIDE the window everything dynamic: chord name (soft static, pill-backed), mode·key, waveform + level bars (camera mode only, subtle alpha — skeleton content carries its own waveform), no flashing anywhere. **All ratios are FULL-FRAME** (immersive): content cover-crops or fits to fill the canvas; brand/URL float as small badges. (9:16 was a "poster" with design bands until 2026-08-04 — real-user feedback: vertical video should be full-bleed like TikTok/Reels). Capture-frame overlay during countdown/recording (dim-outside viewfinder convention); audio via MediaStreamAudioDestinationNode tap on masterGain
- **Audio mode**: MediaRecorder audio-only (m4a preferred, webm fallback) — unified with video mode. **Cover art**: m4a carries a 600×600 branded cover (covr atom) + ©nam/©ART/©cmt tags — players show the brand; webm has no cover (filename carries brand)
- **Mic (sing-along)**: microphone mixed into the recording tap (mic → analyser → gain → mediaStreamDest), NEVER routed to speakers (feedback). Chooser toggle "Include my voice" (default on), live mic level meter, **device picker** (Chrome's permission prompt defaults to a virtual/loopback device — BlackHole — on some Macs, which records silence), and a **voice↔chords mix slider** (synth's recording gain via recMixGain tap, default 130% voice-favoring; headphones = cleanest mix). Mic requested in its OWN getUserMedia with its own prompt; denial falls back silently. Attach AFTER audioEngine.init(). Chrome AEC-bug workaround: auto-retry without audio processing after ~2.5s of meter silence
- **Visual atmosphere (2026-08-04)**: optional stage lighting — Vignette (≤28% edge darkening) or Scanlines (≤4% texture), off by default. Live view: pure CSS overlay (display layer only, gesture pipeline untouched). Recording: drawn inside the window in drawRecFrame (design bands stay clean). WYSIWYG between live and recording
- **Capability gate**: `VIDEO_REC_SUPPORTED` (MediaRecorder + canvas.captureStream) — iOS Safari lacks captureStream → video modes disabled with a warning
- **Known**: Chrome omits the audio track when the graph has no active sources (silence, no mic) — harmless

## Tech Stack

- **Framework**: Vite + React + TypeScript
- **Audio**: Tone.js (PolySynth, Filter, Recorder) + MediaRecorder for video recordings
- **Vision**: MediaPipe Tasks Vision (HandLandmarker)
- **Audio Graph**: All instruments → filter → masterGain → destination
- **Performance**: 30fps gesture detection, chord fingerprint deduplication

## File Structure

```
src/
├── analytics.ts        # Clarity + GA4 custom events (low-frequency UI tracking; hostname-guarded — forks of this repo must replace the tracking IDs in index.html)
├── audioEngine.ts      # Tone.js wrapper, all methods idempotent
├── App.tsx             # Main component, two-hand logic, keyboard shortcuts
├── handTracker.ts      # MediaPipe integration, finger detection
├── types.ts            # Type definitions, FINGER_TO_CHORD_INDEX, FINGER_TO_NOTE_INTERVAL
├── chords.ts           # 12 keys, DIATONIC_CHORDS, getChordFreqs()
├── config.ts           # ENABLE_EXTERNAL_SCRIPTS flag
├── index.css           # Full-screen cyberpunk theme
├── main.tsx            # React entry point
├── wavEncoder.ts       # WAV export utility
├── handArt.ts          # Licensed hand-gesture SVG art for the Help demo (Commons CC BY-SA / Noto Apache-2.0 / OpenClipart CC0, single-color)
└── mp4tags.ts          # MP4/M4A brand tags + cover art (covr) injection

public/
├── favicon.svg         # Pink music note + cyan sound waves
├── og-image.png        # Open Graph image (1200×630 PNG — SVG not supported by social platforms)
├── robots.txt
├── sitemap.xml
└── v1.0.1/             # Self-hosted MediaPipe (wasm/ + hand_landmarker.task)

vercel.json             # Build config + immutable cache headers for /v*/assets (fallback model path)
scripts/                # check-mediapipe-version.mjs (quarterly update check)
mediapipe-version.json  # Pinned MediaPipe version, source URLs, file hashes

index.html              # SEO-optimized with JSON-LD schemas
```

## Keyboard Shortcuts

Space: Stop | Esc: Reset — playing shortcuts (1-7, ↑/↓, T/Y, A, B) were removed: both hands must stay in front of the camera while playing, so the keyboard is unreachable mid-performance

## SEO

- **Primary keyword**: "hand gesture music synthesizer" — title, meta description (≤160 chars), JSON-LD
- **JSON-LD**: WebApplication + FAQPage schemas
- **Static HTML**: All SEO content in index.html, React renders below fold

## Deployment

**Layout** (bandwidth-split, not product-split):

```
gesturesynthweld.com → Vercel (web app; DNS-only, direct routing)
assets.gesturesynthweld.com → Cloudflare worker gsw-media (model CDN, unlimited bandwidth)
fallback → same-origin /v1.0.1/ (Vercel; mainland-China safety net)
```

- **Platform**: Vercel (auto-deploy from GitHub) — hosts the web app only
- **Domain DNS**: gesturesynthweld.com nameservers → Cloudflare (maciej/priscilla.ns.cloudflare.com, Free plan) since 2026-08-03. Main-site records (A/www) are **DNS-only** (no CF proxy) so the site keeps direct Vercel routing; only `assets` is proxied
- **Model CDN**: `assets.gesturesynthweld.com` → Cloudflare worker `gsw-media` (unlimited bandwidth, global edge) — see MediaPipe section below
- **Env vars**: VITE_ENABLE_EXTERNAL_SCRIPTS (currently false)

## MediaPipe Self-Hosting & Version Updates

**Why self-hosted**: the WASM engine and hand-landmarker model were downloaded from jsDelivr + Google's GCS bucket on every first camera start (~19 MB, Google's domain is blocked/slow in mainland China, model cache only 1 h). Since 2026-08-03 both are served from **Cloudflare** (`assets.gesturesynthweld.com/v1.0.1/` — custom domain on the `gsw-media` worker; the worker's own URL `gsw-media.rainbow686.workers.dev` is DNS-polluted in mainland China, which is why the custom domain exists) — unlimited bandwidth, global edge, with a **1-year immutable browser cache** (via the CF `_headers` file: `Access-Control-Allow-Origin: *` + `max-age=31536000`). **Why not Vercel**: the ~19 MB model download would consume the 100 GB/month Vercel Hobby bandwidth allowance (~5,000 new camera users per month). Prefetched on Enable-Camera button hover/touch.

**Pinned version: 1.0.1** — see `mediapipe-version.json` (version, source URLs, file hashes, update date).

- WASM files are copied from `node_modules/@mediapipe/tasks-vision/wasm/` — they **must match the npm package version exactly** (package.json is pinned, not `^`)
- Model downloaded once from the GCS URL recorded in mediapipe-version.json
- Source files stay in `public/vX.Y.Z/` (repo = versioned source of truth); `src/handTracker.ts` tries `https://assets.gesturesynthweld.com/v1.0.1/...` first, then falls back to the same-origin `/v1.0.1/...` — workers.dev is DNS-polluted in mainland China, so CN users get the Vercel copy automatically (6s HEAD probe per source); the versioned directory IS the cache-buster
- Re-deploy to CF on every version bump: `wrangler pages deploy` of a folder containing `v<new>/` + `_headers` (project `gsw-media`; requires `CLOUDFLARE_API_TOKEN` env var)

**CRITICAL: because of the 1-year immutable cache, updating a file at the same URL will NOT reach existing users.** Every version bump MUST change the URL (new `v<version>` directory + updated paths in `src/handTracker.ts` + re-upload to CF). Never overwrite files in an existing `v*/` directory.

**Update procedure** (quarterly, or when an update is announced):
1. Run `node scripts/check-mediapipe-version.mjs` — compares npm latest + model fingerprint
2. Read the release notes / changelog for what changed (bug fixes, new features)
3. `npm install @mediapipe/tasks-vision@<new>` → copy new wasm to `public/v<new>/wasm/` → download new model file if available
4. Point `src/handTracker.ts` (MODEL_PATH, MODEL_ASSET_PATH) at the new version directory
5. Re-deploy the `v<new>/` folder + `_headers` to Cloudflare Pages (project `gsw-media`) — see above
6. Update `mediapipe-version.json` (version, hashes, date)
7. Push to dev → preview → **regression-test gestures on the preview**: VI/VII detection, fist/mute, left/right hand, thumb octave-down
8. User confirms → merge to main

## Git Workflow

- Develop on a feature branch; merge to `main` only after a preview deployment is confirmed
- Batch small fixes — don't push one commit per tiny change

## Development Notes

- **Architecture choice**: App-layer deduplication for simplicity; Engine ready for future migration
- **Performance**: Chord fingerprint prevents re-triggering on identical chords
- **Smooth transitions**: All parameter changes use Tone.js ramping methods
- **UI sync**: Help panel and FAQ JSON-LD updated to match actual implementation
- **Testing**: No test framework yet; manual testing required

## Known Gotchas

- **vercel.json redirects**: destination params (`:path*`) must be NAMED in the source too — `/(.*)` + `:path*` fails Vercel's build validation (invalid-route-destination-segment) and silently kills ALL deployments. Use `/:path*` as source. Symptom: GitHub commit status shows `Vercel | failure` with target_url `vercel.link/invalid-route-destination-segment`; the failed deployment does NOT appear in the Vercel Deployments list.
- **mainland-China reachability**: never rely on third-party domains (`*.workers.dev`, `*.vercel.app`, Google CDN are all DNS-polluted/blocked in CN). Model CDN uses our own `assets.gesturesynthweld.com` (CF worker) with a same-origin fallback.
- **Local DNS queries with a TUN proxy**: `dig` results are unreliable (UDP 53 hijacked, fake-ip `198.18.x.x` answers). Verify DNS state via HTTPS DoH (dns.google / alidns.com) instead.
- **New Cloudflare deployments** land on `*.workers.dev` (Pages merged into Workers); the dashboard "Upload assets" flow no longer exists. Confirm actual resource URLs via the API after deploying.

## Current Version

**v2.0 (B2)** - Two-hand division + full recording suite (3 modes, 3 ratios, mic sing-along, branded cover art & share)
- All bugs fixed; UI text synchronized with code; ready for production
