import * as Tone from 'tone';
import type { ChordStyle } from './chords';
import { getChordFreqs, getChordName, midiToFreq } from './chords';
import type { ArpSpeed } from './types';
import { ARP_SPEED_MS } from './types';

/* ─── Tone.js Audio Engine ───────────────────────────────────────────── */

/* ─── Simplified Audio Engine (matching competitor's approach) ──────── */

export type TimbreType = 'gesture' | 'theremin';

/** Vocal polish level for the sing-along recording tap (recording only). */
export type VocalPolish = 'off' | 'light' | 'standard' | 'strong';

/**
 * Cheap room-ish impulse response: stereo exponentially-decaying noise —
 * the standard Web-Audio trick (Tone.js Reverb generates its own the same
 * way), so no audio asset needs downloading.
 */
function createImpulseResponse(ctx: BaseAudioContext, duration = 1.5, decay = 2.5): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

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

    if (filterFreq) {
      const toneFilter = new Tone.Filter(filterFreq, 'lowpass');
      this.synth.connect(toneFilter);
      if (filter) {
        toneFilter.connect(filter);
      } else {
        toneFilter.toDestination();
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
  private currentTimbre: TimbreType = 'gesture';
  private instruments: Map<TimbreType, Instrument> = new Map();
  private activeNotes: Set<number> = new Set();
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private recMixGain: GainNode | null = null;
  // Mic input (sing-along): mixed into the recording tap only — never to
  // the speakers (feedback). Connected on setMicStream, gated by setMicEnabled.
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private micGain: GainNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  // Vocal polish chain (recording tap only): mic → HPF → compressor →
  // short room reverb. Never routed to speakers — the mic path is
  // recording-only by design, so there is no feedback risk. setVocalPolish
  // toggles three parallel tails off micGain (bypass / dry / wet).
  private vocalHp: BiquadFilterNode | null = null;
  private vocalComp: DynamicsCompressorNode | null = null;
  private vocalReverb: ConvolverNode | null = null;
  private vocalWet: GainNode | null = null;
  private vocalDry: GainNode | null = null;
  private vocalBypass: GainNode | null = null;
  private vocalPolish: VocalPolish = 'standard';
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

    // Main filter matching competitor (1200Hz, Q=0.7)
    this.filter = new Tone.Filter(1200, 'lowpass');
    this.filter.Q.value = 0.7;
    this.filter.connect(this.masterGain);

    // Audio tap for recordings (MediaRecorder): same post-masterGain
    // signal, exposed as a track that can be muxed with the canvas stream.
    const rawCtx = this.ctx;
    if (rawCtx) {
      this.mediaStreamDest = rawCtx.createMediaStreamDestination();
      // Synth level inside recordings has its own gain so singers can
      // balance voice vs chords (chords are "clean direct" in the mix and
      // easily mask a voice captured through the room).
      this.recMixGain = rawCtx.createGain();
      this.recMixGain.gain.value = 1.0;
      if (this.mediaStreamDest) {
        this.masterGain.connect(this.recMixGain);
        this.recMixGain.connect(this.mediaStreamDest);
      }
      // Mic path: mic → analyser → micGain(0.9) → recording tap. Always
      // connected and active — Chrome does not render the graph when the
      // gain is 0, which would starve the level analyser (the earlier
      // gain-gating design showed a dead meter). setMicEnabled gates via
      // track.enabled instead (silence to every consumer). Never routed
      // to the speakers (feedback).
      this.micAnalyser = rawCtx.createAnalyser();
      this.micAnalyser.fftSize = 512;
      this.micGain = rawCtx.createGain();
      this.micGain.gain.value = 0.9;
      this.micAnalyser.connect(this.micGain);

      // Vocal polish: industry-standard vocal chain (high-pass → compressor
      // → short room reverb) so sing-along takes sound produced without
      // touching the live path. Three parallel tails off micGain — bypass
      // (polish off, raw voice as before), dry (HPF+compressor) and wet
      // (reverb) — toggled by setVocalPolish.
      this.vocalHp = rawCtx.createBiquadFilter();
      this.vocalHp.type = 'highpass';
      this.vocalHp.frequency.value = 100;
      this.vocalComp = rawCtx.createDynamicsCompressor();
      this.vocalComp.threshold.value = -20;
      this.vocalComp.ratio.value = 3;
      this.vocalComp.knee.value = 6;
      this.vocalComp.attack.value = 0.01;
      this.vocalComp.release.value = 0.15;
      this.vocalReverb = rawCtx.createConvolver();
      this.vocalReverb.buffer = createImpulseResponse(rawCtx, 1.5, 2.5);
      this.vocalWet = rawCtx.createGain();
      this.vocalWet.gain.value = 0.15;
      this.vocalDry = rawCtx.createGain();
      this.vocalDry.gain.value = 1.0;
      this.vocalBypass = rawCtx.createGain();
      this.vocalBypass.gain.value = 0;

      this.micGain.connect(this.vocalBypass);
      this.micGain.connect(this.vocalHp);
      this.vocalHp.connect(this.vocalComp);
      this.vocalComp.connect(this.vocalDry);
      this.vocalComp.connect(this.vocalReverb);
      this.vocalReverb.connect(this.vocalWet);
      this.vocalBypass.connect(this.mediaStreamDest);
      this.vocalDry.connect(this.mediaStreamDest);
      this.vocalWet.connect(this.mediaStreamDest);

      // Re-apply the level chosen before init (the App effect may have
      // run before the camera start).
      this.setVocalPolish(this.vocalPolish);
    }

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
    if (!this.initCalled || this.currentTimbre === timbre) return;

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
    octaveDown: boolean = false,
  ): void {
    if (!this.initCalled) return;

    const freqs = getChordFreqs(chordIndex, mode, inversion, keyOffset, chordStyle, octaveDown);

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
    if (!this.initCalled) return;
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

  /**
   * Audio track for recordings — the post-masterGain signal (synth) plus
   * the microphone if enabled, mixed in the MediaStreamAudioDestinationNode.
   */
  getRecordingAudioTrack(): MediaStreamTrack | null {
    return this.mediaStreamDest?.stream.getAudioTracks()[0] ?? null;
  }

  /**
   * Enable/disable the microphone via track.enabled (the mic path stays
   * connected and rendering so the level analyser keeps working; a
   * disabled track delivers silence to every consumer, so recordings get
   * no voice when off). The mic is never routed to the speakers.
   */
  setMicEnabled(enabled: boolean): void {
    if (this.micTrack) this.micTrack.enabled = enabled;
  }

  /**
   * Set the voice↔chords balance inside recordings.
   * voice 0.5..2: mic gain follows it; the synth's recording gain falls
   * as voice rises (voice 1.0 = equal, 1.3 default = voice-favoring).
   */
  setRecordingMix(voice: number): void {
    if (this.micGain) this.micGain.gain.setTargetAtTime(voice, this.ctx?.currentTime ?? 0, 0.02);
    if (this.recMixGain) {
      const chords = Math.max(0.2, 2 - voice);
      this.recMixGain.gain.setTargetAtTime(chords, this.ctx?.currentTime ?? 0, 0.02);
    }
  }

  /**
   * Set the vocal-polish level for the recording tap. 'off' bypasses the
   * chain (raw voice, exactly as before); light/standard/strong raise the
   * reverb blend, and 'strong' grips the voice harder with the compressor.
   * Recording-only — the live path never routes the mic, so no feedback
   * risk. Idempotent; no-op until init() has built the chain.
   */
  setVocalPolish(level: VocalPolish): void {
    if (!this.vocalBypass || !this.vocalDry || !this.vocalWet || !this.vocalComp || !this.ctx) return;
    this.vocalPolish = level;
    const now = this.ctx.currentTime;
    const wet = level === 'off' ? 0 : level === 'light' ? 0.08 : level === 'standard' ? 0.15 : 0.25;
    this.vocalBypass.gain.setTargetAtTime(level === 'off' ? 1 : 0, now, 0.02);
    this.vocalDry.gain.setTargetAtTime(level === 'off' ? 0 : 1, now, 0.02);
    this.vocalWet.gain.setTargetAtTime(wet, now, 0.02);
    this.vocalComp.threshold.setTargetAtTime(level === 'strong' ? -25 : -20, now, 0.02);
  }

  /**
   * Attach (or detach) the microphone input stream.
   * Call with null to release. The mic stays disconnected from the
   * recording tap until setMicEnabled(true) is called.
   */
  setMicStream(stream: MediaStream | null): void {
    const rawCtx = this.ctx;
    if (!rawCtx || !this.micGain) return;
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* already disconnected */ }
      this.micSource = null;
      this.micTrack = null;
    }
    const track = stream?.getAudioTracks()[0] ?? null;
    this.micTrack = track;
    if (track && stream) {
      this.micSource = rawCtx.createMediaStreamSource(stream);
      if (this.micAnalyser) this.micSource.connect(this.micAnalyser);
      else this.micSource.connect(this.micGain);
    }
  }

  /**
   * Live microphone input level (0..1) — powers the chooser's mic meter
   * and diagnoses "app didn't record" vs "system mic is silent".
   */
  getMicLevel(): number {
    if (!this.micAnalyser) return 0;
    const data = new Float32Array(this.micAnalyser.fftSize);
    this.micAnalyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
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
      const prevNote = this.arpNotes[(this.arpIndex - 1 + this.arpNotes.length) % this.arpNotes.length];
      // Release the previous note before attacking the next — the synth
      // envelope sustains at 1.0, so without this each cycle would stack
      // another voice and the arpeggio turns into a wall of sound.
      instrument.triggerRelease(prevNote, t);
      this.activeNotes.delete(prevNote);
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
        // Instant attack + quick release for crisp chord switching
        return new SynthInstrument({
          waveform: 'sawtooth',
          envelope: { attack: 0.001, decay: 0, sustain: 1.0, release: 0.1 },
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
