import type { ChordDef } from './types';

/* ─── 12 Keys ────────────────────────────────────────────────────────── */

export const KEYS = [
  { name: 'C', midi: 0 },
  { name: 'C#/Db', midi: 1 },
  { name: 'D', midi: 2 },
  { name: 'D#/Eb', midi: 3 },
  { name: 'E', midi: 4 },
  { name: 'F', midi: 5 },
  { name: 'F#/Gb', midi: 6 },
  { name: 'G', midi: 7 },
  { name: 'G#/Ab', midi: 8 },
  { name: 'A', midi: 9 },
  { name: 'A#/Bb', midi: 10 },
  { name: 'B', midi: 11 },
];

/* ─── Diatonic Chords (intervals relative to root) ──────────────────── */

export const DIATONIC_CHORDS: ChordDef[] = [
  { roman: 'I',     label: 'C',    intervals: [0, 4, 7],     isMajor: true  },
  { roman: 'ii',    label: 'Dm',   intervals: [2, 5, 9],     isMajor: false },
  { roman: 'iii',   label: 'Em',   intervals: [4, 7, 11],    isMajor: false },
  { roman: 'IV',    label: 'F',    intervals: [5, 9, 12],    isMajor: true  },
  { roman: 'V',     label: 'G',    intervals: [7, 11, 14],   isMajor: true  },
  { roman: 'vi',    label: 'Am',   intervals: [9, 12, 16],   isMajor: false },
  { roman: 'vii°',  label: 'Bdim', intervals: [11, 14, 17],  isMajor: false },
];

/* ─── Chord Types (for right-hand chord style selection) ────────────── */

export type ChordStyle =
  | 'root'           // single note
  | 'triad'          // major/minor triad
  | '7th'            // 7th chord
  | '9th'            // 9th chord
  | 'majorTriad'     // locked major triad
  | 'major1stInv'    // major 1st inversion
  | 'minorTriad'     // locked minor triad
  | 'dimTriad'       // diminished triad
  | 'sus2'           // suspended 2nd
  | 'sus4'           // suspended 4th
  | 'major7th'       // major 7th
  | 'dominant7th';   // dominant 7th

export const CHORD_STYLE_OPTIONS: { id: ChordStyle; label: string }[] = [
  { id: 'majorTriad', label: 'Major Triad' },
  { id: 'major1stInv', label: 'Major 1st Inversion' },
  { id: 'minorTriad', label: 'Minor Triad' },
  { id: 'dimTriad', label: 'Diminished Triad' },
  { id: 'sus2', label: 'Sus2' },
  { id: 'sus4', label: 'Sus4' },
  { id: 'major7th', label: 'Major 7th' },
  { id: 'dominant7th', label: 'Dominant 7th' },
];

/** Base MIDI note: C3 — matches competitor's A3=220Hz root */
export const ROOT_MIDI = 48;

/**
 * Convert a MIDI note number to frequency in Hz.
 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Get chord note frequencies for a given chord index and mode override.
 * Supports key transposition and multiple chord types.
 */
export function getChordFreqs(
  chordIndex: number,
  modeOverride?: 'major' | 'minor',
  inversion: number = 0,
  keyOffset: number = 0, // semitones to transpose
  chordStyle?: ChordStyle,
  octaveDown: boolean = false,
): number[] {
  const chord = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
  let intervals: number[];

  // Determine effective major/minor for chord style
  const effectiveMajor = modeOverride === 'major' ? true : modeOverride === 'minor' ? false : chord.isMajor;

  // Determine base intervals based on chord style
  if (chordStyle) {
    intervals = getChordStyleIntervals(chordStyle, effectiveMajor);
    // Shift by chord's root note so each degree plays a different pitch
    intervals = intervals.map(i => i + chord.intervals[0]);
  } else {
    intervals = [...chord.intervals];

    // Determine chord quality
    let forceMajor: boolean;
    if (modeOverride === 'major') forceMajor = true;
    else if (modeOverride === 'minor') forceMajor = false;
    else forceMajor = chord.isMajor;

    // Adjust the third to make major or minor
    if (forceMajor) {
      intervals[1] = 4; // major third
    } else {
      intervals[1] = 3; // minor third
    }
  }

  // Apply inversion
  for (let i = 0; i < inversion && i < intervals.length; i++) {
    intervals[i] += 12;
  }
  // Sort so the bass note is the lowest
  intervals.sort((a, b) => a - b);

  // Apply key transposition + optional octave shift
  const baseMidi = ROOT_MIDI + (octaveDown ? -12 : 0);
  return intervals.map((interval) => midiToFreq(baseMidi + interval + keyOffset));
}

