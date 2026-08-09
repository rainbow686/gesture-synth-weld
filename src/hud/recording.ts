/**
 * Recording compositor (extracted from App.tsx drawRecFrame, 2026-08-09 —
 * pure move, behavior identical).
 *
 * Composites the performance source canvas (stage or camera + soft
 * skeleton, VIDEO-NATIVE size) into the recording canvas at the chosen
 * aspect ratio:
 *
 * 9:16 — vertical share frame: blur-fill background (the performance
 * itself, enlarged + blurred + darkened — the industry standard for
 * landscape→vertical), sharp content window, brand name (gradient,
 * breathing glow), huge live chord name (pops on change), mode · key,
 * live waveform + level bars, and the domain URL (the traffic driver).
 * 16:9 — cover-fill with a small HUD. 1:1 — blur-fill + simple HUD.
 *
 * Side-effect free except for drawing on `rec` and the caller-owned blur
 * cache (`blurBuf`) — all other inputs are passed in, so the compositor
 * is callable from anywhere (rAF loop / tests).
 */

import { KEYS } from '../chords';
import type { RecMode, RecRatio, SynthState } from '../types';
import { drawChordHud, drawMetalBrand, drawUrlPill } from './draw';

/** Minimal structural type for the analyser — avoids coupling to Tone.js. */
interface WaveAnalyser {
  getValue(): Float32Array | Float32Array[];
}

export interface RecFrameInputs {
  rec: HTMLCanvasElement;
  /** Recording-source canvas (stage or camera + soft skeleton). */
  src: HTMLCanvasElement;
  mode: RecMode;
  ratio: RecRatio;
  synth: SynthState;
  analyser: WaveAnalyser | null;
  /** 0..1 — live atmosphere strengths (already ÷100). */
  vignetteStrength: number;
  scanlinesStrength: number;
  /** Caller-owned persistent blur cache ({ current } ref, survives frames). */
  blurBuf: { current: HTMLCanvasElement | null };
}

