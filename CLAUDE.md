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
- **Left hand**: Scale degree (1-5 fingers → I-V), Index+Pinky=VI, Index+Pinky+Thumb=VII, wrist tilt=major/minor (or locked Natural diatonic 2026-08-10: I/IV/V major, ii/iii/vi minor, vii° dim — per-degree quality), key selector
- **Right hand**: Height=volume, wrist tilt=filter sweep, finger count=chord style (1=triad, 2=1st inversion, 3=7th, 4+=9th)

### Modes
- **Gesture**: Two-hand chord playing (default)
- **Theremin**: Right hand Y=pitch, left hand Y=volume (dual-hand)
- **MonoPiano**: Finger count → note interval (1=root, 2=3rd, 3=5th, 4=octave, 5=9th)

### No-Camera Mode (keyboard, 2026-08-09 refactor branch)
- Settings toggle "No camera? Keyboard mode (desktop)" (persisted gsw-keyboard-mode; mobile-hidden — phones have no physical keyboard); main button becomes "Start Playing (Keyboard)" — no getUserMedia, no MediaPipe model download
- **Input source abstraction** (`src/input/`): every source produces a `HandFrame` (left/right HandData) consumed by ONE pipeline ("every input reaches the same audio engine" — competitor .online principle). CameraSource (detection + presence smoothing) / KeyboardSource (synthetic hands, empty landmarks — skeleton overlay skips them; `frame.source` gates camera-only compensation like pinky memory; `keymap.ts` 2026-08-10 PR#1 is the single source for defaults/presets/persistence — KeyboardSource/App/SettingsPanel/KbGuide all read through it)
- Keyboard layout (hold-to-play, release to stop — keyboard-instrument semantics; only the degree key is ever held):
  - **1-7**: scale degrees I-VII (hold = play, release = silence; VI/VII via synthetic index+pinky/+thumb)
  - **[ / ]**: minor/major (default; **player-customizable** 2026-08-10 PR#1: `src/input/keymap.ts` single source, QWERTY/QWERTZ presets, `Settings → Customize Keys` per-action rebind with Esc cancel + conflict block, persisted `gsw-keymap`) · **Shift**: octave down (8vb) · **8/9/0/-**: chord style (triad/1st inv/7th/9th)
  - **↑/↓**: volume sweep · **←/→**: filter sweep (competitor .net arrow-key inspiration; replaces the mouse — single-device, keyboard only) · **Space**: stop (Space is fixed, never rebindable)
- **Toolbar camera↔keyboard switch** (desktop only, mobile-collapse — keyboard mode is desktop-only so the switch has nothing to switch to on phones): the PERMANENT prominent mode switch (user decision 2026-08-09 — the NEW card expires after its announce window, this button doesn't; keyboard-mode players must always find the way back to the camera). **Single slider switch** (2026-08-10 PR#1 thorsten-klein#1 — replaces labeled capsule; capsule text naming the target mode read as confusing while active, and the intermediate two-segment toggle read as two buttons): camera icon · track+dot · keyboard icon — dot slides left (camera) / right (keyboard), one click anywhere toggles. **Switching while playing goes through stopCamera() FIRST, then the target starter** (bug 2026-08-09: keyboard→camera used to start the camera directly over the resident keyboard session — the old stream + MediaPipe session stayed live and gestures came back dead; camera→keyboard used to leave the camera stream running, LED on. Both directions now mirror the provably-working fresh path: isRunning false → true). It **pulses while the What's-new card is visible** (the card teaches it, the glow points at it). The old **stop-camera button is hidden in keyboard mode** (visibility:hidden — keeps the slot so the toolbar doesn't shift; no camera to stop — misleading; the slider takes its role when active). In camera mode stop stays — the only way out of the playing scene. Help keyboard section + first-run KbGuide hint line both point at the switch
- **First-run keyboard guide** (`src/components/KbGuide.tsx`): REAL physical QWERTY layout — position recognition + live press-to-learn highlighting (pressed key glows, shows degree/function; cyan=harmony, pink=expression, red=stop, unmapped keys dim). **Auto-demo animation** on open: cycles every mapped key (1.4s each, English caption "Press 6 → VI"; arrow keys use a colon separator "Hold ← : filter sweep left" — a → would read as a second arrow key); the player's own presses pause the demo and the caption line follows their keys (same copy, live). **The guide RUNS the keyboard pipeline while open** — keypresses sound even on the landing-page Help replay (first-ever visit: audioEngine.init() was camera-only until 2026-08-09, so guide presses were silent; init is now an idempotent promise + startKeyboardMode inits too). **Dismissal: ✕ inside the keyboard panel's corner + explicit "Close" button + overlay click + Esc — no auto-hide, no key-press close** (user decision: the first keypress IS the lesson; a timed or key-press dismissal interrupts it — the earlier "flashed away" bug; the panel-corner ✕ replaced the screen-corner one that was hard to find). Same behavior for the first-run auto-pop (localStorage gsw-keyboard-guide-seen) and the Help replay. (Abstract mini-keypad retired 2026-08-09 — user feedback: it flashed away too fast and didn't map to real key positions)
- **Scroll conflict**: keyboard mode blocks default behavior of mapped keys (↑/↓/Space would scroll the page mid-play — the page scrolls, it's not an app); unmapped keys keep native behavior
- Scale Guide (8 degree blocks) visible in BOTH modes; hint line switches semantics (key numbers vs finger gestures)
- Recording in keyboard mode: **audio only** (user decision 2026-08-09 — the video modes would capture a feed-less stage + waveform, no gestures or face: "a video of keys jumping — what's the point?"); the chooser shows just the Audio only option and the aspect-ratio row is hidden

### What's New (feature announcements, 2026-08-09)
- **Mechanism** (`src/whatsNew.ts`): newest entry at top of WHATS_NEW (version/releasedAt/title/body) — **ONE entry is live at a time**: adding a new one retires the previous (new version key = the playing-scene card reappears even for players who dismissed the old one). **Two touchpoints, two mechanisms** (user decision 2026-08-09 — each maps to a different moment in the journey):
  - **LANDING hint** (below the main button): TIME-based conversion assist at the camera decision point — shows while ACTIVE (14-day window), then stops on its own. No ✕, no dismissal (can't be "seen once and lost"; the player never has to close it). Click = enter the feature, gated on the entry's `landingClick` ('keyboard-mode' = enter keyboard mode; informational entries like v2.2 works omit it and the hint doesn't render — the feature is already on the landing page)
  - **PLAYING-scene card**: DISMISSAL-based — a GENERIC announcement slot showing in EVERY playing mode, camera and keyboard (user decision 2026-08-09: it's a description, not a shortcut, so the old !keyboardMode gate is gone; future features announce here in any scene). Shows every session while ACTIVE until the player closes it with the ✕ (localStorage gsw-whatsnew-dismissed). **DESKTOP: bottom-left, above the status bar** (`--status-bar-h` + 10px). **MOBILE: top-left below the toolbar** (the Scale Guide's 8 degree blocks own the bottom; near-full-width card can't sit there) and **auto-collapses after 4s into a small NEW dot** (iOS floating-pill pattern — tap to re-expand, ✕ to dismiss; the tiny viewfinder stays clear but the every-session presence remains). **TEACHING card, not a shortcut** — data-driven: the entry's `pulseTarget` names the toolbar control to pulse while the card is visible, and `teach` carries the per-mode teaching line pointing at that control's actual label (keyboard button in camera mode / Camera button in keyboard mode) — future entries without those fields show no pulse and no teaching line. No backdrop-filter on the card (blur over the live canvas is a mobile compositor hog — suspected of starving the detection loop, 2026-08-09)
  - Help modal shows "New in this version" permanently (changelog role) — reading it dismisses nothing. **Dismissed state mirrored in React** (`whatsNewDismissedState` in App — localStorage alone can't trigger a re-render). Card copy is one line per entry (v2.2: "My works — saved in this browser"). **Landing NEW badge** (2026-08-18): entry field `landingBadge` puts a time-limited pink NEW badge on the landing element the feature owns (My works entry) — same announce window, expires on its own (`whatsNewLandingBadge()`)
- Every future feature announcement goes through the same file — nothing per-feature

### Instruments
Single sawtooth synth — intentionally minimal

### Center HUD (live, gesture mode)
- **Chord display**: root+quality big (Orbitron 900), right-hand extension smaller + dimmer (maj7/maj9/9th, inversion as slash-bass A/C#), scale-degree chip on the left (Inter, quiet), amber 8vb pill badge on the corner (Inter — never Orbitron: its geometric glyphs turn "8ve" into "81B"). Key/mode deliberately NOT shown here (toolbar + recording HUD already carry them)
- **Waveform**: three channels — color = scale degree (7-hue neon spectrum, smooth lerp, DEGREE_COLORS), line count = chord note count (chordNoteCount: triad 3 / 7th 4 / 9th 5, echoes recede toward a horizon like a floor grid — higher, smaller, dimmer, converging spacing, so the strands read as separate in depth), width = volume; right-hand tilt (filter sweep) brightens/darkens ±25%. Gray when muted

### Expression Controls
- **Arpeggiator**: 3 speeds (slow/normal/fast), sequential note triggering
- **Auto Bass**: Root note in lower octave, independent volume
- **Filter Sweep**: Real-time wrist tilt → frequency/Q changes

### Recording (B2, 2026-08)
- **3 modes**: Audio only / Full video (camera + neon skeleton) / Skeleton animation (no camera feed, privacy-friendly). **Default: Skeleton** where video is supported (share-ready + privacy-friendly), audio fallback on iOS Safari (no captureStream); saved choice wins
- **Aspect ratios**: 9:16 (TikTok·Reels·Shorts) / 16:9 (YouTube) / 1:1 (Instagram·Discord), hidden for audio mode. Default 9:16 (social-first)
- **Flow**: Record button → mode/ratio chooser (SVG previews) → 3s countdown (cyan "Get ready" 3-2-1) → 30s recording (button counts down remaining 30→0; last 3s: magenta "Wrap up" 3-2-1 overlay, DOM-only — never in the video; `RECORD_SECONDS` constant, 2026-08-09: 15 → 30) → result panel
- **Result panel**: Download (all); Share via Web Share API (mobile only) sending a branded message (title/text carry brand + gesturesynthweld.com); platform hint (WhatsApp/WeChat/Telegram direct, TikTok/IG/抖音 save-to-photos); non-cancel failure → "use Download" hint
- **Video engine**: MediaRecorder (mp4 preferred, webm fallback) on a composited canvas. **Recording source = VIDEO-NATIVE size** (not the display-size live canvas — a 16:9 source shrank the 9:16 crop from 42% to 32% of the video and recordings silently lost content, fixed 2026-08-09; no-camera mode falls back to 640×480). **Unified design (all ratios/modes)**: blur-fill background; OUTSIDE the window only the brand (top-left, metallic chrome gradient, static — like a broadcast bug) and the URL (bottom-right, white bold on a pill, vertically centered — channel-watermark position); INSIDE the window everything dynamic: chord root+quality (soft static, pill-backed) with a smaller extension (right-hand thickness: maj7/maj9/slash-bass) and an amber 8vb badge (drawChordHud — mirrors the live center display), mode·key, waveform + level bars (camera mode only, subtle alpha — skeleton content carries its own waveform), no flashing anywhere. **All ratios are FULL-FRAME** (immersive): content cover-crops or fits to fill the canvas; brand/URL float as small badges. (9:16 was a "poster" with design bands until 2026-08-04 — real-user feedback: vertical video should be full-bleed like TikTok/Reels). Capture-frame overlay during countdown/recording (dim-outside viewfinder convention; window width = the cover-crop fraction of the screen, computed from the video aspect — synced with the video-native source); audio via MediaStreamAudioDestinationNode tap on masterGain
- **Audio mode**: MediaRecorder audio-only (m4a preferred, webm fallback) — unified with video mode. **Cover art**: m4a carries a 600×600 branded cover (covr atom) + ©nam/©ART/©cmt tags — players show the brand; webm has no cover (filename carries brand)
- **Mic (sing-along)**: microphone mixed into the recording tap (mic → analyser → gain → **vocal-polish chain** → mediaStreamDest), NEVER routed to speakers (feedback). The chain (HPF 100Hz → DynamicsCompressor -20dB/3:1 → parallel short room reverb, generated IR — no asset download) makes sing-along takes sound produced; recording-only, zero feedback risk. 4 levels in the chooser: **Off / Light / Standard / Strong** ("Vocal polish" select, default Standard, saved in localStorage; 'strong' also grips the compressor at -25dB). Chooser toggle "Include my voice" (default on), live mic level meter, **device picker** (Chrome's permission prompt defaults to a virtual/loopback device — BlackHole — on some Macs, which records silence), and a **voice↔chords mix slider** (synth's recording gain via recMixGain tap, default 130% voice-favoring; headphones = cleanest mix). Mic requested in its OWN getUserMedia with its own prompt; denial falls back silently. Attach AFTER audioEngine.init(). Chrome AEC-bug workaround: auto-retry without audio processing after ~2.5s of meter silence
- **Visual atmosphere (2026-08-04)**: stage lighting — Vignette (≤28% edge darkening) or Scanlines (≤4% texture), **on by default: Vignette 60% / Scanlines 30%** (saved in localStorage gsw-vignette/gsw-scanlines, user choice wins). **Scanlines render only while the camera is running** — the pre-camera landing stays clean (frosted-glass feedback 2026-08-05); the vignette applies everywhere (cinematic, subtle). Live view: pure CSS overlay (display layer only, gesture pipeline untouched). Recording: drawn inside the window in drawRecFrame (design bands stay clean). WYSIWYG between live and recording
- **Capability gate**: `VIDEO_REC_SUPPORTED` (MediaRecorder + canvas.captureStream) — iOS Safari lacks captureStream → video modes disabled with a warning
- **Local works gallery** (2026-08-17, retention experiment - "let users leave assets behind"): finished takes auto-save to IndexedDB (`src/works/workStore.ts`, capped at 20 works, oldest pruned) - browser-only, ZERO upload, nothing server-side. Returning players see "My works" on the landing (`src/components/WorksPanel.tsx`): replay / re-download / delete; the result panel tells the player the take was saved. Validation stage: if replay-rate data confirms the retention hypothesis, the R2 + shareable-link backend is the next step; if not, skip the server entirely (judgment thresholds are internal, docs/analytics-events.md)
- **Known**: Chrome omits the audio track when the graph has no active sources (silence, no mic) — harmless

## Tech Stack

- **Framework**: Vite + React + TypeScript
- **Audio**: Tone.js (PolySynth, Filter, Recorder) + MediaRecorder for video recordings
- **Vision**: MediaPipe Tasks Vision (HandLandmarker)
- **Audio Graph**: All instruments → filter → masterGain → destination
- **Performance**: adaptive gesture detection (30/20/15fps — drops only when a device's detections run long, so the main thread stays responsive for interactions/INP), chord fingerprint deduplication

## File Structure

```
src/
├── analytics.ts        # Clarity + GA4 custom events (low-frequency UI tracking; hostname-guarded — forks of this repo must replace the tracking IDs in index.html)
├── audioEngine.ts      # Tone.js wrapper, all methods idempotent; Engine-layer dedup (frequency key)
├── App.tsx             # Main component, two-hand logic, input orchestration + mode switch/analytics wiring (2380 lines; input/recording/hud/components extracted — see below)
├── handTracker.ts      # MediaPipe integration, finger detection
├── types.ts            # Type definitions, FINGER_TO_CHORD_INDEX, FINGER_TO_NOTE_INTERVAL
├── chords.ts           # 12 keys, DIATONIC_CHORDS, getChordFreqs()
├── config.ts           # ENABLE_EXTERNAL_SCRIPTS flag
├── index.css           # Full-screen cyberpunk theme
├── main.tsx            # React entry point
├── wavEncoder.ts       # WAV export utility
├── input/              # Input source abstraction (2026-08-09): types.ts (HandFrame/HandInputSource), cameraSource.ts, keyboardSource.ts, keymap.ts (2026-08-10 customizable bindings)
├── recording/          # Recording DOMAIN (2026-08-09): useRecording.ts (chooser→countdown→record→result + mic sing-along + compositor wiring; owns ALL recording state/refs), RecSheet.tsx (chooser/countdown/result UI), constants.tsx (RECORD_SECONDS, VIDEO_REC_SUPPORTED, ratios, SVG previews), utils.ts (branded cover art, mime picking)
├── components/KbGuide.tsx  # Keyboard-mode first-run guide: real QWERTY layout, live press highlighting (2026-08-09)
├── components/WorksPanel.tsx  # Landing-page "My works" gallery: IndexedDB takes, replay/download/delete (2026-08-17)
├── works/workStore.ts  # IndexedDB wrapper for the local works gallery (2026-08-17, zero upload)
├── components/SettingsPanel.tsx  # Settings panel (extracted 2026-08-09: hand modes/arp/bass/atmosphere/keyboard toggle; presentation-only, App owns side effects)
├── components/HelpModal.tsx  # Quick Guide modal (extracted 2026-08-09: owns demo animation state; gradeNameFor passed from App)
├── components/HandArt.tsx  # renderHandArt — licensed hand-gesture SVGs (shared by Help modal + loading screen)
├── whatsNew.ts         # New-feature announcements (2026-08-09): newest entry at top; landing hint = time-based (14-day window), playing-scene card = ✕-dismissed (gsw-whatsnew-dismissed), Help shows "New in this version"
├── hud/draw.ts         # Canvas drawing helpers (extracted 2026-08-09: skeleton/chord HUD/stage/brand; drawHandSkeleton takes a scale param — live canvas is display-size × dpr, callers pass w/640 to keep the pre-refactor look)
├── hud/recording.ts    # Recording compositor (extracted 2026-08-09 from drawRecFrame: blur-fill bg + cover/fit content + chord HUD + waveform + brand/URL + atmosphere; pure function composeRecordingFrame)
├── hud/waveform.ts     # Live three-channel waveform (extracted 2026-08-09: degree color lerp / note-count floor-grid echoes / tilt brightness; pure function drawWaveform)
├── __tests__/          # Vitest: chords.test.ts + audioEngine.test.ts (29 tests)
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
- Source files stay in `public/vX.Y.Z/` (repo = versioned source of truth); `src/handTracker.ts` probes CF (`https://assets.gesturesynthweld.com/v1.0.1/...`) with a 3s HEAD — reachable ⇒ full download from CF (unlimited bandwidth); unreachable ⇒ same-origin `/v1.0.1/...` fallback (workers.dev is DNS-polluted in mainland China, so CF-unreachable users get the Vercel copy automatically). **Sources are NEVER raced**: Vercel's static edges win ~92% of Promise.any races on real networks, which routed ~6 GB/day back onto Vercel's metered bandwidth (measured 8/4: vercel 24 / cf 2 completed loads). Hover/touch prefetch is CF-only (`prefetchModel`) — a hover never spends Vercel bandwidth. The versioned directory IS the cache-buster
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
- **Testing**: Vitest (since 2026-08-09, refactor branch) — unit tests for chords + audioEngine pure logic (`npm test`); UI still manual + Kimi WebBridge screenshot regression

## Known Gotchas

- **vercel.json redirects**: destination params (`:path*`) must be NAMED in the source too — `/(.*)` + `:path*` fails Vercel's build validation (invalid-route-destination-segment) and silently kills ALL deployments. Use `/:path*` as source. Symptom: GitHub commit status shows `Vercel | failure` with target_url `vercel.link/invalid-route-destination-segment`; the failed deployment does NOT appear in the Vercel Deployments list.
- **mainland-China reachability**: never rely on third-party domains (`*.workers.dev`, `*.vercel.app`, Google CDN are all DNS-polluted/blocked in CN). Model CDN uses our own `assets.gesturesynthweld.com` (CF worker) with a same-origin fallback.
- **Local DNS queries with a TUN proxy**: `dig` results are unreliable (UDP 53 hijacked, fake-ip `198.18.x.x` answers). Verify DNS state via HTTPS DoH (dns.google / alidns.com) instead.
- **New Cloudflare deployments** land on `*.workers.dev` (Pages merged into Workers); the dashboard "Upload assets" flow no longer exists. Confirm actual resource URLs via the API after deploying.

## Current Version

**v2.0 (B2)** - Two-hand division + full recording suite (3 modes, 3 ratios, mic sing-along, branded cover art & share)
- All bugs fixed; UI text synchronized with code; ready for production