/**
 * Get intervals for a specific chord style.
 */
function getChordStyleIntervals(style: ChordStyle, isNaturallyMajor: boolean): number[] {
  switch (style) {
    case 'root':
      return [0];
    case 'triad':
      return isNaturallyMajor ? [0, 4, 7] : [0, 3, 7];
    case '7th':
      return isNaturallyMajor ? [0, 4, 7, 11] : [0, 3, 7, 10];
    case '9th':
      return isNaturallyMajor ? [0, 4, 7, 11, 14] : [0, 3, 7, 10, 14];
    case 'majorTriad':
      return isNaturallyMajor ? [0, 7, 12, 16] : [0, 7, 12, 15]; // major vs minor third
    case 'major1stInv':
      return [4, 7, 12]; // 1st inversion: 3rd in bass
    case 'minorTriad':
      return [0, 3, 7];
    case 'dimTriad':
      return [0, 3, 6];
    case 'sus2':
      return [0, 2, 7];
    case 'sus4':
      return [0, 5, 7];
    case 'major7th':
      return [0, 4, 7, 11];
    case 'dominant7th':
      return [0, 4, 7, 10];
    default:
      return [0, 4, 7];
  }
}

/**
 * Get the display name for a chord with mode override and key transposition.
 */
export function getChordName(
  chordIndex: number,
  modeOverride?: 'major' | 'minor',
  keyOffset: number = 0,
  chordStyle?: ChordStyle,
): string {
  const chord = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
  const rootNoteIndex = ((chord.intervals[0] + keyOffset) % 12 + 12) % 12;
  const rootNoteName = KEYS[rootNoteIndex]?.name ?? 'C';

  // For locked chord styles, use their specific names
  if (chordStyle) {
    switch (chordStyle) {
      case 'root':
        return rootNoteName;
      case 'triad':
      case 'majorTriad':
      case 'major1stInv':
        return rootNoteName;
      case 'minorTriad':
        return rootNoteName + 'm';
      case 'dimTriad':
        return rootNoteName + 'dim';
      case 'sus2':
        return rootNoteName + 'sus2';
      case 'sus4':
        return rootNoteName + 'sus4';
      case 'major7th':
        return rootNoteName + 'maj7';
      case 'dominant7th':
        return rootNoteName + '7';
      case '7th':
        return rootNoteName + (modeOverride === 'minor' ? 'm7' : 'maj7');
      case '9th':
        return rootNoteName + (modeOverride === 'minor' ? 'm9' : 'maj9');
    }
  }

  // Default behavior for diatonic chords
  let forceMajor: boolean;
  if (modeOverride === 'major') forceMajor = true;
  else if (modeOverride === 'minor') forceMajor = false;
  else forceMajor = chord.isMajor;

  if (forceMajor) {
    return rootNoteName;
  } else {
    // Check if it's a diminished chord
    if (chord.roman === 'vii°') return rootNoteName + 'dim';
    return rootNoteName + 'm';
  }
}

/**
 * Get scale degree notes for a given key and mode.
 * Returns 7 notes (one octave of the scale).
 */
export function getScaleNotes(
  keyOffset: number,
  mode: 'major' | 'minor',
): number[] {
  // Major scale: W-W-H-W-W-W-H (whole/half steps)
  // Minor scale (natural): W-H-W-W-H-W-W
  const majorPattern = [0, 2, 4, 5, 7, 9, 11];
  const minorPattern = [0, 2, 3, 5, 7, 8, 10];

  const pattern = mode === 'major' ? majorPattern : minorPattern;
  return pattern.map((interval) => midiToFreq(ROOT_MIDI + interval + keyOffset));
}
