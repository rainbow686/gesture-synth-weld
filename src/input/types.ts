/**
 * Input source abstraction (2026-08-09, refactor/input-engine-architecture).
 *
 * Architecture: every input source (camera, keyboard+mouse, future MIDI)
 * produces the SAME payload — a pair of `HandData` (left/right, or null) —
 * which App consumes through one pipeline ("every input reaches the same
 * audio engine", the competitor .online principle). Hand-gesture-only
 * concerns (detection smoothing) live inside CameraSource; synthetic
 * sources like KeyboardSource emit already-stable HandData.
 */

import type { HandData } from '../types';

/** Which input source is driving the instrument right now. */
export type InputSource = 'camera' | 'keyboard';

/** One processed frame from any source: stable hands or null. */
export interface HandFrame {
  left: HandData | null;
  right: HandData | null;
  /** Which source produced this frame — consumers gate camera-specific
   *  compensation (pinky memory) on this. */
  source: InputSource;
}

/** Common interface for all input sources (future MIDI source implements this). */
export interface HandInputSource {
  readonly kind: InputSource;
  /** Produce the current stable hand pair (nulls = hand absent).
   *  Camera needs the video frame; synthetic sources take none. */
  getFrame(video?: HTMLVideoElement, timestamp?: number): HandFrame;
  /** Reset per-session state (fired on stop). */
  reset(): void;
}
