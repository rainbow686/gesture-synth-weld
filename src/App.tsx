import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initHandTracking,
  detectHands,
  HAND_CONNECTIONS,
} from './handTracker';
import { audioEngine, TIMBRE_OPTIONS, type TimbreType } from './audioEngine';
import {
  DIATONIC_CHORDS,
  getChordName,
} from './chords';
import {
  FINGER_TO_CHORD_INDEX,
  type GestureState,
  type HandData,
  type SynthState,
} from './types';
import { makeRecordingFilename } from './wavEncoder';

/* ─── Gesture Synth Weld — Full-Screen Layout ───────────────────────── */

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
  });
  const [isRecording, setIsRecording] = useState(false);
  const [hasLeftHand, setHasLeftHand] = useState(false);
  const [hasRightHand, setHasRightHand] = useState(false);
  const [currentTimbre, setCurrentTimbre] = useState<TimbreType>('piano');
  const [pianoLoaded, setPianoLoaded] = useState(false);
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);

  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;

  const synthRef = useRef(synthState);
  synthRef.current = synthState;

  /* ─── Initialize audio + load piano samples ─────────────────────────── */

  useEffect(() => {
    // Pre-load piano samples in background
    audioEngine.init().then(() => {
      audioEngine.loadPianoSamples(() => {
        setPianoLoaded(true);
      });
    });
  }, []);

  /* ─── Process Detected Hands ───────────────────────────────────────── */

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

    setGesture({ left: leftHand, right: rightHand });
    setHasLeftHand(!!leftHand);
    setHasRightHand(!!rightHand);

    const prev = synthRef.current;
    let chordIndex = prev.chordIndex;
    let mode: 'major' | 'minor' | 'neutral' = 'neutral';
    let volume = prev.volume;
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
      if (!leftHand) isPlaying = true;
    }

    const chordName = getChordName(chordIndex, mode === 'neutral' ? undefined : mode);

    const newSynth: SynthState = {
      chordIndex,
      chordName,
      volume,
      mode,
      isPlaying,
    };
    setSynthState(newSynth);

    if (isPlaying) {
      audioEngine.playChord(
        chordIndex,
        'sine', // waveform param kept for API compat
        mode === 'neutral' ? undefined : mode,
        rightHand ? Math.min(rightHand.fingerCount, 3) : 0,
      );
    } else {
      audioEngine.stopAll();
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

  /* ─── Start Camera ─────────────────────────────────────────────────── */

  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setKeyboardMode(false);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera access. Please use Chrome, Edge, or Firefox on HTTPS.');
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
        setError('Camera access was denied. Please allow camera permission in your browser settings and try again.');
      } else if (isDomError(err, 'NotFoundError')) {
        setError('No camera found. You can still use keyboard shortcuts.');
      } else if (isDomError(err, 'NotReadableError')) {
        setError('Camera is in use by another application. Please close it and try again.');
      } else {
        const msg = getErrorMessage(err);
        setError(`Failed to start: ${msg}`);
      }
    }
  }, []);

  /* ─── Keyboard Mode (no camera) ────────────────────────────────────── */

  const enterKeyboardMode = useCallback(() => {
    setKeyboardMode(true);
    setIsRunning(false);
    setError(null);
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
    } else {
      const ok = audioEngine.startRecording();
      if (ok) setIsRecording(true);
    }
  }, [isRecording]);

  /* ─── Timbre Switch ────────────────────────────────────────────────── */

  const switchTimbre = useCallback(async (timbre: TimbreType) => {
    await audioEngine.setTimbre(timbre);
    setCurrentTimbre(timbre);
  }, []);

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
          audioEngine.playChord(idx, 'sine', modeArg);
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const v = Math.min(1, synthRef.current.volume + 0.1);
        setSynthState((prev) => ({ ...prev, volume: v }));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const v = Math.max(0, synthRef.current.volume - 0.1);
        setSynthState((prev) => ({ ...prev, volume: v }));
        return;
      }

      if (e.key === 't' || e.key === 'T') {
        setSynthState((prev) => {
          const next = { ...prev, mode: 'major' as const };
          next.chordName = getChordName(prev.chordIndex, 'major');
          if (prev.isPlaying) audioEngine.playChord(prev.chordIndex, 'sine', 'major');
          return next;
        });
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        setSynthState((prev) => {
          const next = { ...prev, mode: 'minor' as const };
          next.chordName = getChordName(prev.chordIndex, 'minor');
          if (prev.isPlaying) audioEngine.playChord(prev.chordIndex, 'sine', 'minor');
          return next;
        });
        return;
      }

      // Q/W/E/R: timbre
      const timbreMap: Record<string, TimbreType> = { q: 'piano', w: 'strings', e: 'organ', r: 'synth' };
      const timbre = timbreMap[e.key.toLowerCase()];
      if (timbre) {
        switchTimbre(timbre);
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
  }, [switchTimbre]);

  /* ─── Cleanup ──────────────────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      audioEngine.stopAll();
    };
  }, []);

  /* ─── Render ───────────────────────────────────────────────────────── */

  const currentTimbreOption = TIMBRE_OPTIONS.find(t => t.id === currentTimbre) ?? TIMBRE_OPTIONS[0];

  return (
    <div className="full-screen-app">
      {/* ─── Full-screen camera / placeholder area ──────────────────── */}
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

        {/* Placeholder / Start screen */}
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

        {/* Keyboard mode placeholder */}
        {keyboardMode && (
          <div className="keyboard-mode-screen">
            <div className="keyboard-chord-display">
              <span className="keyboard-chord-name">{synthState.chordName}</span>
              <span className="keyboard-chord-roman">
                {DIATONIC_CHORDS[synthState.chordIndex]?.roman ?? '—'}
              </span>
            </div>
            <div className="keyboard-volume-bar">
              <div className="keyboard-volume-fill" style={{ width: `${synthState.volume * 100}%` }} />
            </div>
            <div className="keyboard-shortcuts-card">
              <h3>Keyboard Controls</h3>
              <div className="shortcut-grid">
                <div><kbd>1</kbd>-<kbd>7</kbd> Chords</div>
                <div><kbd>↑</kbd><kbd>↓</kbd> Volume</div>
                <div><kbd>T</kbd> Major <kbd>Y</kbd> Minor</div>
                <div><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> Timbre</div>
                <div><kbd>Space</kbd> Stop</div>
              </div>
            </div>
            <button className="back-to-camera-btn" onClick={startCamera}>
              ← Switch to camera mode
            </button>
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

        {/* ─── Floating Control Panel (desktop: top-left) ─────────── */}
        {(isRunning || keyboardMode) && (
          <>
            {/* Desktop panel */}
            <div className="floating-panel desktop-only">
              <div className="panel-section">
                <label className="panel-label">Timbre</label>
                <div className="timbre-selector">
                  {TIMBRE_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      className={`timbre-btn ${currentTimbre === opt.id ? 'active' : ''}`}
                      onClick={() => switchTimbre(opt.id)}
                      title={opt.label}
                    >
                      <span className="timbre-icon">{opt.icon}</span>
                      <span className="timbre-text">{opt.label}</span>
                    </button>
                  ))}
                </div>
                {!pianoLoaded && currentTimbre === 'piano' && (
                  <span className="loading-hint">Loading samples…</span>
                )}
              </div>

              <div className="panel-section">
                <label className="panel-label">Mode</label>
                <div className="mode-toggle">
                  <button
                    className={`mode-btn ${synthState.mode === 'major' ? 'active' : ''}`}
                    onClick={() => setSynthState(prev => ({ ...prev, mode: 'major', chordName: getChordName(prev.chordIndex, 'major') }))}
                  >
                    Major
                  </button>
                  <button
                    className={`mode-btn ${synthState.mode === 'minor' ? 'active' : ''}`}
                    onClick={() => setSynthState(prev => ({ ...prev, mode: 'minor', chordName: getChordName(prev.chordIndex, 'minor') }))}
                  >
                    Minor
                  </button>
                </div>
              </div>

              <div className="panel-section">
                <button
                  className={`record-btn ${isRecording ? 'recording' : ''}`}
                  onClick={toggleRecording}
                  title={isRecording ? 'Stop recording' : 'Start recording'}
                >
                  <span className="record-dot" />
                  {isRecording ? 'Stop' : 'Rec'}
                </button>
              </div>
            </div>

            {/* Mobile: toggle button */}
            <button
              className="mobile-panel-toggle mobile-only"
              onClick={() => setShowMobilePanel(!showMobilePanel)}
            >
              ⚙️
            </button>

            {/* Mobile drawer */}
            {showMobilePanel && (
              <div className="mobile-drawer mobile-only">
                <div className="drawer-header">
                  <span>Controls</span>
                  <button onClick={() => setShowMobilePanel(false)}>✕</button>
                </div>
                <div className="drawer-content">
                  <div className="panel-section">
                    <label className="panel-label">Timbre</label>
                    <div className="timbre-selector">
                      {TIMBRE_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          className={`timbre-btn ${currentTimbre === opt.id ? 'active' : ''}`}
                          onClick={() => switchTimbre(opt.id)}
                        >
                          <span className="timbre-icon">{opt.icon}</span>
                          <span className="timbre-text">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="panel-section">
                    <label className="panel-label">Mode</label>
                    <div className="mode-toggle">
                      <button
                        className={`mode-btn ${synthState.mode === 'major' ? 'active' : ''}`}
                        onClick={() => setSynthState(prev => ({ ...prev, mode: 'major', chordName: getChordName(prev.chordIndex, 'major') }))}
                      >
                        Major
                      </button>
                      <button
                        className={`mode-btn ${synthState.mode === 'minor' ? 'active' : ''}`}
                        onClick={() => setSynthState(prev => ({ ...prev, mode: 'minor', chordName: getChordName(prev.chordIndex, 'minor') }))}
                      >
                        Minor
                      </button>
                    </div>
                  </div>
                  <div className="panel-section">
                    <button
                      className={`record-btn ${isRecording ? 'recording' : ''}`}
                      onClick={toggleRecording}
                    >
                      <span className="record-dot" />
                      {isRecording ? 'Stop Rec' : 'Record'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── Title (top-right, subtle) ────────────────────────────── */}
        <div className="app-title">
          <span>Gesture Synth Weld</span>
        </div>

        {/* ─── Bottom status bar ────────────────────────────────────── */}
        {(isRunning || keyboardMode) && (
          <div className="status-bar-bottom">
            <div className="status-chord">
              🎵 {synthState.chordName}
              <span className="status-roman">
                {DIATONIC_CHORDS[synthState.chordIndex]?.roman ?? ''}
              </span>
            </div>
            <div className="status-volume">
              <span className="status-label">Vol</span>
              <div className="status-volume-track">
                <div className="status-volume-fill" style={{ width: `${synthState.volume * 100}%` }} />
              </div>
            </div>
            <div className="status-timbre">
              {currentTimbreOption.icon} {currentTimbreOption.label}
            </div>
          </div>
        )}
      </section>

      {/* ─── Stop button (floating) ───────────────────────────────── */}
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
