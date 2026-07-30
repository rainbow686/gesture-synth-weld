import * as Tone from 'tone';
import type { ChordStyle } from './chords';
import { getChordFreqs, getChordName, midiToFreq, ROOT_MIDI } from './chords';
import type { ArpSpeed } from './types';
import { ARP_SPEED_MS } from './types';

/* ─── Tone.js Audio Engine ───────────────────────────────────────────── */

export type TimbreType = 'piano' | 'strings' | 'organ' | 'synth' | 'vibraphone';

export const TIMBRE_OPTIONS: { id: TimbreType; label: string; icon: string }[] = [
  { id: 'piano', label: 'Piano', icon: '🎹' },
  { id: 'strings', label: 'Strings', icon: '🎻' },
  { id: 'organ', label: 'Organ', icon: '🎛️' },
  { id: 'synth', label: 'Synth', icon: '⚡' },
  { id: 'vibraphone', label: 'Vibraphone', icon: '🔔' },
];

// Salamander Grand Piano samples from Tone.js CDN (C1 to C7)
const PIANO_SAMPLES_URL = 'https://tonejs.github.io/audio/salamander/';
const PIANO_NOTES: Record<string, string> = {
  C1: 'C1.mp3', C2: 'C2.mp3', C3: 'C3.mp3', C4: 'C4.mp3',
  C5: 'C5.mp3', C6: 'C6.mp3', C7: 'C7.mp3',
};

interface Instrument {
  triggerAttack: (freq: number, time?: number, velocity?: number) => void;
  triggerRelease: (freq: number, time?: number) => void;
  releaseAll: (time?: number) => void;
  dispose: () => void;
}

class SamplerInstrument implements Instrument {
  private sampler: Tone.Sampler;
  private loaded = false;

  constructor(urls: Record<string, string>, baseUrl: string, onload?: () => void, filter?: Tone.Filter) {
    const dest = filter || Tone.getContext().destination;
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl,
      onload: () => {
        this.loaded = true;
        onload?.();
      },
      onerror: (err) => {
        console.warn('Sampler load error:', err);
      },
    }).connect(dest);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  triggerAttack(freq: number, time?: number, velocity = 0.8): void {
    this.sampler.triggerAttack(freq, time, velocity);
  }

  triggerRelease(freq: number, time?: number): void {
    this.sampler.triggerRelease(freq, time);
  }

  releaseAll(time?: number): void {
    this.sampler.releaseAll(time);
  }

  dispose(): void {
    this.sampler.dispose();
  }
}

class SynthInstrument implements Instrument {
  private synth: Tone.PolySynth;

  constructor(options: {
    waveform: OscillatorType;
    envelope: { attack?: number; decay?: number; sustain?: number; release?: number };
    filterFreq?: number;
    filter?: Tone.Filter;
  }) {
    const { waveform, envelope, filterFreq, filter } = options;

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: waveform },
      envelope: {
        attack: envelope.attack ?? 0.02,
        decay: envelope.decay ?? 0.1,
        sustain: envelope.sustain ?? 0.8,
        release: envelope.release ?? 0.5,
      },
    });

    if (filterFreq) {
      const filterNode = new Tone.Filter(filterFreq, 'lowpass');
      this.synth.connect(filterNode);
      if (filter) {
        filterNode.connect(filter);
      } else {
        filterNode.toDestination();
      }
    } else {
      if (filter) {
        this.synth.connect(filter);
      } else {
        this.synth.toDestination();
      }
    }
  }

  triggerAttack(freq: number, time?: number, velocity = 0.8): void {
    this.synth.triggerAttack(freq, time, velocity);
  }

  triggerRelease(freq: number, time?: number): void {
    this.synth.triggerRelease(freq, time);
  }

  releaseAll(time?: number): void {
    this.synth.releaseAll(time);
  }

  dispose(): void {
    this.synth.dispose();
  }
}

