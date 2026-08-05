import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandData, LandmarkPoint } from './types';
import { modelSourceLabel, trackModelLoad } from './analytics';

/* ─── MediaPipe Hand Tracking Wrapper ────────────────────────────────── */

// Model sources. Primary: Cloudflare (assets.gesturesynthweld.com —
// unlimited bandwidth, global CDN). Fallback: Vercel same-origin (/v1.0.1/).
// CF is deterministic-priority — see pickSource() for why we never race them.
// Browsers cache these files for 1 year (immutable, via the CF _headers
// file), so a version bump MUST change this path AND re-upload
// public/vX.Y.Z/ to CF — see CLAUDE.md.
const MODEL_SOURCES = [
  {
    wasm: 'https://assets.gesturesynthweld.com/v1.0.1/wasm',
    task: 'https://assets.gesturesynthweld.com/v1.0.1/hand_landmarker.task',
  },
  { wasm: '/v1.0.1/wasm', task: '/v1.0.1/hand_landmarker.task' },
] as const;

/**
 * Pick the download source. CF is deterministic-priority, never raced against
 * Vercel: on real user networks Vercel's static edges answer HEADs faster
 * than CF's worker (8/4 analytics: Promise.any picked Vercel for 92% of
 * downloads — ~6 GB/day of metered egress). Probe CF only (3s) and prefer it
 * whenever reachable; same-origin Vercel is the fallback for CF-unreachable
 * users (e.g. mainland China ISPs with flaky CF paths).
 */
