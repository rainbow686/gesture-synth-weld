import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initHandTracking,
  detectHands,
  HAND_CONNECTIONS,
} from './handTracker';
import { audioEngine } from './audioEngine';
import {
  DIATONIC_CHORDS,
  getChordName,
} from './chords';
import {
  FINGER_TO_CHORD_INDEX,
  FINGER_TO_WAVEFORM,
  TIMBRE_LABELS,
  type GestureState,
  type HandData,
  type SynthState,
  type WaveformType,
} from './types';
import { makeRecordingFilename } from './wavEncoder';

/* ─── Gesture Synth Weld — Main Application ────────────────────────── */

/** Helper: extract a readable error message from any thrown value */
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

/** Helper: check if error has a specific DOMException name */
function isDomError(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

export default function App() {
  /* ─── Refs ──────────────────────────────────────────────────────────── */

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserCanvasRef = useRef<HTMLCanvasElement>(null);
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
    waveform: 'sawtooth',
    timbreLabel: 'Bright Saw',
    mode: 'neutral',
    isPlaying: false,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [hasLeftHand, setHasLeftHand] = useState(false);
  const [hasRightHand, setHasRightHand] = useState(false);

  // Refs for values accessed inside the animation loop
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;

  const synthRef = useRef(synthState);
  synthRef.current = synthState;

  /* ─── Process Detected Hands ───────────────────────────────────────── */

  /** Pure function — called from inside the animation loop via ref */
  const processHandsRef = useRef<(hands: HandData[]) => void>();
  processHandsRef.current = (hands: HandData[]) => {
    let leftHand: HandData | null = null;
    let rightHand: HandData | null = null;

    for (const hand of hands) {
      // Hand on the right side of the raw image = left side of the mirrored view
      // → that's the user's left hand
      if (hand.positionX > 0.5) {
        leftHand = hand;
      } else {
        rightHand = hand;
      }
    }

    setGesture({ left: leftHand, right: rightHand });
    setHasLeftHand(!!leftHand);
    setHasRightHand(!!rightHand);

    const prev = synthRef.current;
    let chordIndex = prev.chordIndex;
    let mode: 'major' | 'minor' | 'neutral' = 'neutral';
    let volume = prev.volume;
    let waveform: WaveformType = prev.waveform;
    let isPlaying = false;

    if (leftHand) {
      const fingers = leftHand.fingerCount;
      chordIndex = FINGER_TO_CHORD_INDEX[fingers] ?? 0;

      const tilt = leftHand.tiltAngle;
      const tiltThreshold = 0.15;
      if (tilt > tiltThreshold) mode = 'major';
      else if (tilt < -tiltThreshold) mode = 'minor';
      else mode = 'neutral';

      isPlaying = true;
    }

    if (rightHand) {
      const normalizedY = rightHand.positionY;
      volume = Math.max(0.02, Math.min(1.0, 1.1 - normalizedY));
      waveform = FINGER_TO_WAVEFORM[rightHand.fingerCount] ?? 'sawtooth';
      if (!leftHand) isPlaying = true;
    }

    const chordName = getChordName(chordIndex, mode === 'neutral' ? undefined : mode);
    const timbreLabel = TIMBRE_LABELS[waveform];

    const newSynth: SynthState = {
      chordIndex,
      chordName,
      volume,
      waveform,
      timbreLabel,
      mode,
      isPlaying,
    };
    setSynthState(newSynth);

    audioEngine.setVolume(volume);
    audioEngine.setWaveform(waveform);

    if (isPlaying) {
      audioEngine.playChord(
        chordIndex,
        waveform,
        mode === 'neutral' ? undefined : mode,
        rightHand ? Math.min(rightHand.fingerCount, 3) : 0,
      );
    } else {
      audioEngine.stopAll();
    }
  };

  /* ─── Draw helpers (refs so the loop always sees latest) ──────────── */

  const drawOverlayRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>();
  drawOverlayRef.current = (ctx, w, h) => {
    const g = gestureRef.current;
    if (g.left) drawHandSkeleton(ctx, g.left, w, h, '#00ffcc', 'rgba(0,255,204,0.4)');
    if (g.right) drawHandSkeleton(ctx, g.right, w, h, '#ff00ff', 'rgba(255,0,255,0.4)');
  };

  const drawAnalyserRef = useRef<() => void>();
  drawAnalyserRef.current = () => {
    const canvas = analyserCanvasRef.current;
    const analyser = audioEngine.getAnalyser();
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== canvas.clientWidth * 2 || canvas.height !== canvas.clientHeight * 2) {
      canvas.width = canvas.clientWidth * 2;
      canvas.height = canvas.clientHeight * 2;
    }

    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(data);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 6;
    ctx.beginPath();

    const slice = canvas.width / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = data[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  /* ─── Animation loop (single effect, cleanup on stop) ─────────────── */

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

      // Mirrored video
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      // Cyberpunk overlay
      ctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Hand detection (throttled ~30fps)
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
      drawAnalyserRef.current?.();
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      runningRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    };
  }, [isRunning]);

  /* ─── Start Camera ─────────────────────────────────────────────────── */

  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Check browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'Your browser does not support camera access. Please use Chrome, Edge, or Firefox on HTTPS.'
        );
      }

      // 2. Init hand tracking model (downloads ~5MB WASM)
      setIsLoading(true);
      await initHandTracking();

      // 3. Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      // 4. Set up video element
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
          const mediaErr = video.error;
          reject(new Error(
            mediaErr
              ? `Video error (code ${mediaErr.code}): ${mediaErr.message || 'unknown'}`
              : 'Video element error'
          ));
        };
        setTimeout(() => {
          video.onloadedmetadata = null;
          video.onerror = null;
          reject(new Error('Video loading timed out after 10 seconds'));
        }, 10000);
      });

      // video.play() can reject with an Event object in some browsers
      try {
        await video.play();
      } catch (playErr) {
        throw new Error(`Video playback failed: ${getErrorMessage(playErr)}`);
      }

      // 5. Init audio context (user gesture context)
      await audioEngine.init();
      audioEngine.setVolume(synthRef.current.volume);

      // 6. Go!
      setIsRunning(true);
      setIsLoading(false);
    } catch (err: unknown) {
      console.error('Failed to start:', err);
      setIsLoading(false);

      if (isDomError(err, 'NotAllowedError')) {
        setError('Camera access was denied. Please allow camera permission in your browser settings and try again.');
      } else if (isDomError(err, 'NotFoundError')) {
        setError('No camera found. You can still use keyboard shortcuts (1-7 for chords, ↑↓ for volume).');
      } else if (isDomError(err, 'NotReadableError')) {
        setError('Camera is in use by another application. Please close it and try again.');
      } else if (isDomError(err, 'NotAllowedError') || isDomError(err, 'SecurityError')) {
        setError('Camera access blocked. Make sure you are on HTTPS and have granted permission.');
      } else {
        const msg = getErrorMessage(err);
        setError(`Failed to start: ${msg}`);
      }
    }
  }, []);

  /* ─── Stop Camera ──────────────────────────────────────────────────── */

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
    } else {
      const ok = audioEngine.startRecording();
      if (ok) setIsRecording(true);
    }
  }, [isRecording]);

  /* ─── Keyboard Shortcuts ───────────────────────────────────────────── */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '7') {
        const idx = parseInt(e.key) - 1;
        const s = synthRef.current;
        const modeArg = s.mode === 'neutral' ? undefined : s.mode as 'major' | 'minor';
        const chordName = getChordName(idx, modeArg);
        setSynthState((prev) => ({ ...prev, chordIndex: idx, chordName, isPlaying: true }));
        audioEngine.init().then(() => {
          audioEngine.playChord(idx, s.waveform, modeArg);
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const v = Math.min(1, synthRef.current.volume + 0.1);
        audioEngine.setVolume(v);
        setSynthState((prev) => ({ ...prev, volume: v }));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const v = Math.max(0, synthRef.current.volume - 0.1);
        audioEngine.setVolume(v);
        setSynthState((prev) => ({ ...prev, volume: v }));
        return;
      }

      if (e.key === 't' || e.key === 'T') {
        setSynthState((prev) => {
          const next = { ...prev, mode: 'major' as const };
          next.chordName = getChordName(prev.chordIndex, 'major');
          if (prev.isPlaying) audioEngine.playChord(prev.chordIndex, prev.waveform, 'major');
          return next;
        });
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        setSynthState((prev) => {
          const next = { ...prev, mode: 'minor' as const };
          next.chordName = getChordName(prev.chordIndex, 'minor');
          if (prev.isPlaying) audioEngine.playChord(prev.chordIndex, prev.waveform, 'minor');
          return next;
        });
        return;
      }

      const wfMap: Record<string, WaveformType> = { q: 'sine', w: 'triangle', e: 'sawtooth', r: 'square' };
      const wf = wfMap[e.key.toLowerCase()];
      if (wf) {
        audioEngine.setWaveform(wf);
        setSynthState((prev) => ({ ...prev, waveform: wf, timbreLabel: TIMBRE_LABELS[wf] }));
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        audioEngine.stopAll();
        setSynthState((prev) => ({ ...prev, isPlaying: false }));
        return;
      }

      if (e.key === 'Escape') {
        audioEngine.stopAll();
        setSynthState((prev) => ({ ...prev, isPlaying: false, mode: 'neutral' }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* ─── Cleanup on unmount ───────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      audioEngine.stopAll();
    };
  }, []);

  /* ─── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="synth-container">
      <div className="camera-section">
        {/* Camera */}
        <div className="camera-wrapper">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />

          {isRunning && (
            <div className="hand-label-overlay">
              {hasLeftHand && <span className="hand-tag left">L</span>}
              {hasRightHand && <span className="hand-tag right">R</span>}
            </div>
          )}

          {!isRunning && !isLoading && !error && (
            <div className="camera-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <h3>Camera Ready</h3>
              <p>Click <strong>Start</strong> below to enable your camera and begin playing with hand gestures.</p>
            </div>
          )}

          {isLoading && (
            <div className="loading-overlay">
              <div style={{ textAlign: 'center' }}>
                <div className="spinner" />
                <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.85rem' }}>
                  Loading hand tracking model…
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="camera-placeholder">
              <div className="error-message" style={{ width: '100%' }}>
                {error}
              </div>
            </div>
          )}
        </div>

        {/* Feedback Panel */}
        <div className="feedback-panel">
          <div className="feedback-item">
            <span className="feedback-label">Chord</span>
            <span className="feedback-value">{synthState.chordName}</span>
          </div>

          <div className="feedback-item">
            <span className="feedback-label">Roman Numeral</span>
            <span className="feedback-value magenta">
              {DIATONIC_CHORDS[synthState.chordIndex]?.roman ?? '—'}
            </span>
          </div>

          <div className="feedback-item">
            <span className="feedback-label">Mode</span>
            <span className="feedback-value purple">
              {synthState.mode === 'major' ? 'Major' : synthState.mode === 'minor' ? 'Minor' : '—'}
            </span>
          </div>

          <div className="feedback-item">
            <span className="feedback-label">Volume</span>
            <div className="volume-meter">
              <div className="volume-meter-fill" style={{ width: `${synthState.volume * 100}%` }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {Math.round(synthState.volume * 100)}%
            </span>
          </div>

          <div className="feedback-item">
            <span className="feedback-label">Timbre</span>
            <span className="feedback-value amber" style={{ fontSize: '1.2rem' }}>
              {synthState.timbreLabel}
            </span>
          </div>

          <div className="feedback-item">
            <span className="feedback-label">Waveform</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {synthState.waveform}
            </span>
          </div>

          <div className="analyser-wrapper">
            <canvas ref={analyserCanvasRef} />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="controls-bar">
        <div className="status-bar">
          <span className={`status-dot ${isRunning ? 'active' : ''}`} />
          {isRunning ? 'Tracking' : 'Idle'}
        </div>

        {!isRunning ? (
          <button className="btn btn-primary" onClick={startCamera} disabled={isLoading}>
            {isLoading ? 'Loading…' : '▶ Start'}
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stopCamera}>
            ■ Stop
          </button>
        )}

        <button
          className={`btn btn-record ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecording}
          disabled={!isRunning}
        >
          {isRecording ? 'Stop Rec' : '● Record'}
        </button>
      </div>

      <div className="keyboard-hint">
        <strong>Keyboard:</strong>{' '}
        <kbd>1</kbd>-<kbd>7</kbd> chords &nbsp;|&nbsp;
        <kbd>↑</kbd><kbd>↓</kbd> volume &nbsp;|&nbsp;
        <kbd>T</kbd> major &nbsp;
        <kbd>Y</kbd> minor &nbsp;|&nbsp;
        <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> waveform &nbsp;|&nbsp;
        <kbd>Space</kbd> stop
      </div>
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
