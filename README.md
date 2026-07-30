# Gesture Synth Weld

**Play music with your hands — a free, browser-based synthesizer controlled entirely by hand gestures.**

🔗 **Live:** [gesturesynthweld.com](https://gesturesynthweld.com) · [gesturesynth.io](https://gesturesynth.io)

## What is it?

Gesture Synth Weld turns your webcam into a musical instrument. Using real-time hand tracking
(MediaPipe Hands) and Tone.js for audio synthesis with real piano samples, you can play chords,
control volume, and switch between four instrument timbres — all by moving your hands in front
of the camera.

No downloads, no plugins, no MIDI controllers needed. Just open the page, allow camera access,
and play.

## Features

- **4 instrument timbres** — Piano (Salamander Grand Piano samples), Strings, Organ, and classic Synth
- **Left hand chord control** — Hold up 1-5 fingers to select from the 7 diatonic chords
  (I, ii, iii, IV, V, vi, vii°)
- **Right hand volume control** — Raise your hand higher for more volume (theremin-style)
- **Wrist tilt for major/minor** — Tilt your left wrist left for major, right for minor
- **Full-screen camera view** — Immersive layout with floating glassmorphism control panel
- **Real-time visualization** — Hand skeleton overlay with neon glow effects
- **Performance recording** — Record your session and export as a WAV file
- **Keyboard fallback** — Play without a camera using keyboard shortcuts
- **SEO-optimized** — Static HTML content, structured data, Open Graph tags for search engines
- **Zero backend** — Everything runs in the browser; your video never leaves your device
- **Mobile responsive** — Floating controls adapt to mobile with bottom drawer panel

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hand tracking | [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (HandLandmarker) |
| Audio engine | [Tone.js](https://tonejs.github.io/) — Sampler for piano, PolySynth for strings/organ/synth |
| Piano samples | [Salamander Grand Piano](https://tonejs.github.io/audio/salamander/) (C1–C7, free) |
| Canvas | Canvas 2D API for video rendering and skeleton overlay |
| Recording | Tone.Recorder (MediaRecorder under the hood) |
| Framework | React 18 + TypeScript |
| Build | Vite 6 |
| Deployment | Vercel (static) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-username/gesture-synth-weld.git
cd gesture-synth-weld

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm run preview  # preview the production build locally
```

The output is in the `dist/` directory.

## Deployment

### Vercel (recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

The `vercel.json` configures SPA fallback routing and security headers.

### Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name gesture-synth-weld
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1`–`7` | Select chord (I through vii°) |
| `↑` / `↓` | Increase / decrease volume |
| `T` | Force major mode |
| `Y` | Force minor mode |
| `Q` | Piano timbre |
| `W` | Strings timbre |
| `E` | Organ timbre |
| `R` | Synth timbre |
| `Space` | Stop all notes |
| `Escape` | Reset state |

## How It Works

1. **Hand Detection**: MediaPipe's HandLandmarker model detects up to 2 hands in each video frame,
   returning 21 3D landmarks per hand.

2. **Feature Extraction**: For each detected hand:
   - **Finger count**: Each fingertip is compared to its MCP joint distance from the wrist.
   - **Wrist tilt**: The angle of the index MCP → pinky MCP vector relative to horizontal.
   - **Hand position**: Normalized Y-coordinate for volume mapping.
   - **Hand side**: Determined by X-position.

3. **Gesture Mapping**:
   - Left hand finger count → diatonic chord index
   - Left hand tilt → major/minor/neutral mode
   - Right hand Y-position → master volume

4. **Audio Synthesis**: Tone.js handles the audio:
   - **Piano**: `Tone.Sampler` loads Salamander Grand Piano samples (C1–C7)
   - **Strings**: `Tone.PolySynth` with triangle waveform, slow attack, long release
   - **Organ**: `Tone.PolySynth` with sine waveform through a lowpass filter
   - **Synth**: `Tone.PolySynth` with sawtooth waveform + lowpass filter
   - If piano samples fail to load, a synthesized triangle-wave piano is used as fallback.

5. **Recording**: `Tone.Recorder` captures the audio output. On stop, the recording is
   downloaded as a WAV-compatible file.

## Project Structure

```
gesture-synth-weld/
├── index.html          # SEO content (H1, FAQ, JSON-LD, OG tags) in raw HTML
├── vercel.json         # Vercel deployment config
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx        # React entry point
│   ├── App.tsx         # Full-screen camera + floating controls UI
│   ├── index.css       # Cyberpunk dark theme (full-screen layout)
│   ├── types.ts        # TypeScript type definitions
│   ├── chords.ts       # Diatonic chord theory (frequencies, names)
│   ├── audioEngine.ts  # Tone.js audio engine (Sampler + PolySynth)
│   ├── handTracker.ts  # MediaPipe hand tracking wrapper
│   └── wavEncoder.ts   # AudioBuffer → WAV file converter
├── LICENSE             # MIT License
└── README.md
```

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✅ Full support (recommended) |
| Edge 90+ | ✅ Full support |
| Firefox 90+ | ✅ Full support |
| Safari 15+ | ⚠️ Partial (hand tracking may be slower) |

## Credits

Inspired by the concept of gesture-controlled musical instruments. Built from scratch
with original code, original architecture, and original visual design.

Technologies used:
- [MediaPipe](https://ai.google.dev/edge/mediapipe) by Google
- [Tone.js](https://tonejs.github.io/) — Web Audio framework
- [Salamander Grand Piano](https://tonejs.github.io/audio/salamander/) — Free piano samples

## License

MIT License — see [LICENSE](./LICENSE) for details.