async function pickSource(): Promise<(typeof MODEL_SOURCES)[number]> {
  const cf = MODEL_SOURCES[0];
  try {
    const res = await fetch(cf.task, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (res.ok) return cf;
  } catch {
    // CF unreachable — fall back to same-origin Vercel.
  }
  return MODEL_SOURCES[1];
}

let handLandmarker: HandLandmarker | null = null;
let initPromise: Promise<HandLandmarker> | null = null;

/**
 * Initialize the MediaPipe HandLandmarker.
 * Safe to call multiple times — returns the existing instance if already loaded.
 * Concurrent calls (prefetch + click) share one in-flight promise so the
 * ~19 MB download happens exactly once.
 */
export function initHandTracking(): Promise<HandLandmarker> {
  if (handLandmarker) return Promise.resolve(handLandmarker);
  if (!initPromise) {
    initPromise = doInit().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

/**
 * Hover/touch prefetch — downloads from CF only. A hover must never spend
 * Vercel's metered bandwidth, so if CF is unreachable this silently does
 * nothing; the click path (initHandTracking) still has the Vercel fallback.
 */
export async function prefetchModel(): Promise<void> {
  const cf = MODEL_SOURCES[0];
  try {
    const res = await fetch(cf.task, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (res.ok) await initHandTracking();
  } catch {
    // CF down — nothing to prefetch.
  }
}

async function doInit(): Promise<HandLandmarker> {
  let lastError: unknown;
  // Race the probes, then init from the winner; retry once with the other
  // source if the first init fails mid-download.
  const order = await pickSource().catch((e) => {
    lastError = e;
    return null;
  });
  const attemptSources = order
    ? [order, ...MODEL_SOURCES.filter((s) => s !== order)]
    : [...MODEL_SOURCES];
  const startTime = performance.now();
  for (const src of attemptSources) {
    trackModelLoad('started', { source: modelSourceLabel(src.wasm) });
    try {
      const vision = await FilesetResolver.forVisionTasks(src.wasm);

      // Try GPU delegate first, fall back to CPU
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: src.task,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (_gpuErr) {
        // GPU delegate not available — try CPU
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: src.task,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      }
      trackModelLoad('completed', {
        source: modelSourceLabel(src.wasm),
        duration_ms: Math.round(performance.now() - startTime),
      });
      return handLandmarker;
    } catch (e) {
      lastError = e;
    }
  }
  trackModelLoad('failed', {
    source: 'all',
    reason: lastError instanceof Error ? lastError.message.slice(0, 80) : String(lastError),
  });
  throw new Error(
    `Failed to load MediaPipe WASM runtime. Check your internet connection. (${lastError instanceof Error ? lastError.message : String(lastError)})`
  );
}

/**
 * Detect hands in a video frame.
 * Returns an array of HandData for each detected hand (0, 1, or 2).
 */
export function detectHands(
  video: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas,
  timestampMs: number,
): HandData[] {
  if (!handLandmarker) return [];

  const result = handLandmarker.detectForVideo(video, timestampMs);
  return parseResults(result);
}

/* ─── Parse MediaPipe Results ────────────────────────────────────────── */

function parseResults(result: HandLandmarkerResult): HandData[] {
  if (!result.landmarks || result.landmarks.length === 0) return [];

  const hands: HandData[] = [];

  for (let i = 0; i < result.landmarks.length; i++) {
    const rawLandmarks = result.landmarks[i];
    const label = result.handedness[i]?.[0]?.categoryName as 'Left' | 'Right';

    if (!label || !rawLandmarks?.length) continue;

    const landmarks: LandmarkPoint[] = rawLandmarks.map((lm) => ({
      x: lm.x,
      y: lm.y,
      z: lm.z ?? 0,
    }));

    const extendedFingers = getExtendedFingers(landmarks, label);
    const fingerCount = extendedFingers.length;
    const tiltAngle = computeWristTilt(landmarks, label);
    const wrist = landmarks[0];

    hands.push({
      landmarks,
      label,
      fingerCount,
      extendedFingers,
      tiltAngle,
      positionY: wrist.y,
      positionX: wrist.x,
    });
  }

  return hands;
}

/* ─── Finger Counting ────────────────────────────────────────────────── */

/**
 * Get which fingers are extended on a single hand.
 * Uses Y-coordinate comparison: fingertip above PIP joint means extended.
 * This works consistently regardless of palm facing direction.
 */
function getExtendedFingers(pts: LandmarkPoint[], label: 'Left' | 'Right'): string[] {
  const extended: string[] = [];

  // Thumb: use horizontal comparison (X-axis) with handedness awareness
  const thumbTip = pts[4];
  const thumbIp = pts[3];
  // For right hand: thumb extends right (tip.x > ip.x)
  // For left hand: thumb extends left (tip.x < ip.x)
  const thumbExtended = label === 'Right' ? thumbTip.x > thumbIp.x : thumbTip.x < thumbIp.x;
  if (thumbExtended) {
    extended.push('thumb');
  }

  // Index / Middle / Ring: standard tip-vs-PIP (matching competitor)
  const standardFingers: [number, number, string][] = [
    [8, 6, 'index'],
    [12, 10, 'middle'],
    [16, 14, 'ring'],
  ];

  for (const [tipIdx, pipIdx, name] of standardFingers) {
    if (pts[tipIdx].y < pts[pipIdx].y) {
      extended.push(name);
    }
  }

  // Pinky: standard tip-vs-PIP, same as other fingers
  if (pts[20].y < pts[18].y) {
    extended.push('pinky');
  }

  return extended;
}

/* ─── Wrist Tilt ─────────────────────────────────────────────────────── */

/**
 * Compute wrist tilt as a normalized value in [-1, 1].
 * Based on wrist X position relative to middle/ring MCP span.
 * Positive = thumb side raised, negative = pinky side raised.
 */
function computeWristTilt(pts: LandmarkPoint[], label: 'Left' | 'Right'): number {
  const wrist = pts[0];
  const midMcp = pts[9];
  const ringMcp = pts[13];
  if (!wrist || !midMcp || !ringMcp) return 0;

  const spanLeft = Math.min(midMcp.x, ringMcp.x);
  const spanRight = Math.max(midMcp.x, ringMcp.x);
  const deadZone = 0.12;

  let tilt = 0;
  if (wrist.x < spanLeft) {
    tilt = (wrist.x - spanLeft) / deadZone;
  } else if (wrist.x > spanRight) {
    tilt = (wrist.x - spanRight) / deadZone;
  }
  tilt = Math.max(-1, Math.min(1, tilt));

  // Flip sign for right hand to align with anatomical direction
  return label === 'Right' ? -tilt : tilt;
}

/* ─── Hand Connection Map for Skeleton Drawing ──────────────────────── */

/** Connections between landmarks for drawing the hand skeleton */
export const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm
  [5, 9], [9, 13], [13, 17],
];
