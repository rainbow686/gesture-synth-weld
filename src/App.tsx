import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  type RecMode,
  type RecRatio,
  type RecPhase,
} from './types';
import { makeRecordingFilename } from './wavEncoder';
// Config imports removed — external scripts feature not currently active

/* ─── Gesture Synth Weld — Two-Hand Division System ─────────────────── */

/* ─── B2: Recording constants & helpers (module level, pure) ────────── */

const VIDEO_REC_SUPPORTED =
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function';

const REC_RATIO_DIMS: Record<RecRatio, [number, number]> = {
  '9:16': [720, 1280],
  '16:9': [1280, 720],
  '1:1': [1080, 1080],
};

const REC_RATIO_HINTS: Record<RecRatio, string> = {
  '9:16': 'TikTok · Instagram Reels · YouTube Shorts',
  '16:9': 'YouTube · general sharing',
  '1:1': 'Instagram feed · Discord · Reddit',
};

const REC_SVG_PREVIEWS: Record<RecMode, ReactNode> = {
  video: (
    <svg viewBox="0 0 64 36" className="rec-preview" aria-hidden="true">
      <rect width="64" height="36" rx="4" fill="#0d0d2b" />
      <circle cx="22" cy="14" r="6" fill="#3a3a6a" />
      <path d="M14 29c0-4.2 3.5-6.5 8-6.5s8 2.3 8 6.5" fill="#3a3a6a" />
      <circle cx="44" cy="16" r="3" fill="#00ffcc" opacity=".9" />
      <circle cx="52" cy="16" r="3" fill="#ff00ff" opacity=".9" />
      <path d="M44 16h8M47 12.5l-3.5 3.5L47 19.5" stroke="#00ffcc" strokeWidth="1.4" fill="none" />
      <path d="M52 12.5l3.5 3.5L52 19.5" stroke="#ff00ff" strokeWidth="1.4" fill="none" />
    </svg>
  ),
  skeleton: (
    <svg viewBox="0 0 64 36" className="rec-preview" aria-hidden="true">
      <rect width="64" height="36" rx="4" fill="#0d0d2b" />
      <circle cx="44" cy="16" r="3" fill="#00ffcc" opacity=".9" />
      <circle cx="52" cy="16" r="3" fill="#ff00ff" opacity=".9" />
      <path d="M44 16h8M47 12.5l-3.5 3.5L47 19.5" stroke="#00ffcc" strokeWidth="1.4" fill="none" />
      <path d="M52 12.5l3.5 3.5L52 19.5" stroke="#ff00ff" strokeWidth="1.4" fill="none" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 64 36" className="rec-preview" aria-hidden="true">
      <rect width="64" height="36" rx="4" fill="#0d0d2b" />
      {[8, 14, 20, 26, 32, 38, 44, 50, 56].map((x, i) => (
        <rect key={x} x={x} y={18 - (i % 3) * 4} width="3" height={(i % 3) * 8 + 8} rx="1.5" fill="#00ffcc" opacity={0.85} />
      ))}
    </svg>
  ),
};