/** Compose one recording frame into `rec` at the chosen ratio. */
export function composeRecordingFrame({
  rec,
  src,
  mode,
  ratio,
  synth: s,
  analyser,
  vignetteStrength: vStrength,
  scanlinesStrength: sStrength,
  blurBuf,
}: RecFrameInputs): void {
  if (!src.width || !src.height) return;
  const rctx = rec.getContext('2d');
  if (!rctx) return;

  const W = rec.width;
  const H = rec.height;
  const sw = src.width;
  const sh = src.height;
  const modeLabel = s.appMode === 'gesture' ? 'Gesture' : s.appMode === 'theremin' ? 'Theremin' : 'Piano';
  const now = performance.now();

  // ── Blur-fill background (cheap: draw via a tiny copy, then upscale) ──
  // Redrawn at ~5fps — it's visually stable, and this is the heaviest
  // draw (a full-frame upscale), so throttling it removes most of the
  // recording-compositor load that can cause jank.
  {
    rctx.fillStyle = '#050510';
    rctx.fillRect(0, 0, W, H);
    const bw = Math.max(32, Math.round(W / 10));
    const bh = Math.max(56, Math.round(H / 10));
    if (!blurBuf.current) blurBuf.current = document.createElement('canvas');
    const bb = blurBuf.current;
    if (bb.width !== bw || bb.height !== bh) {
      bb.width = bw;
      bb.height = bh;
    }
    const bctx = bb.getContext('2d');
    if (bctx) {
      const scale = Math.max(bw / sw, bh / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'medium';
      bctx.drawImage(src, (bw - dw) / 2, (bh - dh) / 2, dw, dh);
    }
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'medium';
    rctx.drawImage(bb, 0, 0, W, H);
    rctx.fillStyle = 'rgba(5, 5, 15, 0.55)';
    rctx.fillRect(0, 0, W, H);
  }

  // ── Design language (all ratios):
  //   Brand = cyan-cool metal (top-left, static); URL = white bold on
  //   pill (bottom-right, clarity first). Everything else is placed per
  //   ratio:
  //   All ratios are now FULL-FRAME (immersive, like 16:9): the content
  //   cover-crops or fits to fill the entire canvas; brand/URL float on
  //   top as small badges. (9:16 used to be a "poster" with design bands —
  //   removed 2026-08-04 after real-user feedback: vertical video should
  //   be full-bleed like TikTok/Reels, not a letterboxed strip.)
  //   1:1 and 9:16 — full frame; portrait sources cover-crop (a fit-width
  //   portrait would overflow the frame), landscape sources fit by width.
  let wy = 0;
  let winH = H;
  if (ratio === '16:9') {
    // 16:9 canvas, landscape source: fit fills the frame exactly.
    const ch = Math.round((W * sh) / sw);
    const dy = Math.round((H - ch) / 2);
    rctx.drawImage(src, 0, dy, W, ch);
  } else {
    // 1:1 / 9:16 canvases: cover-crop the source to FILL the frame —
    // always. (A fit-width landscape source would leave letterbox
    // strips, i.e. the old poster look; immersive vertical/square
    // video covers instead — TikTok/IG convention.)
    const scale = Math.max(W / sw, H / sh);
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    const dx = Math.round((W - dw) / 2);
    const dy = Math.round((H - dh) / 2);
    rctx.drawImage(src, dx, dy, dw, dh);
    wy = 0;
    winH = H;
    rctx.strokeStyle = 'rgba(0, 255, 204, 0.3)';
    rctx.lineWidth = 2;
    rctx.strokeRect(0, wy, W, winH);
  }

  // ── Inside the window: chord name (the green note) + live waveform.
  //    Immersive video keeps the performance, chord, waveform and the
  //    brand/URL badges — the mode·key line was removed per user
  //    feedback 2026-08-04. ──
  const chordSize = ratio === '16:9' ? 46 : 48;
  // 1:1 / 9:16: push the chord down by ~a note-height so it never crowds
  // the top-left brand wordmark (16:9 keeps its tighter 84px slot).
  const chordY = ratio === '16:9' ? 84 : wy + 114;
  drawChordHud(rctx, W / 2, chordY, chordSize, s.chordBase || '—', s.chordExt || '', !!s.octaveDown);

  if (ratio !== '16:9') {
    rctx.font = '500 16px Inter, system-ui, sans-serif';
    rctx.textAlign = 'center';
    rctx.fillStyle = 'rgba(160, 160, 208, 0.8)';
    rctx.fillText(`${modeLabel} · Key ${KEYS[s.keyOffset]?.name ?? 'A'}`, W / 2, chordY + 28);
  }

  if (mode !== 'skeleton' && analyser) {
    const wf = analyser.getValue() as Float32Array;
    const n = wf.length;
    const waveBase = ratio === '16:9' ? H - 34 : wy + winH - 40;
    rctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = W * 0.06 + (i / (n - 1)) * W * 0.88;
      const y = waveBase - wf[i] * (ratio === '16:9' ? 20 : 22);
      if (i === 0) rctx.moveTo(x, y);
      else rctx.lineTo(x, y);
    }
    rctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
    rctx.lineWidth = 2;
    rctx.shadowColor = 'rgba(0, 255, 204, 0.3)';
    rctx.shadowBlur = 6;
    rctx.stroke();
    rctx.shadowBlur = 0;
  }

  drawMetalBrand(rctx, 24, 40, 26);
  drawUrlPill(rctx, W - 26, H - 24, 22, false);

  // ── Atmosphere — window only (0, wy, W, winH); the design bands stay
  //    clean so brand/URL keep full clarity. Matches the live overlay
  //    (base effect × user strength/100); both effects can stack. ──
  // Base effect × strength: base 1.0 (vignette) / 0.3 (scanlines) makes
  // 100% deliberately "too much" — users settle around 40-70%, where 50%
  // ≈ the old 100% look. Mirrors the live CSS overlay.
  if (vStrength > 0) {
    const cx = W / 2;
    const cy = wy + winH / 2;
    const g = rctx.createRadialGradient(cx, cy, Math.min(W, winH) * 0.3, cx, cy, Math.max(W, winH) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${1.0 * vStrength})`);
    rctx.fillStyle = g;
    rctx.fillRect(0, wy, W, winH);
  }
  if (sStrength > 0) {
    rctx.fillStyle = `rgba(255,255,255,${0.3 * sStrength})`;
    for (let y = wy; y < wy + winH; y += 4) {
      rctx.fillRect(0, y, W, 2);
    }
  }
}
