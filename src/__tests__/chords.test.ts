import { describe, it, expect } from 'vitest';
import {
  KEYS,
  DIATONIC_CHORDS,
  CHORD_STYLE_OPTIONS,
  midiToFreq,
  getChordFreqs,
  getChordName,
  getChordParts,
  chordNoteCount,
} from '../chords';

describe('KEYS', () => {
  it('has exactly 12 keys starting from C', () => {
    expect(KEYS).toHaveLength(12);
    expect(KEYS[0].name).toBe('C');
    expect(KEYS[0].midi).toBe(0);
    expect(KEYS[11].name).toBe('B');
    expect(KEYS[11].midi).toBe(11);
  });
});

describe('DIATONIC_CHORDS', () => {
  it('has 7 scale degrees I through vii°', () => {
    expect(DIATONIC_CHORDS).toHaveLength(7);
    expect(DIATONIC_CHORDS.map((c) => c.roman)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  });

  it('marks the correct chord qualities (C major: I maj, ii min, vii° dim)', () => {
    const majors = DIATONIC_CHORDS.filter((c) => c.isMajor).map((c) => c.roman);
    expect(majors).toEqual(['I', 'IV', 'V']);
  });

  it('labels follow the C major scale (C, Dm, Em, F, G, Am, Bdim)', () => {
    expect(DIATONIC_CHORDS.map((c) => c.label)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  });
});

describe('midiToFreq', () => {
  it('converts MIDI note 69 (A4) to 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 3);
  });

  it('is monotonic (higher MIDI = higher frequency)', () => {
    expect(midiToFreq(70)).toBeGreaterThan(midiToFreq(69));
  });
});

describe('getChordFreqs', () => {
  it('C major I chord (C4 E4 G4) in C', () => {
    const freqs = getChordFreqs(0, 'major', 0, 0);
    expect(freqs).toHaveLength(3);
    expect(freqs[0]).toBeCloseTo(midiToFreq(48), 3); // C4
    expect(freqs[1]).toBeCloseTo(midiToFreq(52), 3); // E4
    expect(freqs[2]).toBeCloseTo(midiToFreq(55), 3); // G4
  });

  it('minor mode flattens the third (C minor: C4 Eb4 G4)', () => {
    const freqs = getChordFreqs(0, 'minor', 0, 0);
    expect(freqs[1]).toBeCloseTo(midiToFreq(51), 3); // Eb4
  });

  it('applies keyOffset (D key = +2 semitones)', () => {
    const freqs = getChordFreqs(0, 'major', 0, 2);
    expect(freqs[0]).toBeCloseTo(midiToFreq(50), 3); // D4
  });

  it('applies octaveDown (-12 semitones)', () => {
    const freqs = getChordFreqs(0, 'major', 0, 0, undefined, true);
    expect(freqs[0]).toBeCloseTo(midiToFreq(36), 3); // C3
  });

  it('major 7th style adds a 4th note (C maj7: C4 E4 G4 B4)', () => {
    const freqs = getChordFreqs(0, 'major', 0, 0, 'major7th');
    expect(freqs).toHaveLength(4);
    expect(freqs[3]).toBeCloseTo(midiToFreq(59), 3); // B4
  });
});

describe('getChordName', () => {
  it('returns root + quality for a major chord', () => {
    expect(getChordName(0, 'major', 0)).toMatch(/^C/);
  });

  it('returns root only for the root style', () => {
    expect(getChordName(0, 'major', 0, 'root')).toBe('C');
  });
});

describe('getChordParts (HUD split)', () => {
  it('diatonic default: base = root, ext empty', () => {
    const parts = getChordParts(0, 'major', 0);
    expect(parts.base).toBe('C');
    expect(parts.ext).toBe('');
  });

  it('minor chord gets an m suffix', () => {
    const parts = getChordParts(0, 'minor', 0);
    expect(parts.base).toContain('m');
  });

  it('1st inversion uses slash-bass notation', () => {
    const parts = getChordParts(0, 'major', 0, 'major1stInv');
    expect(parts.base).toBe('C');
    expect(parts.ext).toContain('/');
  });
});

describe('chordNoteCount (HUD waveform line count)', () => {
  it('triads/root = 3 lines', () => {
    expect(chordNoteCount('triad')).toBe(3);
    expect(chordNoteCount('root')).toBe(3);
    expect(chordNoteCount()).toBe(3); // undefined → default
  });

  it('7th family = 4 lines', () => {
    expect(chordNoteCount('7th')).toBe(4);
    expect(chordNoteCount('major7th')).toBe(4);
    expect(chordNoteCount('dominant7th')).toBe(4);
  });

  it('9th = 5 lines', () => {
    expect(chordNoteCount('9th')).toBe(5);
  });
});

describe('CHORD_STYLE_OPTIONS', () => {
  it('exposes ids and labels for every option', () => {
    expect(CHORD_STYLE_OPTIONS.length).toBeGreaterThanOrEqual(8);
    for (const opt of CHORD_STYLE_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });
});
