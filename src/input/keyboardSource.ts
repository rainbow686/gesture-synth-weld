/**
 * Keyboard input source — the no-camera fallback (growth plan P0).
 *
 * Key principle: inputs are translated into synthetic `HandData` and fed
 * through the SAME consume pipeline as the camera ("every input reaches
 * the same audio engine"). The left hand (harmony) maps to the number
 * keys, the right hand (expression) to the direction keys.
 *
 * Design (2026-08-09, user + competitor review — single-device, keyboard
 * only; competitor .net's arrow-key energy control was the inspiration):
 *
 *   Left hand (harmony) — HOLD to play, release to stop (keyboard
 *   instrument semantics; only the degree key is ever held, so multi-key
 *   state is always knowable):
 *     1-5      → scale degree I–V        (fingerCount 1–5)
 *     6        → VI                      (index+pinky)
 *     7        → VII                     (index+pinky+thumb)
 *     [ / ]    → wrist tilt minor/major (point-toggle, like the camera
 *                wrist; '[' = minor, ']' = major)
 *   Right hand (expression):
 *     ↑ / ↓    → volume (hold to sweep; maps to height positionY)
 *     ← / →    → filter sweep (hold to sweep; maps to tiltAngle)
 *     8/9/0/-  → chord style 1–4 (triad / 1st inv / 7th / 9th)
 *     Shift    → thumb (octave down, HUD 8vb badge)
 *   Space      → stop-all (kept in App; category convention)
 *
 * Releasing the held degree key reports no left hand — the consume
 * pipeline stops all sound (same path as the left fist / hand loss).
 *
 * Synthetic hands have empty landmarks — the skeleton overlay skips them
 * (drawHandSkeleton requires ≥21 points); everything else (HUD chord,
 * waveform, recording) works off the same fields as real hands.
 */

import type { HandData } from '../types';
import type { HandFrame, HandInputSource, InputSource } from './types';

interface KbState {
  left: {
    /** The degree key currently HELD ('1'-'7'), or null when released. */
    key: string | null;
    fingerCount: number; // 1-5 → I-V
    vi: boolean; // 6 → VI
    vii: boolean; // 7 → VII
    tilt: number; // -1 minor / +1 major ('[' / ']')
  };
  right: {
    styleFinger: number; // 1-4 → triad/1stInv/7th/9th
    thumb: boolean; // Shift → octave down
    positionY: number; // height → volume (0 top = loud, 1 bottom = quiet)
    tiltAngle: number; // -1..1 → filter sweep
  };
  /** Arrow keys held this frame — applied as a continuous sweep in getFrame. */
  adjust: {
    volume: -1 | 0 | 1; // ↑ = -1 (louder), ↓ = +1 (quieter)
    tilt: -1 | 0 | 1; // ← = -1, → = +1
  };
}

const DEFAULT_STATE: KbState = {
  left: { key: null, fingerCount: 1, vi: false, vii: false, tilt: 1 },
  right: { styleFinger: 1, thumb: false, positionY: 0.5, tiltAngle: 0 },
  adjust: { volume: 0, tilt: 0 },
};

/** Sweep speed per frame (rAF ~60fps → full range in ~1s). */
const SWEEP_STEP = 0.02;

export class KeyboardSource implements HandInputSource {
  readonly kind: InputSource = 'keyboard';

  private state: KbState = structuredClone(DEFAULT_STATE);

  /** Key handler — call from a window keydown/keyup listener. */
  handleKey(e: KeyboardEvent, down: boolean): void {
    const key = e.key;
    // Only react to our mapped keys; keep default browser behavior otherwise.
    switch (key) {
      case '1': case '2': case '3': case '4': case '5':
        if (down) {
          this.state.left = { ...this.state.left, key, fingerCount: Number(key), vi: false, vii: false };
        } else if (key === this.state.left.key) {
          // Release the held degree → no left hand → silence.
          this.state.left = { ...this.state.left, key: null };
        }
        break;
      case '6':
        if (down) this.state.left = { ...this.state.left, key, vi: true, vii: false };
        else if (key === this.state.left.key) this.state.left = { ...this.state.left, key: null };
        break;
      case '7':
        if (down) this.state.left = { ...this.state.left, key, vii: true, vi: false };
        else if (key === this.state.left.key) this.state.left = { ...this.state.left, key: null };
        break;
      case '[':
        if (down) this.state.left = { ...this.state.left, tilt: -1 }; // minor
        break;
      case ']':
        if (down) this.state.left = { ...this.state.left, tilt: 1 }; // major
        break;
      case 'Shift':
        if (down) this.state.right = { ...this.state.right, thumb: !this.state.right.thumb };
        break;
      case '8': case '9': case '0': case '-':
        if (down) {
          const styleFinger = key === '8' ? 1 : key === '9' ? 2 : key === '0' ? 3 : 4;
          this.state.right = { ...this.state.right, styleFinger };
        }
        break;
      case 'ArrowUp':
        this.state.adjust = { ...this.state.adjust, volume: down ? -1 : 0 };
        break;
      case 'ArrowDown':
        this.state.adjust = { ...this.state.adjust, volume: down ? 1 : 0 };
        break;
      case 'ArrowLeft':
        this.state.adjust = { ...this.state.adjust, tilt: down ? -1 : 0 };
        break;
      case 'ArrowRight':
        this.state.adjust = { ...this.state.adjust, tilt: down ? 1 : 0 };
        break;
      default:
        break;
    }
  }

  getFrame(): HandFrame {
    const { left, right, adjust } = this.state;

    // No degree key held → no left hand → the consume pipeline silences
    // (same path as the left fist / hand loss).
    if (left.key === null) {
      return { left: null, right: null, source: 'keyboard' };
    }

    // Arrow-key sweeps: volume (positionY) and filter (tiltAngle).
    if (adjust.volume !== 0) {
      right.positionY = Math.max(0, Math.min(1, right.positionY + adjust.volume * SWEEP_STEP));
    }
    if (adjust.tilt !== 0) {
      right.tiltAngle = Math.max(-1, Math.min(1, right.tiltAngle + adjust.tilt * SWEEP_STEP));
    }

    // Left hand → harmony. VI/VII express via extended fingers (same
    // detection as the camera: index+pinky / +thumb). Plain 1-5 use
    // fingerCount only — extendedFingers must NOT include thumb/pinky
    // for those (a stray pinky would flip VI detection).
    let extendedFingers: string[];
    let fingerCount: number;
    if (left.vi) {
      extendedFingers = ['index', 'pinky'];
      fingerCount = 2;
    } else if (left.vii) {
      extendedFingers = ['index', 'pinky', 'thumb'];
      fingerCount = 3;
    } else {
      extendedFingers = left.fingerCount >= 1 ? ['index'] : [];
      fingerCount = left.fingerCount;
    }

    const leftHand: HandData = {
      landmarks: [],
      label: 'Left',
      fingerCount,
      extendedFingers,
      tiltAngle: left.tilt,
      positionY: 0.5,
      positionX: 0.3,
    };

    // Right hand → expression (direction keys replace the mouse).
    const rightHand: HandData = {
      landmarks: [],
      label: 'Right',
      fingerCount: right.styleFinger,
      extendedFingers: right.thumb ? ['thumb'] : ['index'],
      tiltAngle: right.tiltAngle,
      positionY: right.positionY,
      positionX: 0.7,
    };

    return { left: leftHand, right: rightHand, source: 'keyboard' };
  }

  reset(): void {
    this.state = structuredClone(DEFAULT_STATE);
  }
}
