import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initHandTracking,
  detectHands,
  HAND_CONNECTIONS,
} from './handTracker';
import { audioEngine } from './audioEngine';
import {
  DIATONIC_CHORDS,
  KEYS,
  getChordName,
  midiToFreq,
  type ChordStyle,
  CHORD_STYLE_OPTIONS,
} from './chords';
import {
  FINGER_TO_CHORD_INDEX,
  FINGER_TO_NOTE_INTERVAL,
  type GestureState,
  type HandData,
  type SynthState,
  type AppMode,
  type LeftHandMode,
  type RightHandMode,
  type ArpSpeed,
} from './types';
import { makeRecordingFilename } from './wavEncoder';
import { ENABLE_EXTERNAL_SCRIPTS, EXTERNAL_SCRIPT_CLIENT_ID } from './config';

/* ─── Gesture Synth Weld — Two-Hand Division System ─────────────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'Unknown error';
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.name === 'string') return e.name;
    try { return JSON.stringify(err); } catch { /* ignore */ }
  }
  return String(err);
}

function isDomError(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

export default function App() {
  /* ─── Refs ──────────────────────────────────────────────────────────── */

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number>(0);
  const lastDetectRef = useRef<number>(0);
  const isDetectingRef = useRef(false);
  const runningRef = useRef(false);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  /* ─── State ─────────────────────────────────────────────────────────── */

  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<GestureState>({ left: null, right: null });
  const [synthState, setSynthState] = useState<SynthState>({
    chordIndex: 0,
    chordName: 'C',
    volume: 0.6,
    mode: 'neutral',
    isPlaying: false,
    keyOffset: 9, // A major (matches competitor default)
    appMode: 'gesture',
    leftHandMode: 'scaleLocked',
    lockedMode: 'major',
    rightHandMode: 'fixedChordStyle',
    lockedChordStyle: 'majorTriad',
    arpeggiate: true,
    arpSpeed: 'normal',
    autoBass: true,
    bassVolume: 0.5,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [hasLeftHand, setHasLeftHand] = useState(false);
  const [hasRightHand, setHasRightHand] = useState(false);
  // Track the last stable finger count
  const lastStableFingerCountRef = useRef<{ left: number; right: number }>({
    left: 0,
    right: 0,
  });

  // Hand detection smoothing to prevent flickering
  const handDetectionHistoryRef = useRef<{ left: boolean[]; right: boolean[] }>({
    left: [],
    right: [],
  });
  const HAND_STABLE_FRAMES = 3; // Require 3 frames for hand presence

  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingStartRef = useRef<number | null>(null);

  /* ─── Metronome state ───────────────────────────────────────────────── */

  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [metronomeTimeSig, setMetronomeTimeSig] = useState('4/4');
  const [metronomeBars, setMetronomeBars] = useState('1');
  const [metronomeSound, setMetronomeSound] = useState('click');
  const [metronomeVolume, setMetronomeVolume] = useState(0.25);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const tapTimesRef = useRef<number[]>([]);

  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;

  const synthRef = useRef(synthState);
  synthRef.current = synthState;

  // Track last chord state to avoid re-triggering every frame
  const lastChordRef = useRef<string>('');

  // Time-based chord stabilizer (similar to competitor's approach)
  // Requires gesture to be stable for HOLD_MS before committing
  const stabilizerRef = useRef<{
    committed: number | null;
    pending: number | null;
    pendingSince: number;
    lastSeen: number;
  }>({
    committed: null,
    pending: null,
    pendingSince: 0,
    lastSeen: 0,
  });
  const HOLD_MS = 150; // Require 150ms stability before committing

  // Right hand finger count history for chord style smoothing
  const rightHandHistoryRef = useRef<number[]>([]);

  /* ─── Reset stabilizer on mode switch ────────────────────────────────── */

  useEffect(() => {
    stabilizerRef.current = { committed: null, pending: null, pendingSince: 0, lastSeen: 0 };
    rightHandHistoryRef.current = [];
    lastChordRef.current = '';
  }, [synthState.appMode]);

  /* ─── Metronome effect ──────────────────────────────────────────────── */

  useEffect(() => {
    if (metronomeOn) {
      audioEngine.startMetronome(metronomeBpm, metronomeTimeSig, metronomeBars, metronomeSound, metronomeVolume);
    } else {
      audioEngine.stopMetronome();
    }
    // Only restart on structural changes, not volume
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metronomeOn, metronomeBpm, metronomeTimeSig, metronomeBars, metronomeSound]);

  /* ─── Keyboard Shortcuts ─────────────────────────────────────────── */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default behavior for certain keys
      if (['ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
        e.preventDefault();
      }

      const s = synthRef.current;

      // 1-7: Select chord (I through vii°)
      if (e.key >= '1' && e.key <= '7') {
        const idx = parseInt(e.key) - 1;
        const modeArg = s.mode === 'neutral' ? undefined : s.mode as 'major' | 'minor';
        const chordName = getChordName(idx, modeArg, s.keyOffset);

        setSynthState(prev => ({ ...prev, chordIndex: idx, chordName, isPlaying: true }));
        audioEngine.init().then(() => {
          audioEngine.playChord(idx, 'sine', modeArg, 0, s.keyOffset, s.lockedChordStyle, s.arpeggiate, s.arpSpeed);
        });
        return;
      }

      // Arrow Up/Down: Volume control
      if (e.key === 'ArrowUp') {
        const v = Math.min(1, s.volume + 0.1);
        setSynthState(prev => ({ ...prev, volume: v }));
        audioEngine.setVolume(v);
        return;
      }
      if (e.key === 'ArrowDown') {
        const v = Math.max(0, s.volume - 0.1);
        setSynthState(prev => ({ ...prev, volume: v }));
        audioEngine.setVolume(v);
        return;
      }

      // T/Y: Major/Minor mode
      if (e.key === 't' || e.key === 'T') {
        setSynthState(prev => {
          const next = { ...prev, mode: 'major' as const };
          next.chordName = getChordName(prev.chordIndex, 'major', prev.keyOffset);
          if (prev.isPlaying) {
            audioEngine.playChord(prev.chordIndex, 'sine', 'major', 0, prev.keyOffset, prev.lockedChordStyle, prev.arpeggiate, prev.arpSpeed);
          }
          return next;
        });
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        setSynthState(prev => {
          const next = { ...prev, mode: 'minor' as const };
          next.chordName = getChordName(prev.chordIndex, 'minor', prev.keyOffset);
          if (prev.isPlaying) {
            audioEngine.playChord(prev.chordIndex, 'sine', 'minor', 0, prev.keyOffset, prev.lockedChordStyle, prev.arpeggiate, prev.arpSpeed);
          }
          return next;
        });
        return;
      }

      // Q/W/E/R/V: No longer used (timbre selection removed)

      // A: Toggle arpeggiator
      if (e.key === 'a' || e.key === 'A') {
        setSynthState(prev => ({ ...prev, arpeggiate: !prev.arpeggiate }));
        return;
      }

      // B: Toggle auto bass
      if (e.key === 'b' || e.key === 'B') {
        setSynthState(prev => ({ ...prev, autoBass: !prev.autoBass }));
        return;
      }

      // Space: Stop all notes
      if (e.key === ' ') {
        audioEngine.stopAll();
        setSynthState(prev => ({ ...prev, isPlaying: false }));
        return;
      }

      // Escape: Reset state
      if (e.key === 'Escape') {
        audioEngine.stopAll();
        setSynthState(prev => ({
          ...prev,
          isPlaying: false,
          mode: 'neutral',
          arpeggiate: false,
          autoBass: false,
        }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* ─── Process Detected Hands (Two-Hand Logic) ──────────────────────── */

  const processHandsRef = useRef<(hands: HandData[]) => void>();
  processHandsRef.current = (hands: HandData[]) => {
    let leftHand: HandData | null = null;
    let rightHand: HandData | null = null;

    for (const hand of hands) {
      if (hand.label === 'Left') {
        leftHand = hand;
      } else {
        rightHand = hand;
      }
    }

    // Apply hand detection smoothing to prevent flickering
    handDetectionHistoryRef.current.left.push(!!leftHand);
    handDetectionHistoryRef.current.right.push(!!rightHand);
    if (handDetectionHistoryRef.current.left.length > HAND_STABLE_FRAMES) {
      handDetectionHistoryRef.current.left.shift();
    }
    if (handDetectionHistoryRef.current.right.length > HAND_STABLE_FRAMES) {
      handDetectionHistoryRef.current.right.shift();
    }

    // Use majority vote: hand is detected if at least half of recent frames detected it
    // This prevents flickering while still being responsive
    const leftDetected = handDetectionHistoryRef.current.left.filter(v => v).length >= Math.ceil(HAND_STABLE_FRAMES / 2);
    const rightDetected = handDetectionHistoryRef.current.right.filter(v => v).length >= Math.ceil(HAND_STABLE_FRAMES / 2);

    // Use smoothed detection
    leftHand = leftDetected ? leftHand : null;
    rightHand = rightDetected ? rightHand : null;

    setGesture({ left: leftHand, right: rightHand });
    setHasLeftHand(!!leftHand);
    setHasRightHand(!!rightHand);

    const s = synthRef.current;

    // ─── Theremin Mode (single hand) ───────────────────────────────
    if (s.appMode === 'theremin') {
      // Dual-hand control: right hand = pitch, left hand = volume
      const hasRight = !!rightHand;
      const hasLeft = !!leftHand;

      // Theremin requires BOTH hands: right=pitch, left=volume
      if (hasRight && hasLeft && rightHand && leftHand) {
        const minFreq = 130.81;
        const maxFreq = 1046.5;
        const freq = minFreq * Math.pow(maxFreq / minFreq, 1 - rightHand.positionY);
        const volume = Math.max(0.02, Math.min(1.0, 1.1 - leftHand.positionY));
        audioEngine.playNote(freq);
        setSynthState(prev => ({ ...prev, volume, isPlaying: true }));
        audioEngine.setVolume(volume);
      } else {
        audioEngine.stopAll();
        setSynthState(prev => ({ ...prev, isPlaying: false }));
      }
      return;
    }

    // ─── Monophonic Piano Mode (single note per finger) ────────────
    if (s.appMode === 'monoPiano') {
      // CRITICAL: Piano mode requires BOTH hands
      // Left hand determines note, right hand triggers it and controls volume
      if (leftHand && rightHand) {
        // Apply time-based stabilizer (same as Gesture mode)
        const now = performance.now();
        const rawFingerCount = leftHand.fingerCount;
        const stabilizer = stabilizerRef.current;

        // Update last seen time
        stabilizer.lastSeen = now;

        // If we have a candidate, update pending
        if (rawFingerCount !== stabilizer.pending) {
          stabilizer.pending = rawFingerCount;
          stabilizer.pendingSince = now;
        }

        // Commit if pending has been stable for HOLD_MS
        if (now - stabilizer.pendingSince >= HOLD_MS) {
          stabilizer.committed = stabilizer.pending;
        }

        // Use committed finger count for note selection
        const stableFingerCount = stabilizer.committed ?? rawFingerCount;

        // Each finger count maps to a different note interval
        const interval = FINGER_TO_NOTE_INTERVAL[stableFingerCount] ?? 0;
        const midiNote = 60 + interval + s.keyOffset; // Middle C + interval + key offset
        const freq = midiToFreq(midiNote);

        // Only trigger if note changed (use lastChordRef for fingerprint)
        // Piano mode: sustain like other timbres
        const pianoFingerprint = `mono|${midiNote}`;
        if (pianoFingerprint !== lastChordRef.current) {
          lastChordRef.current = pianoFingerprint;
          // Play note and sustain (like other timbres)
          audioEngine.playNote(freq);
        }

        // Volume: right hand height (since right hand is required)
        const volume = Math.max(0.02, Math.min(1.0, 1.1 - rightHand.positionY));
        setSynthState(prev => ({ ...prev, volume, isPlaying: true }));
        audioEngine.setVolume(volume);
      } else {
        // No hands or missing one hand - stop all
        audioEngine.stopAll();
        lastChordRef.current = '';
        setSynthState(prev => ({ ...prev, isPlaying: false }));
      }
      return;
    }

    // ─── Gesture Mode (two-hand division) ──────────────────────────

    // Left Hand → Harmony (scale degree + mode)
    let chordIndex = s.chordIndex;
    let mode: 'major' | 'minor' | 'neutral' = s.mode;
    let hasValidChord = false;

    if (leftHand) {
      // Apply time-based stabilizer (similar to competitor's approach)
      const now = performance.now();
      const rawFingerCount = leftHand.fingerCount;
      const stabilizer = stabilizerRef.current;

      // Update last seen time
      stabilizer.lastSeen = now;

      // If we have a candidate, update pending
      if (rawFingerCount !== stabilizer.pending) {
        stabilizer.pending = rawFingerCount;
        stabilizer.pendingSince = now;
      }

      // Commit if pending has been stable for HOLD_MS
      if (now - stabilizer.pendingSince >= HOLD_MS) {
        stabilizer.committed = stabilizer.pending;
      }

      // Use committed finger count for chord selection
      const stableFingerCount = stabilizer.committed ?? rawFingerCount;

      // VI/VII: check specific finger combos, but only if the stabilizer has committed
      const extended = leftHand.extendedFingers;
      const hasCommitted = stabilizer.committed !== null;
      if (hasCommitted && extended.includes('index') && extended.includes('pinky') && extended.includes('thumb')) {
        chordIndex = 6; // VII
      } else if (hasCommitted && extended.includes('index') && extended.includes('pinky')) {
        chordIndex = 5; // VI
      } else {
        // Standard finger count mapping
        chordIndex = FINGER_TO_CHORD_INDEX[stableFingerCount] ?? 0;
      }
      hasValidChord = stableFingerCount > 0; // 0 fingers (fist) = no valid chord

      if (s.leftHandMode === 'scaleTilt') {
        // Wrist tilt → major/minor (>=0 = major, <0 = minor like competitor)
        mode = leftHand.tiltAngle >= 0 ? 'major' : 'minor';
      } else {
        // scaleLocked: use locked mode
        mode = s.lockedMode ?? 'neutral';
      }
    }

    // Right Hand → Expression (volume + chord style)
    // CRITICAL: Right hand must have at least 1 finger raised to trigger sound
    let volume = 0; // Default to 0 (no sound)
    let chordStyle: ChordStyle | undefined;
    let qualityIndex = 0; // 0 = no sound, 1+ = sound
    let hasRightHand = !!rightHand;

    if (rightHand) {
      // Apply sliding window majority vote for right hand (for chord style)
      // This is less critical than left hand since it only affects chord style, not chord root
      const rawFingerCount = rightHand.fingerCount;
      const history = rightHandHistoryRef.current;
      history.push(rawFingerCount);
      if (history.length > 5) {
        history.shift();
      }

      // Use majority vote with 3/5 threshold
      const countMap = new Map<number, number>();
      history.forEach((count: number) => countMap.set(count, (countMap.get(count) || 0) + 1));
      let majorityCount = -1;
      let maxOccurrences = 0;
      countMap.forEach((occurrences, count) => {
        if (occurrences >= 3 && occurrences > maxOccurrences) {
          maxOccurrences = occurrences;
          majorityCount = count;
        }
      });

      const stableFingerCount = majorityCount !== -1 ? majorityCount : rawFingerCount;

      // CRITICAL: Right hand finger count determines if sound plays
      // 0 fingers (fist) = no sound, 1+ fingers = sound
      qualityIndex = stableFingerCount;

      // Y position → volume
      volume = Math.max(0.02, Math.min(1.0, 1.1 - rightHand.positionY));

      if (s.rightHandMode === 'fingerLayout') {
        // Finger count → chord complexity (using smoothed count)
        if (stableFingerCount === 1) chordStyle = 'triad';
        else if (stableFingerCount === 2) chordStyle = 'major1stInv';
        else if (stableFingerCount === 3) chordStyle = '7th';
        else if (stableFingerCount >= 4) chordStyle = '9th';
      } else {
        // fixedChordStyle: use locked chord style
        chordStyle = s.lockedChordStyle;
      }
    }

    // CRITICAL: Sound only plays if BOTH hands have at least 1 finger raised
    // Left fist or right fist = immediate stop (use raw count for instant response)
    const leftFist = leftHand ? leftHand.fingerCount === 0 : true;
    const rightFist = rightHand ? rightHand.fingerCount === 0 : true;
    const isPlaying = !!(leftHand && rightHand && !leftFist && !rightFist);
    const chordName = getChordName(
      chordIndex,
      mode === 'neutral' ? undefined : mode,
      s.keyOffset,
      chordStyle,
    );

    const newSynth: SynthState = {
      ...s,
      chordIndex,
      chordName,
      volume,
      mode,
      isPlaying,
    };
    setSynthState(newSynth);

    // Create chord fingerprint to detect actual changes
    const chordFingerprint = `${chordIndex}|${mode}|${chordStyle || ''}|${s.keyOffset}|${s.arpeggiate}|${s.arpSpeed}`;

    // Play chord - only if chord actually changed
    if (isPlaying) {
      if (chordFingerprint !== lastChordRef.current) {
        // Chord changed - trigger new notes
        lastChordRef.current = chordFingerprint;
        audioEngine.playChord(
          chordIndex,
          'sine',
          mode === 'neutral' ? undefined : mode,
          0,
          s.keyOffset,
          chordStyle,
          s.arpeggiate,
          s.arpSpeed,
        );
      }

      // Volume changes are handled by audioEngine.setVolume (no note cutoff)
      audioEngine.setVolume(volume);

      // Filter changes are handled by audioEngine.updateFilterSweep (real-time)
      if (rightHand) {
        audioEngine.updateFilterSweep(rightHand.tiltAngle);
      }
    } else {
      // No hands detected - stop all sounds immediately
      audioEngine.stopAll();
      lastChordRef.current = '';
    }

    // Auto bass
    if (s.autoBass && isPlaying) {
      const chord = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
      const bassMidi = 60 + chord.intervals[0] + s.keyOffset; // root note
      audioEngine.setBassNote(bassMidi, s.bassVolume);
    } else {
      audioEngine.setBassNote(null);
    }
  };

  /* ─── Draw helpers ──────────────────────────────────────────────────── */

  const drawOverlayRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>();
  drawOverlayRef.current = (ctx, w, h) => {
    const g = gestureRef.current;
    if (g.left) drawHandSkeleton(ctx, g.left, w, h, '#00ffcc', 'rgba(0,255,204,0.4)');
    if (g.right) drawHandSkeleton(ctx, g.right, w, h, '#ff00ff', 'rgba(255,0,255,0.4)');
  };

  // Draw waveform visualization - transparent overlay style at bottom
  const drawWaveformRef = useRef<() => void>();
  drawWaveformRef.current = () => {
    const canvas = waveformCanvasRef.current;
    const analyser = audioEngine.getAnalyser();
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== canvas.clientWidth * 2 || canvas.height !== canvas.clientHeight * 2) {
      canvas.width = canvas.clientWidth * 2;
      canvas.height = canvas.clientHeight * 2;
    }

    const waveform = analyser.getValue() as Float32Array;
    const bufferLength = waveform.length;

    // Transparent background
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.6)';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      // waveform values are in range [-1, 1]
      const v = (waveform[i] + 1) / 2; // normalize to [0, 1]
      const y = v * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  /* ─── Animation loop ───────────────────────────────────────────────── */

  useEffect(() => {
    if (!isRunning) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    runningRef.current = true;
    lastDetectRef.current = 0;
    isDetectingRef.current = false;

    const loop = async (timestamp: number) => {
      if (!runningRef.current) return;
      rafIdRef.current = requestAnimationFrame(loop);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
      }

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!isDetectingRef.current && timestamp - lastDetectRef.current > 33) {
        lastDetectRef.current = timestamp;
        isDetectingRef.current = true;
        try {
          const hands = detectHands(video, timestamp);
          processHandsRef.current?.(hands);
        } catch (e) {
          console.warn('Detection frame error:', e);
        } finally {
          isDetectingRef.current = false;
        }
      }

      drawOverlayRef.current?.(ctx, canvas.width, canvas.height);
      drawWaveformRef.current?.();
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      runningRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    };
  }, [isRunning]);

  /* ─── Start / Stop Camera ──────────────────────────────────────────── */

  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setKeyboardMode(false);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera access.');
      }

      await initHandTracking();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('Video element not found');

      video.srcObject = stream;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.onloadedmetadata = null;
          video.onerror = null;
          resolve();
        };
        video.onerror = () => {
          video.onloadedmetadata = null;
          video.onerror = null;
          reject(new Error('Video playback error'));
        };
        setTimeout(() => reject(new Error('Video loading timed out')), 10000);
      });

      try {
        await video.play();
      } catch (playErr) {
        throw new Error(`Video playback failed: ${getErrorMessage(playErr)}`);
      }

      await audioEngine.init();

      setIsRunning(true);
      setIsLoading(false);
    } catch (err: unknown) {
      console.error('Failed to start:', err);
      setIsLoading(false);

      if (isDomError(err, 'NotAllowedError')) {
        setError('Camera access was denied.');
      } else if (isDomError(err, 'NotFoundError')) {
        setError('No camera found.');
      } else {
        setError(`Failed to start: ${getErrorMessage(err)}`);
      }
    }
  }, []);

  const enterKeyboardMode = useCallback(() => {
    setKeyboardMode(true);
    setIsRunning(false);
    setError(null);
  }, []);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    audioEngine.stopAll();
    audioEngine.stopMetronome();
    setMetronomeOn(false);

    // Reset stabilizer state for clean restart
    stabilizerRef.current = { committed: null, pending: null, pendingSince: 0, lastSeen: 0 };
    rightHandHistoryRef.current = [];
    handDetectionHistoryRef.current = { left: [], right: [] };

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    setGesture({ left: null, right: null });
    setHasLeftHand(false);
    setHasRightHand(false);
    setIsRunning(false);
    setKeyboardMode(false);
    setSynthState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  /* ─── Recording ────────────────────────────────────────────────────── */

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      const blob = await audioEngine.stopRecording();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = makeRecordingFilename();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Delay revocation to avoid Firefox download race
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
      setIsRecording(false);
      setRecordingTime(0);
      recordingStartRef.current = null;
    } else {
      const ok = audioEngine.startRecording();
      if (ok) {
        setIsRecording(true);
        recordingStartRef.current = Date.now();
      }
    }
  }, [isRecording]);

  // Recording timer with 15s auto-stop
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      if (recordingStartRef.current) {
        const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
        setRecordingTime(Math.min(elapsed, 15));
      }
    }, 100);

    // Auto-stop at 15s
    const timeout = setTimeout(async () => {
      const blob = await audioEngine.stopRecording();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = makeRecordingFilename();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
      setIsRecording(false);
      setRecordingTime(0);
      recordingStartRef.current = null;
    }, 15000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isRecording]);

  /* ─── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="full-screen-app">
      {/* ─── Full-screen camera area ────────────────────────────────── */}
      <section className="camera-stage">
        <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
        <canvas ref={canvasRef} className="camera-canvas" />

        {/* Hand tags on sides */}
        {isRunning && (
          <>
            {hasLeftHand && (
              <div style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', zIndex: 15, padding: '6px 10px', background: 'var(--frost-bg)', backdropFilter: 'var(--frost-blur)', border: '1px solid rgba(0,255,204,0.3)', borderRadius: '12px', color: 'var(--neon-cyan)', fontSize: '0.7rem', fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}>
                L
              </div>
            )}
            {hasRightHand && (
              <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', zIndex: 15, padding: '6px 10px', background: 'var(--frost-bg)', backdropFilter: 'var(--frost-blur)', border: '1px solid rgba(255,0,255,0.3)', borderRadius: '12px', color: 'var(--neon-magenta)', fontSize: '0.7rem', fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}>
                R
              </div>
            )}
          </>
        )}

        {/* Start screen */}
        {!isRunning && !isLoading && !error && !keyboardMode && (
          <div className="start-screen">
            <div className="start-graphic">
              <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="60" cy="60" r="50" stroke="rgba(0,255,204,0.2)" strokeWidth="2" />
                <path d="M40 70 L45 50 L50 70 M55 70 L60 45 L65 70 M70 70 L75 50 L80 70" stroke="rgba(0,255,204,0.6)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="60" cy="85" r="8" fill="rgba(255,0,255,0.3)" />
              </svg>
            </div>
            <button className="start-btn" onClick={startCamera} disabled={isLoading}>
              <span className="start-btn-icon">▶</span>
              <span>Start</span>
            </button>
            <p className="start-hint">Allow camera to begin playing with hand gestures</p>
            <button className="keyboard-mode-link" onClick={enterKeyboardMode}>
              No camera? Try keyboard mode →
            </button>
          </div>
        )}

        {/* Keyboard mode */}
        {keyboardMode && (
          <div className="keyboard-mode-screen">
            <div className="keyboard-chord-display">
              <span className="keyboard-chord-name">{synthState.chordName}</span>
            </div>
            <div className="keyboard-volume-bar">
              <div className="keyboard-volume-fill" style={{ width: `${synthState.volume * 100}%` }} />
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="loading-screen">
            <div className="spinner" />
            <p>Loading hand tracking model…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-screen">
            <div className="error-message">{error}</div>
            <button className="retry-btn" onClick={startCamera}>Retry</button>
            <button className="keyboard-mode-link" onClick={enterKeyboardMode}>
              No camera? Try keyboard mode →
            </button>
          </div>
        )}

        {/* ─── Two-Row Toolbar ──────────────────────────────────────── */}
        {(isRunning || keyboardMode) && (
          <div style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', zIndex: 20 }}>
            {/* Row 1: compact controls */}
            <div className="frost-toolbar" style={{ gap: '3px', padding: '6px 14px', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'visible' }}>
              <span className="brand" style={{ fontSize: '0.6rem' }}>Gesture Synth Weld</span>
              <button className={synthState.appMode === 'gesture' ? 'active' : ''} onClick={() => setSynthState(prev => ({ ...prev, appMode: 'gesture' }))} data-tip="Two-hand chord mode — left hand picks harmony, right hand controls expression">Gesture</button>
              <button className={synthState.appMode === 'theremin' ? 'active' : ''} onClick={() => setSynthState(prev => ({ ...prev, appMode: 'theremin' }))} data-tip="Theremin mode — right hand Y-axis = pitch, left hand Y-axis = volume">Theremin</button>
              <button className={synthState.appMode === 'monoPiano' ? 'active' : ''} onClick={() => setSynthState(prev => ({ ...prev, appMode: 'monoPiano' }))} data-tip="Mono Piano mode — finger count selects a single note interval">Piano</button>
              <span className="divider" />
              <select value={KEYS[synthState.keyOffset]?.name ?? 'C'} onChange={(e) => { const ki = KEYS.findIndex(k => k.name === e.target.value); setSynthState(prev => ({ ...prev, keyOffset: ki })); }} data-tip="Transpose all chords to a different key">
                {KEYS.map(key => <option key={key.name} value={key.name}>{key.name}</option>)}
              </select>
              <span className="divider" />
              <button className={`icon-btn ${synthState.arpeggiate ? 'active' : ''}`} onClick={() => setSynthState(prev => ({ ...prev, arpeggiate: !prev.arpeggiate }))} data-tip="Arpeggiator — sweep chord notes like a harp">⟿</button>
              <button className={`icon-btn ${synthState.autoBass ? 'active' : ''}`} onClick={() => setSynthState(prev => ({ ...prev, autoBass: !prev.autoBass }))} data-tip="Auto Bass — root note two octaves below">∿</button>
              <span className="divider" />
              <button className={`icon-btn ${isRecording ? 'recording' : ''}`} onClick={toggleRecording} data-tip={isRecording ? `Recording ${recordingTime}s / 15s` : 'Record — captures WebM audio (max 15s)'}>{isRecording ? `${recordingTime}s` : '●'}</button>
              <button className="icon-btn" onClick={() => setShowSettings(!showSettings)} data-tip={showSettings ? 'Hide settings panel' : 'Show settings panel'} style={showSettings ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>⚙</button>
              <button className="icon-btn" onClick={() => setShowHelp(!showHelp)} data-tip="How to play — hand gesture guide">?</button>
              <span className="divider" />
              <button className="icon-btn" onClick={stopCamera} data-tip="Stop camera and audio" style={{ color: 'var(--neon-magenta)' }}>■</button>
            </div>

            {/* Row 2: hand settings panel — only for Gesture mode (Theremin/Piano don't use hand division) */}
            {showSettings && synthState.appMode === 'gesture' && (
              <div className="frost-panel" style={{ flexDirection: 'row', gap: '16px', padding: '12px 18px', maxWidth: '700px', fontSize: '0.65rem' }}>
                {/* Left Hand */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px' }}>
                  <label style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left Hand — Harmony</label>
                  <select value={synthState.leftHandMode} onChange={(e) => setSynthState(prev => ({ ...prev, leftHandMode: e.target.value as LeftHandMode }))}>
                    <option value="scaleTilt">Scale notes + tilt major/minor</option>
                    <option value="scaleLocked">Scale notes only (lock mode)</option>
                  </select>
                  {synthState.leftHandMode === 'scaleTilt' ? (
                    <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Fingers pick the scale degree; wrist tilt flips major ↔ minor.</p>
                  ) : (
                    <>
                      <select value={synthState.lockedMode ?? 'major'} onChange={(e) => setSynthState(prev => ({ ...prev, lockedMode: e.target.value as 'major' | 'minor' }))}>
                        <option value="major">Major</option>
                        <option value="minor">Minor</option>
                      </select>
                      <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Fingers pick the scale degree only. Mode is locked above.</p>
                    </>
                  )}
                </div>

                <span className="divider" style={{ height: 'auto', alignSelf: 'stretch' }} />

                {/* Right Hand */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
                  <label style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right Hand — Expression</label>
                  <select value={synthState.rightHandMode} onChange={(e) => setSynthState(prev => ({ ...prev, rightHandMode: e.target.value as RightHandMode }))}>
                    <option value="fingerLayout">Finger layout = chord style</option>
                    <option value="fixedChordStyle">Fixed chord style</option>
                  </select>
                  {synthState.rightHandMode === 'fingerLayout' ? (
                    <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>1–4 fingers set triad / inversion / 7ths. Height = volume, tilt = tone.</p>
                  ) : (
                    <>
                      <select value={synthState.lockedChordStyle ?? 'majorTriad'} onChange={(e) => setSynthState(prev => ({ ...prev, lockedChordStyle: e.target.value as ChordStyle }))}>
                        {CHORD_STYLE_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                      </select>
                      <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Chord style is locked. Right hand still controls volume and tone.</p>
                    </>
                  )}
                </div>

                {/* Arp / Bass extras */}
                {(synthState.arpeggiate || synthState.autoBass) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '120px' }}>
                    {synthState.arpeggiate && (
                      <div>
                        <label style={{ color: 'var(--neon-purple)', fontWeight: 600 }}>Arpeggiator</label>
                        <select value={synthState.arpSpeed} onChange={(e) => setSynthState(prev => ({ ...prev, arpSpeed: e.target.value as ArpSpeed }))} style={{ width: '100%' }}>
                          <option value="slow">Slow (120ms)</option>
                          <option value="normal">Normal (80ms)</option>
                          <option value="fast">Fast (50ms)</option>
                        </select>
                      </div>
                    )}
                    {synthState.autoBass && (
                      <div>
                        <label style={{ color: 'var(--neon-amber)', fontWeight: 600 }}>Bass Volume</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input type="range" min="0" max="1" step="0.05" value={synthState.bassVolume} onChange={(e) => setSynthState(prev => ({ ...prev, bassVolume: parseFloat(e.target.value) }))} style={{ flex: 1, accentColor: 'var(--neon-cyan)' }} />
                          <span style={{ fontSize: '0.6rem', width: '24px' }}>{Math.round(synthState.bassVolume * 100)}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

            {/* Help Modal */}
            {showHelp && (
              <div className="help-modal desktop-only" style={{
                position: 'absolute',
                top: '1rem',
                left: '220px',
                width: '320px',
                maxHeight: '80vh',
                overflowY: 'auto',
                background: 'rgba(10, 15, 30, 0.95)',
                border: '1px solid var(--glass-border)',
                borderRadius: '12px',
                padding: '1rem',
                backdropFilter: 'blur(12px)',
                zIndex: 100,
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
              }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--neon-cyan)', marginBottom: '0.8rem' }}>How to Play</h3>
                <div style={{ marginBottom: '0.8rem' }}>
                  <strong style={{ color: 'var(--neon-cyan)' }}>Left Hand — Harmony</strong>
                  <p style={{ marginTop: '0.3rem' }}>• Fingers = scale degree (1-5 → I, ii, iii, IV, V)</p>
                  <p>• Index + Pinky = VI (6th chord)</p>
                  <p>• Index + Pinky + Thumb = VII (7th chord)</p>
                  <p>• Wrist tilt = major ↔ minor (in Scale + Tilt mode)</p>
                  <p>• Key selector = transpose to any of 12 keys</p>
                </div>
                <div style={{ marginBottom: '0.8rem' }}>
                  <strong style={{ color: 'var(--neon-magenta)' }}>Right Hand — Expression</strong>
                  <p style={{ marginTop: '0.3rem' }}>• Height = volume (higher = louder)</p>
                  <p>• Wrist tilt = tone (filter sweep)</p>
                  <p>• Finger Layout mode:</p>
                  <p style={{ paddingLeft: '0.5rem' }}>1 finger = triad, 2 = 1st inversion, 3 = 7th, 4+ = 9th</p>
                  <p>• Fixed Chord Style: lock to specific chord type</p>
                </div>
                <div style={{ marginBottom: '0.8rem' }}>
                  <strong style={{ color: 'var(--neon-purple)' }}>Features</strong>
                  <p style={{ marginTop: '0.3rem' }}>• 🎹 5 timbres: Piano, Strings, Organ, Synth, Vibraphone</p>
                  <p>• 🎼 Arpeggiate: harp-like strumming</p>
                  <p>• 🎸 Auto Bass: adds low-end foundation</p>
                  <p>• ⏺️ Record: save as WebM (max 15s)</p>
                </div>
                <div>
                  <strong style={{ color: 'var(--neon-amber)' }}>Theremin Mode</strong>
                  <p style={{ marginTop: '0.3rem' }}>• Right hand Y-axis = pitch (continuous)</p>
                  <p>• Left hand Y-axis = volume</p>
                  <p>• Dual-hand control: both hands work together</p>
                </div>
              </div>
            )}

        {/* Scale Guide - 8 blocks showing scale degrees (positioned at bottom) */}
        {(isRunning || keyboardMode) && synthState.appMode === 'gesture' && (
          <div className="scale-guide" style={{
            position: 'absolute',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '3px',
            zIndex: 5,
          }}>
            {(() => {
              // Calculate note names based on current key (use sharp notation only)
              const mkNote = (semis: number) => {
                const key = KEYS[(semis + synthState.keyOffset) % 12];
                return key?.name?.split('/')[0] ?? '?';
              };
              const keyNotes = [
                { note: mkNote(0),  roman: 'I',   hint: '1 finger' },
                { note: mkNote(2),  roman: 'II',  hint: '2 fingers' },
                { note: mkNote(4),  roman: 'III', hint: '3 fingers' },
                { note: mkNote(5),  roman: 'IV',  hint: '4 fingers' },
                { note: mkNote(7),  roman: 'V',   hint: '5 fingers' },
                { note: mkNote(9),  roman: 'VI',  hint: 'idx + pky' },
                { note: mkNote(11), roman: 'VII', hint: 'i + p + t' },
                { note: mkNote(0),  roman: 'I\'', hint: '1 fing (oct)' },
              ];
              return keyNotes.map((block, i) => {
                const isActive = synthState.chordIndex === i && synthState.isPlaying;
                return (
                  <div
                    key={i}
                    style={{
                      width: '70px',
                      padding: '0.6rem 0.3rem',
                      background: isActive ? 'rgba(0, 255, 204, 0.2)' : 'rgba(22, 22, 32, 0.35)',
                      backdropFilter: 'var(--frost-blur)',
                      WebkitBackdropFilter: 'var(--frost-blur)',
                      border: `2px solid ${isActive ? 'rgba(0, 255, 204, 0.6)' : 'rgba(255, 255, 255, 0.04)'}`,
                      borderRadius: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 0 20px rgba(0, 255, 204, 0.6)' : 'none',
                      textAlign: 'center',
                    }}
                  >
                    <span style={{
                      fontSize: '1.6rem',
                      fontWeight: 700,
                      color: isActive ? 'var(--neon-cyan)' : 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                      lineHeight: 1.2,
                    }}>
                      {block.note}
                    </span>
                    <span style={{
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      color: isActive ? 'var(--neon-cyan)' : 'var(--text-muted)',
                      marginTop: '0.2rem',
                    }}>
                      {block.roman}
                    </span>
                    <span style={{
                      fontSize: '0.6rem',
                      color: isActive ? 'rgba(0, 255, 204, 0.7)' : 'var(--text-muted)',
                      marginTop: '0.15rem',
                      whiteSpace: 'nowrap',
                    }}>
                      {block.hint}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* Now playing note - prominent but transparent, centered */}
        {(isRunning || keyboardMode) && synthState.appMode === 'gesture' && synthState.isPlaying && (
          <div style={{
            position: 'absolute',
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '5rem',
            fontWeight: 900,
            color: 'rgba(0, 255, 204, 0.15)',
            fontFamily: 'var(--font-display)',
            zIndex: 3,
            pointerEvents: 'none',
            letterSpacing: '0.1em',
          }}>
            {synthState.chordName}
          </div>
        )}

        {/* Waveform visualization - full-width, transparent overlay at bottom */}
        {(isRunning || keyboardMode) && synthState.isPlaying && (
          <div style={{
            position: 'absolute',
            bottom: '45px',
            left: 0,
            right: 0,
            height: '36px',
            zIndex: 5,
            pointerEvents: 'none',
          }}>
            <canvas
              ref={waveformCanvasRef}
              style={{ width: '100%', height: '100%', opacity: 0.5 }}
            />
          </div>
        )}

        {/* Bottom status bar */}
        {(isRunning || keyboardMode) && (
          <div className="status-bar-bottom">
            <div className="status-chord">
              🎵 {synthState.chordName}
            </div>
            <div className="status-volume">
              <span className="status-label">Vol</span>
              <div className="status-volume-track">
                <div className="status-volume-fill" style={{ width: `${synthState.volume * 100}%` }} />
              </div>
            </div>
            <div className="status-mode">
              {synthState.appMode === 'gesture' ? 'Gesture' : synthState.appMode === 'theremin' ? 'Theremin' : 'Piano'}
            </div>

            {/* Metronome controls integrated into status bar */}
            <input
              type="number"
              value={metronomeBpm}
              onChange={(e) => setMetronomeBpm(Number(e.target.value))}
              style={{ width: '36px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', textAlign: 'center', padding: '1px' }}
            />
            <span style={{ fontSize: '0.6rem' }}>BPM</span>
            <button
              onClick={() => {
                const now = performance.now();
                const taps = tapTimesRef.current;
                taps.push(now);
                if (taps.length > 4) taps.shift();
                if (taps.length >= 2) {
                  const intervals = taps.slice(1).map((t, i) => t - taps[i]);
                  const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                  setMetronomeBpm(Math.max(40, Math.min(240, Math.round(60000 / avgMs))));
                }
              }}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-muted)', fontSize: '0.55rem', padding: '1px 4px', cursor: 'pointer' }}
            >
              TAP
            </button>
            <select value={metronomeTimeSig} onChange={(e) => setMetronomeTimeSig(e.target.value)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', padding: '1px' }}>
              <option>3/4</option><option>4/4</option><option>5/4</option><option>6/8</option><option>7/8</option>
            </select>
            <select value={metronomeBars} onChange={(e) => setMetronomeBars(e.target.value)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', padding: '1px' }}>
              <option value="1">1 bar</option><option value="2">2 bars</option><option value="4">4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option>
            </select>
            <select value={metronomeSound} onChange={(e) => setMetronomeSound(e.target.value)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', padding: '1px' }}>
              <option value="click">Click</option><option value="wood">Wood</option><option value="beep">Beep</option><option value="hihat">Hi-hat</option>
            </select>
            <button
              onClick={() => setMetronomeOn(!metronomeOn)}
              style={{
                background: metronomeOn ? 'rgba(0,255,204,0.15)' : 'transparent',
                border: `1px solid ${metronomeOn ? 'rgba(0,255,204,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '3px', color: metronomeOn ? 'var(--neon-cyan)' : 'var(--text-muted)',
                fontSize: '0.6rem', padding: '1px 5px', cursor: 'pointer',
              }}
            >
              ♪
            </button>
            <input type="range" min="0" max="1" step="0.05" value={metronomeVolume} onChange={(e) => setMetronomeVolume(Number(e.target.value))} style={{ width: '50px', accentColor: 'var(--neon-cyan)' }} />
            <span style={{ fontSize: '0.6rem', width: '26px' }}>{Math.round(metronomeVolume * 100)}%</span>

            <span style={{ flex: 1 }} />

            <a href="https://github.com/rainbow686/gesture-synth-weld" target="_blank" rel="noopener" title="Open source on GitHub" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', opacity: 0.6 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
        )}
      </section>

    </div>
  );
}

/* ─── Drawing Utilities ──────────────────────────────────────────────── */

function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: HandData,
  canvasW: number,
  canvasH: number,
  color: string,
  glowColor: string,
) {
  const pts = hand.landmarks;
  if (!pts || pts.length < 21) return;

  const toCanvas = (lm: { x: number; y: number }) => ({
    x: (1 - lm.x) * canvasW,
    y: lm.y * canvasH,
  });

  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [a, b] of HAND_CONNECTIONS) {
    const pA = toCanvas(pts[a]);
    const pB = toCanvas(pts[b]);
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();
  }

  for (let i = 0; i < pts.length; i++) {
    const p = toCanvas(pts[i]);
    const isTip = [4, 8, 12, 16, 20].includes(i);

    ctx.beginPath();
    ctx.arc(p.x, p.y, isTip ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isTip ? color : 'rgba(255,255,255,0.5)';
    ctx.fill();

    if (isTip) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
