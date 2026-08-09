/**
 * Recording utilities (extracted from App.tsx 2026-08-09, pure move):
 * branded cover art + MediaRecorder mime-type selection.
 */

import { roundRectPath, drawStageBackground, drawUrlPill } from '../hud/draw';

/** Square cover art for audio files — the site's visual family:
 * dark cosmos background, neon sound-wave mark (cyan arcs + magenta
 * note dot — the two-hand colors), metal brand, decorative waveform,
 * URL pill, neon inner frame. */
export function makeCoverBlob(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 600;
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.resolve(new Blob());

  // background: the site's dark cosmos + footlight
  drawStageBackground(ctx, 600, 600);

  // neon inner frame (liquid-glass container)
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.28)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, 26, 26, 548, 548, 24);
  ctx.stroke();

  // sound-wave mark: three cyan arcs + magenta note dot
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i === 1 ? 'rgba(0, 255, 204, 0.9)' : 'rgba(0, 255, 204, 0.5)';
    ctx.lineWidth = i === 1 ? 3.5 : 2.5;
    ctx.beginPath();
    ctx.arc(300, 162, 30 + i * 13, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff6ec7';
  ctx.shadowColor = 'rgba(255, 110, 199, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(300, 152, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // brand: metal wordmark centered — auto-shrink so it never touches the edges
  // (target width = 80% of the canvas, leaving breathing room on both sides)
  const text = 'GESTURE SYNTH WELD';
  let size = 44;
  ctx.font = `800 ${size}px Orbitron, monospace`;
  ctx.textAlign = 'center';
  const targetW = 480;
  const measureW = ctx.measureText(text).width;
  if (measureW > targetW) {
    size = Math.floor(size * (targetW / measureW));
    ctx.font = `800 ${size}px Orbitron, monospace`;
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillText(text, 300, 306);
  const g = ctx.createLinearGradient(0, 304 - size, 0, 310);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#d8ecff');
  g.addColorStop(0.5, '#7fb8e8');
  g.addColorStop(0.7, '#eef8ff');
  g.addColorStop(1, '#a8cde8');
  ctx.fillStyle = g;
  ctx.fillText(text, 300, 304);

  // decorative waveform under the brand (music feel)
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const x = 110 + (i / 48) * 380;
    const y = 400 + Math.sin((i / 48) * Math.PI * 4) * 14;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // URL pill centered
  drawUrlPill(ctx, 300, 478, 24, true);

  return new Promise((res) => c.toBlob((b) => res(b ?? new Blob()), 'image/jpeg', 0.85));
}

/** Pick the best MediaRecorder mime type (mp4/m4a preferred, webm fallback). */
export function pickRecMimeType(audioOnly: boolean = false): { mime: string; ext: string } {
  const candidates: [string, string][] = audioOnly
    ? [
        ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
        ['audio/mp4', 'm4a'],
        ['audio/webm;codecs=opus', 'webm'],
        ['audio/webm', 'webm'],
      ]
    : [
        ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
        ['video/mp4', 'mp4'],
        ['video/webm;codecs=vp9,opus', 'webm'],
        ['video/webm;codecs=vp8,opus', 'webm'],
        ['video/webm', 'webm'],
      ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: audioOnly ? 'webm' : 'webm' };
}
