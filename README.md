# Gesture Synth Weld

**Play music with your hands — a free, browser-based synthesizer controlled entirely by hand gestures.**

🔗 **Live:** [gesturesynthweld.com](https://gesturesynthweld.com) · [gesturesynth.io](https://gesturesynth.io)

## What is it?

Gesture Synth Weld turns your webcam into a musical instrument. Using real-time hand tracking
(MediaPipe Hands) and Web Audio synthesis, you can play chords, control volume, and switch
timbres — all by moving your hands in front of the camera.

No downloads, no plugins, no MIDI controllers needed. Just open the page, allow camera access,
and play.

## Features

- **Left hand chord control** — Hold up 1-5 fingers to select from the 7 diatonic chords
  (I, ii, iii, IV, V, vi, vii°)
- **Right hand volume & timbre** — Raise your hand higher for more volume; change finger
  count to switch between sine, triangle, sawtooth, and square waveforms
- **Wrist tilt for major/minor** — Tilt your left wrist left for major, right for minor
- **Real-time visualization** — Hand skeleton overlay, waveform analyser, live chord/volume display
- **Performance recording** — Record your session and export as a WAV file
- **Keyboard fallback** — Play without a camera using number keys (1-7), arrow keys, and letter shortcuts
- **SEO-optimized** — Static HTML content, structured data, Open Graph tags for search engines
- **Zero backend** — Everything runs in the browser; your video never leaves your device
- **Cyberpunk UI** — Dark theme with neon glow effects

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hand tracking | [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (HandLandmarker) |
| Audio | Web Audio API (OscillatorNode, GainNode, BiquadFilter, AnalyserNode) |
| Canvas | Canvas 2D API for video rendering and skeleton overlay |
| Recording | MediaRecorder API + custom WAV encoder |
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
vercel
```

Or connect your GitHub repository to Vercel for automatic deployments.

The `vercel.json` configures SPA fallback routing and security headers.

### Cloudflare Pages

```bash
# Install Wrangler CLI
npm i -g wrangler

# Deploy
npx wrangler pages deploy dist --project-name gesture-synth-weld
```

### Netlify

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1`–`7` | Select chord (I through vii°) |
| `↑` / `↓` | Increase / decrease volume |
| `T` | Force major mode |
| `Y` | Force minor mode |
| `Q` | Sine waveform |
| `W` | Triangle waveform |
| `E` | Sawtooth waveform |
| `R` | Square waveform |
| `Space` | Stop all notes |
| `Escape` | Reset state |

## How It Works

1. **Hand Detection**: MediaPipe's HandLandmarker model detects up to 2 hands in each video frame,
   returning 21 3D landmarks per hand.

2. **Feature Extraction**: For each detected hand, we compute:
   - **Finger count**: Each fingertip is compared to its MCP joint distance from the wrist.
     A finger is "extended" when its tip is farther from the wrist than its MCP.
   - **Wrist tilt**: The angle of the vector from index MCP to pinky MCP relative to horizontal.
   - **Hand position**: The normalized Y-coordinate of the wrist (for volume mapping).
   - **Hand side**: Determined by X-position (left/right of frame center).

3. **Gesture Mapping**:
   - Left hand finger count → diatonic chord index (cycling through 7 chords)
   - Left hand tilt → major/minor/neutral mode
   - Right hand Y-position → master volume (higher = louder)
   - Right hand finger count → waveform/timbre

4. **Audio Synthesis**: The Web Audio API creates oscillator voices for each note in the
   selected chord. A lowpass filter and detuned copy add warmth. ADSR envelopes ensure
   smooth transitions between chords.

5. **Recording**: The master gain output is routed to a `MediaStreamAudioDestinationNode`.
   A `MediaRecorder` captures the stream as WebM, then it's decoded and re-encoded as
   16-bit PCM WAV for maximum compatibility.

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✅ Full support (recommended) |
| Edge 90+ | ✅ Full support |
| Firefox 90+ | ✅ Full support |
| Safari 15+ | ⚠️ Partial (hand tracking may be slower) |

## Project Structure

```
gesture-synth-weld/
├── index.html          # SEO content, static HTML, JSON-LD schema
├── vercel.json         # Vercel deployment config
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx        # React entry point
│   ├── App.tsx         # Main app component (camera, controls, UI)
│   ├── index.css       # Cyberpunk dark theme styles
│   ├── types.ts        # TypeScript type definitions
│   ├── chords.ts       # Diatonic chord theory (frequencies, names)
│   ├── audioEngine.ts  # Web Audio API synthesizer
│   ├── handTracker.ts  # MediaPipe hand tracking wrapper
│   └── wavEncoder.ts   # AudioBuffer → WAV file converter
├── LICENSE             # MIT License
└── README.md
```

## Credits

Inspired by the concept of gesture-controlled musical instruments. Built from scratch
with original code, original architecture, and original visual design.

Technologies used:
- [MediaPipe](https://ai.google.dev/edge/mediapipe) by Google
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) (W3C standard)

## License

MIT License — see [LICENSE](./LICENSE) for details.
