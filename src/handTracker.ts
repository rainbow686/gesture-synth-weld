import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandData, LandmarkPoint } from './types';

/* ─── MediaPipe Hand Tracking Wrapper ────────────────────────────────── */

const MODEL_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';

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

    const fingerCount = countExtendedFingers(landmarks);
    const tiltAngle = computeWristTilt(landmarks);
    const wrist = landmarks[0];

    hands.push({
      landmarks,
      label,
      fingerCount,
      tiltAngle,
      positionY: wrist.y,
      positionX: wrist.x,
    });
  }

  return hands;
}

/* ─── Finger Counting ────────────────────────────────────────────────── */

/**
 * Count how many fingers are extended on a single hand.
 * Uses the fingertip-to-wrist distance compared to MCP-to-wrist distance.
 * A finger is "extended" when its tip is farther from the wrist than its MCP joint.
 */
function countExtendedFingers(pts: LandmarkPoint[]): number {
  const wrist = pts[0];
  let count = 0;

  // Thumb: compare tip (4) vs index MCP (5) by X-distance from wrist
  // In MediaPipe coordinates, positive X is right in the image.
  // The thumb is extended when its tip is further from the palm center.
  const thumbTip = pts[4];
  const thumbIp = pts[3];
  const thumbMcp = pts[2];
  // Use the distance from the wrist projected onto the hand's radial axis
  const handDirX = pts[5].x - pts[0].x; // pinky MCP to index MCP direction
  const thumbTipProj = (thumbTip.x - wrist.x) * Math.sign(handDirX);
  const thumbMcpProj = (thumbMcp.x - wrist.x) * Math.sign(handDirX);
  const thumbIpProj = (thumbIp.x - wrist.x) * Math.sign(handDirX);
  if (thumbTipProj > thumbMcpProj || thumbTipProj > thumbIpProj) {
    count++;
  }

  // Other four fingers: tip farther from wrist than MCP
  const fingerPairs: [number, number][] = [
    [8, 5],   // Index:  tip vs MCP
    [12, 9],  // Middle: tip vs MCP
    [16, 13], // Ring:   tip vs MCP
    [20, 17], // Pinky:  tip vs MCP
  ];

  for (const [tipIdx, mcpIdx] of fingerPairs) {
    const tip = pts[tipIdx];
    const mcp = pts[mcpIdx];
    const tipDist = dist2D(tip, wrist);
    const mcpDist = dist2D(mcp, wrist);
    if (tipDist > mcpDist * 1.05) {
      count++;
    }
  }

  return count;
}

function dist2D(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/* ─── Wrist Tilt ─────────────────────────────────────────────────────── */

/**
 * Compute the wrist tilt angle in radians.
 * Uses the vector from index MCP (5) to pinky MCP (17) as the hand's cross-axis.
 * The angle relative to horizontal indicates tilt direction.
 *
 * Positive = hand tilted "up" (thumb side raised) → major
 * Negative = hand tilted "down" (pinky side raised) → minor
 */
function computeWristTilt(pts: LandmarkPoint[]): number {
  const indexMcp = pts[5];
  const pinkyMcp = pts[17];

  const dx = pinkyMcp.x - indexMcp.x;
  const dy = pinkyMcp.y - indexMcp.y;

  // atan2 gives the angle of the cross-axis from horizontal
  const angle = Math.atan2(dy, dx);

  return angle;
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
