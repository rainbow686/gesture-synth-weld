import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandData, LandmarkPoint } from './types';

/* ─── MediaPipe Hand Tracking Wrapper ────────────────────────────────── */

// Use @latest to avoid version mismatch with installed package
const MODEL_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

let handLandmarker: HandLandmarker | null = null;

/**
 * Initialize the MediaPipe HandLandmarker.
 * Safe to call multiple times — returns the existing instance if already loaded.
 */
export async function initHandTracking(): Promise<HandLandmarker> {
  if (handLandmarker) return handLandmarker;

  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks(MODEL_PATH);
  } catch (e) {
    throw new Error(
      `Failed to load MediaPipe WASM runtime from CDN. Check your internet connection. (${e instanceof Error ? e.message : String(e)})`
    );
  }

  // Try GPU delegate first, fall back to CPU
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
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
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
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

  // Four fingers: fingertip above reference joint → extended
  // Pinky uses MCP (landmark 17) for more reliable detection —
  // the pinky is short so tip-vs-PIP difference is very small
  const fingerSpecs: [number, number, string][] = [
    [8, 6, 'index'],   // Index:  tip vs PIP
    [12, 10, 'middle'], // Middle: tip vs PIP
    [16, 14, 'ring'],   // Ring:   tip vs PIP
    [20, 17, 'pinky'],  // Pinky:  tip vs MCP (more lenient, pinky is short)
  ];

  for (const [tipIdx, refIdx, name] of fingerSpecs) {
    const tip = pts[tipIdx];
    const ref = pts[refIdx];
    // Fingertip above reference joint → extended
    // Small threshold on middle/ring to avoid false positives when curled
    const threshold = (name === 'middle' || name === 'ring') ? 0.015 : 0;
    if (tip.y < ref.y - threshold) {
      extended.push(name);
    }
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
