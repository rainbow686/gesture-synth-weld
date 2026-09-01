/**
 * Recording constants (extracted from App.tsx 2026-08-09, pure move).
 * All module-level and pure — the recording domain's shared vocabulary.
 */

import type { ReactNode } from 'react';
import type { RecMode, RecRatio } from '../types';

/** Max recording length in seconds (15 → 30 2026-08-09, → 60 2026-08-17,
 *  → 120 2026-09-01: timeout share plateaued at ~27% after the 60s bump). */
export const RECORD_SECONDS = 120;

export const VIDEO_REC_SUPPORTED =
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function';

export const REC_RATIO_DIMS: Record<RecRatio, [number, number]> = {
  '9:16': [720, 1280],
  '16:9': [1280, 720],
  '1:1': [1080, 1080],
};

export const REC_RATIO_HINTS: Record<RecRatio, string> = {
  '9:16': 'TikTok · Instagram Reels · YouTube Shorts',
  '16:9': 'YouTube · general sharing',
  '1:1': 'Instagram feed · Discord · Reddit',
};

export const REC_SVG_PREVIEWS: Record<RecMode, ReactNode> = {
  video: (
    <svg viewBox="0 0 64 36" className="rec-preview" aria-hidden="true">
      <rect width="64" height="36" rx="4" fill="#0d0d2b" />
      <circle cx="22" cy="14" r="6" fill="#3a3a6a" />
      <path d="M14 29c0-4.2 3.5-6.5 8-6.5s8 2.3 8 6.5" fill="#3a3a6a" />
      <circle cx="44" cy="16" r="3" fill="#00ffcc" opacity=".9" />
      <circle cx="52" cy="16" r="3" fill="#ff00ff" opacity=".9" />
      <path d="M44 16h8M47 12.5l-3.5 3.5L47 19.5" stroke="#00ffcc" strokeWidth="1.4" fill="none" />
      <path d="M52 12.5l3.5 3.5L52 19.5" stroke="#ff00ff" strokeWidth="1.4" fill="none" />
    </svg>
  ),
  skeleton: (
    <svg viewBox="0 0 64 36" className="rec-preview" aria-hidden="true">
      <rect width="64" height="36" rx="4" fill="#0d0d2b" />
      <circle cx="44" cy="16" r="3" fill="#00ffcc" opacity=".9" />
      <circle cx="52" cy="16" r="3" fill="#ff00ff" opacity=".9" />
      <path d="M44 16h8M47 12.5l-3.5 3.5L47 19.5" stroke="#00ffcc" strokeWidth="1.4" fill="none" />
      <path d="M52 12.5l3.5 3.5L52 19.5" stroke="#ff00ff" strokeWidth="1.4" fill="none" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 64 36" className="rec-preview" aria-hidden="true">
      <rect width="64" height="36" rx="4" fill="#0d0d2b" />
      {[8, 14, 20, 26, 32, 38, 44, 50, 56].map((x, i) => (
        <rect key={x} x={x} y={18 - (i % 3) * 4} width="3" height={(i % 3) * 8 + 8} rx="1.5" fill="#00ffcc" opacity={0.85} />
      ))}
    </svg>
  ),
};
