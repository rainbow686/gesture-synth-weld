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
  { roman: 'ii',    label: 'd',    intervals: [2, 5, 9],     isMajor: false },
  { roman: 'iii',   label: 'e',    intervals: [4, 7, 11],    isMajor: false },
  { roman: 'IV',    label: 'F',    intervals: [5, 9, 12],    isMajor: true  },
  { roman: 'V',     label: 'G',    intervals: [7, 11, 14],   isMajor: true  },
  { roman: 'vi',    label: 'a',    intervals: [9, 12, 16],   isMajor: false },
  { roman: 'vii°',  label: 'bdim', intervals: [11, 14, 17],  isMajor: false },
];

/**
 * Diatonic chords of the natural minor (Aeolian) scale, same degree order
 * as DIATONIC_CHORDS but built on the natural-minor pattern [0,2,3,5,7,8,10]
 * — roots AND qualities differ from the major table starting at degree 3.
 */
export const DIATONIC_CHORDS_MINOR: ChordDef[] = [
  { roman: 'i',    label: 'c',    intervals: [0, 3, 7],    isMajor: false },
  { roman: 'ii°',  label: 'ddim', intervals: [2, 5, 8],    isMajor: false },
  { roman: 'III',  label: 'Eb',   intervals: [3, 7, 10],   isMajor: true  },
  { roman: 'iv',   label: 'f',    intervals: [5, 8, 12],   isMajor: false },
  { roman: 'v',    label: 'g',    intervals: [7, 10, 14],  isMajor: false },
  { roman: 'VI',   label: 'Ab',   intervals: [8, 12, 15],  isMajor: true  },
  { roman: 'VII',  label: 'Bb',   intervals: [10, 14, 17], isMajor: true  },
];