export class AudioEngine {
  private currentTimbre: TimbreType = 'piano';
  private instruments: Map<TimbreType, Instrument> = new Map();
  private activeNotes: Set<number> = new Set();
  private recordingDestination: Tone.Recorder | null = null;
  private isRecordingActive = false;
  private pianoLoading = false;
  private pianoLoaded = false;
  private initCalled = false;

  // Volume control
  private masterGain: Tone.Gain | null = null;
  private currentVolume = -1;

  // Filter control
  private filter: Tone.Filter | null = null;

  // Arpeggiator state
  private arpTimer: number | null = null;
  private arpNotes: number[] = [];
  private arpIndex = 0;
  private arpSpeed: ArpSpeed = 'normal';

  // Auto Bass
  private bassSynth: Tone.Synth | null = null;
  private bassNote: number | null = null;

  // Chord deduplication
  private currentChordKey: string | null = null;

  async init(): Promise<void> {
    if (this.initCalled) return;
    this.initCalled = true;

    await Tone.start();
    console.log('Audio engine initialized');

    // Create master gain for volume control
    this.masterGain = new Tone.Gain(1).toDestination();

    // Create filter for tone control
    this.filter = new Tone.Filter(1200, 'lowpass');
    this.filter.Q.value = 0.7;
    this.filter.connect(this.masterGain);

    this.recordingDestination = new Tone.Recorder();
    Tone.Destination.connect(this.recordingDestination);

    // Create bass synth for auto bass
    this.bassSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.5 },
    }).connect(this.filter);
    this.bassSynth.volume.value = -6; // softer
  }

  async loadPianoSamples(onLoad?: () => void): Promise<void> {
    if (this.pianoLoaded || this.pianoLoading) return;
    this.pianoLoading = true;

    try {
      const instrument = new SamplerInstrument(
        PIANO_NOTES,
        PIANO_SAMPLES_URL,
        () => {
          this.pianoLoaded = true;
          this.pianoLoading = false;
          this.instruments.set('piano', instrument);
          onLoad?.();
        },
        this.filter || undefined
      );
      this.instruments.set('piano', instrument);
    } catch (err) {
      console.warn('Failed to load piano samples:', err);
      this.pianoLoading = false;
      this.instruments.set('piano', this.createSynthPiano());
    }
  }

  isPianoLoaded(): boolean {
    return this.pianoLoaded;
  }

  getTimbre(): TimbreType {
    return this.currentTimbre;
  }

  async setTimbre(timbre: TimbreType): Promise<void> {
    if (this.currentTimbre === timbre) return;

    this.releaseAllNotes();
    this.currentTimbre = timbre;

    if (!this.instruments.has(timbre)) {
      this.instruments.set(timbre, this.createInstrument(timbre));
    }
  }

  /**
   * Set master volume with smooth transition (idempotent).
   */
  setVolume(volume: number): void {
    if (!this.ctx || !this.masterGain) return;
    const v = Math.max(0, Math.min(1, volume));
    if (Math.abs(v - this.currentVolume) < 0.01) return; // Idempotent check

    const now = this.ctx.currentTime;
    this.masterGain.gain.linearRampToValueAtTime(v, now + 0.05); // Smooth transition
    this.currentVolume = v;
  }

  /**
   * Update filter frequency based on wrist tilt (smooth transition).
   */
  updateFilterSweep(tilt: number): void {
    if (!this.filter || !this.ctx) return;

    // Map wrist tilt to filter frequency and Q
    // Limit Q to prevent self-oscillation (Q > 1.0 can cause resonance)
    let freq = 1200;
    let q = 0.7;
    if (tilt < 0) {
      const r = Math.abs(tilt);
      freq = 1200 - r * 950; // Tilt left → lower frequency (darker)
      q = Math.min(0.7 + r * 1.0, 1.0); // Limit Q to prevent resonance
    } else if (tilt > 0) {
      freq = 1200 + tilt * 3800; // Tilt right → higher frequency (brighter)
      q = Math.min(0.7 + tilt * 2.0, 1.0); // Limit Q to prevent resonance
    }

    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(freq, now, 0.04);
    this.filter.Q.setTargetAtTime(q, now, 0.04);
  }

  private get ctx(): AudioContext | null {
    return Tone.getContext().rawContext as AudioContext;
  }

  /**
   * Play a chord with optional arpeggiation (with internal deduplication).
   */
  playChord(
    chordIndex: number,
    _waveform: string,
    mode?: 'major' | 'minor',
    inversion: number = 0,
    keyOffset: number = 0,
    chordStyle?: ChordStyle,
    arpeggiate: boolean = false,
    arpSpeed: ArpSpeed = 'normal',
  ): void {
    if (!this.initCalled) return;

    const freqs = getChordFreqs(chordIndex, mode, inversion, keyOffset, chordStyle);

    // Calculate chord key for deduplication
    const key = freqs.map(f => f.toFixed(1)).join(',') + (arpeggiate ? '|arp' : '') + '|' + arpSpeed;

    // Internal deduplication
    if (key === this.currentChordKey) return;

    // Stop previous arpeggiator if running
    this.stopArpeggiator();

    // Release previous notes
    this.releaseAllNotes();

    if (arpeggiate && freqs.length > 1) {
      this.startArpeggiator(freqs, arpSpeed);
    } else {
      // Play all at once (block chord)
      const now = Tone.now();
      const instrument = this.getInstrument();
      for (const freq of freqs) {
        instrument.triggerAttack(freq, now, 0.7);
        this.activeNotes.add(freq);
      }
    }

    this.currentChordKey = key;
  }

  /**
   * Play a single note (for theremin mode).
   */
  playNote(freq: number): void {
    if (!this.initCalled) return;

    this.releaseAllNotes();

    const now = Tone.now();
    const instrument = this.getInstrument();
    instrument.triggerAttack(freq, now, 0.8);
    this.activeNotes.add(freq);
  }

  /**
   * Update auto bass note.
   */
  setBassNote(midiNote: number | null, volume: number = 0.5): void {
    if (!this.bassSynth) return;

    if (midiNote === null) {
      // Stop bass immediately
      if (this.bassNote !== null) {
        this.bassSynth.triggerRelease();
        this.bassNote = null;
      }
      return;
    }

    const bassMidi = midiNote - 24; // drop 2 octaves
    if (this.bassNote !== bassMidi) {
      const now = Tone.now();
      this.bassSynth.triggerRelease();
      this.bassSynth.volume.value = Tone.gainToDb(volume) - 12;
      this.bassSynth.triggerAttack(midiToFreq(bassMidi + 12), now);
      this.bassNote = bassMidi;
    }
  }

  /**
   * Immediately stop bass synth (no release envelope).
   */
  private stopBassImmediately(): void {
    if (!this.bassSynth) return;
    if (this.bassNote !== null) {
      // Stop by setting volume to -Infinity immediately
      const now = Tone.now();
      this.bassSynth.volume.cancelScheduledValues(now);
      this.bassSynth.volume.setValueAtTime(-Infinity, now);
      this.bassNote = null;
    }
  }

  stopAll(): void {
    this.stopArpeggiator();
    this.releaseAllNotes();
    this.stopBassImmediately();

    // Force stop all oscillators immediately (not just release)
    const instrument = this.instruments.get(this.currentTimbre);
    if (instrument) {
      instrument.releaseAll();
    }

    // Set volume to 0 to ensure silence
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0, now);
      this.currentVolume = 0;
    }

    // Reset filter to neutral
    if (this.filter && this.ctx) {
      const now = this.ctx.currentTime;
      this.filter.frequency.cancelScheduledValues(now);
      this.filter.Q.cancelScheduledValues(now);
      this.filter.frequency.setValueAtTime(1200, now);
      this.filter.Q.setValueAtTime(0.7, now);
    }

    // Clear deduplication state
    this.currentChordKey = null;
  }

  startRecording(): boolean {
    if (!this.recordingDestination || this.isRecordingActive) return false;
    this.recordingDestination.start();
    this.isRecordingActive = true;
    return true;
  }

  async stopRecording(): Promise<Blob | null> {
    if (!this.recordingDestination || !this.isRecordingActive) return null;
    const recording = await this.recordingDestination.stop();
    this.isRecordingActive = false;
    return recording;
  }

  isRecording(): boolean {
    return this.isRecordingActive;
  }

  getChordName(
    chordIndex: number,
    mode?: 'major' | 'minor',
    keyOffset: number = 0,
    chordStyle?: ChordStyle,
  ): string {
    return getChordName(chordIndex, mode, keyOffset, chordStyle);
  }

  /* ─── Arpeggiator ────────────────────────────────────────────────── */

  private startArpeggiator(freqs: number[], speed: ArpSpeed): void {
    // Idempotent check: if already running with same parameters, skip
    if (this.arpTimer !== null &&
        JSON.stringify(this.arpNotes) === JSON.stringify(freqs) &&
        this.arpSpeed === speed) {
      return;
    }

    this.stopArpeggiator();
    this.arpNotes = freqs;
    this.arpSpeed = speed;
    this.arpIndex = 0;

    const intervalMs = ARP_SPEED_MS[speed];
    const instrument = this.getInstrument();

    // Play first note immediately
    const now = Tone.now();
    instrument.triggerAttack(this.arpNotes[0], now, 0.7);
    this.activeNotes.add(this.arpNotes[0]);
    this.arpIndex = 1;

    // Schedule remaining notes
    this.arpTimer = window.setInterval(() => {
      if (this.arpIndex >= this.arpNotes.length) {
        this.arpIndex = 0; // loop
      }
      const t = Tone.now();
      instrument.triggerAttack(this.arpNotes[this.arpIndex], t, 0.7);
      this.activeNotes.add(this.arpNotes[this.arpIndex]);
      this.arpIndex++;
    }, intervalMs);
  }

  private stopArpeggiator(): void {
    if (this.arpTimer !== null) {
      clearInterval(this.arpTimer);
      this.arpTimer = null;
    }
    this.arpNotes = [];
    this.arpIndex = 0;
  }

  /* ─── Private ────────────────────────────────────────────────────── */

  private getInstrument(): Instrument {
    let instrument = this.instruments.get(this.currentTimbre);
    if (!instrument) {
      instrument = this.createInstrument(this.currentTimbre);
      this.instruments.set(this.currentTimbre, instrument);
    }
    return instrument;
  }

  private createInstrument(timbre: TimbreType): Instrument {
    const filter = this.filter || undefined;

    switch (timbre) {
      case 'piano':
        if (!this.pianoLoaded) {
          console.warn('Piano samples not loaded, using synth fallback');
          return this.createSynthPiano();
        }
        return this.instruments.get('piano')!;

      case 'strings':
        return new SynthInstrument({
          waveform: 'sawtooth',
          envelope: { attack: 0.3, decay: 0.2, sustain: 0.9, release: 1.5 },
          filterFreq: 2000,
          filter,
        });

      case 'organ':
        return new SynthInstrument({
          waveform: 'sine',
          envelope: { attack: 0.01, decay: 0.05, sustain: 1.0, release: 0.1 },
          filterFreq: 3000,
          filter,
        });

      case 'synth':
        return new SynthInstrument({
          waveform: 'sawtooth',
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.5 },
          filterFreq: 2500,
          filter,
        });

      case 'vibraphone':
        return new SynthInstrument({
          waveform: 'sine',
          envelope: { attack: 0.005, decay: 0.4, sustain: 0.2, release: 1.2 },
          filterFreq: 4000,
          filter,
        });

      default:
        return this.createSynthPiano();
    }
  }

  private createSynthPiano(): Instrument {
    const filter = this.filter || undefined;
    return new SynthInstrument({
      waveform: 'triangle',
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.8 },
      filter,
    });
  }

  private releaseAllNotes(): void {
    const instrument = this.instruments.get(this.currentTimbre);
    if (instrument) {
      const now = Tone.now();
      for (const freq of this.activeNotes) {
        instrument.triggerRelease(freq, now);
      }
      this.activeNotes.clear();
    }
  }
}

/** Singleton audio engine instance */
export const audioEngine = new AudioEngine();
