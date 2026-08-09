/**
 * Keyboard + mouse input source — the no-camera fallback (growth plan P0,
 * competitor .online/.net ship equivalents).
 *
 * Key principle: inputs are translated into synthetic `HandData` and fed
 * through the SAME consume pipeline as the camera ("every input reaches
 * the same audio engine"). The left hand (harmony) maps to the number
 * keys, the right hand (expression) to the mouse:
 *
 *   Left hand (harmony):
 *     1-5      → scale degree I–V        (fingerCount 1–5)
 *     6        → VI                      (index+pinky)
 *     7        → VII                     (index+pinky+thumb)
 *     Q / W    → wrist tilt (minor/major, matching camera sign: ≥0 major)
 *   Right hand (expression):
 *     mouse X  → tilt (filter sweep, -1..1)
 *     mouse Y  → height (volume, top = loud)
 *     8/9/0/-  → chord style 1–4 (triad / 1st inv / 7th / 9th)
 *     M        → thumb (octave down, HUD 8vb badge)
 *
 * Synthetic hands have empty landmarks — the skeleton overlay skips them
 * (drawHandSkeleton requires ≥21 points); everything else (HUD chord,
 * waveform, recording) works off the same fields as real hands.
 */

import type { HandData } from '../types';
import type { HandFrame, HandInputSource, InputSource } from './types';

interface KbState {
  left: {
    fingerCount: number; // 1-5 → I-V
    vi: boolean; // 6 → VI
    vii: boolean; // 7 → VII
    tilt: number; // -1 minor / +1 major
  };
  right: {
    styleFinger: number; // 1-4 → triad/1stInv/7th/9th
    thumb: boolean; // M → octave down
  };
  mouse: { x: number; y: number }; // 0..1 normalized
}

const DEFAULT_STATE: KbState = {
  left: { fingerCount: 1, vi: false, vii: false, tilt: 1 },
  right: { styleFinger: 1, thumb: false },
  mouse: { x: 0.5, y: 0.5 },
};

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
          this.state.left = { ...this.state.left, fingerCount: Number(key), vi: false, vii: false };
        }
        break;
      case '6':
        if (down) this.state.left = { ...this.state.left, vi: true, vii: false };
        break;
      case '7':
        if (down) this.state.left = { ...this.state.left, vii: true, vi: false };
        break;
      case 'q': case 'Q':
        if (down) this.state.left = { ...this.state.left, tilt: -1 };
        break;
      case 'w': case 'W':
        if (down) this.state.left = { ...this.state.left, tilt: 1 };
        break;
      case '8': case '9': case '0': case '-':
        if (down) {
          const styleFinger = key === '8' ? 1 : key === '9' ? 2 : key === '0' ? 3 : 4;
          this.state.right = { ...this.state.right, styleFinger };
        }
        break;
      case 'm': case 'M':
        if (down) this.state.right = { ...this.state.right, thumb: !this.state.right.thumb };
        break;
      default:
        break;
    }
  }

  /** Mouse handler — call from a window mousemove listener. */
  handleMouse(e: MouseEvent): void {
    this.state.mouse = {
      x: Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
      y: Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
    };
  }

  getFrame(): HandFrame {
    const { left, right, mouse } = this.state;

    // Left hand → harmony. VI/VII express via extended fingers (same
    // detection as the camera: index+pinky / +thumb). Plain 1-5 use
    // fingerCount only — extendedFingers must NOT include thumb/pinky
    // for those (a stray pinky would flip VI detection on the camera
    // path; here we control it fully).
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

    // Right hand → expression. Mouse Y is height (volume): positionY 0 =
    // top = loud (matches 1.1 - positionY in the consume pipeline).
    const rightHand: HandData = {
      landmarks: [],
      label: 'Right',
      fingerCount: right.styleFinger,
      extendedFingers: right.thumb ? ['thumb'] : ['index'],
      tiltAngle: mouse.x * 2 - 1, // -1..1 → filter sweep
      positionY: mouse.y,
      positionX: 0.7,
    };

    return { left: leftHand, right: rightHand };
  }

  reset(): void {
    this.state = structuredClone(DEFAULT_STATE);
  }
}
