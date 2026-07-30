/* ─── Gesture & Synth Type Definitions ───────────────────────────────── */

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface HandData {
  landmarks: LandmarkPoint[];
  /** "Left" or "Right" as reported by MediaPipe (camera-mirror-aware) */
  label: 'Left' | 'Right';
  /** Number of extended fingers (0-5) */
  fingerCount: number;
  /** Wrist tilt angle in radians, positive = toward thumb/up-right */
  tiltAngle: number;
  /** Normalized Y position of wrist (0 = top, 1 = bottom) */
  positionY: number;
  /** Normalized X position of wrist (0 = left, 1 = right) */
  positionX: number;
}

export interface GestureState {
  left: HandData | null;
  right: HandData | null;
}

export interface ChordDef {
  roman: string;
  label: string;
  intervals: number[];
  /** True = naturally major, False = naturally minor */
  isMajor: boolean;
}

export type WaveformType = 'sine' | 'triangle' | 'sawtooth' | 'square';

export const TIMBRE_LABELS: Record<WaveformType, string> = {
  sine: 'Pure Sine',
  triangle: 'Warm Triangle',
  sawtooth: 'Bright Saw',
  square: 'Punchy Square',
};

/** Maps finger count (0-5) to waveform type */
export const FINGER_TO_WAVEFORM: Record<number, WaveformType> = {
  0: 'sine',
  1: 'sine',
  2: 'triangle',
  3: 'sawtooth',
  4: 'square',
  5: 'sawtooth',
};

/** Maps finger count (1-5) to diatonic chord index (0-6), cycling */
export const FINGER_TO_CHORD_INDEX: Record<number, number> = {
  0: 0,
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
};

/** Extra chord indices for 5 fingers (cycles to V, vi, vii°) */
export const FINGER_5_ALT_CHORDS = [4, 5, 6];

export interface SynthState {
  chordIndex: number;
  chordName: string;
  volume: number; // 0-1
  waveform: WaveformType;
  timbreLabel: string;
  mode: 'major' | 'minor' | 'neutral';
  isPlaying: boolean;
}
