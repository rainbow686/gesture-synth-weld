/**
 * Canvas drawing helpers — HUD, recording-frame, and cover-art primitives.
 *
 * Extracted from App.tsx (2026-08-09 refactor, pure move — no behavior
 * changes). All functions are pure canvas drawing; the live overlay and
 * recording frame compose them from App/recording.
 */

import type { HandData } from '../types';
import { HAND_CONNECTIONS } from '../handTracker';

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawUrlPill(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  baseY: number,
  fontSize: number,
  centered: boolean,
): void {
  const url = 'gesturesynthweld.com';
  ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
  const w = ctx.measureText(url).width;
  const pillH = fontSize + 14;
  const textMid = baseY - fontSize * 0.35; // visual center of the glyphs
  const pillTop = textMid - pillH / 2; // pill centered on the text
  const left = centered ? anchorX - w / 2 - 14 : anchorX - w - 14;
  roundRectPath(ctx, left, pillTop, w + 28, pillH, pillH / 2);
  ctx.fillStyle = 'rgba(5, 5, 15, 0.72)';
  ctx.fill();
  ctx.textAlign = centered ? 'center' : 'right';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.fillText(url, anchorX, baseY);
  ctx.shadowBlur = 0;
}

/** Metallic brand wordmark — cyan-cool chrome, static, no flash. */
export function drawMetalBrand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const text = 'GESTURE SYNTH WELD';
  ctx.font = `800 ${size}px Orbitron, monospace`;
  ctx.textAlign = 'left';
  // subtle dark drop for a raised, dimensional look
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillText(text, x, y + 2);
  // cyan-cool chrome gradient: white → light cyan → cool mid → bright
  const g = ctx.createLinearGradient(0, y - size, 0, y + 4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#d8ecff');
  g.addColorStop(0.5, '#7fb8e8');
  g.addColorStop(0.7, '#eef8ff');
  g.addColorStop(1, '#a8cde8');
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
}

// 7 scale-degree colors for the waveform (neon palette, in-key): the
// degree = harmony identity (left hand), so a chord change glides the
// waveform's hue through this spectrum.
export const DEGREE_COLORS: [number, number, number][] = [
  [0, 255, 204],   // I   — brand cyan
  [0, 224, 138],   // ii  — spring green
  [102, 255, 102], // iii — green
  [170, 255, 68],  // IV  — yellow-green
  [255, 204, 0],   // V   — amber
  [255, 68, 204],  // vi  — magenta
  [180, 76, 255],  // vii — violet
];

/**
 * Recording-HUD chord: root+quality big (soft static, pill-backed look),
 * right-hand extension smaller and dimmer, and the amber 8vb badge —
 * mirrors the live center display (WYSIWYG).
 */
export function drawChordHud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  size: number,
  base: string,
  ext: string,
  octaveDown: boolean,
): void {
  ctx.font = `700 ${size}px Orbitron, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0, 255, 204, 0.88)';
  ctx.shadowColor = 'rgba(0, 255, 204, 0.3)';
  ctx.shadowBlur = 6;
  const baseWidth = ctx.measureText(base).width;
  ctx.fillText(base, cx, baseY);
  if (ext) {
    ctx.font = `500 ${Math.round(size * 0.4)}px Orbitron, monospace`;
    ctx.fillStyle = 'rgba(0, 255, 204, 0.55)';
    ctx.shadowBlur = 0;
    ctx.fillText(ext, cx + baseWidth / 2 + Math.round(size * 0.25), baseY);
  }
  ctx.shadowBlur = 0;
  if (octaveDown) {
    // Amber pill (Inter — never Orbitron: its geometric glyphs turn
    // "8ve" into "81B"). Anchored to the base text's top-right.
    const badgeFont = Math.round(size * 0.22);
    ctx.font = `700 ${badgeFont}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    const bw = ctx.measureText('8vb').width;
    const bh = Math.round(size * 0.32);
    const pad = Math.round(size * 0.12);
    const bx = cx + baseWidth / 2 + (ext ? Math.round(size * 0.25) + ctx.measureText(ext).width + Math.round(size * 0.1) : Math.round(size * 0.12));
    const by = baseY - size * 0.95;
    ctx.fillStyle = 'rgba(255, 140, 0, 0.12)';
    ctx.strokeStyle = 'rgba(255, 160, 40, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bw + pad * 2, bh, bh / 2);
    } else {
      ctx.rect(bx, by, bw + pad * 2, bh);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb84d';
    ctx.textBaseline = 'middle';
    ctx.fillText('8vb', bx + pad, by + bh / 2 + 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
  }
}

