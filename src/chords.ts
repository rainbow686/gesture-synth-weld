import type { ChordDef } from './types';

/* ─── Diatonic Chords in C Major ─────────────────────────────────────── */

export const DIATONIC_CHORDS: ChordDef[] = [
  { roman: 'I',     label: 'C',    intervals: [0, 4, 7],     isMajor: true  },
  { roman: 'ii',    label: 'Dm',   intervals: [2, 5, 9],     isMajor: false },
  { roman: 'iii',   label: 'Em',   intervals: [4, 7, 11],    isMajor: false },
  { roman: 'IV',    label: 'F',    intervals: [5, 9, 12],    isMajor: true  },
  { roman: 'V',     label: 'G',    intervals: [7, 11, 14],   isMajor: true  },
  { roman: 'vi',    label: 'Am',   intervals: [9, 12, 16],   isMajor: false },
  { roman: 'vii°',  label: 'Bdim', intervals: [11, 14, 17],  isMajor: false },
];

/** Base MIDI note: C4 */
export const ROOT_MIDI = 60;

/**
 * Convert a MIDI note number to frequency in Hz.
 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Get chord note frequencies for a given chord index and mode override.
 * `modeOverride` forces major/minor triads regardless of the chord's natural quality.
 */
export function getChordFreqs(
  chordIndex: number,
  modeOverride?: 'major' | 'minor',
  inversion: number = 0,
): number[] {
  const chord = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
  let intervals = [...chord.intervals];

  // Determine chord quality
  let forceMajor: boolean | null = null;
  if (modeOverride === 'major') forceMajor = true;
  else if (modeOverride === 'minor') forceMajor = false;
  else forceMajor = chord.isMajor;

  // Adjust the third to make major or minor
  if (forceMajor) {
    intervals[1] = 4; // major third
  } else {
    intervals[1] = 3; // minor third
  }

  // Apply inversion
  for (let i = 0; i < inversion && i < intervals.length; i++) {
    intervals[i] += 12;
  }
  // Sort so the bass note is the lowest
  intervals.sort((a, b) => a - b);

  return intervals.map((interval) => midiToFreq(ROOT_MIDI + interval));
}

/**
 * Get the display name for a chord with mode override.
 */
export function getChordName(
  chordIndex: number,
  modeOverride?: 'major' | 'minor',
): string {
  const chord = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
  const root = chord.label.replace(/m$|dim$/, '');

  let forceMajor: boolean;
  if (modeOverride === 'major') forceMajor = true;
  else if (modeOverride === 'minor') forceMajor = false;
  else forceMajor = chord.isMajor;

  if (forceMajor) {
    return root;
  } else {
    // Check if it's a diminished chord
    if (chord.roman === 'vii°') return root + 'dim';
    return root + 'm';
  }
}