/** Pick the best MediaRecorder mime type (mp4 preferred, webm fallback). */
function pickRecMimeType(): { mime: string; ext: string } {
  const candidates: [string, string][] = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
}


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
    arpeggiate: false,
    arpSpeed: 'normal',
    autoBass: false,
    bassVolume: 0.5,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [hasLeftHand, setHasLeftHand] = useState(false);
  const [hasRightHand, setHasRightHand] = useState(false);

  // B2: recording flow (chooser → countdown → recording → result)
  const [recPhase, setRecPhase] = useState<RecPhase>('idle');
  const [recMode, setRecMode] = useState<RecMode>(() => (localStorage.getItem('gsw-rec-mode') as RecMode) || 'audio');
  const [recRatio, setRecRatio] = useState<RecRatio>(() => (localStorage.getItem('gsw-rec-ratio') as RecRatio) || '9:16');
  const [recCount, setRecCount] = useState(3);
  const [recBlob, setRecBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const recModeRef = useRef<RecMode>('audio');
  const recRatioRef = useRef<RecRatio>('9:16');
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const recordingAbortedRef = useRef(false);
  // B2: recording compositor helpers (cheap blur buffer + chord-pop timing)
  const blurBufRef = useRef<HTMLCanvasElement | null>(null);
  const recChordRef = useRef('');
  const recChordTimeRef = useRef(0);

  // Hand detection smoothing to prevent flickering
  const handDetectionHistoryRef = useRef<{ left: boolean[]; right: boolean[] }>({
    left: [],
    right: [],
  });
  const HAND_STABLE_FRAMES = 3; // Require 3 frames for hand presence

  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const [showSettings, setShowSettings] = useState(!isMobile);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingStartRef = useRef<number | null>(null);
  const recordingActiveRef = useRef(false);

  useEffect(() => { recModeRef.current = recMode; }, [recMode]);
  useEffect(() => { recRatioRef.current = recRatio; }, [recRatio]);
  useEffect(() => {
    recordingActiveRef.current = isRecording;
  }, [isRecording]);

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
  const HOLD_MS = 100; // Require 100ms stability (matching competitor)
  const GRACE_MS = 80; // Keep previous chord if hand briefly disappears

  // Right hand finger count history for chord style smoothing
  const rightHandHistoryRef = useRef<number[]>([]);
  // Pinky detection memory — extends pinky detection across frames
  // to prevent flicker from resetting the stabilizer's HOLD timer
  const pinkyMemoryRef = useRef<number>(0);

  /* ─── Reset stabilizer on mode switch ────────────────────────────────── */

  useEffect(() => {
    stabilizerRef.current = { committed: null, pending: null, pendingSince: 0, lastSeen: 0 };
    rightHandHistoryRef.current = [];
    pinkyMemoryRef.current = 0;
    lastChordRef.current = '';
    // Full audio reset on mode switch: clears the engine chord dedup key
    // (otherwise a Gesture→Piano→Gesture round-trip with the same chord
    // goes silent) and stops the auto bass (otherwise it drones on after
    // leaving Gesture mode).
    audioEngine.stopAll();
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

  /* ─── Keyboard Controls (Space: stop, Esc: reset) ──────────────────── */
  // Playing shortcuts (1-7, ↑/↓, T/Y, A, B) were removed: both hands must
  // stay in front of the camera while playing, so the keyboard is
  // unreachable mid-performance, and no competitor offers keyboard playing
  // (see CLAUDE.md "Competitors"). Only control keys that work anytime
  // (browser focus) remain.

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space: Stop all notes
      if (e.key === ' ') {
        e.preventDefault();
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

    // Theremin mode uses the sine instrument; every other mode the sawtooth.
    // Idempotent, so calling it per frame is free.
    audioEngine.setTimbre(s.appMode === 'theremin' ? 'theremin' : 'gesture');

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
        } else if (stabilizer.committed === null) {
          // First gesture: commit immediately
          stabilizer.committed = rawFingerCount;
        }

        // Use committed finger count for note selection
        const stableFingerCount = stabilizer.committed ?? rawFingerCount;

        // Left fist (0 fingers) = silence, consistent with the other modes
        if (stableFingerCount === 0) {
          audioEngine.stopAll();
          lastChordRef.current = '';
          setSynthState(prev => ({ ...prev, isPlaying: false }));
          return;
        }

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
      // Apply time-based stabilizer on chordIndex (catches VI/VII changes too)
      const now = performance.now();
      const stabilizer = stabilizerRef.current;

      // Compute raw chord index including VI/VII special gestures
      const extended = leftHand.extendedFingers;
      // Pinky memory: if detected in last 60 frames (~2s), treat as extended.
      // Long window compensates for unreliable Y-axis pinky detection.
      if (extended.includes('pinky')) {
        pinkyMemoryRef.current = 60;
      } else if (pinkyMemoryRef.current > 0) {
        pinkyMemoryRef.current--;
      }
      const pinky = pinkyMemoryRef.current > 0;
      const thumb = extended.includes('thumb');
      const index = extended.includes('index');
      const middle = extended.includes('middle');
      const ring = extended.includes('ring');
      let rawChordIndex: number;
      const viMatch = index && pinky && !middle && !ring && !thumb;
      const viiMatch = index && pinky && !middle && !ring && thumb;
      if (viiMatch) {
        rawChordIndex = 6; // VII
      } else if (viMatch) {
        rawChordIndex = 5; // VI
      } else {
        rawChordIndex = FINGER_TO_CHORD_INDEX[leftHand.fingerCount] ?? 0;
      }


      // Stabilize chordIndex (not finger count — catches all gesture changes)
      if (rawChordIndex !== stabilizer.pending) {
        stabilizer.pending = rawChordIndex;
        stabilizer.pendingSince = now;
      }
      if (now - stabilizer.pendingSince >= HOLD_MS) {
        stabilizer.committed = stabilizer.pending;
      } else if (stabilizer.committed === null) {
        stabilizer.committed = rawChordIndex;
      }

      chordIndex = stabilizer.committed ?? rawChordIndex;

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

    // Right thumb extended → octave down (matching competitor)
    const thumbDown = !!(rightHand?.extendedFingers.includes('thumb'));

    // CRITICAL: Sound only plays if both hands are present and left has fingers.
    // Left fist mutes; right fist does NOT stop sound — only left fist or
    // hand loss stops (grace period below).
    const leftFist = leftHand ? leftHand.fingerCount === 0 : true;
    const isPlaying = !!(leftHand && rightHand && !leftFist);
    const chordName = getChordName(
      chordIndex,
      mode === 'neutral' ? undefined : mode,
      s.keyOffset,
      chordStyle,
    ) + (thumbDown ? ' (-8ve)' : '');

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
    const chordFingerprint = `${chordIndex}|${mode}|${chordStyle || ''}|${s.keyOffset}|${s.arpeggiate}|${s.arpSpeed}|${thumbDown ? '8vdn' : ''}`;

    // Play chord only if the fingerprint actually changed (volume is
    // intentionally excluded so height changes don't re-trigger).
    if (isPlaying) {
      // Refresh the grace-period clock — sound continues while this holds.
      // (Updating it only here means a missing right hand stops the music
      // after GRACE_MS instead of sustaining forever on a left hand alone.)
      stabilizerRef.current.lastSeen = performance.now();
      if (chordFingerprint !== lastChordRef.current) {
        lastChordRef.current = chordFingerprint;
        audioEngine.playChord(
          chordIndex, 'sine',
          mode === 'neutral' ? undefined : mode,
          0, s.keyOffset, chordStyle,
          s.arpeggiate, s.arpSpeed, thumbDown,
        );
      }
      audioEngine.setVolume(volume);
      if (rightHand) audioEngine.updateFilterSweep(rightHand.tiltAngle);

    } else {
      // Left fist → mute, or hand(s) missing → grace period → stop
      const lFistOnly = leftHand && leftHand.fingerCount === 0;
      if (lFistOnly) {
        audioEngine.setVolume(0);
        return;
      }
      const now = performance.now();
      const stabilizer = stabilizerRef.current;
      if (stabilizer.lastSeen > 0 && now - stabilizer.lastSeen < GRACE_MS) return;
      audioEngine.stopAll();
      lastChordRef.current = '';
      stabilizerRef.current = { committed: null, pending: null, pendingSince: 0, lastSeen: 0 };
    }

    // Auto bass — follows octave shift
    if (s.autoBass && isPlaying) {
      const chord = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
      const bassMidi = 60 + chord.intervals[0] + s.keyOffset - (thumbDown ? 12 : 0);
      audioEngine.setBassNote(bassMidi, s.bassVolume);
    } else {
      audioEngine.setBassNote(null);
    }
  };

  /* ─── Draw helpers ──────────────────────────────────────────────────── */

  const drawOverlayRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>();
  drawOverlayRef.current = (ctx, w, h) => {
    if (!showSkeleton) return;
    const g = gestureRef.current;
    if (g.left) drawHandSkeleton(ctx, g.left, w, h, '#00ffcc', 'rgba(0,255,204,0.4)');
    if (g.right) drawHandSkeleton(ctx, g.right, w, h, '#ff00ff', 'rgba(255,0,255,0.4)');
  };

  // Draw waveform visualization — line thickness follows volume,
  // gray when muted, invisible when silent.
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

    // Compute RMS amplitude from waveform data
    let sumSq = 0;
    for (let i = 0; i < bufferLength; i++) sumSq += waveform[i] * waveform[i];
    const rms = Math.sqrt(sumSq / bufferLength); // 0 (silent) … ~0.7 (loud)

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hands = gestureRef.current;
    const handsPresent = !!(hands.left || hands.right);
    // No hands in frame at all → hide waveform entirely
    if (!handsPresent && rms < 0.005) return;

    // Muted (hands present but silent) → thin gray line
    // Playing → cyan with variable width
    const muted = rms < 0.005;
    const lineW = muted ? 2 : 1 + rms * 8;
    const r = muted ? 120 : 0;
    const g = muted ? 120 : 255;
    const b = muted ? 120 : 204;
    const alpha = muted ? 0.25 : 0.2 + rms * 0.8;

    ctx.lineWidth = lineW;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.shadowColor = muted ? 'transparent' : '#00ffcc';
    ctx.shadowBlur = muted ? 0 : 8;
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = (waveform[i] + 1) / 2;
      const y = v * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  /* ─── B2: recording compositor ──────────────────────────────────────── */

  // Composites the current performance (live canvas, or skeleton canvas in
  // skeleton mode) into the recording canvas at the chosen aspect ratio.
  //
  // 9:16 — vertical share frame: blur-fill background (the performance
  // itself, enlarged + blurred + darkened — the industry standard for
  // landscape→vertical), sharp content window, brand name (gradient,
  // breathing glow), huge live chord name (pops on change), mode · key,
  // live waveform + level bars, and the domain URL (the traffic driver).
  // 16:9 — cover-fill with a small HUD. 1:1 — blur-fill + simple HUD.
  const drawRecFrame = useCallback(() => {
    const rec = recCanvasRef.current;
    const mode = recModeRef.current;
    const src = mode === 'skeleton' ? skeletonCanvasRef.current : canvasRef.current;
    if (!rec || !src || !src.width || !src.height) return;
    const rctx = rec.getContext('2d');
    if (!rctx) return;

    const W = rec.width;
    const H = rec.height;
    const sw = src.width;
    const sh = src.height;
    const ratio = recRatioRef.current;
    const s = synthRef.current;
    const modeLabel = s.appMode === 'gesture' ? 'Gesture' : s.appMode === 'theremin' ? 'Theremin' : 'Piano';
    const now = performance.now();
    const t = recordingStartRef.current ? (now - recordingStartRef.current) / 1000 : 0;

    // ── Blur-fill background (cheap: draw via a tiny copy, then upscale) ──
    rctx.fillStyle = '#050510';
    rctx.fillRect(0, 0, W, H);
    const bw = Math.max(32, Math.round(W / 10));
    const bh = Math.max(56, Math.round(H / 10));
    if (!blurBufRef.current) blurBufRef.current = document.createElement('canvas');
    const bb = blurBufRef.current;
    if (bb.width !== bw || bb.height !== bh) {
      bb.width = bw;
      bb.height = bh;
    }
    const bctx = bb.getContext('2d');
    if (bctx) {
      const scale = Math.max(bw / sw, bh / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'medium';
      bctx.drawImage(src, (bw - dw) / 2, (bh - dh) / 2, dw, dh);
    }
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'medium';
    rctx.drawImage(bb, 0, 0, W, H);
    rctx.fillStyle = 'rgba(5, 5, 15, 0.55)';
    rctx.fillRect(0, 0, W, H);

    if (ratio === '9:16') {
      const topZone = Math.round(H * 0.19);    // brand + chord + mode
      const bottomZone = Math.round(H * 0.165); // waveform + level + URL

      // ── Sharp content window (whole source, fit-width) ──
      const winH = Math.round((W * sh) / sw);
      const midH = H - topZone - bottomZone;
      const y = topZone + Math.max(0, Math.round((midH - winH) / 2));
      rctx.drawImage(src, 0, y, W, winH);
      rctx.strokeStyle = 'rgba(0, 255, 204, 0.35)';
      rctx.lineWidth = 2;
      rctx.strokeRect(0, y, W, winH);

      // ── Brand: gradient wordmark with a breathing glow ──
      const brandAlpha = 0.85 + 0.15 * Math.sin(t * 2.2);
      const grad = rctx.createLinearGradient(0, 0, 260, 0);
      grad.addColorStop(0, '#00ffcc');
      grad.addColorStop(1, '#ff00ff');
      rctx.font = '800 30px Orbitron, monospace';
      rctx.textAlign = 'left';
      rctx.shadowColor = `rgba(0, 255, 204, ${0.4 * brandAlpha})`;
      rctx.shadowBlur = 16;
      rctx.fillStyle = grad;
      rctx.fillText('GESTURE SYNTH WELD', 26, 52);
      rctx.shadowBlur = 0;

      // ── Chord name: huge, centered, pops on change ──
      const chord = s.chordName || '—';
      if (chord !== recChordRef.current) {
        recChordRef.current = chord;
        recChordTimeRef.current = now;
      }
      const chordAge = (now - recChordTimeRef.current) / 1000;
      const popScale = chordAge < 0.25 ? 1 + 0.18 * (1 - chordAge / 0.25) : 1;
      rctx.save();
      rctx.translate(W / 2, topZone - 46);
      rctx.scale(popScale, popScale);
      rctx.font = '900 84px Orbitron, monospace';
      rctx.textAlign = 'center';
      rctx.textBaseline = 'middle';
      rctx.shadowColor = 'rgba(0, 255, 204, 0.75)';
      rctx.shadowBlur = 26;
      rctx.fillStyle = '#00ffcc';
      rctx.fillText(chord, 0, 0);
      rctx.restore();
      rctx.textBaseline = 'alphabetic';

      // ── Mode · key ──
      rctx.font = '500 19px Inter, system-ui, sans-serif';
      rctx.textAlign = 'center';
      rctx.fillStyle = '#a0a0d0';
      rctx.fillText(`${modeLabel} · Key ${KEYS[s.keyOffset]?.name ?? 'A'}`, W / 2, topZone + 18);

      // ── Live waveform (bottom band) ──
      const analyser = audioEngine.getAnalyser();
      if (analyser) {
        const wf = analyser.getValue() as Float32Array;
        const n = wf.length;
        rctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = 56 + (i / (n - 1)) * (W - 112);
          const wy = H - bottomZone / 2 - 8 - wf[i] * 30;
          if (i === 0) rctx.moveTo(x, wy);
          else rctx.lineTo(x, wy);
        }
        rctx.strokeStyle = 'rgba(0, 255, 204, 0.75)';
        rctx.lineWidth = 3;
        rctx.shadowColor = 'rgba(0, 255, 204, 0.6)';
        rctx.shadowBlur = 10;
        rctx.stroke();
        rctx.shadowBlur = 0;

        // ── Level bars (cyan/magenta, follow volume) ──
        let sumSq = 0;
        for (let i = 0; i < n; i++) sumSq += wf[i] * wf[i];
        const rms = Math.sqrt(sumSq / n);
        for (let i = 0; i < 8; i++) {
          const hgt = Math.max(4, rms * 72 * (0.35 + 0.65 * (i / 8)));
          rctx.fillStyle = i % 2 === 0 ? 'rgba(0, 255, 204, 0.9)' : 'rgba(255, 0, 255, 0.75)';
          rctx.fillRect(W - 116 + i * 14, H - 56 - hgt, 8, hgt);
        }
      }

      // ── Domain URL: the traffic driver, bottom center, breathing ──
      const urlAlpha = 0.8 + 0.2 * Math.sin(t * 2.2 + 1);
      rctx.font = '600 21px "JetBrains Mono", monospace';
      rctx.textAlign = 'center';
      rctx.shadowColor = `rgba(0, 255, 204, ${0.5 * urlAlpha})`;
      rctx.shadowBlur = 12;
      rctx.fillStyle = `rgba(0, 255, 204, ${urlAlpha})`;
      rctx.fillText('gesturesynthweld.com', W / 2, H - 34);
      rctx.shadowBlur = 0;
    } else if (ratio === '1:1') {
      // 1:1 — blur-fill + simple centered HUD (bands are small)
      const ch = Math.round((W * sh) / sw);
      const dy = Math.round((H - ch) / 2);
      rctx.drawImage(src, 0, dy, W, ch);
      rctx.font = '800 30px Orbitron, monospace';
      rctx.textAlign = 'center';
      rctx.fillStyle = '#00ffcc';
      rctx.fillText(s.chordName || '—', W / 2, 88);
      rctx.font = '500 18px Inter, system-ui, sans-serif';
      rctx.fillStyle = '#a0a0d0';
      rctx.fillText(modeLabel, W / 2, 118);
      rctx.font = '600 18px "JetBrains Mono", monospace';
      rctx.fillStyle = 'rgba(0, 255, 204, 0.85)';
      rctx.fillText('gesturesynthweld.com', W / 2, H - 34);
    } else {
      // 16:9 — cover-fill (crop top/bottom — 4:3 source is taller) + HUD
      const ch = Math.round((W * sh) / sw);
      const dy = Math.round((H - ch) / 2);
      rctx.drawImage(src, 0, dy, W, ch);
      rctx.font = '700 26px Orbitron, monospace';
      rctx.textAlign = 'left';
      rctx.shadowColor = 'rgba(0, 255, 204, 0.6)';
      rctx.shadowBlur = 12;
      rctx.fillStyle = '#00ffcc';
      rctx.fillText(s.chordName || '—', 24, 44);
      rctx.shadowBlur = 0;
      rctx.font = '500 18px Inter, system-ui, sans-serif';
      rctx.fillStyle = '#a0a0d0';
      rctx.fillText(modeLabel, 24, 70);
      rctx.font = '600 16px "JetBrains Mono", monospace';
      rctx.textAlign = 'right';
      rctx.fillStyle = 'rgba(160, 160, 208, 0.7)';
      rctx.fillText('gesturesynthweld.com', W - 24, 44);
    }
  }, []);

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

      // B2: during recording, build the skeleton canvas (if needed) and
      // composite the recording frame at the chosen aspect ratio.
      if (recordingActiveRef.current) {
        const mode = recModeRef.current;
        if (mode === 'skeleton') {
          const sc = skeletonCanvasRef.current;
          if (sc) {
            if (sc.width !== canvas.width || sc.height !== canvas.height) {
              sc.width = canvas.width;
              sc.height = canvas.height;
            }
            const sctx = sc.getContext('2d');
            if (sctx) {
              sctx.fillStyle = '#0a0a1a';
              sctx.fillRect(0, 0, sc.width, sc.height);
              drawOverlayRef.current?.(sctx, sc.width, sc.height);
              const wf = waveformCanvasRef.current;
              if (wf) sctx.drawImage(wf, 0, 0, sc.width, sc.height);
            }
          }
        }
        drawRecFrame();
      }
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

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera access.');
      }

      // Download the model in parallel with the camera permission prompt
      // (prefetch may have already started it on button hover/touch)
      const trackingPromise = initHandTracking();
      trackingPromise.catch(() => {}); // errors surface via the await below

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

      // Wait for hand tracking before starting the detection loop
      await trackingPromise;
      await audioEngine.init();

      setIsRunning(true);
      setIsLoading(false);
    } catch (err: unknown) {
      console.error('Failed to start:', err);
      setIsLoading(false);

      if (isDomError(err, 'NotAllowedError')) {
        setError(isMobile
          ? 'Camera access was denied. On mobile, check your browser app permissions or system Settings > Privacy > Camera.'
          : 'Camera access was denied. Click the lock icon in the address bar to allow camera access.');
      } else if (isDomError(err, 'NotFoundError')) {
        setError(isMobile
          ? 'No camera found. Make sure your device has a front-facing camera and it is not in use by another app.'
          : 'No camera found. Connect a webcam and try again.');
      } else {
        const msg = getErrorMessage(err);
        if (msg.includes('support') || msg.includes('not supported')) {
          setError(isMobile
            ? 'Your browser does not support camera access. Try Chrome or Edge on Android, or Safari on iOS.'
            : 'Your browser does not support camera access. Try Chrome, Edge, or Firefox.');
        } else {
          setError(isMobile
            ? `Camera error: ${msg}. Try a different browser like Chrome or Safari.`
            : `Camera error: ${msg}. Check that your webcam is connected and not in use.`);
        }
      }
    }
  }, []);

  /* ─── Warm up hand tracking on button intent ───────────────────────── */

  // Starts the ~19 MB model + WASM download the moment the user shows
  // intent (hover / touch / focus on the Enable Camera button) so the
  // actual click has nothing left to wait for. Users who never approach
  // the button download nothing. Errors surface at startCamera.
  const prefetchTracking = useCallback(() => {
    initHandTracking().catch(() => {});
  }, []);

  const stopCamera = useCallback(() => {
    // Cancel any in-flight recording flow
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      recordingAbortedRef.current = true;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    // Discard any in-flight audio recording (Tone.Recorder) so a later
    // recording starts fresh
    audioEngine.stopRecording();
    setRecPhase('idle');
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
    pinkyMemoryRef.current = 0;

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    setGesture({ left: null, right: null });
    setHasLeftHand(false);
    setHasRightHand(false);
    setIsRunning(false);
    setSynthState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  /* ─── Recording (B2 flow: chooser → countdown → record → result) ───── */

  const downloadRec = useCallback(() => {
    if (!recBlob) return;
    const url = URL.createObjectURL(recBlob.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = recBlob.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Delay revocation to avoid Firefox download race
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }, [recBlob]);

  const shareRec = useCallback(async () => {
    if (!recBlob) return;
    try {
      await navigator.share({
        files: [new File([recBlob.blob], recBlob.filename)],
        title: 'Gesture Synth Weld',
      });
    } catch {
      // User cancelled the share sheet — nothing to do
    }
  }, [recBlob]);

  const canFileShare = !!recBlob &&
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' ||
      navigator.canShare({ files: [new File([recBlob.blob], recBlob.filename)] }));

  // Start the actual recording (audio via Tone.Recorder; video/skeleton via
  // MediaRecorder on the composited recording canvas + audio tap).
  const beginRecording = useCallback(() => {
    const mode = recModeRef.current;
    if (mode === 'audio') {
      if (!audioEngine.startRecording()) {
        setRecPhase('idle');
        return;
      }
    } else {
      // Skeleton mode composites an offscreen canvas: dark bg + skeleton +
      // waveform (no camera feed). Create/size it here so beginRecording
      // sees a valid source before the draw loop starts painting it.
      if (mode === 'skeleton') {
        const live = canvasRef.current;
        if (!live || !live.width) {
          setRecPhase('idle');
          return;
        }
        if (!skeletonCanvasRef.current) {
          skeletonCanvasRef.current = document.createElement('canvas');
        }
        skeletonCanvasRef.current.width = live.width;
        skeletonCanvasRef.current.height = live.height;
      }
      const srcCanvas = mode === 'skeleton' ? skeletonCanvasRef.current : canvasRef.current;
      if (!srcCanvas || !srcCanvas.width) {
        setRecPhase('idle');
        return;
      }
      const [rw, rh] = REC_RATIO_DIMS[recRatioRef.current];
      let rec = recCanvasRef.current;
      if (!rec) {
        rec = document.createElement('canvas');
        recCanvasRef.current = rec;
      }
      rec.width = rw;
      rec.height = rh;
      drawRecFrame(); // first paint before captureStream

      let stream: MediaStream;
      try {
        stream = new MediaStream(rec.captureStream(30).getVideoTracks());
        const aTrack = audioEngine.getRecordingAudioTrack();
        if (aTrack) stream.addTrack(aTrack);
      } catch {
        setRecPhase('idle');
        return;
      }
      const { mime } = pickRecMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: 3_000_000,
      });
      const finalMime = recorder.mimeType || mime || 'video/webm';
      const ext = finalMime.includes('mp4') ? 'mp4' : 'webm';
      recChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (recordingAbortedRef.current) {
          recordingAbortedRef.current = false;
          recChunksRef.current = [];
          return;
        }
        const blob = new Blob(recChunksRef.current, { type: finalMime.split(';')[0] || 'video/webm' });
        recChunksRef.current = [];
        setRecBlob({ blob, filename: makeRecordingFilename(ext) });
        setRecPhase('result');
      };
      recorder.start(500);
      mediaRecorderRef.current = recorder;
    }
    setIsRecording(true);
    recordingStartRef.current = Date.now();
    setRecPhase('recording');
  }, [drawRecFrame]);

  // 3-2-1 countdown before recording starts (time to get hands back up)
  const startCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setRecPhase('countdown');
    setRecCount(3);
    let n = 3;
    countdownTimerRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        beginRecording();
      } else {
        setRecCount(n);
      }
    }, 1000);
  }, [beginRecording]);

  // Stop recording and produce the result panel
  const finishRecording = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (recModeRef.current === 'audio') {
      audioEngine.stopRecording().then((blob) => {
        if (blob) {
          setRecBlob({ blob, filename: makeRecordingFilename('webm') });
          setRecPhase('result');
        } else {
          setRecPhase('idle');
        }
      });
    } else {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state === 'recording') {
        rec.stop();
      } else {
        setRecPhase('idle');
      }
    }
    setIsRecording(false);
    setRecordingTime(0);
    recordingStartRef.current = null;
  }, []);

  const finishRecordingRef = useRef<() => void>(() => {});
  finishRecordingRef.current = finishRecording;

  // Record button: idle → open chooser; recording → stop;
  // countdown/result phases ignore the button (use the panel buttons)
  const onRecordButton = useCallback(() => {
    if (!isRunning) return;
    if (isRecording) {
      finishRecording();
      return;
    }
    setRecPhase((p) => (p === 'choosing' ? 'idle' : p === 'idle' ? 'choosing' : p));
  }, [isRunning, isRecording, finishRecording]);

  const handleStartRecording = useCallback(() => {
    localStorage.setItem('gsw-rec-mode', recMode);
    localStorage.setItem('gsw-rec-ratio', recRatio);
    setRecPhase('idle'); // close the chooser
    startCountdown();
  }, [recMode, recRatio, startCountdown]);

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
    const timeout = setTimeout(() => {
      finishRecordingRef.current();
    }, 15000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isRecording]);

  /* ─── Render ───────────────────────────────────────────────────────── */

  const isCameraError = !!error;

  return (
    <div className="full-screen-app">
      {/* ─── Full-screen camera area ────────────────────────────────── */}
      <section className="camera-stage">
        <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
        <canvas ref={canvasRef} className="camera-canvas" />

        {/* ─── B2: capture-frame overlay — shows exactly what's recorded ── */}
        {(recPhase === 'countdown' || recPhase === 'recording') && recMode !== 'audio' && (
          <div className={`rec-frame-overlay ${recRatio === '1:1' ? 'ratio-1x1' : recRatio === '9:16' ? 'ratio-916' : ''}`}>
            {recRatio === '16:9' && <><div className="rec-strip top" /><div className="rec-strip bottom" /></>}
            <div className="rec-window" />
            <div className="rec-tag">REC {recRatio}</div>
          </div>
        )}

        {/* ─── Top Toolbar — always visible ─────────────────────────── */}
        <div style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', zIndex: 20 }}>
          <div className="frost-toolbar" style={{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', gap: '3px', padding: '6px 14px', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'visible' }}>
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
            <button className={`icon-btn ${showSkeleton ? 'active' : ''}`} onClick={() => setShowSkeleton(!showSkeleton)} data-tip="Hand skeleton — show/hide tracking lines" style={showSkeleton ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>✋</button>
            <span className="divider" />
            <button className={`icon-btn ${isRecording ? 'recording' : ''}`} onClick={onRecordButton} data-tip={isRecording ? `Recording ${recordingTime}s / 15s` : 'Record — audio, video or skeleton (max 15s)'}>{isRecording ? `${recordingTime}s` : '●'}</button>
            <button className="icon-btn" onClick={() => setShowSettings(!showSettings)} data-tip={showSettings ? 'Hide settings panel' : 'Show settings panel'} style={showSettings ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>⚙</button>
            <button className="icon-btn" onClick={() => setShowHelp(!showHelp)} data-tip="How to play — hand gesture guide" style={showHelp ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>?</button>
            <span className="divider" />
            <button className="icon-btn" onClick={stopCamera} data-tip="Stop camera and audio" style={{ color: 'var(--neon-magenta)' }}>■</button>
          </div>

          {/* Settings panel — only for Gesture mode */}
          {showSettings && synthState.appMode === 'gesture' && (
            <div className="frost-panel" style={{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', flexDirection: 'row', gap: '16px', padding: '16px 18px', maxWidth: '700px', fontSize: '0.65rem' }}>
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

        {/* ─── Help Modal ────────────────────────────────────────────── */}
        {showHelp && (
          <div style={{
            position: 'absolute', top: '12px', left: '12px', width: '360px',
            background: 'rgba(8, 8, 20, 0.85)', backdropFilter: 'var(--frost-blur)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px',
            padding: '14px 18px', boxShadow: 'var(--frost-shadow)', zIndex: 100,
            fontSize: '0.68rem', color: '#d0d0e8', lineHeight: 1.45,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.82rem', color: 'var(--neon-cyan)' }}>Quick Guide</span>
              <button onClick={() => setShowHelp(false)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '50%', width: '22px', height: '22px', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
              <thead>
                <tr style={{ color: '#a0a0c8', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)', width: '60px' }}>Fingers</th>
                  <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)', width: '40px' }}>Chord</th>
                  <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Gesture</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['1', 'I', '1 finger raised'],
                  ['2', 'II', '2 fingers raised'],
                  ['3', 'III', '3 fingers raised'],
                  ['4', 'IV', '4 fingers raised'],
                  ['5', 'V', '5 fingers raised'],
                  ['VI', 'VI', 'Index + Pinky'],
                  ['VII', 'VII', 'Idx + Pky + Thumb'],
                ].map(([fn, chord, gest]) => (
                  <tr key={fn} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '3px 0', fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 700, fontSize: '0.72rem' }}>{fn}</td>
                    <td style={{ padding: '3px 0', color: 'var(--neon-cyan)', fontWeight: 600 }}>{chord}</td>
                    <td style={{ padding: '3px 0', fontSize: '0.6rem' }}>{gest}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0', paddingTop: '6px', fontSize: '0.58rem', lineHeight: 1.6 }}>
              <span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left Hand</span> — Fingers = scale degree, wrist tilt = major / minor (Scale+Tilt mode)<br/>
              <span style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right Hand</span> — Height = volume, fingers = chord type<br/>
              <span style={{ color: '#b0b0d0' }}>Both hands required · Left fist mutes · Right fist continues · ⟿ Arp  ∿ Bass  ● Rec  ♪ Metronome</span>
            </div>

            <a href="#gesture-guide" onClick={() => setShowHelp(false)} style={{ color: 'var(--neon-cyan)', fontSize: '0.58rem', textDecoration: 'underline' }}>
              Full guide & tips below ↓
            </a>
          </div>
        )}

        {/* ─── B2: recording UI — chooser, countdown, result ──────────── */}

        {/* 3-2-1 countdown overlay */}
        {recPhase === 'countdown' && (
          <div className="countdown-overlay">
            <div className="countdown-hint">Get ready</div>
            <div key={recCount} className="countdown-num">{recCount}</div>
          </div>
        )}

        {/* Mode + ratio chooser (bottom sheet on mobile, card on desktop) */}
        {recPhase === 'choosing' && (
          <div className="rec-sheet">
            <div className="rec-sheet-title">Record performance</div>
            <div className="rec-sheet-sub">What should the recording capture?</div>
            <div className="rec-options">
              {(['video', 'skeleton', 'audio'] as RecMode[]).map((id) => (
                <button
                  key={id}
                  className={`rec-option ${recMode === id ? 'active' : ''} ${id !== 'audio' && !VIDEO_REC_SUPPORTED ? 'disabled' : ''}`}
                  onClick={() => { if (id === 'audio' || VIDEO_REC_SUPPORTED) setRecMode(id); }}
                >
                  {REC_SVG_PREVIEWS[id]}
                  <span>
                    <strong>{id === 'video' ? 'Full' : id === 'skeleton' ? 'Skeleton' : 'Audio only'}</strong>
                    <em>{id === 'video' ? 'Camera + neon skeleton — includes your face' : id === 'skeleton' ? 'Neon skeleton + waveform — no camera feed, privacy-friendly' : 'Music without any visuals'}</em>
                  </span>
                </button>
              ))}
            </div>
            {recMode !== 'audio' && (
              <>
                <div className="rec-sheet-sub">Aspect ratio</div>
                <div className="rec-ratios">
                  {(['9:16', '16:9', '1:1'] as RecRatio[]).map((r) => (
                    <button key={r} className={`rec-ratio-btn ${recRatio === r ? 'active' : ''}`} onClick={() => setRecRatio(r)}>{r}</button>
                  ))}
                </div>
                <div className="rec-ratio-hint">{REC_RATIO_HINTS[recRatio]}</div>
              </>
            )}
            {recMode !== 'audio' && !VIDEO_REC_SUPPORTED && (
              <div className="rec-warn">Video recording isn't supported in this browser — choose Audio only.</div>
            )}
            <div className="rec-actions">
              <button className="rec-btn" onClick={() => setRecPhase('idle')}>Cancel</button>
              <button className="rec-btn primary" onClick={handleStartRecording}>Start · 3s countdown</button>
            </div>
          </div>
        )}

        {/* Result panel: download (all), share (mobile via Web Share API) */}
        {recPhase === 'result' && recBlob && (
          <div className="rec-sheet">
            <div className="rec-sheet-title">✓ Recording ready</div>
            <div className="rec-sheet-sub">{recBlob.filename} · {(recBlob.blob.size / 1048576).toFixed(1)} MB</div>
            <div className="rec-actions">
              <button className="rec-btn" onClick={() => setRecPhase('idle')}>Close</button>
              <button className="rec-btn primary" onClick={downloadRec}>💾 Download</button>
              {canFileShare && <button className="rec-btn primary" onClick={shareRec}>📤 Share</button>}
            </div>
          </div>
        )}

        {/* ─── Hand tags on sides (running only) ─────────────────────── */}
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

        {/* ─── Dimmed overlay + Enable Camera button ───────────────── */}
        {!isRunning && !isLoading && !error && (
          <div className="camera-placeholder">
            <div className="camera-placeholder-brand">
              <span className="camera-placeholder-brand-text">Gesture Synth Weld</span>
            </div>
            <button
              className="enable-camera-btn"
              onClick={startCamera}
              disabled={isLoading}
              onMouseEnter={prefetchTracking}
              onFocus={prefetchTracking}
              onTouchStart={prefetchTracking}
            >
              <svg className="enable-camera-btn-icon" viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2H4zm10 1.5l3.5-2.25A.75.75 0 0118.5 5v10a.75.75 0 01-1 .69L14 13.5V6.5z" clipRule="evenodd" />
              </svg>
              <span>Enable Camera</span>
            </button>
            <p className="camera-placeholder-hint">Allow camera access to start playing with hand gestures</p>
          </div>
        )}

        {/* ─── Loading ───────────────────────────────────────────────── */}
        {isLoading && (
          <div className="loading-screen">
            <div className="spinner" />
            <p>Loading hand tracking model…</p>
          </div>
        )}

        {/* ─── Error (including camera denied) ───────────────────────── */}
        {error && (
          <div className="camera-placeholder error-state">
            <div className="camera-placeholder-brand">
              <span className="camera-placeholder-brand-text">Gesture Synth Weld</span>
            </div>
            <div className="camera-error-message">{error}</div>
            {isCameraError && (
              <div className="camera-error-guide">
                <div className="camera-error-guide-item">
                  <span className="camera-error-guide-label">iPhone / iPad</span>
                  Settings → Privacy &amp; Security → <strong>Camera</strong> → turn on your browser. Then reload.
                </div>
                <div className="camera-error-guide-item">
                  <span className="camera-error-guide-label">Android</span>
                  Settings → Apps → your browser → Permissions → <strong>Camera</strong> → Allow. Then reload.
                </div>
                <div className="camera-error-guide-item">
                  <span className="camera-error-guide-label">Mac</span>
                  System Settings → Privacy &amp; Security → <strong>Camera</strong> → turn on your browser. Then reload.
                </div>
                <div className="camera-error-guide-item">
                  <span className="camera-error-guide-label">Windows</span>
                  Settings → Privacy &amp; Security → <strong>Camera</strong> → Camera access: On → make sure your browser is allowed. Then reload.
                </div>
              </div>
            )}
            <button className="enable-camera-btn retry" onClick={startCamera}>Retry</button>
          </div>
        )}

        {/* ─── Running-state overlays ────────────────────────────────── */}
        {isRunning && (
          <>
            {/* Scale Guide - 8 blocks showing scale degrees */}
            {synthState.appMode === 'gesture' && (
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

            {/* Now playing note — prominent but transparent, centered */}
            {synthState.appMode === 'gesture' && synthState.isPlaying && (
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

            {/* Waveform visualization — shows whenever hands are active */}
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
                style={{ width: '100%', height: '100%' }}
              />
            </div>

          </>
        )}

        {/* ─── Status bar — always visible ──────────────────────────── */}
        {!isLoading && (
          <>
            {/* Bottom status bar */}
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

              {/* Metronome controls */}
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
          </>
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
