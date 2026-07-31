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
    keyOffset: 0,
    appMode: 'gesture',
    leftHandMode: 'scaleTilt',
    rightHandMode: 'fingerLayout',
    arpeggiate: false,
    arpSpeed: 'normal',
    autoBass: false,
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
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingStartRef = useRef<number | null>(null);

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
  const GRACE_MS = 50; // Grace period for temporary hand loss

  // Right hand finger count history for chord style smoothing
  const rightHandHistoryRef = useRef<number[]>([]);

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
          audioEngine.playChord(idx, 'sine', modeArg, 0, s.keyOffset);
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
            audioEngine.playChord(prev.chordIndex, 'sine', 'major', 0, prev.keyOffset);
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
            audioEngine.playChord(prev.chordIndex, 'sine', 'minor', 0, prev.keyOffset);
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
      if (hand.positionX > 0.5) {
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

      if (hasRight || hasLeft) {
        let freq = 0;
        let volume = 0;

        // Right hand Y position → pitch (continuous)
        if (hasRight && rightHand) {
          const minFreq = 130.81; // C3
          const maxFreq = 1046.5; // C6
          freq = minFreq * Math.pow(maxFreq / minFreq, 1 - rightHand.positionY);
        }

        // Left hand Y position → volume
        if (hasLeft && leftHand) {
          volume = Math.max(0.02, Math.min(1.0, 1.1 - leftHand.positionY));
        } else {
          // If no left hand, use default volume
          volume = 0.5;
        }

        // Play note if we have a frequency
        if (hasRight && freq > 0) {
          audioEngine.playNote(freq);
        }

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

      // Use smoothed finger count mapping (VI/VII special gestures disabled for stability)
      chordIndex = FINGER_TO_CHORD_INDEX[stableFingerCount] ?? 0;

      if (s.leftHandMode === 'scaleTilt') {
        // Wrist tilt → major/minor
        const tilt = leftHand.tiltAngle;
        const tiltThreshold = 0.15;
        if (tilt > tiltThreshold) mode = 'major';
        else if (tilt < -tiltThreshold) mode = 'minor';
        else mode = 'neutral';
      } else {
        // scaleLocked: use locked mode
        mode = s.lockedMode ?? 'neutral';
      }
    }

    // Right Hand → Expression (volume + chord style)
    // CRITICAL: Right hand is required to trigger sound
    let volume = 0; // Default to 0 (no sound)
    let chordStyle: ChordStyle | undefined;
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

    // CRITICAL: Only play sound if BOTH hands are present
    const isPlaying = !!(leftHand && rightHand);
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
    // Only include chord root (index + mode + key), not chord style
    // This prevents right hand finger jitter from triggering new chords
    const chordFingerprint = `${chordIndex}|${mode}|${s.keyOffset}`;

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
        URL.revokeObjectURL(url);
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

  // Recording timer
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      if (recordingStartRef.current) {
        const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
        setRecordingTime(Math.min(elapsed, 15)); // Max 15 seconds
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording]);

  /* ─── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="full-screen-app">
      {/* ─── Full-screen camera area ────────────────────────────────── */}
      <section className="camera-stage">
        <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
        <canvas ref={canvasRef} className="camera-canvas" />

        {/* Hand tags */}
        {isRunning && (
          <div className="hand-tag-overlay">
            {hasLeftHand && <span className="hand-tag left">L</span>}
            {hasRightHand && <span className="hand-tag right">R</span>}
          </div>
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

        {/* ─── Floating Control Panel ───────────────────────────────── */}
        {(isRunning || keyboardMode) && (
          <>
            {/* Desktop panel */}
            <div className="floating-panel desktop-only">
              {/* Product name + mode */}
              <div className="panel-section">
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.7rem', color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                  Gesture Synth Weld
                </div>
                <div className="mode-toggle">
                  <button
                    className={`mode-btn ${synthState.appMode === 'gesture' ? 'active' : ''}`}
                    onClick={() => setSynthState(prev => ({ ...prev, appMode: 'gesture' }))}
                  >
                    Gesture
                  </button>
                  <button
                    className={`mode-btn ${synthState.appMode === 'theremin' ? 'active' : ''}`}
                    onClick={() => setSynthState(prev => ({ ...prev, appMode: 'theremin' }))}
                  >
                    Theremin
                  </button>
                  <button
                    className={`mode-btn ${synthState.appMode === 'monoPiano' ? 'active' : ''}`}
                    onClick={() => setSynthState(prev => ({ ...prev, appMode: 'monoPiano' }))}
                  >
                    Piano
                  </button>
                </div>
              </div>

              {/* Gesture mode controls */}
              {synthState.appMode === 'gesture' && (
                <>
                  {/* Left Hand */}
                  <div className="panel-section">
                    <label className="panel-label">Left Hand — Harmony</label>
                    <select
                      value={KEYS[synthState.keyOffset]?.name ?? 'C'}
                      onChange={(e) => {
                        const keyIndex = KEYS.findIndex(k => k.name === e.target.value);
                        setSynthState(prev => ({ ...prev, keyOffset: keyIndex }));
                      }}
                      style={{ width: '100%', padding: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.7rem', marginBottom: '0.3rem' }}
                    >
                      {KEYS.map(key => (
                        <option key={key.name} value={key.name}>{key.name}</option>
                      ))}
                    </select>
                    <select
                      value={synthState.leftHandMode}
                      onChange={(e) => setSynthState(prev => ({ ...prev, leftHandMode: e.target.value as LeftHandMode }))}
                      style={{ width: '100%', padding: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.65rem' }}
                    >
                      <option value="scaleTilt">Scale + Tilt Major/Minor</option>
                      <option value="scaleLocked">Scale Only (Locked)</option>
                    </select>
                    {synthState.leftHandMode === 'scaleLocked' && (
                      <select
                        value={synthState.lockedMode ?? 'major'}
                        onChange={(e) => setSynthState(prev => ({ ...prev, lockedMode: e.target.value as 'major' | 'minor' }))}
                        style={{ width: '100%', padding: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.65rem', marginTop: '0.3rem' }}
                      >
                        <option value="major">Major</option>
                        <option value="minor">Minor</option>
                      </select>
                    )}
                  </div>

                  {/* Right Hand */}
                  <div className="panel-section">
                    <label className="panel-label">Right Hand — Expression</label>
                    <select
                      value={synthState.rightHandMode}
                      onChange={(e) => setSynthState(prev => ({ ...prev, rightHandMode: e.target.value as RightHandMode }))}
                      style={{ width: '100%', padding: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.65rem' }}
                    >
                      <option value="fingerLayout">Chord Style = Finger Layout</option>
                      <option value="fixedChordStyle">Fixed Chord Style</option>
                    </select>
                    {synthState.rightHandMode === 'fixedChordStyle' && (
                      <select
                        value={synthState.lockedChordStyle ?? 'majorTriad'}
                        onChange={(e) => setSynthState(prev => ({ ...prev, lockedChordStyle: e.target.value as ChordStyle }))}
                        style={{ width: '100%', padding: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.65rem', marginTop: '0.3rem' }}
                      >
                        {CHORD_STYLE_OPTIONS.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}

              {/* Arpeggiator */}
              <div className="panel-section">
                <label className="panel-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="checkbox"
                    checked={synthState.arpeggiate}
                    onChange={(e) => setSynthState(prev => ({ ...prev, arpeggiate: e.target.checked }))}
                    style={{ accentColor: 'var(--neon-cyan)' }}
                  />
                  Arpeggiate
                </label>
                {synthState.arpeggiate && (
                  <select
                    value={synthState.arpSpeed}
                    onChange={(e) => setSynthState(prev => ({ ...prev, arpSpeed: e.target.value as ArpSpeed }))}
                    style={{ width: '100%', padding: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.65rem' }}
                  >
                    <option value="slow">Slow (120ms)</option>
                    <option value="normal">Normal (80ms)</option>
                    <option value="fast">Fast (50ms)</option>
                  </select>
                )}
              </div>

              {/* Auto Bass */}
              <div className="panel-section">
                <label className="panel-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="checkbox"
                    checked={synthState.autoBass}
                    onChange={(e) => setSynthState(prev => ({ ...prev, autoBass: e.target.checked }))}
                    style={{ accentColor: 'var(--neon-cyan)' }}
                  />
                  Auto Bass
                </label>
                {synthState.autoBass && (
                  <div style={{ marginTop: '0.3rem' }}>
                    <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Bass Volume</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={synthState.bassVolume}
                      onChange={(e) => setSynthState(prev => ({ ...prev, bassVolume: parseFloat(e.target.value) }))}
                      style={{ width: '100%', accentColor: 'var(--neon-cyan)' }}
                    />
                  </div>
                )}
              </div>

              {/* Record */}
              <div className="panel-section">
                <button
                  className={`record-btn ${isRecording ? 'recording' : ''}`}
                  onClick={toggleRecording}
                >
                  <span className="record-dot" />
                  {isRecording ? `${recordingTime}s / 15s` : 'Rec'}
                </button>
              </div>

              {/* Help */}
              <div className="panel-section">
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-primary)', padding: '0.3rem 0.6rem', fontSize: '0.65rem', cursor: 'pointer', width: '100%' }}
                >
                  {showHelp ? '✕ Close' : '? Help'}
                </button>
              </div>
            </div>

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
                  <p>• ⏺️ Record: save as WAV (max 15s)</p>
                </div>
                <div>
                  <strong style={{ color: 'var(--neon-amber)' }}>Theremin Mode</strong>
                  <p style={{ marginTop: '0.3rem' }}>• Right hand Y-axis = pitch (continuous)</p>
                  <p>• Left hand Y-axis = volume</p>
                  <p>• Dual-hand control: both hands work together</p>
                </div>
              </div>
            )}

            {/* Mobile toggle */}
            <button
              className="mobile-panel-toggle mobile-only"
              onClick={() => setShowMobilePanel(!showMobilePanel)}
            >
              ⚙️
            </button>
          </>
        )}

        {/* Title */}
        <div className="app-title">
          <span>Gesture Synth Weld</span>
        </div>

        {/* Scale Guide - 8 blocks showing scale degrees */}
        {(isRunning || keyboardMode) && synthState.appMode === 'gesture' && (
          <div className="scale-guide" style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            gap: '0.5rem',
            zIndex: 5,
          }}>
            {[
              { degree: 'I', label: '1 finger', index: 0 },
              { degree: 'II', label: '2 fingers', index: 1 },
              { degree: 'III', label: '3 fingers', index: 2 },
              { degree: 'IV', label: '4 fingers', index: 3 },
              { degree: 'V', label: '5 fingers', index: 4 },
              { degree: 'VI', label: 'index + pinky', index: 5 },
              { degree: 'VII', label: 'index + pinky + thumb', index: 6 },
              { degree: 'I\'', label: '1 finger (oct)', index: 7 },
            ].map((block, i) => {
              const isActive = synthState.chordIndex === block.index && synthState.isPlaying;
              return (
                <div
                  key={i}
                  style={{
                    width: '60px',
                    height: '80px',
                    background: isActive ? 'rgba(0, 255, 204, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: `2px solid ${isActive ? 'var(--neon-cyan)' : 'rgba(255, 255, 255, 0.1)'}`,
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                    boxShadow: isActive ? '0 0 20px rgba(0, 255, 204, 0.4)' : 'none',
                  }}
                >
                  <div style={{
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    color: isActive ? 'var(--neon-cyan)' : 'var(--text-primary)',
                    fontFamily: 'var(--font-display)',
                  }}>
                    {block.degree}
                  </div>
                  <div style={{
                    fontSize: '0.6rem',
                    color: isActive ? 'var(--neon-cyan)' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                    textAlign: 'center',
                  }}>
                    {block.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Central note symbol */}
        {(isRunning || keyboardMode) && synthState.isPlaying && (
          <div style={{
            position: 'absolute',
            top: '35%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '4rem',
            color: 'rgba(0, 255, 204, 0.3)',
            fontFamily: 'var(--font-display)',
            zIndex: 4,
            pointerEvents: 'none',
          }}>
            ♪
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
          </div>
        )}
      </section>

      {/* Stop button */}
      {isRunning && (
        <button className="stop-btn-floating" onClick={stopCamera}>
          ■ Stop
        </button>
      )}
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