/** Soft chord text — floats directly, like the on-site display. */
export function drawChordText(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  size: number,
  text: string,
): void {
  ctx.font = `700 ${size}px Orbitron, monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0, 255, 204, 0.88)';
  ctx.shadowColor = 'rgba(0, 255, 204, 0.3)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, cx, baseY);
  ctx.shadowBlur = 0;
}

/** Skeleton-mode stage: the website's dark cosmos + stage footlight. */
export function drawStageBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, w, h);
  // website-style radial glows (cyan above, purple mid)
  let g = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.max(w, h) * 0.6);
  g.addColorStop(0, 'rgba(0, 255, 204, 0.07)');
  g.addColorStop(1, 'rgba(0, 255, 204, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  g = ctx.createRadialGradient(w * 0.5, h * 0.7, 0, w * 0.5, h * 0.7, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(120, 80, 255, 0.06)');
  g.addColorStop(1, 'rgba(120, 80, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // stage footlight (merges with the waveform zone)
  const f = ctx.createLinearGradient(0, h * 0.85, 0, h);
  f.addColorStop(0, 'rgba(0, 255, 204, 0)');
  f.addColorStop(1, 'rgba(0, 255, 204, 0.09)');
  ctx.fillStyle = f;
  ctx.fillRect(0, Math.round(h * 0.85), w, Math.round(h * 0.15));
}

/** Live/recorded hand skeleton — neon lines + glowing fingertips.
 *  `scale` multiplies line widths / dot radii / glow — the live canvas
 *  bitmap is display-size × dpr (previously video-native 640px), so
 *  callers pass w/640 to keep the skeleton the same screen size. */
export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: HandData,
  canvasW: number,
  canvasH: number,
  color: string,
  glowColor: string,
  lineWidth: number = 3,
  tipGlow: number = 8,
  scale: number = 1,
  /** Cover-crop of the video inside the canvas (dx, dy = top-left of the
   *  drawn image, dw/dh = its size). Landmarks must map into this VISIBLE
   *  rect, mirrored — not the full canvas (bug 2026-08-09: the skeleton
   *  drifted toward the frame center on mobile, where a 16:9 video is
   *  zoomed ~2.5× inside a 9:16 canvas; desktop's ~zero crop hid it).
   *  Defaults to the full canvas — the caller passes nothing when the
   *  canvas IS the video (recording source = video-native size). */
  crop?: { dx: number; dy: number; dw: number; dh: number },
) {
  const pts = hand.landmarks;
  if (!pts || pts.length < 21) return;

  // The video's cover scale cancels out (lm.x * sw * scale = lm.x * dw),
  // so only the crop offsets matter.
  const { dx = 0, dy = 0, dw = canvasW, dh = canvasH } = crop ?? {};
  const toCanvas = (lm: { x: number; y: number }) => ({
    x: dx + dw * (1 - lm.x),
    y: dy + dh * lm.y,
  });

  ctx.strokeStyle = glowColor;
  ctx.lineWidth = lineWidth * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [a, b] of HAND_CONNECTIONS) {
    const pA = toCanvas(pts[a]);
    const pB = toCanvas(pts[b]);
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();
  }

  for (let i = 0; i < pts.length; i++) {
    const p = toCanvas(pts[i]);
    const isTip = [4, 8, 12, 16, 20].includes(i);

    ctx.beginPath();
    ctx.arc(p.x, p.y, (isTip ? 5 : 3) * scale, 0, Math.PI * 2);
    ctx.fillStyle = isTip ? color : 'rgba(255,255,255,0.5)';
    ctx.fill();

    if (isTip) {
      ctx.shadowColor = color;
      ctx.shadowBlur = tipGlow * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
