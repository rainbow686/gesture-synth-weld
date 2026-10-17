# Gesture Synth Weld 🎹

**Play music with your hands — an open-source hand-tracking chord synth for the browser.**

![Live](https://gesturesynthweld.com)
![License: MIT](./LICENSE)

> **Hosted Pro version → [gesturesynthweld.app](https://gesturesynthweld.app/?utm_source=free-site&utm_medium=readme&utm_campaign=wave-2026-10&utm_content=readme)** — the same instrument, hosted, for taking work out of the browser. This repo stays the free, MIT-licensed build.

## ✨ Features

- ✋ **Two-hand instrument** — left hand picks harmony (key · scale degree I–VII · major/minor), right hand shapes expression (chord style · volume · tone · octave)
- 🎛️ **3 modes** — Gesture (two-hand chords) · Theremin (dual-hand pitch+volume) · MonoPiano (finger-count intervals)
- ⌨️ **Keyboard mode (desktop, no camera)** — `1-7` degrees (hold to play) · `[ / ]` minor/major (customizable) · `Shift` octave down · `8/9/0/-` chord styles · `↑/↓` volume · `←/→` filter · `Space` stop; includes a real QWERTY guide with demo animation
- 🎚️ **Arpeggiator + Auto Bass + Filter sweep** — harp-like arpeggios, low-end root, real-time tone control
- ⏺️ **Record up to 120s** — audio / full video / skeleton animation; `9:16 / 16:9 / 1:1`; `My recordings` local gallery; mic sing-along with vocal polish
- 🌗 **Stage atmosphere** — vignette/scanlines (WYSIWYG live + recording)
- 🌐 **Works in the browser** — no install, no sign-up, no paywall; pure sawtooth synth (intentionally minimal)

## 🚀 Try It

👉 [gesturesynthweld.com](https://gesturesynthweld.com) — free, no sign-up, nothing to install.

### What the hosted Pro version adds

Everything below is optional — the free build above stays free, ungated (no login, no paywall)
and MIT-licensed. The
[hosted Pro build](https://gesturesynthweld.app/?utm_source=free-site&utm_medium=readme&utm_campaign=wave-2026-10&utm_content=readme)
is a separate, closed-source deployment that adds:

- **Realtime MIDI out** — play the instrument straight into a DAW.
- **HD export** — 1080p / higher-bitrate takes, no brand marks baked in.
- **Commercial license** — use the takes you make commercially.
- Cloud work pages and a larger guided song library.

Source, issues and contributions for *this* build: [github.com/rainbow686/gesture-synth-weld](https://github.com/rainbow686/gesture-synth-weld).

## 📖 How It Works

1. **Click Start** and allow camera access (or switch to **Keyboard mode** in Settings — no camera, no model download).
2. **Left hand** — 1–5 fingers → I–V; `Index+Pinky = VI`, `+Thumb = VII`; wrist tilt or locked **Natural diatonic** per degree.
3. **Right hand** — finger count → chord style (triad / 1st inv / 7th / 9th); height = volume, tilt = filter.
4. **Both hands required** for sound; record `≤120s` and share from the result panel.

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

- [gesturesynthweld.app](https://gesturesynthweld.app/?utm_source=free-site&utm_medium=readme&utm_campaign=wave-2026-10&utm_content=readme) — hosted Pro build (separate site, closed source)
- [Guide](https://gesturesynthweld.com/guide) — how to play, chord progressions and FAQ
