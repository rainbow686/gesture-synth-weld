import * as Tone from 'tone';
import type { ChordStyle } from './chords';
import { getChordFreqs, getChordName, midiToFreq } from './chords';
import type { ArpSpeed } from './types';
import { ARP_SPEED_MS } from './types';

/* ─── Tone.js Audio Engine ───────────────────────────────────────────── */

/* ─── Simplified Audio Engine (matching competitor's approach) ──────── */

export type TimbreType = 'gesture' | 'theremin';

export const TIMBRE_OPTIONS: { id: TimbreType; label: string; icon: string }[] = [
  { id: 'gesture', label: 'Gesture', icon: '' },
  { id: 'theremin', label: 'Theremin', icon: '' },
];

interface Instrument {
  triggerAttack: (freq: number, time?: number, velocity?: number) => void;
  triggerRelease: (freq: number, time?: number) => void;
  releaseAll: (time?: number) => void;
  dispose: () => void;
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

    // Warmth: gentle drive after synth for subtle harmonics
    const warmth = new Tone.Filter(4000, 'lowpass');
    warmth.Q.value = 0.5;
    this.synth.chain(warmth);

    if (filterFreq) {
      const toneFilter = new Tone.Filter(filterFreq, 'lowpass');
      warmth.connect(toneFilter);
      if (filter) {
        toneFilter.connect(filter);
      } else {
        toneFilter.toDestination();
      }
    } else {
      if (filter) {
        warmth.connect(filter);
      } else {
        warmth.toDestination();
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
  private currentTimbre: TimbreType = 'gesture';
  private instruments: Map<TimbreType, Instrument> = new Map();
  private activeNotes: Set<number> = new Set();
  private recordingDestination: Tone.Recorder | null = null;
  private isRecordingActive = false;
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

  // Analyser for waveform visualization
  private analyser: Tone.Analyser | null = null;

  async init(): Promise<void> {
    if (this.initCalled) return;
    this.initCalled = true;

    await Tone.start();
    console.log('Audio engine initialized');

    // Create master gain for volume control
    this.masterGain = new Tone.Gain(1).toDestination();

    // Create analyser for waveform visualization
    this.analyser = new Tone.Analyser('waveform', 256);
    this.masterGain.connect(this.analyser);

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
   * Tilt range is normalized [-1, 1].
   */
  updateFilterSweep(tilt: number): void {
    if (!this.filter || !this.ctx) return;

    let freq = 1200;
    let q = 0.7;
    if (tilt < 0) {
      const r = Math.abs(tilt);
      freq = 1200 - r * 950;
      q = 0.7 + r * 1.5;
    } else if (tilt > 0) {
      freq = 1200 + tilt * 3800;
      q = 0.7 + tilt * 4.5;
    }

    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(freq, now, 0.04);
    this.filter.Q.setTargetAtTime(q, now, 0.04);
  }

  /**
   * Get the analyser for waveform visualization.
   */
  getAnalyser(): Tone.Analyser | null {
    return this.analyser;
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

    const bassMidi = midiNote - 24; // drop 2 octaves below root
    if (this.bassNote !== bassMidi) {
      const now = Tone.now();
      this.bassSynth.triggerRelease();
      this.bassSynth.volume.value = Tone.gainToDb(volume) - 12;
      this.bassSynth.triggerAttack(midiToFreq(bassMidi), now);
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

  /* ─── Metronome ──────────────────────────────────────────────────── */

  private clickSynth: Tone.Synth | null = null;
  private metronomeRunning = false;
  private metronomeBeatIndex = 0;
  private metronomeLoopId: number | null = null;

  startMetronome(bpm: number, timeSig: string, bars: string, sound: string, volume: number): void {
    if (!this.initCalled) return;
    // Clamp BPM to safe range
    bpm = Math.max(20, Math.min(300, isNaN(bpm) ? 120 : bpm));
    this.stopMetronome();

    // Create a short percussive synth connected through master gain
    if (!this.clickSynth) {
      this.clickSynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
      });
      if (this.masterGain) {
        this.clickSynth.connect(this.masterGain);
      } else {
        this.clickSynth.toDestination();
      }
      this.clickSynth.volume.value = -20;
    }

    const [beatsPerBar] = timeSig.split('/').map(Number);
    const totalBars = parseInt(bars);
    const totalBeats = beatsPerBar * totalBars;
    const beatIntervalMs = (60 / bpm) * 1000;

    this.metronomeBeatIndex = 0;
    this.metronomeRunning = true;

    // Store config for restart
    const self = this;
    const playBeat = () => {
      if (!self.metronomeRunning || !self.clickSynth) return;

      self.metronomeBeatIndex = self.metronomeBeatIndex % totalBeats;
      const beat = self.metronomeBeatIndex % beatsPerBar;
      // First beat of each bar gets a higher pitch (accent)
      const pitch = beat === 0 ? 1000 : 600;

      // Adjust waveform based on sound type
      switch (sound) {
        case 'wood': self.clickSynth.oscillator.type = 'triangle'; break;
        case 'beep': self.clickSynth.oscillator.type = 'sine'; break;
        case 'hihat': self.clickSynth.oscillator.type = 'square'; break;
        default: self.clickSynth.oscillator.type = 'sawtooth'; // click
      }

      const db = Tone.gainToDb(Math.max(0.01, volume));
      self.clickSynth.volume.setTargetAtTime(db, Tone.now(), 0.01);
      self.clickSynth.triggerAttackRelease(pitch, beat === 0 ? '32n' : '64n');

      self.metronomeBeatIndex++;
    };

    // Play first beat immediately
    playBeat();

    // Schedule remaining beats
    this.metronomeLoopId = window.setInterval(playBeat, beatIntervalMs);
  }

  stopMetronome(): void {
    this.metronomeRunning = false;
    if (this.metronomeLoopId !== null) {
      clearInterval(this.metronomeLoopId);
      this.metronomeLoopId = null;
    }
    this.metronomeBeatIndex = 0;
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

    this.arpTimer = window.setInterval(() => {
      if (this.arpIndex >= this.arpNotes.length) {
        this.arpIndex = 0; // loop
      }
      const t = Tone.now();
      // Release previous note before playing next to avoid voice stacking
      const prevFreq = this.arpNotes[(this.arpIndex - 1 + this.arpNotes.length) % this.arpNotes.length];
      instrument.triggerRelease(prevFreq, t);
      this.activeNotes.delete(prevFreq);
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
      case 'gesture':
        // Sawtooth wave with filter for warm chord sound
        return new SynthInstrument({
          waveform: 'sawtooth',
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.5 },
          filterFreq: 1400,
          filter,
        });

      case 'theremin':
        // Sine wave - matches competitor's approach for theremin mode
        return new SynthInstrument({
          waveform: 'sine',
          envelope: { attack: 0.01, decay: 0.05, sustain: 1.0, release: 0.1 },
          filter,
        });

      default:
        return new SynthInstrument({
          waveform: 'sawtooth',
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.5 },
          filterFreq: 2500,
          filter,
        });
    }
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
