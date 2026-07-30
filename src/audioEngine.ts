import * as Tone from 'tone';
import type { WaveformType } from './types';
import { getChordFreqs, getChordName } from './chords';

/* ─── Tone.js Audio Engine with Sampler + Synth Fallback ────────────── */

export type TimbreType = 'piano' | 'strings' | 'organ' | 'synth';

export const TIMBRE_OPTIONS: { id: TimbreType; label: string; icon: string }[] = [
  { id: 'piano', label: 'Piano', icon: '🎹' },
  { id: 'strings', label: 'Strings', icon: '🎻' },
  { id: 'organ', label: 'Organ', icon: '🎛️' },
  { id: 'synth', label: 'Synth', icon: '⚡' },
];

// Salamander Grand Piano samples from Tone.js CDN (C1 to C7, 7 octaves)
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

  constructor(urls: Record<string, string>, onload?: () => void) {
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl: PIANO_SAMPLES_URL,
      onload: () => {
        this.loaded = true;
        onload?.();
      },
      onerror: (err) => {
        console.warn('Sampler load error:', err);
      },
    }).toDestination();
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
  }) {
    const { waveform, envelope, filterFreq } = options;

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
      const filter = new Tone.Filter(filterFreq, 'lowpass');
      this.synth.connect(filter);
      filter.toDestination();
    } else {
      this.synth.toDestination();
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

  /**
   * Initialize Tone.js audio context. Must be called from user gesture.
   */
  async init(): Promise<void> {
    if (this.initCalled) return;
    this.initCalled = true;

    await Tone.start();
    console.log('Audio engine initialized');

    // Create recorder for WAV export
    this.recordingDestination = new Tone.Recorder();
    Tone.Destination.connect(this.recordingDestination);
  }

  /**
   * Load piano samples asynchronously.
   * Call this after init() to start loading in background.
   */
  async loadPianoSamples(onLoad?: () => void): Promise<void> {
    if (this.pianoLoaded || this.pianoLoading) return;
    this.pianoLoading = true;

    try {
      const instrument = new SamplerInstrument(PIANO_NOTES, () => {
        this.pianoLoaded = true;
        this.pianoLoading = false;
        this.instruments.set('piano', instrument);
        onLoad?.();
      });
      // Store temporarily even before loaded (will be replaced on load)
      this.instruments.set('piano', instrument);
    } catch (err) {
      console.warn('Failed to load piano samples:', err);
      this.pianoLoading = false;
      // Fall back to synth piano
      this.instruments.set('piano', this.createSynthPiano());
    }
  }

  isPianoLoaded(): boolean {
    return this.pianoLoaded;
  }

  /**
   * Get current timbre.
   */
  getTimbre(): TimbreType {
    return this.currentTimbre;
  }

  /**
   * Set timbre with smooth transition.
   */
  async setTimbre(timbre: TimbreType): Promise<void> {
    if (this.currentTimbre === timbre) return;

    // Release all current notes
    this.releaseAllNotes();

    this.currentTimbre = timbre;

    // Ensure instrument exists
    if (!this.instruments.has(timbre)) {
      this.instruments.set(timbre, this.createInstrument(timbre));
    }
  }

  /**
   * Play a chord at the given index.
   */
  playChord(
    chordIndex: number,
    _waveform: WaveformType, // Kept for API compatibility
    mode?: 'major' | 'minor',
    inversion: number = 0,
  ): void {
    if (!this.initCalled) return;

    // Release previous notes
    this.releaseAllNotes();

    const freqs = getChordFreqs(chordIndex, mode, inversion);
    const now = Tone.now();

    const instrument = this.getInstrument();
    for (const freq of freqs) {
      instrument.triggerAttack(freq, now, 0.7);
      this.activeNotes.add(freq);
    }
  }

  /**
   * Stop all notes with release.
   */
  stopAll(): void {
    this.releaseAllNotes();
  }

  /**
   * Start recording.
   */
  startRecording(): boolean {
    if (!this.recordingDestination || this.isRecordingActive) return false;
    this.recordingDestination.start();
    this.isRecordingActive = true;
    return true;
  }

  /**
   * Stop recording and return WAV blob.
   */
  async stopRecording(): Promise<Blob | null> {
    if (!this.recordingDestination || !this.isRecordingActive) return null;
    const recording = await this.recordingDestination.stop();
    this.isRecordingActive = false;
    return recording;
  }

  isRecording(): boolean {
    return this.isRecordingActive;
  }

  /**
   * Get chord name for display.
   */
  getChordName(chordIndex: number, mode?: 'major' | 'minor'): string {
    return getChordName(chordIndex, mode);
  }

  /* ─── Private Methods ────────────────────────────────────────────── */

  private getInstrument(): Instrument {
    let instrument = this.instruments.get(this.currentTimbre);
    if (!instrument) {
      instrument = this.createInstrument(this.currentTimbre);
      this.instruments.set(this.currentTimbre, instrument);
    }
    return instrument;
  }

  private createInstrument(timbre: TimbreType): Instrument {
    switch (timbre) {
      case 'piano':
        // If samples not loaded, use synth piano as fallback
        if (!this.pianoLoaded) {
          console.warn('Piano samples not loaded, using synth fallback');
          return this.createSynthPiano();
        }
        return this.instruments.get('piano')!;

      case 'strings':
        return new SynthInstrument({
          waveform: 'triangle',
          envelope: { attack: 0.3, decay: 0.2, sustain: 0.9, release: 1.5 },
        });

      case 'organ':
        return new SynthInstrument({
          waveform: 'sine',
          envelope: { attack: 0.01, decay: 0.05, sustain: 1.0, release: 0.1 },
          filterFreq: 3000,
        });

      case 'synth':
        return new SynthInstrument({
          waveform: 'sawtooth',
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.5 },
          filterFreq: 2500,
        });

      default:
        return this.createSynthPiano();
    }
  }

  private createSynthPiano(): Instrument {
    return new SynthInstrument({
      waveform: 'triangle',
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.8 },
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
