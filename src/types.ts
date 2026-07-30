/* ─── Gesture & Synth Type Definitions ───────────────────────────────── */

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface HandData {
  landmarks: LandmarkPoint[];
  label: 'Left' | 'Right';
  fingerCount: number;
  tiltAngle: number;
  positionY: number;
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
  isMajor: boolean;
}

export type WaveformType = 'sine' | 'triangle' | 'sawtooth' | 'square';

/** App mode: Gesture (two-hand) or Theremin (single-hand) or MonoPiano (single-note per finger) */
export type AppMode = 'gesture' | 'theremin' | 'monoPiano';

/** Left hand mode: how left hand controls harmony */
export type LeftHandMode = 'scaleTilt' | 'scaleLocked';

/** Right hand mode: how right hand controls expression */
export type RightHandMode = 'fingerLayout' | 'fixedChordStyle';

/** Arpeggiator speed */
export type ArpSpeed = 'slow' | 'normal' | 'fast';

export const ARP_SPEED_MS: Record<ArpSpeed, number> = {
  slow: 120,
  normal: 80,
  fast: 50,
};

// Right hand finger count → note interval (semitones from root)
// Used in monoPiano mode for single-note-per-finger playing
export const FINGER_TO_NOTE_INTERVAL: Record<number, number> = {
  1: 0,   // Thumb/root → root
  2: 4,   // Index → major 3rd
  3: 7,   // Middle → perfect 5th
  4: 12,  // Ring → octave
  5: 14,  // Pinky → 9th
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

export interface SynthState {
  chordIndex: number;
  chordName: string;
  volume: number;
  mode: 'major' | 'minor' | 'neutral';
  isPlaying: boolean;
  /** Key offset in semitones (0 = C) */
  keyOffset: number;
  /** App mode */
  appMode: AppMode;
  /** Left hand mode */
  leftHandMode: LeftHandMode;
  /** Right hand mode */
  rightHandMode: RightHandMode;
  /** Locked chord style (for fixedChordStyle mode) */
  lockedChordStyle?: import('./chords').ChordStyle;
  /** Locked mode for scaleLocked left hand mode */
  lockedMode?: 'major' | 'minor';
  /** Arpeggiator enabled */
  arpeggiate: boolean;
  /** Arpeggiator speed */
  arpSpeed: ArpSpeed;
  /** Auto bass enabled */
  autoBass: boolean;
  /** Bass volume (0-1) */
  bassVolume: number;
}
