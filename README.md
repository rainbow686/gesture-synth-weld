# Gesture Synth Weld 🎹

**Play music with your hands — an open-source hand-tracking chord synth and theremin for the browser.**

![Live](https://gesturesynthweld.com)
![License: MIT](./LICENSE)

## ✨ Features

- 🎹 **Piano-quality sound** with real multi-sampled piano, strings, organ, and synth
- ✋ **Hand tracking via MediaPipe** — left hand controls chords, right hand controls volume & timbre
- 🎛️ **Floating control panel** — switch instruments and scales without leaving the camera view
- ⌨️ **Keyboard mode** — no camera? Play with your keyboard (keys 1-7 for chords, arrows for volume)
- ⏺️ **Record & Export** — save your performances as WAV files
- 🌐 **Works in the browser** — no install, no sign-up, no paywall

## 🚀 Try It

👉 [gesturesynthweld.com](https://gesturesynthweld.com)

## 🛠️ Tech Stack

- Vite + React + TypeScript
- MediaPipe Tasks Vision (HandLandmarker)
- Tone.js (sampled instruments)
- Web Audio API (fallback synth engine)

## 📖 How It Works

1. **Click Start** and allow camera access
2. **Left hand** — hold up 1-5 fingers to select from 7 diatonic chords (I, ii, iii, IV, V, vi, vii°). Tilt your wrist to toggle major/minor.
3. **Right hand** — raise higher for more volume (theremin-style). Lower = quieter.
4. **Floating panel** — switch between Piano 🎹 / Strings 🎻 / Organ 🎛️ / Synth ⚡, toggle Major/Minor, record your session.

No camera? Use keyboard shortcuts: `1-7` for chords, `↑↓` for volume, `Q/W/E/R` for timbre.

## 🏃 Getting Started Locally

```bash
git clone https://github.com/rainbow686/gesture-synth-weld.git
cd gesture-synth-weld
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build for production

```bash
npm run build
npm run preview
```

Output in `dist/`.

## 🚢 Deployment

### Vercel

```bash
npm i -g vercel
vercel --prod
```

### Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name gesture-synth-weld
```

## 📄 License

MIT — see [LICENSE](./LICENSE)

## 💰 Monetization

This project is free and open source. To support development and hosting costs, we use non-intrusive Google AdSense advertising.

**Ad Configuration:**

- Ads are **disabled by default** in the open-source version
- To enable ads in your deployment, create a `.env` file:
  ```bash
  VITE_ENABLE_ADS=true
  ```
- Replace `ca-pub-XXXXXXXXXXXXXXXX` in `src/config.ts` with your AdSense publisher ID
- Ad slot placeholders are already in place in the layout (3 slots: 728×90, 300×250, 728×90)
- AdSense script loads only when `VITE_ENABLE_ADS=true`

The ad system respects user privacy and does not track or collect personal data beyond standard AdSense behavior.

## 🔗 Related

- [gesturesynth.io](https://gesturesynth.io) — Tutorials & guides for hand gesture music
