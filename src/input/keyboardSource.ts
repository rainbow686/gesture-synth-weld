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
 *     degree1-5 → scale degree I–V        (fingerCount 1–5)
 *     degree6   → VI                      (index+pinky)
 *     degree7   → VII                     (index+pinky+thumb)
 *     minor/major → wrist tilt (point-toggle, like the camera wrist)
 *   Right hand (expression):
 *     volumeUp/Down    → volume (hold to sweep; maps to height positionY)
 *     filterLeft/Right → filter sweep (hold to sweep; maps to tiltAngle)
 *     chordStyle1-4    → chord style (triad / 1st inv / 7th / 9th)
 *     octaveDown       → thumb (octave down, HUD 8vb badge)
 *   Space (stop-all) is kept in App by category convention, outside the
 *   customizable keymap.
 *
 * (2026-08-10) Which physical key drives each action is player-customizable
 * — see ./keymap.ts (DEFAULT_KEYMAP, ACTION_META, load/saveKeymap). This
 * file only knows about actions, never literal `e.key` values, so a rebind
 * (e.g. minor/major off '[' / ']', hard to reach on German QWERTZ) needs no
 * change here — just a call to setKeymap().
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
import { DEFAULT_KEYMAP, type KbAction } from './keymap';

const DEGREE_ACTIONS: KbAction[] = ['degree1', 'degree2', 'degree3', 'degree4', 'degree5', 'degree6', 'degree7'];
const CHORD_STYLE_INDEX: Partial<Record<KbAction, number>> = {
  chordStyle1: 1, chordStyle2: 2, chordStyle3: 3, chordStyle4: 4,
};

interface KbState {
  left: {
    /** The degree action currently HELD, or null when released. */
    action: KbAction | null;
    fingerCount: number; // 1-5 → I-V
    vi: boolean; // degree6 → VI
    vii: boolean; // degree7 → VII
    tilt: number; // -1 minor / +1 major
  };
  right: {
    styleFinger: number; // 1-4 → triad/1stInv/7th/9th
    thumb: boolean; // octaveDown → octave down
    positionY: number; // height → volume (0 top = loud, 1 bottom = quiet)
    tiltAngle: number; // -1..1 → filter sweep
  };
  /** Volume/filter actions held this frame — applied as a continuous sweep in getFrame. */
  adjust: {
    volume: -1 | 0 | 1; // volumeUp = -1 (louder), volumeDown = +1 (quieter)
    tilt: -1 | 0 | 1; // filterLeft = -1, filterRight = +1
  };
}

const DEFAULT_STATE: KbState = {
  left: { action: null, fingerCount: 1, vi: false, vii: false, tilt: 1 },
  right: { styleFinger: 1, thumb: false, positionY: 0.5, tiltAngle: 0 },
  adjust: { volume: 0, tilt: 0 },
};

/** Sweep speed per frame (rAF ~60fps → full range in ~1s). */
const SWEEP_STEP = 0.02;

function invert(map: Record<KbAction, string>): Map<string, KbAction> {
  return new Map(Object.entries(map).map(([action, key]) => [key, action as KbAction]));
}

export class KeyboardSource implements HandInputSource {
  readonly kind: InputSource = 'keyboard';

  private state: KbState = structuredClone(DEFAULT_STATE);
  private keyToAction: Map<string, KbAction> = invert(DEFAULT_KEYMAP);

  /** Swap the active key→action bindings (player customization). */
  setKeymap(map: Record<KbAction, string>): void {
    this.keyToAction = invert(map);
  }

  /** Key handler — call from a window keydown/keyup listener. */
  handleKey(e: KeyboardEvent, down: boolean): void {
    const action = this.keyToAction.get(e.key);
    if (!action) return; // Not a mapped key — keep default browser behavior.

    if (DEGREE_ACTIONS.includes(action)) {
      if (down) {
        const vi = action === 'degree6';
        const vii = action === 'degree7';
        const fingerCount = vi || vii ? this.state.left.fingerCount : DEGREE_ACTIONS.indexOf(action) + 1;
        this.state.left = { ...this.state.left, action, fingerCount, vi, vii };
      } else if (action === this.state.left.action) {
        // Release the held degree → no left hand → silence.
        this.state.left = { ...this.state.left, action: null };
      }
      return;
    }

    switch (action) {
      case 'minor':
        if (down) this.state.left = { ...this.state.left, tilt: -1 };
        break;
      case 'major':
        if (down) this.state.left = { ...this.state.left, tilt: 1 };
        break;
      case 'octaveDown':
        if (down) this.state.right = { ...this.state.right, thumb: !this.state.right.thumb };
        break;
      case 'chordStyle1': case 'chordStyle2': case 'chordStyle3': case 'chordStyle4':
        if (down) {
          this.state.right = { ...this.state.right, styleFinger: CHORD_STYLE_INDEX[action]! };
        }
        break;
      case 'volumeUp':
        this.state.adjust = { ...this.state.adjust, volume: down ? -1 : 0 };
        break;
      case 'volumeDown':
        this.state.adjust = { ...this.state.adjust, volume: down ? 1 : 0 };
        break;
      case 'filterLeft':
        this.state.adjust = { ...this.state.adjust, tilt: down ? -1 : 0 };
        break;
      case 'filterRight':
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
    if (left.action === null) {
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
