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
import { audioBufferToWav, makeRecordingFilename } from './wavEncoder';

/* ─── Gesture Synth Weld — Main Application ────────────────────────── */

export default function App() {
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number>(0);
  const lastDetectRef = useRef<number>(0);
  const isDetectingRef = useRef(false);

  // State
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

  // Gesture state ref for use in animation loop
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;

  const synthStateRef = useRef(synthState);
  synthStateRef.current = synthState;

  /* ─── Start / Stop Camera ──────────────────────────────────────────── */

  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Initialize hand tracking model
      await initHandTracking();

      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      // Set up video element
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      await video.play();

      // Initialize audio context (must be triggered by user gesture)
      await audioEngine.init();
      audioEngine.setVolume(synthStateRef.current.volume);

      setIsRunning(true);
      setIsLoading(false);

      // Start the render/detect loop
      startLoop(video);
    } catch (err: any) {
      console.error('Failed to start:', err);
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera access was denied. Please allow camera permission and try again.'
          : err.name === 'NotFoundError'
          ? 'No camera found. You can still use keyboard shortcuts (1-7 for chords, ↑↓ for volume).'
          : `Failed to start: ${err.message}`
      );
      setIsLoading(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    // Stop render loop
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }

    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Stop audio
    audioEngine.stopAll();

    // Clear canvas
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

  /* ─── Render & Detection Loop ──────────────────────────────────────── */

  const startLoop = useCallback((video: HTMLVideoElement) => {
    const loop = async (timestamp: number) => {
      rafIdRef.current = requestAnimationFrame(loop);

      // Draw video to canvas (mirrored)
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas resolution
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
      }

      // Draw mirrored video
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      // Semi-transparent overlay for cyberpunk feel
      ctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Run hand detection (throttled to ~30fps)
      if (!isDetectingRef.current && timestamp - lastDetectRef.current > 33) {
        lastDetectRef.current = timestamp;
        isDetectingRef.current = true;

        try {
          const hands = detectHands(video, timestamp);
          processHands(hands);
        } catch {
          // Ignore detection errors on individual frames
        } finally {
          isDetectingRef.current = false;
        }
      }

      // Draw gesture data on canvas
      drawGestureOverlay(ctx, canvas.width, canvas.height, gestureRef.current);

      // Draw analyser
      drawAnalyser();
    };

    rafIdRef.current = requestAnimationFrame(loop);
  }, []);

  /* ─── Process Detected Hands ───────────────────────────────────────── */

  const processHands = useCallback((hands: HandData[]) => {
    let leftHand: HandData | null = null;
    let rightHand: HandData | null = null;

    for (const hand of hands) {
      // MediaPipe reports "Left" for the camera-mirrored left hand
      // When mirroring on canvas, we flip — so "Left" label = user's right hand visually
      // But we want: left hand in the mirror → left hand control
      // Since we mirror the canvas, the hand on the LEFT side of the image
      // is the user's RIGHT hand. MediaPipe's "Left" means the model's left
      // which corresponds to the user's right hand (because camera is mirrored).
      //
      // To make it intuitive: hand on left side of screen = left hand control
      // So we use x-position instead of MediaPipe's handedness label:
      if (hand.positionX > 0.5) {
        // Hand is on the right side of the raw image = left side of the mirrored view
        leftHand = hand;
      } else {
        rightHand = hand;
      }
    }

    const newGesture: GestureState = { left: leftHand, right: rightHand };
    setGesture(newGesture);
    setHasLeftHand(!!leftHand);
    setHasRightHand(!!rightHand);

    // Determine synth parameters
    let chordIndex = synthStateRef.current.chordIndex;
    let mode: 'major' | 'minor' | 'neutral' = 'neutral';
    let volume = synthStateRef.current.volume;
    let waveform: WaveformType = synthStateRef.current.waveform;
    let isPlaying = false;

    // Left hand → chord selection
    if (leftHand) {
      const fingers = leftHand.fingerCount;
      chordIndex = FINGER_TO_CHORD_INDEX[fingers] ?? 0;

      // Wrist tilt → major/minor
      const tilt = leftHand.tiltAngle;
      const tiltThreshold = 0.15; // ~8.5 degrees
      if (tilt > tiltThreshold) {
        mode = 'major';
      } else if (tilt < -tiltThreshold) {
        mode = 'minor';
      } else {
        mode = 'neutral';
      }

      isPlaying = true;
    }

    // Right hand → volume + timbre
    if (rightHand) {
      // Volume: higher hand (lower Y) = louder
      // Y is 0 at top, 1 at bottom. Map: y=0.1 → vol=1.0, y=0.9 → vol=0.05
      const normalizedY = rightHand.positionY;
      volume = Math.max(0.02, Math.min(1.0, 1.1 - normalizedY));

      // Finger count → waveform
      waveform = FINGER_TO_WAVEFORM[rightHand.fingerCount] ?? 'sawtooth';

      if (!leftHand) isPlaying = true; // Right hand alone also plays (theremin-like)
    }

    const chordName = getChordName(chordIndex, mode === 'neutral' ? undefined : mode);
    const timbreLabel = TIMBRE_LABELS[waveform];

    // Update synth state
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

    // Apply to audio engine
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
  }, []);

  /* ─── Canvas Drawing ───────────────────────────────────────────────── */

  const drawGestureOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, state: GestureState) => {
      // Draw left hand skeleton (cyan)
      if (state.left) {
        drawHandSkeleton(ctx, state.left, w, h, '#00ffcc', 'rgba(0,255,204,0.4)');
      }
      // Draw right hand skeleton (magenta)
      if (state.right) {
        drawHandSkeleton(ctx, state.right, w, h, '#ff00ff', 'rgba(255,0,255,0.4)');
      }
    },
    [],
  );

  const drawAnalyser = useCallback(() => {
    const canvas = analyserCanvasRef.current;
    const analyser = audioEngine.getAnalyser();
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== canvas.clientWidth * 2 || canvas.height !== canvas.clientHeight * 2) {
      canvas.width = canvas.clientWidth * 2;
      canvas.height = canvas.clientHeight * 2;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 6;
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
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
      // Number keys 1-7: select chord
      if (e.key >= '1' && e.key <= '7') {
        const idx = parseInt(e.key) - 1;
        const chordName = getChordName(idx, synthStateRef.current.mode === 'neutral' ? undefined : synthStateRef.current.mode as 'major' | 'minor');
        setSynthState((prev) => ({ ...prev, chordIndex: idx, chordName, isPlaying: true }));
        audioEngine.playChord(
          idx,
          synthStateRef.current.waveform,
          synthStateRef.current.mode === 'neutral' ? undefined : synthStateRef.current.mode as 'major' | 'minor',
        );
        return;
      }

      // Arrow up/down: volume
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newVol = Math.min(1, synthStateRef.current.volume + 0.1);
        audioEngine.setVolume(newVol);
        setSynthState((prev) => ({ ...prev, volume: newVol }));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newVol = Math.max(0, synthStateRef.current.volume - 0.1);
        audioEngine.setVolume(newVol);
        setSynthState((prev) => ({ ...prev, volume: newVol }));
        return;
      }

      // T/Y: major/minor
      if (e.key === 't' || e.key === 'T') {
        setSynthState((prev) => ({ ...prev, mode: 'major' }));
        if (synthStateRef.current.isPlaying) {
          audioEngine.playChord(synthStateRef.current.chordIndex, synthStateRef.current.waveform, 'major');
          setSynthState((prev) => ({
            ...prev,
            chordName: getChordName(prev.chordIndex, 'major'),
          }));
        }
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        setSynthState((prev) => ({ ...prev, mode: 'minor' }));
        if (synthStateRef.current.isPlaying) {
          audioEngine.playChord(synthStateRef.current.chordIndex, synthStateRef.current.waveform, 'minor');
          setSynthState((prev) => ({
            ...prev,
            chordName: getChordName(prev.chordIndex, 'minor'),
          }));
        }
        return;
      }

      // Q/W/E/R: waveform
      const waveformMap: Record<string, WaveformType> = { q: 'sine', w: 'triangle', e: 'sawtooth', r: 'square' };
      if (waveformMap[e.key.toLowerCase()]) {
        const wf = waveformMap[e.key.toLowerCase()];
        audioEngine.setWaveform(wf);
        setSynthState((prev) => ({ ...prev, waveform: wf, timbreLabel: TIMBRE_LABELS[wf] }));
        return;
      }

      // Space: stop all
      if (e.key === ' ') {
        e.preventDefault();
        audioEngine.stopAll();
        setSynthState((prev) => ({ ...prev, isPlaying: false }));
        return;
      }

      // Escape: release keyboard-held notes
      if (e.key === 'Escape') {
        audioEngine.stopAll();
        setSynthState((prev) => ({ ...prev, isPlaying: false, mode: 'neutral' }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* ─── Cleanup ──────────────────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      audioEngine.stopAll();
    };
  }, []);

  /* ─── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="synth-container">
      {/* Camera + Feedback */}
      <div className="camera-section">
        {/* Camera */}
        <div className="camera-wrapper">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />

          {/* Hand tags */}
          {isRunning && (
            <div className="hand-label-overlay">
              {hasLeftHand && <span className="hand-tag left">L</span>}
              {hasRightHand && <span className="hand-tag right">R</span>}
            </div>
          )}

          {/* Placeholder */}
          {!isRunning && !isLoading && !error && (
            <div className="camera-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <h3>Camera Ready</h3>
              <p>Click <strong>Start</strong> below to enable your camera and begin playing with hand gestures.</p>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="loading-overlay">
              <div className="spinner" />
            </div>
          )}

          {/* Error */}
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
              <div
                className="volume-meter-fill"
                style={{ width: `${synthState.volume * 100}%` }}
              />
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

          {/* Waveform analyser */}
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

      {/* Keyboard shortcut hints */}
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

/**
 * Draw a hand's skeleton on the canvas.
 * Landmarks are in normalized coordinates (0-1).
 * The canvas is already mirrored, so we mirror the X when drawing.
 */
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

  // Convert normalized coords to canvas coords (mirrored X)
  const toCanvas = (lm: { x: number; y: number }) => ({
    x: (1 - lm.x) * canvasW, // Mirror X
    y: lm.y * canvasH,
  });

  // Draw connections
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

  // Draw landmark points
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
