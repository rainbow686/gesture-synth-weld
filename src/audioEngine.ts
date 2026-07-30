import type { WaveformType } from './types';
import { getChordFreqs, getChordName } from './chords';

/* ─── Web Audio Synthesizer Engine ───────────────────────────────────── */

interface SynthVoice {
  oscillators: OscillatorNode[];
  gainNode: GainNode;
  filter: BiquadFilterNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private voices: SynthVoice[] = [];
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private currentVolume = 0.6;
  private currentWaveform: WaveformType = 'sawtooth';

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Initialize the audio context. Must be called from a user gesture.
   */
  async init(): Promise<void> {
    if (this.ctx) return;

    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();

    // Master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.currentVolume;

    // Analyser for visualization
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Recording destination
    this.recordingDestination = this.ctx.createMediaStreamDestination();

    // Routing: masterGain → analyser → destination
    this.masterGain.connect(this.analyserNode);
    this.analyserNode.connect(this.ctx.destination);

    // Also route to recording destination
    this.masterGain.connect(this.recordingDestination);

    // Resume if suspended
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Get the analyser node for visualization.
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /**
   * Play a chord at the given index.
   * Smoothly transitions from any currently playing chord.
   */
  playChord(
    chordIndex: number,
    waveform: WaveformType,
    mode?: 'major' | 'minor',
    inversion: number = 0,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    // Release any existing voices
    this.releaseVoices(now, 0.25);

    // Create new voices
    const freqs = getChordFreqs(chordIndex, mode, inversion);
    const attackTime = 0.08;

    for (const freq of freqs) {
      this.createVoice(freq, waveform, now, attackTime);
    }
  }

  /**
   * Play a single note at a given frequency (for theremin-like mode).
   */
  playTheremin(frequency: number, waveform: WaveformType): void {
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    // Release existing
    this.releaseVoices(now, 0.05);

    // Create single voice
    this.createVoice(frequency, waveform, now, 0.02);
  }

  /**
   * Stop all voices immediately.
   */
  stopAll(): void {
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.releaseVoices(now, 0.1);
  }

  /**
   * Update the master volume (0-1).
   */
  setVolume(vol: number): void {
    this.currentVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.currentVolume, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Update the waveform type for all active and future voices.
   */
  setWaveform(type: WaveformType): void {
    this.currentWaveform = type;
    // Update oscillators in active voices
    for (const voice of this.voices) {
      for (const osc of voice.oscillators) {
        try {
          osc.type = type;
        } catch {
          // Some waveforms may not be settable during playback
        }
      }
    }
  }

  /* ─── Recording ──────────────────────────────────────────────────── */

  /**
   * Start recording the audio output.
   */
  startRecording(): boolean {
    if (!this.recordingDestination || !this.ctx) return false;

    try {
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.recordingDestination.stream, {
        mimeType: this.getSupportedMimeType(),
      });

      this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.start(100); // Collect data every 100ms
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      return false;
    }
  }

  /**
   * Stop recording and return the recorded audio as a WAV Blob.
   */
  async stopRecording(): Promise<Blob | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        const mimeType = this.mediaRecorder!.mimeType;
        const webmBlob = new Blob(this.recordedChunks, { type: mimeType });

        try {
          // Decode the WebM/Opus data and re-encode as WAV
          const arrayBuffer = await webmBlob.arrayBuffer();
          if (!this.ctx) {
            resolve(webmBlob);
            return;
          }
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          const wavBlob = this.audioBufferToWav(audioBuffer);
          resolve(wavBlob);
        } catch (err) {
          console.error('Failed to encode WAV:', err);
          // Fallback: return raw WebM blob
          resolve(webmBlob);
        }
      };

      this.mediaRecorder!.stop();
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }

  /**
   * Get current chord name for display.
   */
  getChordName(chordIndex: number, mode?: 'major' | 'minor'): string {
    return getChordName(chordIndex, mode);
  }

  /* ─── Private Methods ────────────────────────────────────────────── */

  private createVoice(
    frequency: number,
    waveform: WaveformType,
    startTime: number,
    attackTime: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    // Gain node for this voice
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, startTime);
    gainNode.gain.linearRampToValueAtTime(
      0.3 / Math.max(1, frequency > 400 ? 1 : 1.5), // Slightly lower gain for bass
      startTime + attackTime,
    );

    // Filter for warmth
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = waveform === 'sawtooth' || waveform === 'square' ? 2500 : 4000;
    filter.Q.value = 1.0;

    // Connect: filter → gain → master
    filter.connect(gainNode);
    gainNode.connect(this.masterGain);

    // Main oscillator
    const osc = this.ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.value = frequency;
    osc.connect(filter);
    osc.start(startTime);

    const oscillators = [osc];

    // Add subtle detuned copy for richness (supersaw-lite)
    if (waveform === 'sawtooth' || waveform === 'square') {
      const detuneOsc = this.ctx.createOscillator();
      detuneOsc.type = waveform;
      detuneOsc.frequency.value = frequency;
      detuneOsc.detune.value = 7; // 7 cents sharp
      const detuneGain = this.ctx.createGain();
      detuneGain.gain.value = 0.4;
      detuneOsc.connect(detuneGain);
      detuneGain.connect(filter);
      detuneOsc.start(startTime);
      oscillators.push(detuneOsc);
    }

    this.voices.push({ oscillators, gainNode, filter });
  }

  private releaseVoices(now: number, duration: number): void {
    if (!this.ctx) return;

    const releaseEnd = now + duration;

    for (const voice of this.voices) {
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
        voice.gainNode.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
      } catch {
        // Ignore scheduling errors
      }

      for (const osc of voice.oscillators) {
        try {
          osc.stop(releaseEnd + 0.05);
        } catch {
          // Already stopped
        }
      }
    }

    // Clean up voices after release
    const voicesToClean = [...this.voices];
    this.voices = [];
    setTimeout(() => {
      for (const voice of voicesToClean) {
        try {
          voice.oscillators.forEach((o) => o.disconnect());
          voice.gainNode.disconnect();
          voice.filter.disconnect();
        } catch {
          // Already disconnected
        }
      }
    }, (duration + 0.1) * 1000);
  }

  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = len * blockAlign;
    const totalSize = 44 + dataSize;
    const ab = new ArrayBuffer(totalSize);
    const view = new DataView(ab);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    const channels: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }

    return new Blob([ab], { type: 'audio/wav' });
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }
}

/** Singleton audio engine instance */
export const audioEngine = new AudioEngine();
