# Gesture Synth Weld 🎹

**Play music with your hands — an open-source hand-tracking chord synth for the browser.**

![Live](https://gesturesynthweld.com)
![License: MIT](./LICENSE)

## ✨ Features

- ✋ **Two-hand instrument** — left hand picks harmony (key · scale degree I–VII · major/minor), right hand shapes expression (chord style · volume · tone · octave)
- 🎛️ **3 modes** — Gesture (two-hand chords) · Theremin (dual-hand pitch+volume) · MonoPiano (finger-count intervals)
- ⌨️ **Keyboard mode (desktop, no camera)** — `1-7` degrees (hold to play) · `[ / ]` minor/major (customizable) · `Shift` octave down · `8/9/0/-` chord styles · `↑/↓` volume · `←/→` filter · `Space` stop; includes a real QWERTY guide with demo animation
- 🎚️ **Arpeggiator + Auto Bass + Filter sweep** — harp-like arpeggios, low-end root, real-time tone control
- ⏺️ **Record up to 60s** — audio / full video / skeleton animation; `9:16 / 16:9 / 1:1`; `My works` local gallery; mic sing-along with vocal polish
- 🌗 **Stage atmosphere** — vignette/scanlines (WYSIWYG live + recording)
- 🌐 **Works in the browser** — no install, no sign-up, no paywall; pure sawtooth synth (intentionally minimal)

## 🚀 Try It

👉 [gesturesynthweld.com](https://gesturesynthweld.com)

## 📖 How It Works

1. **Click Start** and allow camera access (or switch to **Keyboard mode** in Settings — no camera, no model download).
2. **Left hand** — 1–5 fingers → I–V; `Index+Pinky = VI`, `+Thumb = VII`; wrist tilt or locked **Natural diatonic** per degree.
3. **Right hand** — finger count → chord style (triad / 1st inv / 7th / 9th); height = volume, tilt = filter.
4. **Both hands required** for sound; record `≤60s` and share from the result panel.

No camera? See **Keyboard mode** above — `Settings → Customize Keys` supports QWERTY/QWERTZ presets and per-action rebind.

## 🏃 Getting Started Locally

```bash
git clone https://github.com/rainbow686/gesture-synth-weld.git
cd gesture-synth-weld
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (Vite default is `5173` — see console).

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

## 🚀 Self-Hosting

Clone and run locally — no ads, no tracking, no sign-up:

```bash
git clone https://github.com/rainbow686/gesture-synth-weld.git
cd gesture-synth-weld
npm install
npm run dev
```

The deployed version at gesturesynthweld.com includes hosting-related disclosures in its FAQ and a reserved, non-intrusive below-fold ad slot (no ads currently serving).

## 🔗 Related

- [gesturesynth.io](https://gesturesynth.io) — Tutorials & guides for hand gesture music
