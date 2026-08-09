/**
 * Camera input source: MediaPipe detection + hand-presence smoothing.
 *
 * Extracted from App.tsx processHands (2026-08-09 refactor, pure move —
 * behavior identical). The smoothing here is camera-specific noise
 * handling (a hand flickering out for a frame should not mute the music);
 * keyboard/MIDI sources don't need it. The STABLE result feeds the same
 * consume-hands pipeline as every other source.
 */

import type { HandData } from '../types';
import { detectHands } from '../handTracker';
import type { HandFrame, HandInputSource, InputSource } from './types';

/** Frames of history used for the majority-vote hand-presence check. */
const HAND_STABLE_FRAMES = 3;

export class CameraSource implements HandInputSource {
  readonly kind: InputSource = 'camera';

  private history: { left: boolean[]; right: boolean[] } = { left: [], right: [] };

  /** Detect + smooth hands from one video frame. */
  getFrame(video: HTMLVideoElement, timestamp: number): HandFrame {
    const hands = detectHands(video, timestamp);

    let left: HandData | null = null;
    let right: HandData | null = null;

    for (const hand of hands) {
      if (hand.label === 'Left') {
        left = hand;
      } else {
        right = hand;
      }
    }

    // Apply hand detection smoothing to prevent flickering
    this.history.left.push(!!left);
    this.history.right.push(!!right);
    if (this.history.left.length > HAND_STABLE_FRAMES) {
      this.history.left.shift();
    }
    if (this.history.right.length > HAND_STABLE_FRAMES) {
      this.history.right.shift();
    }

    // Use majority vote: hand is detected if at least half of recent frames detected it
    // This prevents flickering while still being responsive
    const leftDetected = this.history.left.filter((v) => v).length >= Math.ceil(HAND_STABLE_FRAMES / 2);
    const rightDetected = this.history.right.filter((v) => v).length >= Math.ceil(HAND_STABLE_FRAMES / 2);

    return {
      left: leftDetected ? left : null,
      right: rightDetected ? right : null,
    };
  }

  reset(): void {
    this.history = { left: [], right: [] };
  }
}
