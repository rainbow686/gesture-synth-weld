import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandData, LandmarkPoint } from './types';

/* ─── MediaPipe Hand Tracking Wrapper ────────────────────────────────── */

// Model sources, tried in order. Primary: Cloudflare (gsw-media.rainbow686.
// workers.dev — unlimited bandwidth, global CDN). Fallback: Vercel same-origin
// (/v1.0.1/) — workers.dev is DNS-polluted in mainland China, so CN users get
// the fallback automatically (their ~19 MB still counts against Vercel's
// bandwidth, but it keeps the camera working). Browsers cache these files for
// 1 year (immutable, via the CF _headers file), so a version bump MUST change
// this path AND re-upload public/vX.Y.Z/ to CF — see CLAUDE.md.
const MODEL_SOURCES = [
  {
    wasm: 'https://assets.gesturesynthweld.com/v1.0.1/wasm',
    task: 'https://assets.gesturesynthweld.com/v1.0.1/hand_landmarker.task',
  },
  { wasm: '/v1.0.1/wasm', task: '/v1.0.1/hand_landmarker.task' },
] as const;

/** Fast reachability probe (HEAD, 6s cap) so a blocked CDN falls back quickly. */
async function sourceReachable(taskUrl: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(taskUrl, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
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

async function doInit(): Promise<HandLandmarker> {
  let lastError: unknown;
  for (const src of MODEL_SOURCES) {
    // Skip unreachable sources quickly (6s cap) so CN users fall back to the
    // same-origin copy instead of waiting for a workers.dev timeout.
    if (!(await sourceReachable(src.task))) continue;
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
      return handLandmarker;
    } catch (e) {
      lastError = e;
    }
  }
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