/** Pick the diatonic chord table for a natural (unlocked-quality) scale. */
export function getDiatonicChords(scaleMode: 'major' | 'minor' = 'major'): ChordDef[] {
  return scaleMode === 'minor' ? DIATONIC_CHORDS_MINOR : DIATONIC_CHORDS;
}

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
  scaleMode: 'major' | 'minor' = 'major',
): number[] {
  const chords = getDiatonicChords(scaleMode);
  const chord = chords[chordIndex % chords.length];
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
      return isNaturallyMajor ? [4, 7, 12] : [3, 7, 12]; // 1st inversion: 3rd in bass (minor = flat 3rd)
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
 *
 * Case convention (2026-08-10): root-letter case IS the major/minor marker
 * — "C" = C major, "c" = C minor — instead of an appended 'm'. Diminished
 * still needs its own 'dim' suffix (case alone can't distinguish a
 * diminished triad from a plain minor one), stacked on the lowercase root.
 */
export function getChordName(
  chordIndex: number,
  modeOverride?: 'major' | 'minor',
  keyOffset: number = 0,
  chordStyle?: ChordStyle,
  scaleMode: 'major' | 'minor' = 'major',
): string {
  const chords = getDiatonicChords(scaleMode);
  const chord = chords[chordIndex % chords.length];
  const rootNoteIndex = ((chord.intervals[0] + keyOffset) % 12 + 12) % 12;
  const rootNoteName = KEYS[rootNoteIndex]?.name ?? 'C';

  // For locked chord styles, use their specific names
  if (chordStyle) {
    switch (chordStyle) {
      case 'root':
        // Single note, no third — no quality to case-mark.
        return rootNoteName;
      case 'triad':
      case 'majorTriad':
      case 'major1stInv': {
        // Despite the id, 'majorTriad' still tracks modeOverride/
        // chord.isMajor for its actual quality (see
        // getChordStyleIntervals) — same as the dynamic 'triad' style.
        const isMinor = modeOverride === 'major' ? false : modeOverride === 'minor' ? true : !chord.isMajor;
        return isMinor ? rootNoteName.toLowerCase() : rootNoteName;
      }
      case 'minorTriad':
        return rootNoteName.toLowerCase();
      case 'dimTriad':
        return rootNoteName.toLowerCase() + 'dim';
      case 'sus2':
        return rootNoteName + 'sus2';
      case 'sus4':
        return rootNoteName + 'sus4';
      case 'major7th':
        return rootNoteName + 'maj7';
      case 'dominant7th':
        return rootNoteName + '7';
      case '7th':
        return modeOverride === 'minor' ? rootNoteName.toLowerCase() + '7' : rootNoteName + 'maj7';
      case '9th':
        return modeOverride === 'minor' ? rootNoteName.toLowerCase() + '9' : rootNoteName + 'maj9';
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
    if (chord.roman.includes('°')) return rootNoteName.toLowerCase() + 'dim';
    return rootNoteName.toLowerCase();
  }
}

/**
 * Display-name split for the center HUD: the big root+quality line and the
 * smaller extension (right-hand chord changes — 7th/9th suffixes, inversion
 * slash-bass). Mirror of getChordName with the extension separated so the
 * HUD can style the two differently. Root names use the sharp alias
 * (C#/Db → C#), matching the toolbar.
 */
export function getChordParts(
  chordIndex: number,
  modeOverride?: 'major' | 'minor',
  keyOffset: number = 0,
  chordStyle?: ChordStyle,
  scaleMode: 'major' | 'minor' = 'major',
): { base: string; ext: string } {
  const chords = getDiatonicChords(scaleMode);
  const chord = chords[chordIndex % chords.length];
  const rootNoteIndex = ((chord.intervals[0] + keyOffset) % 12 + 12) % 12;
  const rootNoteName = (KEYS[rootNoteIndex]?.name ?? 'C').split('/')[0];

  const minor = (): boolean => {
    if (modeOverride === 'major') return false;
    if (modeOverride === 'minor') return true;
    return !chord.isMajor;
  };

  const root = minor() ? rootNoteName.toLowerCase() : rootNoteName;

  if (!chordStyle) {
    // Diatonic default (no locked style): root + quality, no extension.
    const dim = chord.roman.includes('°') && modeOverride !== 'major';
    return { base: dim ? root + 'dim' : root, ext: '' };
  }

  switch (chordStyle) {
    case 'root':
      // Single note, no third — no quality to case-mark.
      return { base: rootNoteName, ext: '' };
    case 'triad':
    case 'majorTriad':
      // Despite the id, 'majorTriad' still tracks modeOverride/chord.isMajor
      // for its actual quality (see getChordStyleIntervals) — same as the
      // dynamic 'triad' style. Display must match what's actually playing.
      return { base: root, ext: '' };
    case 'major1stInv': {
      // Slash-bass notation: 1st inversion puts the 3rd in the bass
      // (major third for major chords, minor third for minor). The bass
      // note is just an added-note annotation, not its own chord symbol
      // — it stays capitalized regardless of the base chord's quality.
      const third = minor() ? 3 : 4;
      const bass = (KEYS[(rootNoteIndex + third) % 12]?.name ?? 'C').split('/')[0];
      return { base: root, ext: `/${bass}` };
    }
    case 'minorTriad':
      return { base: rootNoteName.toLowerCase(), ext: '' };
    case 'dimTriad':
      return { base: rootNoteName.toLowerCase() + 'dim', ext: '' };
    case 'sus2':
      return { base: rootNoteName + 'sus2', ext: '' };
    case 'sus4':
      return { base: rootNoteName + 'sus4', ext: '' };
    case 'major7th':
      return { base: rootNoteName, ext: 'maj7' };
    case 'dominant7th':
      return { base: rootNoteName, ext: '7' };
    case '7th':
      return minor() ? { base: rootNoteName.toLowerCase(), ext: '7' } : { base: rootNoteName, ext: 'maj7' };
    case '9th':
      return minor() ? { base: rootNoteName.toLowerCase(), ext: '9' } : { base: rootNoteName, ext: 'maj9' };
  }
}

/** Number of notes the chord style plays (drives the waveform line count). */
export function chordNoteCount(chordStyle?: ChordStyle): number {
  switch (chordStyle) {
    case '7th':
    case 'major7th':
    case 'dominant7th':
      return 4;
    case '9th':
      return 5;
    default:
      return 3; // triads, 1st inversions, sus2/sus4, dim, root
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
