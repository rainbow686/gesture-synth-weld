/**
 * Live waveform — the three-channel HUD (extracted from App.tsx
 * drawWaveformRef 2026-08-09, pure move):
 *   color  = scale degree (left hand; 7-hue neon spectrum, smooth lerp),
 *   lines  = chord note count (right hand: 3 triad / 4 seventh / 5 ninth,
 *            echoes recede like a floor grid),
 *   width  = volume; right-hand tilt (filter sweep) brightens/darkens.
 * Gray when muted, invisible when silent.
 *
 * Side-effect free except for drawing on `canvas`; the lerp color state
 * (`degreeColor`) is caller-owned and persists across frames.
 */

import type { HandData, SynthState } from '../types';
import { chordNoteCount } from '../chords';
import { DEGREE_COLORS } from './draw';

export interface WaveformInputs {
  canvas: HTMLCanvasElement | null;
  analyser: { getValue(): Float32Array | Float32Array[] } | null;
  hands: { left: HandData | null; right: HandData | null };
  synth: SynthState;
  /** Persistent lerp state (survives frames — pass the same object). */
  degreeColor: { r: number; g: number; b: number };
}

/** Draw one waveform frame; silent+no-hands → nothing. */
export function drawWaveform({ canvas, analyser, hands, synth, degreeColor }: WaveformInputs): void {
  if (!canvas || !analyser) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (canvas.width !== canvas.clientWidth * 2 || canvas.height !== canvas.clientHeight * 2) {
    canvas.width = canvas.clientWidth * 2;
    canvas.height = canvas.clientHeight * 2;
  }

  const waveform = analyser.getValue() as Float32Array;
  const bufferLength = waveform.length;

  // Compute RMS amplitude from waveform data
  let sumSq = 0;
  for (let i = 0; i < bufferLength; i++) sumSq += waveform[i] * waveform[i];
  const rms = Math.sqrt(sumSq / bufferLength); // 0 (silent) … ~0.7 (loud)

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const handsPresent = !!(hands.left || hands.right);
  // No hands in frame at all → hide waveform entirely
  if (!handsPresent && rms < 0.005) return;

  // Muted (hands present but silent) → thin gray line
  const muted = rms < 0.005;
  const lineW = muted ? 2 : 1 + rms * 8;

  // ── Color = scale degree (left-hand harmony), lerped so a chord
  //    change glides through the neon spectrum instead of snapping. ──
  const degree = synth.chordIndex >= 0 && synth.chordIndex < DEGREE_COLORS.length ? synth.chordIndex : 0;
  const target = DEGREE_COLORS[degree];
  degreeColor.r += (target[0] - degreeColor.r) * 0.12;
  degreeColor.g += (target[1] - degreeColor.g) * 0.12;
  degreeColor.b += (target[2] - degreeColor.b) * 0.12;

  // ── Tilt (filter sweep) → brightness ±25% (right-hand expression) ──
  const tilt = Math.max(-1, Math.min(1, hands.right?.tiltAngle ?? 0));
  const brightness = 1 + 0.25 * tilt;
  const R = Math.max(0, Math.min(255, Math.round(degreeColor.r * brightness)));
  const G = Math.max(0, Math.min(255, Math.round(degreeColor.g * brightness)));
  const B = Math.max(0, Math.min(255, Math.round(degreeColor.b * brightness)));

  // ── Line count = chord note count (right-hand thickness). The echoes
  //    recede like a floor grid: front line at the bottom, each echo
  //    higher, smaller, dimmer, with spacing compressing toward the
  //    horizon and a slight horizontal convergence — so 3-5 lines read
  //    as clearly separate strands in depth, not one blurry line. ──
  const lineCount = muted ? 1 : Math.max(1, chordNoteCount(synth.chordStyle));
  const alphaBase = muted ? 0.25 : 0.2 + rms * 0.8;
  const H = canvas.height;
  const baseY = H * 0.78;    // front line (closest)
  const horizonY = H * 0.16; // far echoes converge toward here
  const cx = canvas.width / 2;
  const ampH = H * 0.55;

  for (let k = 0; k < lineCount; k++) {
    const depth = k;
    const t = 1 - Math.pow(0.55, depth); // 0 (front) → ~0.9 (far)
    const yCenter = baseY + (horizonY - baseY) * t;
    const scale = Math.pow(0.7, depth);       // amplitude shrinks with depth
    const hScale = 1 - 0.06 * depth;          // slight horizontal convergence
    const a = muted ? alphaBase : alphaBase * Math.pow(0.62, depth);
    ctx.lineWidth = lineW * (0.5 + 0.5 * scale);
    ctx.strokeStyle = muted
      ? `rgba(120, 120, 120, ${alphaBase})`
      : `rgba(${R}, ${G}, ${B}, ${a})`;
    ctx.shadowColor = muted ? 'transparent' : `rgb(${R}, ${G}, ${B})`;
    ctx.shadowBlur = muted ? 0 : Math.max(2, Math.round(8 * scale));
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const v = (waveform[i] + 1) / 2 - 0.5; // -0.5..0.5
      const x = cx + (i / (bufferLength - 1) - 0.5) * canvas.width * hScale;
      const y = yCenter + v * ampH * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}
