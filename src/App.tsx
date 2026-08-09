import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  initHandTracking,
  prefetchModel,
} from './handTracker';
import { audioEngine, type VocalPolish } from './audioEngine';
import { CameraSource } from './input/cameraSource';
import type { HandFrame } from './input/types';
import {
  roundRectPath,
  drawUrlPill,
  drawMetalBrand,
  DEGREE_COLORS,
  drawChordHud,
  drawChordText,
  drawStageBackground,
  drawHandSkeleton,
} from './hud/draw';
import {
  DIATONIC_CHORDS,
  KEYS,
  getChordName,
  getChordParts,
  chordNoteCount,
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
import { HAND_ART } from './handArt';
import { injectBrandTags } from './mp4tags';
import {
  initTrafficSource,
  trackCameraClicked,
  trackLoadingScreenVisible,
  trackCameraPermission,
  trackCameraStartFailed,
  trackDownload,
  trackFirstGesture,
  trackHelpButtonClicked,
  trackPageEngaged,
  trackRecording,
  trackRecordingModeChanged,
  trackRecordingViewed,
  trackScrollToPlaybook,
  trackSettingChanged,
  trackShare,
  trackRecordButtonClicked,
  trackMicToggled,
  trackWatchdogTriggered,
} from './analytics';
import { AFFILIATE_CARD_URL, ENABLE_AFFILIATE_CARD } from './config';
// Config imports removed — external scripts feature not currently active

/* ─── Gesture Synth Weld — Two-Hand Division System ─────────────────── */

/* ─── B2: Recording constants & helpers (module level, pure) ────────── */

/** Max recording length in seconds (2026-08-09: 15 → 30, growth plan P0). */
const RECORD_SECONDS = 30;

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

/** Square cover art for audio files — the site's visual family:
 * dark cosmos background, neon sound-wave mark (cyan arcs + magenta
 * note dot — the two-hand colors), metal brand, decorative waveform,
 * URL pill, neon inner frame. */
function makeCoverBlob(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 600;
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.resolve(new Blob());

  // background: the site's dark cosmos + footlight
  drawStageBackground(ctx, 600, 600);

  // neon inner frame (liquid-glass container)
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.28)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, 26, 26, 548, 548, 24);
  ctx.stroke();

  // sound-wave mark: three cyan arcs + magenta note dot
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i === 1 ? 'rgba(0, 255, 204, 0.9)' : 'rgba(0, 255, 204, 0.5)';
    ctx.lineWidth = i === 1 ? 3.5 : 2.5;
    ctx.beginPath();
    ctx.arc(300, 162, 30 + i * 13, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff6ec7';
  ctx.shadowColor = 'rgba(255, 110, 199, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(300, 152, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // brand: metal wordmark centered — auto-shrink so it never touches the edges
  // (target width = 80% of the canvas, leaving breathing room on both sides)
  const text = 'GESTURE SYNTH WELD';
  let size = 44;
  ctx.font = `800 ${size}px Orbitron, monospace`;
  ctx.textAlign = 'center';
  const targetW = 480;
  const measureW = ctx.measureText(text).width;
  if (measureW > targetW) {
    size = Math.floor(size * (targetW / measureW));
    ctx.font = `800 ${size}px Orbitron, monospace`;
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillText(text, 300, 306);
  const g = ctx.createLinearGradient(0, 304 - size, 0, 310);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#d8ecff');
  g.addColorStop(0.5, '#7fb8e8');
  g.addColorStop(0.7, '#eef8ff');
  g.addColorStop(1, '#a8cde8');
  ctx.fillStyle = g;
  ctx.fillText(text, 300, 304);

  // decorative waveform under the brand (music feel)
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const x = 110 + (i / 48) * 380;
    const y = 400 + Math.sin((i / 48) * Math.PI * 4) * 14;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // URL pill centered
  drawUrlPill(ctx, 300, 478, 24, true);

  return new Promise((res) => c.toBlob((b) => res(b ?? new Blob()), 'image/jpeg', 0.85));
}

/** Pick the best MediaRecorder mime type (mp4/m4a preferred, webm fallback). */
function pickRecMimeType(audioOnly: boolean = false): { mime: string; ext: string } {
  const candidates: [string, string][] = audioOnly
    ? [
        ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
        ['audio/mp4', 'm4a'],
        ['audio/webm;codecs=opus', 'webm'],
        ['audio/webm', 'webm'],
      ]
    : [
        ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
        ['video/mp4', 'mp4'],
        ['video/webm;codecs=vp9,opus', 'webm'],
        ['video/webm;codecs=vp8,opus', 'webm'],
        ['video/webm', 'webm'],
      ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: audioOnly ? 'webm' : 'webm' };
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
  // Adaptive detection interval (ms): raised on weak devices so the main
  // thread stays responsive for interactions (INP); 33ms = 30fps baseline.
  const detectIntervalRef = useRef<number>(33);
  const runningRef = useRef(false);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  // Waveform color state (RGB, lerped toward the current degree's hue).
  const degreeColorRef = useRef({ r: 0, g: 255, b: 204 });

  /* ─── State ─────────────────────────────────────────────────────────── */

  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<GestureState>({ left: null, right: null });
  const [synthState, setSynthState] = useState<SynthState>({
    chordIndex: 0,
    chordName: 'C',
    chordBase: 'C',
    chordExt: '',
    octaveDown: false,
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
  // Default: skeleton video (share-ready, privacy-friendly) where the
  // platform supports it; audio otherwise (iOS Safari lacks captureStream).
  // A saved choice always wins.
  const [recMode, setRecMode] = useState<RecMode>(() => {
    const saved = localStorage.getItem('gsw-rec-mode') as RecMode | null;
    if (saved === 'audio' || saved === 'video' || saved === 'skeleton') return saved;
    return VIDEO_REC_SUPPORTED ? 'skeleton' : 'audio';
  });
  // Whether this player has ever recorded (i.e. made a choice) — the
  // "default" tag in the chooser is only meaningful before that.
  let savedRecModeExists = false;
  try { savedRecModeExists = !!localStorage.getItem('gsw-rec-mode'); } catch { /* private mode */ }
  const [recRatio, setRecRatio] = useState<RecRatio>(() => (localStorage.getItem('gsw-rec-ratio') as RecRatio) || '9:16');
  const [recCount, setRecCount] = useState(3);
  const [endCount, setEndCount] = useState<number | null>(null); // 3-2-1 wrap-up overlay (last 3s)
  const [recBlob, setRecBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  // Result preview: play the take back IN-PAGE (Blob URL — memory only, no
  // server) so the player watches before deciding to download/share. The
  // object URL is revoked when the preview unmounts or the blob changes.
  const recPreviewUrl = useMemo(() => {
    if (!recBlob) return null;
    return URL.createObjectURL(recBlob.blob);
  }, [recBlob]);
  useEffect(() => {
    return () => {
      if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
    };
  }, [recPreviewUrl]);
  const [shareFailed, setShareFailed] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [micPermState, setMicPermState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [recVoice, setRecVoice] = useState(() => Number(localStorage.getItem('gsw-rec-voice')) || 1.3);
  // Vocal polish (recording-only voice effects): off/light/standard/strong.
  // Saved choice wins; 'standard' is the industry-chain default.
  const [recPolish, setRecPolish] = useState<VocalPolish>(() => {
    const saved = localStorage.getItem('gsw-rec-polish');
    if (saved === 'off' || saved === 'light' || saved === 'standard' || saved === 'strong') return saved;
    return 'standard';
  });
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  const recVoiceRef = useRef(1.3);
  const micOnRef = useRef(true);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micRetriedRef = useRef(false);

  // Reflect Chrome's mic permission state (used to give the right
  // guidance: prompt → we can ask again; denied → only the browser's
  // site settings can restore it).
  const updateMicPermState = useCallback(() => {
    if (typeof navigator.permissions?.query !== 'function') {
      setMicPermState('prompt');
      return;
    }
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => setMicPermState(s.state as 'granted' | 'denied' | 'prompt'))
      .catch(() => setMicPermState('prompt'));
  }, []);

  // Request the microphone (camera start + the chooser's "Enable
  // microphone" button — for first-time users who denied it earlier).
  const requestMic = useCallback(async (): Promise<boolean> => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      });
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = micStream;
      audioEngine.setMicStream(micStream);
      audioEngine.setMicEnabled(micOnRef.current);
      // List mic devices so the user can pick the real one — Chrome's
      // permission prompt defaults to a virtual/loopback device on some
      // Macs (e.g. BlackHole), which records silence.
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      setMicDevices(devs.filter((d) => d.kind === 'audioinput'));
      const cur = micStream.getAudioTracks()[0]?.getSettings().deviceId;
      if (cur) setMicDeviceId(cur);
      setMicPermState('granted');
      return true;
    } catch {
      micStreamRef.current = null;
      updateMicPermState();
      return false;
    }
  }, [updateMicPermState]);

  // Chrome workaround: some Chrome/macOS builds deliver silence from the
  // mic when echo cancellation is active (Safari is unaffected). Re-request
  // the mic WITHOUT audio processing and rewire, once.
  const retryMicRaw = useCallback(async () => {
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = s2;
      audioEngine.setMicStream(s2);
      audioEngine.setMicEnabled(micOnRef.current);
    } catch {
      // keep the original stream
    }
  }, []);
  const recModeRef = useRef<RecMode>('audio');
  const recRatioRef = useRef<RecRatio>('9:16');
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const endCountTimerRef = useRef<number | null>(null);
  const recordingAbortedRef = useRef(false);
  // B2: recording compositor helpers (cheap blur buffer + chord-pop timing)
  const blurBufRef = useRef<HTMLCanvasElement | null>(null);
  const recBlurAtRef = useRef(0); // last blur-bg redraw (throttled to ~5fps)

  // Camera-freeze watchdog: after a long screen lock some Android builds
  // leave the video on the last frame forever. Track the video clock and
  // restart the stream when it stops advancing while visible.
  const lastVideoTimeRef = useRef(-1);
  const lastVideoCheckRef = useRef(0);
  const frozenChecksRef = useRef(0);

  // Camera input source: MediaPipe detection + hand-presence smoothing
  // (moved to input/cameraSource.ts in the 2026-08-09 refactor — pure move,
  // identical behavior).
  const cameraSourceRef = useRef<CameraSource | null>(null);
  if (!cameraSourceRef.current) cameraSourceRef.current = new CameraSource();

  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // ─── Onboarding (first visit) ─────────────────────────────────────────
  // No popups on first visit — a newcomer's intent is to try, not to
  // learn, and a popup just gets dismissed. The only nudge: once the
  // camera is running and the player can see themselves, the ? help
  // button breathes for 8s — the player can then follow the demo hand by
  // hand, raising fingers and hearing the sound. Marked done once they
  // actually open the help. The hands-ready badge appears once per
  // session when both hands are first detected.
  // Mobile ⋯ more-panel: portrait phones collapse the toolbar to
  // [brand · record · help · ⋯]; the rest lives in the panel. Hidden on
  // desktop/landscape (media query).
  const [moreOpen, setMoreOpen] = useState(false);
  const [showMorePulse, setShowMorePulse] = useState(false);
  const morePulseTimerRef = useRef<number | null>(null);
  const triggerMorePulse = useCallback(() => {
    let done = false;
    try { done = sessionStorage.getItem('gswMorePulse') === '1'; } catch { /* private mode */ }
    if (done) return;
    setShowMorePulse(true);
    if (morePulseTimerRef.current) window.clearTimeout(morePulseTimerRef.current);
    morePulseTimerRef.current = window.setTimeout(() => setShowMorePulse(false), 8000);
  }, []);
  const dismissMorePulse = useCallback(() => {
    setShowMorePulse(false);
    if (morePulseTimerRef.current) {
      window.clearTimeout(morePulseTimerRef.current);
      morePulseTimerRef.current = null;
    }
    try { sessionStorage.setItem('gswMorePulse', '1'); } catch { /* private mode */ }
  }, []);
  const [showHelpPulse, setShowHelpPulse] = useState(false);
  const helpPulseTimerRef = useRef<number | null>(null);
  const triggerHelpPulse = useCallback(() => {
    let done = false;
    try { done = localStorage.getItem('gswHelpPulse') === '1'; } catch { /* private mode */ }
    if (done) return;
    setShowHelpPulse(true);
    if (helpPulseTimerRef.current) window.clearTimeout(helpPulseTimerRef.current);
    helpPulseTimerRef.current = window.setTimeout(() => setShowHelpPulse(false), 8000);
  }, []);
  const dismissHelpPulse = useCallback(() => {
    setShowHelpPulse(false);
    if (helpPulseTimerRef.current) {
      window.clearTimeout(helpPulseTimerRef.current);
      helpPulseTimerRef.current = null;
    }
    try { localStorage.setItem('gswHelpPulse', '1'); } catch { /* private mode */ }
  }, []);
  const [showHandsReady, setShowHandsReady] = useState(false);
  const handsReadyTimerRef = useRef<number | null>(null);
  // Once per session: whether the hands-ready badge was already shown
  // (sessionStorage survives reloads within the same tab)
  const [handsReadyShown, setHandsReadyShown] = useState(() => {
    try { return sessionStorage.getItem('gswHandsReady') === '1'; } catch { return false; }
  });

  // Help-panel hand demo: 8 steps — left hand picks the chord degree,
  // right hand picks the chord type (finger count = voicing size); both
  // hands move together as in real play, and the matching table row
  // highlights. The left hand renders real gesture art (HAND_ART), the
  // right hand is described by finger count.
  // Demo steps: ONLY the left hand changes — it alone picks the chord
  // degree (matches real play: the right hand never changes the chord,
  // default it only controls volume; finger-count → chord type is an
  // optional mode explained under the table).
  // Loading-screen carousel rows (one table row per step, 5s each).
  const LOADING_STEPS = [
    { art: '1', row: 0, hint: 'Any 1 finger raised' },
    { art: '2', row: 1, hint: 'Any 2 fingers' },
    { art: '3', row: 2, hint: 'Any 3 fingers' },
    { art: '4', row: 3, hint: 'Any 4 fingers' },
    { art: '5', row: 4, hint: 'All 5 fingers' },
    { art: 'VI', row: 5, hint: 'Index + Pinky ONLY' },
    { art: 'VII', row: 6, hint: 'Index + Pinky + Thumb' },
    { art: 'mute', row: 7, hint: 'Fist = mute — notes held' },
  ] as const;
  const HELP_DEMO_STEPS = [
    { left: '1', row: 0 },
    { left: '2', row: 1 },
    { left: '3', row: 2 },
    { left: '4', row: 3 },
    { left: '5', row: 4 },
    { left: 'VI', row: 5 },
    { left: 'VII', row: 6 },
    { left: 'mute', row: 7 },
  ] as const;
  const [demoStep, setDemoStep] = useState(0);
  useEffect(() => {
    if (!showHelp) return;
    const t = window.setInterval(() => setDemoStep((s) => (s + 1) % HELP_DEMO_STEPS.length), 1800);
    return () => window.clearInterval(t);
  }, [showHelp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chord name in the currently selected key (e.g. key C → "I · C",
  // key G → "I · G"); follows the toolbar key selector.
  const chordNameFor = (chordIndex: number): string => {
    const c = DIATONIC_CHORDS[chordIndex % DIATONIC_CHORDS.length];
    const rootName = (KEYS[(c.intervals[0] + synthState.keyOffset) % KEYS.length]?.name ?? '?').split('/')[0];
    const third = c.intervals[1] - c.intervals[0];
    const fifth = c.intervals[2] - c.intervals[1];
    if (third === 3 && fifth === 3) return `${rootName}dim`;
    if (c.isMajor) return rootName;
    return `${rootName}m`;
  };
  // Uppercase degree names (I-VII) so the table matches the hand-name
  // labels (VI = Index+Pinky, VII = +Thumb). The chord NAME column carries
  // the musical quality (C, Dm, Em, F, G, Am, Bdim) — the strict roman
  // analysis would be ii/iii/vi/vii°.
  const GRADE_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const gradeNameFor = (chordIndex: number): string =>
    chordIndex < DIATONIC_CHORDS.length
      ? `${GRADE_NAMES[chordIndex]} · ${chordNameFor(chordIndex)}`
      : 'mute';

  // Renders one of the licensed hand artworks, sized by height.
  // mirrored flips the hand horizontally (right-hand view: thumb right).
  const handArt = (key: string, size: number, color: string, mirrored = false): ReactNode => {
    const a = HAND_ART[key];
    if (!a) return null;
    return (
      <svg viewBox={a.vb} style={{
        height: size, width: 'auto', color, flexShrink: 0, display: 'block',
        transform: mirrored ? 'scaleX(-1)' : undefined,
      }} dangerouslySetInnerHTML={{ __html: a.body }} />
    );
  };

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  // Which camera error is showing (for the personalized guide + visual
  // address-bar hint on permission denial).
  const [cameraErrorType, setCameraErrorType] = useState<'permission_denied' | 'no_camera' | 'unsupported_browser' | 'other' | null>(null);
  // Settings panel hidden by default on all platforms (it covers the camera
  // view; the gear lives in the mobile ⋯ panel / desktop toolbar).
  const [showSettings, setShowSettings] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  // Visual atmosphere: Vignette + Scanlines, each with its OWN strength
  // slider (0-100, 0 = off). Dragging a slider is the on/off — no separate
  // toggle needed, and each effect adjusts independently. Stackable.
  // WYSIWYG between live view and recording window.
  // Visual atmosphere defaults ON at 50% (= the pre-slider fixed look:
  // gentle cinematic vignette + subtle scanlines). Saved choice wins; the
  // localStorage read is guarded for private mode.
  const [vignetteStrength, setVignetteStrength] = useState(() => {
    try {
      const saved = localStorage.getItem('gsw-vignette');
      const v = saved === null ? NaN : Number(saved);
      return isNaN(v) ? 60 : Math.min(100, Math.max(0, v)); // 60% = cinematic but gentle
    } catch { return 60; }
  });
  const [scanlinesStrength, setScanlinesStrength] = useState(() => {
    try {
      const saved = localStorage.getItem('gsw-scanlines');
      const v = saved === null ? NaN : Number(saved);
      return isNaN(v) ? 30 : Math.min(100, Math.max(0, v)); // 30% = subtle texture
    } catch { return 30; }
  });
  const vignetteStrengthRef = useRef(vignetteStrength);
  const scanlinesStrengthRef = useRef(scanlinesStrength);
  useEffect(() => { vignetteStrengthRef.current = vignetteStrength; }, [vignetteStrength]);
  useEffect(() => { scanlinesStrengthRef.current = scanlinesStrength; }, [scanlinesStrength]);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingStartRef = useRef<number | null>(null);
  const cameraStartRef = useRef(0);
  const firstGestureSentRef = useRef(false);
  const loadingStartRef = useRef(0);
  // Loading progress: honest-anchored fake bar — creeps quickly to ~45%,
  // crawls after, and jumps to 100% ONLY when the real download resolves.
  // (Real byte progress is unavailable inside MediaPipe's loader, so a
  // percent is inherently approximate — the completion anchor is real.)
  const [loadProgress, setLoadProgress] = useState(0);
  const loadProgTimerRef = useRef<number | null>(null);
  // Loading-screen gesture carousel: one table row at a time (5s/row),
  // same data as the Help demo — the wait becomes a learning moment.
  // Desktop also shows the big animated hand above the row.
  const [loadingDemoStep, setLoadingDemoStep] = useState(0);
  const [loadingTimeoutShown, setLoadingTimeoutShown] = useState(false);
  const [loadingVisible, setLoadingVisible] = useState(false);
  const [loadingFading, setLoadingFading] = useState(false);
  const loadDemoTimerRef = useRef<number | null>(null);
  const loadTimeoutTimerRef = useRef<number | null>(null);
  // Fade-out: render continues 250ms after isLoading drops, fading the
  // screen before the camera view appears.
  useEffect(() => {
    if (isLoading) {
      setLoadingVisible(true);
      setLoadingFading(false);
    } else if (loadingVisible) {
      setLoadingFading(true);
      const t = setTimeout(() => setLoadingVisible(false), 250);
      return () => clearTimeout(t);
    }
  }, [isLoading, loadingVisible]);
  // Cancel = back to idle; the model download keeps running in the
  // background (initPromise is reused), so the next Enable Camera is
  // instant. The startCamera flow checks this flag after the awaits.
  const loadCancelledRef = useRef(false);
  const recordingActiveRef = useRef(false);

  useEffect(() => { recModeRef.current = recMode; }, [recMode]);
  useEffect(() => { recRatioRef.current = recRatio; }, [recRatio]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { audioEngine.setMicEnabled(micOn); }, [micOn]);
  useEffect(() => { recVoiceRef.current = recVoice; }, [recVoice]);
  useEffect(() => {
    audioEngine.setRecordingMix(recVoice);
    localStorage.setItem('gsw-rec-voice', String(recVoice));
  }, [recVoice]);
  useEffect(() => {
    audioEngine.setVocalPolish(recPolish);
    localStorage.setItem('gsw-rec-polish', recPolish);
  }, [recPolish]);
  useEffect(() => { try { localStorage.setItem('gsw-vignette', String(vignetteStrength)); } catch { /* private mode */ } }, [vignetteStrength]);
  useEffect(() => { try { localStorage.setItem('gsw-scanlines', String(scanlinesStrength)); } catch { /* private mode */ } }, [scanlinesStrength]);

  // Re-select the mic device (Chrome's permission prompt defaults to a
  // virtual/loopback device on some Macs — e.g. BlackHole — which records
  // silence). Enumerated after mic permission is granted.
  const switchMicDevice = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = s2;
      audioEngine.setMicStream(s2);
      audioEngine.setMicEnabled(micOnRef.current);
      setMicDeviceId(deviceId);
      micRetriedRef.current = true;
    } catch {
      // device unavailable — keep the current stream
    }
  }, []);

  // Reflect the mic permission state whenever the chooser opens
  useEffect(() => {
    if (recPhase === 'choosing') updateMicPermState();
  }, [recPhase, updateMicPermState]);

  // Live mic level while the chooser is open (diagnostic: is the mic
  // actually receiving sound?). Also triggers the Chrome raw-mic retry:
  // ~2.5s of silence with the toggle on means the OS granted the mic but
  // Chrome isn't delivering audio (echo-cancellation bug class).
  useEffect(() => {
    if (recPhase !== 'choosing' || !micStreamRef.current) return;
    let silentFor = 0;
    const t = window.setInterval(() => {
      const lvl = audioEngine.getMicLevel();
      setMicLevel(lvl);
      if (lvl < 0.005 && micOnRef.current && !micRetriedRef.current) {
        silentFor += 250;
        if (silentFor >= 2500) {
          micRetriedRef.current = true;
          retryMicRaw();
        }
      } else {
        silentFor = 0;
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [recPhase, retryMicRaw]);
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

  const processHandsRef = useRef<(frame: HandFrame) => void>();
  processHandsRef.current = (frame: HandFrame) => {
    const leftHand = frame.left;
    const rightHand = frame.right;

    // First hand detected = the activation moment (funnel event, once per run)
    if ((leftHand || rightHand) && !firstGestureSentRef.current) {
      firstGestureSentRef.current = true;
      trackFirstGesture(cameraStartRef.current ? (Date.now() - cameraStartRef.current) / 1000 : 0);
    }

    setGesture({ left: leftHand, right: rightHand });
    setHasLeftHand(!!leftHand);
    setHasRightHand(!!rightHand);

    // Onboarding: once per session, celebrate the first stable two-hand
    // detection — a 3s badge, never shown again in this session.
    if (leftHand && rightHand && !handsReadyShown) {
      setHandsReadyShown(true);
      try { sessionStorage.setItem('gswHandsReady', '1'); } catch { /* private mode */ }
      setShowHandsReady(true);
      if (handsReadyTimerRef.current) window.clearTimeout(handsReadyTimerRef.current);
      handsReadyTimerRef.current = window.setTimeout(() => setShowHandsReady(false), 3000);
    }

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
    const { base: chordBase, ext: chordExt } = getChordParts(
      chordIndex,
      mode === 'neutral' ? undefined : mode,
      s.keyOffset,
      chordStyle,
    );
    const chordName = chordBase + chordExt + (thumbDown ? ' (-8ve)' : '');

    const newSynth: SynthState = {
      ...s,
      chordIndex,
      chordName,
      chordBase,
      chordExt,
      octaveDown: thumbDown,
      chordStyle,
      volume,
      mode,
      isPlaying,
    };
    setSynthState(newSynth);

    // Engine-layer deduplication (2026-08-09 refactor): audioEngine.playChord
    // computes a frequency-based key internally (freqs|arp|arpSpeed) and
    // skips re-triggering identical chords — App-layer fingerprint removed
    // (it was redundant; the engine's key covers all dimensions, even more
    // precisely, since it derives from the actual frequencies).
    if (isPlaying) {
      // Refresh the grace-period clock — sound continues while this holds.
      // (Updating it only here means a missing right hand stops the music
      // after GRACE_MS instead of sustaining forever on a left hand alone.)
      stabilizerRef.current.lastSeen = performance.now();
      audioEngine.playChord(
        chordIndex, 'sine',
        mode === 'neutral' ? undefined : mode,
        0, s.keyOffset, chordStyle,
        s.arpeggiate, s.arpSpeed, thumbDown,
      );
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

  // Video version of the skeleton: soft palette + thinner lines + weak
  // glow — matches the frame's quiet design language (used only inside
  // recordings; the live view keeps the brighter look).
  const drawOverlayVideoRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>();
  drawOverlayVideoRef.current = (ctx, w, h) => {
    if (!showSkeleton) return;
    const g = gestureRef.current;
    if (g.left) drawHandSkeleton(ctx, g.left, w, h, '#00e6c0', 'rgba(0,230,192,0.35)', 2, 5);
    if (g.right) drawHandSkeleton(ctx, g.right, w, h, '#ff6ec7', 'rgba(255,110,199,0.3)', 2, 4);
  };

  // Draw waveform visualization — three-channel HUD:
  //   color  = scale degree (left hand; 7-hue neon spectrum, smooth lerp),
  //   lines  = chord note count (right hand: 3 triad / 4 seventh / 5 ninth),
  //   width  = volume; right-hand tilt (filter sweep) brightens/darkens.
  // Gray when muted, invisible when silent.
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
    const muted = rms < 0.005;
    const lineW = muted ? 2 : 1 + rms * 8;

    // ── Color = scale degree (left-hand harmony), lerped so a chord
    //    change glides through the neon spectrum instead of snapping. ──
    const s = synthRef.current;
    const degree = s.chordIndex >= 0 && s.chordIndex < DEGREE_COLORS.length ? s.chordIndex : 0;
    const target = DEGREE_COLORS[degree];
    const cur = degreeColorRef.current;
    cur.r += (target[0] - cur.r) * 0.12;
    cur.g += (target[1] - cur.g) * 0.12;
    cur.b += (target[2] - cur.b) * 0.12;

    // ── Tilt (filter sweep) → brightness ±25% (right-hand expression) ──
    const tilt = Math.max(-1, Math.min(1, hands.right?.tiltAngle ?? 0));
    const brightness = 1 + 0.25 * tilt;
    const R = Math.max(0, Math.min(255, Math.round(cur.r * brightness)));
    const G = Math.max(0, Math.min(255, Math.round(cur.g * brightness)));
    const B = Math.max(0, Math.min(255, Math.round(cur.b * brightness)));

    // ── Line count = chord note count (right-hand thickness). The echoes
    //    recede like a floor grid: front line at the bottom, each echo
    //    higher, smaller, dimmer, with spacing compressing toward the
    //    horizon and a slight horizontal convergence — so 3-5 lines read
    //    as clearly separate strands in depth, not one blurry line. ──
    const lineCount = muted ? 1 : Math.max(1, chordNoteCount(s.chordStyle));
    const alphaBase = muted ? 0.25 : 0.2 + rms * 0.8;
    const H = canvas.height;
    const baseY = H * 0.78;    // front line (closest)
    const horizonY = H * 0.16; // far echoes converge toward here
    const cx = canvas.width / 2;
    const ampH = H * 0.55;

    for (let k = 0; k < lineCount; k++) {
      const depth = k;
      const t = 1 - Math.pow(0.55, depth); // 0 (front) → ~0.9 (far)
      const yCenter = baseY + (horizonY - baseY) * t;
      const scale = Math.pow(0.7, depth);       // amplitude shrinks with depth
      const hScale = 1 - 0.06 * depth;          // slight horizontal convergence
      const a = muted ? alphaBase : alphaBase * Math.pow(0.62, depth);
      ctx.lineWidth = lineW * (0.5 + 0.5 * scale);
      ctx.strokeStyle = muted
        ? `rgba(120, 120, 120, ${alphaBase})`
        : `rgba(${R}, ${G}, ${B}, ${a})`;
      ctx.shadowColor = muted ? 'transparent' : `rgb(${R}, ${G}, ${B})`;
      ctx.shadowBlur = muted ? 0 : Math.max(2, Math.round(8 * scale));
      ctx.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        const v = (waveform[i] + 1) / 2 - 0.5; // -0.5..0.5
        const x = cx + (i / (bufferLength - 1) - 0.5) * canvas.width * hScale;
        const y = yCenter + v * ampH * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
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
    const src = skeletonCanvasRef.current; // recording-source canvas (stage or camera + soft skeleton)
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

    // ── Blur-fill background (cheap: draw via a tiny copy, then upscale) ──
    // Redrawn at ~5fps — it's visually stable, and this is the heaviest
    // draw (a full-frame upscale), so throttling it removes most of the
    // recording-compositor load that can cause jank.
    {
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
    }

    // ── Design language (all ratios):
    //   Brand = cyan-cool metal (top-left, static); URL = white bold on
    //   pill (bottom-right, clarity first). Everything else is placed per
    //   ratio:
    //   All ratios are now FULL-FRAME (immersive, like 16:9): the content
    //   cover-crops or fits to fill the entire canvas; brand/URL float on
    //   top as small badges. (9:16 used to be a "poster" with design bands —
    //   removed 2026-08-04 after real-user feedback: vertical video should
    //   be full-bleed like TikTok/Reels, not a letterboxed strip.)
    //   1:1 and 9:16 — full frame; portrait sources cover-crop (a fit-width
    //   portrait would overflow the frame), landscape sources fit by width.
    let wy = 0;
    let winH = H;
    if (ratio === '16:9') {
      // 16:9 canvas, landscape source: fit fills the frame exactly.
      const ch = Math.round((W * sh) / sw);
      const dy = Math.round((H - ch) / 2);
      rctx.drawImage(src, 0, dy, W, ch);
    } else {
      // 1:1 / 9:16 canvases: cover-crop the source to FILL the frame —
      // always. (A fit-width landscape source would leave letterbox
      // strips, i.e. the old poster look; immersive vertical/square
      // video covers instead — TikTok/IG convention.)
      const scale = Math.max(W / sw, H / sh);
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);
      const dx = Math.round((W - dw) / 2);
      const dy = Math.round((H - dh) / 2);
      rctx.drawImage(src, dx, dy, dw, dh);
      wy = 0;
      winH = H;
      rctx.strokeStyle = 'rgba(0, 255, 204, 0.3)';
      rctx.lineWidth = 2;
      rctx.strokeRect(0, wy, W, winH);
    }

    // ── Inside the window: chord name (the green note) + live waveform.
    //    Immersive video keeps the performance, chord, waveform and the
    //    brand/URL badges — the mode·key line was removed per user
    //    feedback 2026-08-04. ──
    const chordSize = ratio === '16:9' ? 46 : 48;
    // 1:1 / 9:16: push the chord down by ~a note-height so it never crowds
    // the top-left brand wordmark (16:9 keeps its tighter 84px slot).
    const chordY = ratio === '16:9' ? 84 : wy + 114;
    drawChordHud(rctx, W / 2, chordY, chordSize, s.chordBase || '—', s.chordExt || '', !!s.octaveDown);

    if (ratio !== '16:9') {
      rctx.font = '500 16px Inter, system-ui, sans-serif';
      rctx.textAlign = 'center';
      rctx.fillStyle = 'rgba(160, 160, 208, 0.8)';
      rctx.fillText(`${modeLabel} · Key ${KEYS[s.keyOffset]?.name ?? 'A'}`, W / 2, chordY + 28);
    }

    if (mode !== 'skeleton') {
      const analyser = audioEngine.getAnalyser();
      if (analyser) {
        const wf = analyser.getValue() as Float32Array;
        const n = wf.length;
        const waveBase = ratio === '16:9' ? H - 34 : wy + winH - 40;
        rctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = W * 0.06 + (i / (n - 1)) * W * 0.88;
          const wy2 = waveBase - wf[i] * (ratio === '16:9' ? 20 : 22);
          if (i === 0) rctx.moveTo(x, wy2);
          else rctx.lineTo(x, wy2);
        }
        rctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
        rctx.lineWidth = 2;
        rctx.shadowColor = 'rgba(0, 255, 204, 0.3)';
        rctx.shadowBlur = 6;
        rctx.stroke();
        rctx.shadowBlur = 0;

      }
    }

    drawMetalBrand(rctx, 24, 40, 26);
    drawUrlPill(rctx, W - 26, H - 24, 22, false);

    // ── Atmosphere — window only (0, wy, W, winH); the design bands stay
    //    clean so brand/URL keep full clarity. Matches the live overlay
    //    (base effect × user strength/100); both effects can stack. ──
    // Base effect × strength: base 1.0 (vignette) / 0.3 (scanlines) makes
    // 100% deliberately "too much" — users settle around 40-70%, where 50%
    // ≈ the old 100% look. Mirrors the live CSS overlay.
    const vStrength = vignetteStrengthRef.current / 100;
    const sStrength = scanlinesStrengthRef.current / 100;
    if (vStrength > 0) {
      const cx = W / 2;
      const cy = wy + winH / 2;
      const g = rctx.createRadialGradient(cx, cy, Math.min(W, winH) * 0.3, cx, cy, Math.max(W, winH) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${1.0 * vStrength})`);
      rctx.fillStyle = g;
      rctx.fillRect(0, wy, W, winH);
    }
    if (sStrength > 0) {
      rctx.fillStyle = `rgba(255,255,255,${0.3 * sStrength})`;
      for (let y = wy; y < wy + winH; y += 4) {
        rctx.fillRect(0, y, W, 2);
      }
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

      if (!isDetectingRef.current && timestamp - lastDetectRef.current > detectIntervalRef.current) {
        lastDetectRef.current = timestamp;
        isDetectingRef.current = true;
        const t0 = performance.now();
        try {
          const frame = cameraSourceRef.current?.getFrame(video, timestamp) ?? { left: null, right: null };
          processHandsRef.current?.(frame);
        } catch (e) {
          console.warn('Detection frame error:', e);
        } finally {
          // Adaptive rate (B2): a slow synchronous detection eats the main
          // thread, and every click queues behind it (the 530ms INP). Drop
          // to 20/15fps while detections run long; fast devices stay at
          // 30fps and never notice. Thresholds are tuning constants.
          const dt = performance.now() - t0;
          detectIntervalRef.current = dt > 70 ? 66 : dt > 45 ? 50 : 33;
          isDetectingRef.current = false;
        }
      }

      drawOverlayRef.current?.(ctx, canvas.width, canvas.height);
      drawWaveformRef.current?.();

      // B2: camera-freeze watchdog — while visible, if the video clock
      // hasn't advanced for ~4s the OS killed the stream (long screen
      // lock on Android). Restart it so the picture comes back.
      if (document.visibilityState === 'visible' && !video.paused && video.videoWidth > 0) {
        const now = performance.now();
        if (now - lastVideoCheckRef.current > 2000) {
          lastVideoCheckRef.current = now;
          if (Math.abs(video.currentTime - lastVideoTimeRef.current) < 0.001) {
            frozenChecksRef.current += 1;
            if (frozenChecksRef.current >= 2) {
              frozenChecksRef.current = 0;
              trackWatchdogTriggered('frozen-clock');
              void restartCameraStream();
            }
          } else {
            frozenChecksRef.current = 0;
            lastVideoTimeRef.current = video.currentTime;
          }
        }
      }

      // B2: during recording, build the recording-source canvas (stage or
      // camera frame + SOFT skeleton + waveform) and composite the frame.
      // The soft video skeleton differs from the live overlay; the live
      // view above keeps the brighter look.
      if (recordingActiveRef.current) {
        const mode = recModeRef.current;
        const sc = skeletonCanvasRef.current;
        if (sc) {
          if (sc.width !== canvas.width || sc.height !== canvas.height) {
            sc.width = canvas.width;
            sc.height = canvas.height;
          }
          const sctx = sc.getContext('2d');
          if (sctx) {
            if (mode === 'skeleton') {
              // Stage: the website's dark cosmos + footlight, soft skeleton
              drawStageBackground(sctx, sc.width, sc.height);
              drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
              const wf = waveformCanvasRef.current;
              if (wf) sctx.drawImage(wf, 0, 0, sc.width, sc.height);
            } else {
              // Camera frame (mirrored like the live view) + soft skeleton.
              // NO waveform here — camera layouts draw their own HUD
              // waveform (bottom band / frame bottom).
              sctx.fillStyle = '#050510';
              sctx.fillRect(0, 0, sc.width, sc.height);
              sctx.save();
              sctx.scale(-1, 1);
              sctx.drawImage(video, -sc.width, 0, sc.width, sc.height);
              sctx.restore();
              sctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
              sctx.fillRect(0, 0, sc.width, sc.height);
              drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
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

  // Quietly re-acquire the camera after the OS reclaimed it (long screen
  // lock on Android/iOS). Hand tracking + audio keep running — only the
  // video source is swapped. Errors are swallowed: the freeze watchdog
  // retries on its next check.
  const restartCameraStream = useCallback(async () => {
    const oldStream = streamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      oldStream?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      stream.getVideoTracks().forEach((t) => {
        t.onended = () => {
          if (runningRef.current) void restartCameraStream();
        };
      });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      lastVideoTimeRef.current = -1; // re-baseline the watchdog
      frozenChecksRef.current = 0;
    } catch {
      // Re-acquisition failed (permission dismissed, camera in use) — the
      // watchdog will try again on the next freeze check.
    }
  }, []);

  // Screen unlocks after a lock: resume a paused video, or fully restart
  // the stream if the OS killed the camera track while locked.
  const handleVisibility = useCallback(() => {
    if (document.visibilityState !== 'visible' || !runningRef.current) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (stream.getVideoTracks().some((t) => t.readyState === 'ended')) {
      void restartCameraStream();
      return;
    }
    if (video.paused) video.play().catch(() => {});
  }, [restartCameraStream]);

  const startCamera = useCallback(async () => {
    trackCameraClicked();
    setIsLoading(true);
    loadingStartRef.current = performance.now();
    loadCancelledRef.current = false;
    setLoadProgress(4);
    setLoadingDemoStep(0);
    setLoadingTimeoutShown(false);
    if (loadProgTimerRef.current) window.clearInterval(loadProgTimerRef.current);
    loadProgTimerRef.current = window.setInterval(() => {
      setLoadProgress((p) => {
        if (p >= 90) return p;            // never cross 90% until real done
        return p < 45 ? p + 4 : p + 1;    // quick start, then crawl
      });
    }, 700);
    // Gesture carousel: 5s per row (enough to read the long VI/VII hints).
    if (loadDemoTimerRef.current) window.clearInterval(loadDemoTimerRef.current);
    loadDemoTimerRef.current = window.setInterval(() => {
      setLoadingDemoStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 5000);
    // Timeout nudge: after 90s swap the hint text for a reassurance
    // (same slot — the cancel button already guarantees no wasted download).
    if (loadTimeoutTimerRef.current) window.clearTimeout(loadTimeoutTimerRef.current);
    loadTimeoutTimerRef.current = window.setTimeout(() => setLoadingTimeoutShown(true), 90000);
    setError(null);
    setCameraErrorType(null);
    firstGestureSentRef.current = false;

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
      trackCameraPermission('granted');
      cameraStartRef.current = Date.now();
      streamRef.current = stream;

      // If the OS reclaims the camera while the page is backgrounded
      // (long screen lock), the track fires 'ended' — restart quietly.
      stream.getVideoTracks().forEach((t) => {
        t.onended = () => {
          if (runningRef.current) void restartCameraStream();
        };
      });
      document.addEventListener('visibilitychange', handleVisibility);

      // Request the microphone SEPARATELY (its own permission prompt —
      // sing-along use case). Optional: if denied or unavailable, the
      // camera keeps working and recordings are synth-only. Users who
      // deny it can re-enable later via the chooser's "Enable
      // microphone" button.
      await requestMic();

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
      // Real completion anchor: the fake bar jumps to 100% only here.
      if (loadProgTimerRef.current) window.clearInterval(loadProgTimerRef.current);
      if (loadDemoTimerRef.current) window.clearInterval(loadDemoTimerRef.current);
      if (loadTimeoutTimerRef.current) window.clearTimeout(loadTimeoutTimerRef.current);
      setLoadProgress(100);
      if (loadCancelledRef.current) {
        // User cancelled mid-download — the model is now cached (initPromise
        // reused), so just return to idle; next Enable Camera is instant.
        setIsLoading(false);
        return;
      }
      await audioEngine.init();
      // Attach the mic AFTER init — the engine's mic gain node only exists
      // once initialized
      audioEngine.setMicStream(micStreamRef.current);

      setIsRunning(true);
      trackLoadingScreenVisible(performance.now() - loadingStartRef.current, 'success');
      setIsLoading(false);
      // Camera is live — the player can see their hands now, so nudge
      // them toward the hand demo (8s pulse, one-time until they open it)
      triggerHelpPulse();
      // …and (portrait phones) toward the ⋯ more panel (settings/modes)
      triggerMorePulse();
    } catch (err: unknown) {
      console.error('Failed to start:', err);
      if (loadProgTimerRef.current) window.clearInterval(loadProgTimerRef.current);
      if (loadDemoTimerRef.current) window.clearInterval(loadDemoTimerRef.current);
      if (loadTimeoutTimerRef.current) window.clearTimeout(loadTimeoutTimerRef.current);
      trackLoadingScreenVisible(performance.now() - loadingStartRef.current, 'failed');
      setIsLoading(false);

      let errorType: 'permission_denied' | 'no_camera' | 'unsupported_browser' | 'other';
      if (isDomError(err, 'NotAllowedError')) {
        errorType = 'permission_denied';
        trackCameraPermission('denied');
        setError(isMobile
          ? 'Camera access was denied. On mobile, check your browser app permissions or system Settings > Privacy > Camera.'
          : 'Camera access was denied. Click the lock icon in the address bar to allow camera access.');
      } else if (isDomError(err, 'NotFoundError')) {
        errorType = 'no_camera';
        setError(isMobile
          ? 'No camera found. Make sure your device has a front-facing camera and it is not in use by another app.'
          : 'No camera found. Connect a webcam and try again.');
      } else {
        const msg = getErrorMessage(err);
        if (msg.includes('support') || msg.includes('not supported')) {
          errorType = 'unsupported_browser';
          setError(isMobile
            ? 'Your browser does not support camera access. Try Chrome or Edge on Android, or Safari on iOS.'
            : 'Your browser does not support camera access. Try Chrome, Edge, or Firefox.');
        } else {
          errorType = 'other';
          setError(isMobile
            ? `Camera error: ${msg}. Try a different browser like Chrome or Safari.`
            : `Camera error: ${msg}. Check that your webcam is connected and not in use.`);
        }
      }
      trackCameraStartFailed(errorType, getErrorMessage(err));
      setCameraErrorType(errorType);
    }
  }, [handleVisibility, restartCameraStream, triggerHelpPulse, triggerMorePulse]);

  /* ─── Warm up hand tracking on button intent ───────────────────────── */

  // Starts the ~19 MB model + WASM download the moment the user shows
  // intent (hover / touch / focus on the Enable Camera button) so the
  // actual click has nothing left to wait for. Users who never approach
  // the button download nothing. Errors surface at startCamera.
  // CF-only: a hover must never spend Vercel's metered bandwidth — the
  // click path owns the Vercel fallback for CF-unreachable users.
  const prefetchTracking = useCallback(() => {
    prefetchModel().catch(() => {});
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
    // Release the mic from the recording tap
    audioEngine.setMicEnabled(false);
    audioEngine.setMicStream(null);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
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
    document.removeEventListener('visibilitychange', handleVisibility);
    lastVideoTimeRef.current = -1;
    frozenChecksRef.current = 0;
    if (helpPulseTimerRef.current) {
      window.clearTimeout(helpPulseTimerRef.current);
      helpPulseTimerRef.current = null;
    }
    setShowHelpPulse(false);

    audioEngine.stopAll();
    audioEngine.stopMetronome();
    setMetronomeOn(false);

    // Reset stabilizer state for clean restart
    stabilizerRef.current = { committed: null, pending: null, pendingSince: 0, lastSeen: 0 };
    rightHandHistoryRef.current = [];
    cameraSourceRef.current?.reset();
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
  }, [handleVisibility]);

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
    // The File MUST carry an explicit MIME type — Android Chrome rejects
    // typeless File objects during share() validation (canShare passes but
    // share throws NotSupportedError).
    const file = new File([recBlob.blob], recBlob.filename, {
      type: recBlob.blob.type || 'application/octet-stream',
    });
    const brandText = 'I just played this with Gesture Synth Weld 🎹 — play music with hand gestures. gesturesynthweld.com';
    try {
      await navigator.share({
        files: [file],
        title: 'Gesture Synth Weld — hand gesture music synthesizer',
        text: brandText,
      });
      setShareFailed(false);
      trackShare('success', 'file');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        trackShare('canceled', 'file');
        return; // user cancelled
      }
      // Files share rejected (NotSupportedError etc.) — retry text-only so
      // the brand message still reaches the share sheet.
      try {
        await navigator.share({
          title: 'Gesture Synth Weld — hand gesture music synthesizer',
          text: brandText,
          url: 'https://gesturesynthweld.com',
        });
        setShareFailed(false);
        trackShare('success', 'text');
      } catch (e2) {
        if (e2 instanceof DOMException && e2.name === 'AbortError') {
          trackShare('canceled', 'text');
          return;
        }
        setShareFailed(true);
        trackShare('failed', 'text');
      }
    }
  }, [recBlob]);

  const canFileShare = !!recBlob &&
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' ||
      navigator.canShare({ files: [new File([recBlob.blob], recBlob.filename, { type: recBlob.blob.type || 'application/octet-stream' })] }));

  // Start the actual recording (audio via Tone.Recorder; video/skeleton via
  // MediaRecorder on the composited recording canvas + audio tap).
  const beginRecording = useCallback(() => {
    const mode = recModeRef.current;
    // Sing-along: mix the mic into the recording tap while recording
    audioEngine.setRecordingMix(recVoiceRef.current);
    audioEngine.setMicEnabled(micOnRef.current && !!micStreamRef.current);

    // Video/skeleton modes need the composited recording canvas as source.
    // (Skeleton mode composites an offscreen canvas: dark bg + skeleton +
    // waveform, no camera feed — created here so beginRecording sees a
    // valid source before the draw loop starts painting it.)
    let rec: HTMLCanvasElement | null = null;
    if (mode !== 'audio') {
      const live = canvasRef.current;
      if (!live || !live.width) {
        setRecPhase('idle');
        return;
      }
      // The recording-source canvas (stage or camera + soft skeleton) is
      // the source for BOTH video modes
      if (!skeletonCanvasRef.current) {
        skeletonCanvasRef.current = document.createElement('canvas');
      }
      skeletonCanvasRef.current.width = live.width;
      skeletonCanvasRef.current.height = live.height;
      const srcCanvas = skeletonCanvasRef.current;
      if (!srcCanvas || !srcCanvas.width) {
        setRecPhase('idle');
        return;
      }
      const [rw, rh] = REC_RATIO_DIMS[recRatioRef.current];
      rec = recCanvasRef.current;
      if (!rec) {
        rec = document.createElement('canvas');
        recCanvasRef.current = rec;
      }
      rec.width = rw;
      rec.height = rh;
      recBlurAtRef.current = 0; // force the first blur-bg paint
      // Paint the source once BEFORE the first composite — otherwise the
      // video's first keyframe shows an empty (black) window.
      {
        const sc = skeletonCanvasRef.current;
        if (sc) {
          const sctx = sc.getContext('2d');
          if (sctx) {
            if (mode === 'skeleton') {
              drawStageBackground(sctx, sc.width, sc.height);
              drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
              const wf0 = waveformCanvasRef.current;
              if (wf0) sctx.drawImage(wf0, 0, 0, sc.width, sc.height);
            } else {
              sctx.fillStyle = '#050510';
              sctx.fillRect(0, 0, sc.width, sc.height);
              sctx.save();
              sctx.scale(-1, 1);
              const v0 = videoRef.current;
              if (v0) sctx.drawImage(v0, -sc.width, 0, sc.width, sc.height);
              sctx.restore();
              sctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
              sctx.fillRect(0, 0, sc.width, sc.height);
              drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
            }
          }
        }
      }
      drawRecFrame(); // first paint before captureStream
    }

    // Unified recording stream: the audio tap (synth + mic when enabled),
    // plus canvas video tracks for video/skeleton modes.
    const stream = new MediaStream();
    const aTrack = audioEngine.getRecordingAudioTrack();
    if (aTrack) stream.addTrack(aTrack);
    if (rec) {
      try {
        // 24fps instead of 30 — nearly invisible, ~20% less encoder load
        rec.captureStream(24).getVideoTracks().forEach((t) => stream.addTrack(t));
      } catch {
        setRecPhase('idle');
        return;
      }
    }

    const { mime } = pickRecMimeType(mode === 'audio');
    const recorder = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: 3_000_000,
    });
    const finalMime = recorder.mimeType || mime || (mode === 'audio' ? 'audio/webm' : 'video/webm');
    const ext = finalMime.includes('mp4') || finalMime.includes('m4a')
      ? (finalMime.includes('audio') ? 'm4a' : 'mp4')
      : 'webm';
      recChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (recordingAbortedRef.current) {
          recordingAbortedRef.current = false;
          recChunksRef.current = [];
          return;
        }
        const raw = new Blob(recChunksRef.current, { type: finalMime.split(';')[0] || 'video/webm' });
        recChunksRef.current = [];
        // Brand the file: mp4/m4a get iTunes-style tags (title/artist/
        // comment) so players show the site; webm keeps the branded name
        let blob = raw;
        if (ext === 'mp4' || ext === 'm4a') {
          // Audio files also carry branded cover art so players show it
          const cover = ext === 'm4a'
            ? new Uint8Array(await (await makeCoverBlob()).arrayBuffer())
            : undefined;
          blob = await injectBrandTags(
            raw,
            'Gesture Synth Weld',
            'gesturesynthweld.com',
            'Created with Gesture Synth Weld — gesturesynthweld.com',
            cover
          );
        }
        setShareFailed(false);
        setRecBlob({ blob, filename: makeRecordingFilename(ext) });
        setRecPhase('result');
      };
      recorder.start(500);
      mediaRecorderRef.current = recorder;

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

  // Stop recording and produce the result panel (unified MediaRecorder
  // path for audio, video and skeleton modes)
  const finishRecording = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (endCountTimerRef.current) {
      clearInterval(endCountTimerRef.current);
      endCountTimerRef.current = null;
    }
    setEndCount(null);
    audioEngine.setMicEnabled(false);
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.stop();
    } else {
      setRecPhase('idle');
    }
    if (recordingStartRef.current) {
      const dur = Math.floor((Date.now() - recordingStartRef.current) / 1000);
      trackRecording('completed', dur, dur >= RECORD_SECONDS ? 'timeout' : 'user');
    }
    setIsRecording(false);
    setRecordingTime(0);
    recordingStartRef.current = null;
  }, []);

  const finishRecordingRef = useRef<() => void>(() => {});
  finishRecordingRef.current = finishRecording;

  // Funnel: did the user READ the SEO content (Playbook)? Fires once, only
  // after the section stays ≥50% visible for 3s (a quick scroll-through does
  // not count) — decides whether below-fold ad placements are viable.
  useEffect(() => {
    const target = document.querySelector('.seo-content');
    if (!target || typeof IntersectionObserver === 'undefined') return;
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !sent) {
          timer = setTimeout(() => {
            sent = true;
            trackScrollToPlaybook();
            observer.disconnect();
          }, 3000);
        } else if (!visible && timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Funnel start: traffic-source tag (Clarity session tag) + "came but never
  // touched the camera" detection (10s stay).
  useEffect(() => {
    initTrafficSource();
    const t = setTimeout(() => trackPageEngaged(), 10000);
    return () => clearTimeout(t);
  }, []);

  // Paywall signal: user previewed the result ≥5s without downloading.
  const recDownloadedRef = useRef(false);
  useEffect(() => {
    if (recPhase === 'result' && recBlob) {
      recDownloadedRef.current = false;
      const t = setTimeout(() => {
        if (!recDownloadedRef.current) trackRecordingViewed();
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [recPhase, recBlob]);

  // Record button: idle → open chooser; recording → stop;
  // countdown/result phases ignore the button (use the panel buttons)
  const onRecordButton = useCallback(() => {
    if (!isRunning) return;
    if (isRecording) {
      finishRecording();
      return;
    }
    // Recording = the player is about to perform — drop any open menus
    // (⋯ panel and settings panel must not appear in the recording)
    setMoreOpen(false);
    setShowSettings(false);
    // Platforms without canvas.captureStream (iOS Safari) can't record
    // video — fall back to audio before showing the chooser.
    if (!VIDEO_REC_SUPPORTED && recMode !== 'audio') {
      setRecMode('audio');
    }
    setRecPhase((p) => (p === 'choosing' ? 'idle' : p === 'idle' ? 'choosing' : p));
    // Funnel entry: only when the chooser actually opens (idle → choosing).
    if (recPhase === 'idle') trackRecordButtonClicked();
  }, [isRunning, isRecording, finishRecording, recMode, recPhase]);

  const handleStartRecording = useCallback(() => {
    localStorage.setItem('gsw-rec-mode', recMode);
    localStorage.setItem('gsw-rec-ratio', recRatio);
    setRecPhase('idle'); // close the chooser
    trackRecording('started');
    startCountdown();
  }, [recMode, recRatio, startCountdown]);

  // Recording timer: countdown of remaining seconds + 3-2-1 wrap-up overlay
  // (RECORD_SECONDS-3s in → show 3,2,1 at the center, DOM-only so it never enters the video)
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      if (recordingStartRef.current) {
        const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
        setRecordingTime(Math.max(0, RECORD_SECONDS - elapsed));
      }
    }, 100);

    // Auto-stop at RECORD_SECONDS
    const timeout = setTimeout(() => {
      finishRecordingRef.current();
    }, RECORD_SECONDS * 1000);

    // Start the wrap-up countdown with 3s left
    const endTimeout = setTimeout(() => {
      setEndCount(3);
      let n = 3;
      endCountTimerRef.current = window.setInterval(() => {
        n -= 1;
        if (n <= 0) {
          if (endCountTimerRef.current) {
            clearInterval(endCountTimerRef.current);
            endCountTimerRef.current = null;
          }
          setEndCount(null);
        } else {
          setEndCount(n);
        }
      }, 1000);
    }, (RECORD_SECONDS - 3) * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      clearTimeout(endTimeout);
      if (endCountTimerRef.current) {
        clearInterval(endCountTimerRef.current);
        endCountTimerRef.current = null;
      }
      setEndCount(null);
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

        {/* Visual atmosphere — stage lighting over the live view (display
            layer only, never touches the gesture pipeline). WYSIWYG with
            the recording window (drawn in drawRecFrame). Opacity = the
            user's strength slider (base gradient × strength/100). */}
        {vignetteStrength > 0 && <div className="theme-overlay theme-vignette" style={{ opacity: vignetteStrength / 100 }} />}
        {/* Scanlines only while the camera runs — on the pre-camera landing
            they read as frosted-glass mesh over the UI (user feedback
            2026-08-05); the performance atmosphere belongs to the
            performance. The recording window still gets them (camera on). */}
        {isRunning && scanlinesStrength > 0 && <div className="theme-overlay theme-scanlines" style={{ opacity: scanlinesStrength / 100 }} />}

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
            <button className={`mobile-collapse ${synthState.appMode === 'gesture' ? 'active' : ''}`} onClick={() => { trackSettingChanged('app_mode', 'gesture'); setSynthState(prev => ({ ...prev, appMode: 'gesture' })); }} data-tip="Two-hand chord mode — left hand picks harmony, right hand controls expression">Gesture</button>
            <button className={`mobile-collapse ${synthState.appMode === 'theremin' ? 'active' : ''}`} onClick={() => { trackSettingChanged('app_mode', 'theremin'); setSynthState(prev => ({ ...prev, appMode: 'theremin' })); }} data-tip="Theremin mode — right hand Y-axis = pitch, left hand Y-axis = volume">Theremin</button>
            <button className={`mobile-collapse ${synthState.appMode === 'monoPiano' ? 'active' : ''}`} onClick={() => { trackSettingChanged('app_mode', 'monoPiano'); setSynthState(prev => ({ ...prev, appMode: 'monoPiano' })); }} data-tip="Mono Piano mode — finger count selects a single note interval">Piano</button>
            <span className="divider mobile-collapse" />
            <select className="mobile-collapse" value={KEYS[synthState.keyOffset]?.name ?? 'C'} onChange={(e) => { const ki = KEYS.findIndex(k => k.name === e.target.value); setSynthState(prev => ({ ...prev, keyOffset: ki })); }} data-tip="Transpose all chords to a different key">
              {KEYS.map(key => <option key={key.name} value={key.name}>{key.name}</option>)}
            </select>
            <span className="divider mobile-collapse" />
            <button className={`icon-btn mobile-collapse ${synthState.arpeggiate ? 'active' : ''}`} onClick={() => { trackSettingChanged('arpeggiate', synthState.arpeggiate ? 'off' : 'on'); setSynthState(prev => ({ ...prev, arpeggiate: !prev.arpeggiate })); }} data-tip="Arpeggiator — sweep chord notes like a harp">⟿</button>
            <button className={`icon-btn mobile-collapse ${synthState.autoBass ? 'active' : ''}`} onClick={() => { trackSettingChanged('auto_bass', synthState.autoBass ? 'off' : 'on'); setSynthState(prev => ({ ...prev, autoBass: !prev.autoBass })); }} data-tip="Auto Bass — root note two octaves below">∿</button>
            <button className={`icon-btn mobile-collapse ${showSkeleton ? 'active' : ''}`} onClick={() => setShowSkeleton(!showSkeleton)} data-tip="Hand skeleton — show/hide tracking lines" style={showSkeleton ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>
              {/* Hand-tracking skeleton: the MediaPipe 21-landmark graph
                  (this IS what the toggle shows over the hands) */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M11 21.2 L9.4 17.6 L7.1 15.6 L5.4 13.1 L4.7 11.3 M11 21.2 L9.7 14.9 L9.5 10.6 L9.5 7.6 L9.6 5.3 M9.7 14.9 L11.3 14.9 L11.5 9.9 L11.6 6.5 L11.7 3.9 M11.3 14.9 L12.9 14.9 L13.3 10.6 L13.6 7.6 L13.9 5.3 M12.9 14.9 L14.5 15.5 L15.5 12.1 L16.2 9.6 L16.9 7.5 M11 21.2 L14.5 15.5"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <g fill="currentColor">
                  {[[11,21.2],[9.4,17.6],[7.1,15.6],[5.4,13.1],[4.7,11.3],[9.7,14.9],[9.5,10.6],[9.5,7.6],[9.6,5.3],[11.3,14.9],[11.5,9.9],[11.6,6.5],[11.7,3.9],[12.9,14.9],[13.3,10.6],[13.6,7.6],[13.9,5.3],[14.5,15.5],[15.5,12.1],[16.2,9.6],[16.9,7.5]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.85" />)}
                </g>
              </svg>
            </button>
            <span className="divider mobile-collapse" />
            <button className="icon-btn mobile-collapse" onClick={stopCamera} data-tip="Stop camera and audio">
              {/* video.slash — camera pictogram + magenta cross (Apple-style) */}
              <svg width="20" height="17" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="6.6" width="14.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M7.2 6.6 L8.3 4.3 L12.4 4.3 L13.5 6.6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                <circle cx="9.3" cy="11.6" r="2.4" stroke="currentColor" strokeWidth="1.7" />
                <line x1="21" y1="3" x2="3.5" y2="21" stroke="var(--neon-magenta)" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button className="icon-btn mobile-collapse" onClick={() => { setShowSettings(!showSettings); }} data-tip={showSettings ? 'Hide settings panel' : 'Show settings panel'} style={showSettings ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>
              {/* Gear like the iOS Settings / clockwork cog: a thick ring
                  with many short fat teeth and an open center */}
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="5.7" stroke="currentColor" strokeWidth="2.7" />
                {Array.from({ length: 12 }, (_, i) => {
                  const a = (i * 30 * Math.PI) / 180;
                  return (
                    <line key={i}
                      x1={12 + 5.7 * Math.cos(a)} y1={12 + 5.7 * Math.sin(a)}
                      x2={12 + 8.4 * Math.cos(a)} y2={12 + 8.4 * Math.sin(a)}
                      stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" />
                  );
                })}
              </svg>
            </button>
            <button className={`icon-btn ${showHelpPulse ? 'help-pulse' : ''}`} onClick={() => { if (!showHelp) trackHelpButtonClicked(); dismissHelpPulse(); setShowHelp(!showHelp); }} data-tip="How to play — hand gesture guide" style={showHelp ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>?</button>
            <span className="divider" />
            {/* Record capsule — a horizontal bar with a red dot (REC), the most
                prominent button at the end of the toolbar. Shows countdown
                seconds while recording. */}
            <button className={`icon-btn rec-capsule ${isRecording ? 'recording' : ''}`} onClick={onRecordButton} data-tip={isRecording ? `Recording — ${recordingTime}s left` : `Record — audio, video or skeleton (max ${RECORD_SECONDS}s)`} style={isRecording && recordingTime <= 3 ? { color: 'var(--neon-magenta)', textShadow: '0 0 12px rgba(255, 110, 199, 0.6)' } : undefined}>
              {/* Abstract record: frosted pill + red dot (Apple Camera-app language) */}
              {isRecording ? `${recordingTime}s` : (
                <svg width="11" height="11" viewBox="0 0 11 11">
                  <circle cx="5.5" cy="5.5" r="4.7" fill="#ff3b5c" />
                </svg>
              )}
            </button>
            {/* More ⋯ — portrait phones only (hidden by media query on
                desktop/landscape). Opens the collapsed controls panel. */}
            <button
              className={`icon-btn mobile-more-btn ${showMorePulse ? 'help-pulse' : ''}`}
              onClick={() => {
                if (moreOpen) dismissMorePulse();
                // Mutual exclusion: only one floating layer at a time —
                // opening ⋯ closes the settings panel (and vice versa).
                if (!moreOpen) setShowSettings(false);
                setMoreOpen(!moreOpen);
              }}
              data-tip={moreOpen ? 'Close more options' : 'More options'}
              style={moreOpen ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}
            >{moreOpen ? '✕' : '⋯'}</button>
          </div>

          {/* Mobile ⋯ panel — the collapsed controls (modes, arp/bass,
              skeleton, settings, stop). Rendered under the toolbar; the
              backdrop closes it on outside tap. Portrait phones only. */}
          {moreOpen && (
            <>
              <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)} />
              <div className="frost-panel mobile-more-panel">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.62rem' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className={synthState.appMode === 'gesture' ? 'active' : ''} onClick={() => { trackSettingChanged('app_mode', 'gesture'); setSynthState(prev => ({ ...prev, appMode: 'gesture' })); setMoreOpen(false); }}>Gesture</button>
                    <button className={synthState.appMode === 'theremin' ? 'active' : ''} onClick={() => { trackSettingChanged('app_mode', 'theremin'); setSynthState(prev => ({ ...prev, appMode: 'theremin' })); setMoreOpen(false); }}>Theremin</button>
                    <button className={synthState.appMode === 'monoPiano' ? 'active' : ''} onClick={() => { trackSettingChanged('app_mode', 'monoPiano'); setSynthState(prev => ({ ...prev, appMode: 'monoPiano' })); setMoreOpen(false); }}>Piano</button>
                  </div>
                  {/* One row of icon buttons — same glyphs as the landscape/desktop toolbar */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className={`icon-btn ${synthState.arpeggiate ? 'active' : ''}`} onClick={() => { trackSettingChanged('arpeggiate', synthState.arpeggiate ? 'off' : 'on'); setSynthState(prev => ({ ...prev, arpeggiate: !prev.arpeggiate })); }} data-tip="Arpeggiator">⟿</button>
                    <button className={`icon-btn ${synthState.autoBass ? 'active' : ''}`} onClick={() => { trackSettingChanged('auto_bass', synthState.autoBass ? 'off' : 'on'); setSynthState(prev => ({ ...prev, autoBass: !prev.autoBass })); }} data-tip="Auto Bass">∿</button>
                    <button className={`icon-btn ${showSkeleton ? 'active' : ''}`} onClick={() => setShowSkeleton(!showSkeleton)} data-tip="Hand skeleton" style={showSkeleton ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>
                      {/* Same 21-landmark skeleton glyph as the desktop toolbar */}
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M11 21.2 L9.4 17.6 L7.1 15.6 L5.4 13.1 L4.7 11.3 M11 21.2 L9.7 14.9 L9.5 10.6 L9.5 7.6 L9.6 5.3 M9.7 14.9 L11.3 14.9 L11.5 9.9 L11.6 6.5 L11.7 3.9 M11.3 14.9 L12.9 14.9 L13.3 10.6 L13.6 7.6 L13.9 5.3 M12.9 14.9 L14.5 15.5 L15.5 12.1 L16.2 9.6 L16.9 7.5 M11 21.2 L14.5 15.5"
                          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        <g fill="currentColor">
                          {[[11,21.2],[9.4,17.6],[7.1,15.6],[5.4,13.1],[4.7,11.3],[9.7,14.9],[9.5,10.6],[9.5,7.6],[9.6,5.3],[11.3,14.9],[11.5,9.9],[11.6,6.5],[11.7,3.9],[12.9,14.9],[13.3,10.6],[13.6,7.6],[13.9,5.3],[14.5,15.5],[15.5,12.1],[16.2,9.6],[16.9,7.5]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.85" />)}
                        </g>
                      </svg>
                    </button>
                    <button className="icon-btn" onClick={() => { setMoreOpen(false); setShowSettings(!showSettings); }} data-tip="Settings" style={showSettings ? {background:'rgba(0,255,204,0.12)',borderColor:'rgba(0,255,204,0.3)',color:'var(--neon-cyan)'} : {}}>
                      {/* Same iOS-Settings cog as the desktop toolbar */}
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="5.7" stroke="currentColor" strokeWidth="2.7" />
                        {Array.from({ length: 12 }, (_, i) => {
                          const a = (i * 30 * Math.PI) / 180;
                          return (
                            <line key={i}
                              x1={12 + 5.7 * Math.cos(a)} y1={12 + 5.7 * Math.sin(a)}
                              x2={12 + 8.4 * Math.cos(a)} y2={12 + 8.4 * Math.sin(a)}
                              stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" />
                          );
                        })}
                      </svg>
                    </button>
                    <button className="icon-btn" onClick={() => { setMoreOpen(false); stopCamera(); }} data-tip="Stop camera">
                      {/* Same video.slash glyph as the desktop toolbar (NOT a ✕ —
                          ✕ is reserved for closing the ⋯ panel itself) */}
                      <svg width="20" height="17" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="6.6" width="14.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
                        <path d="M7.2 6.6 L8.3 4.3 L12.4 4.3 L13.5 6.6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                        <circle cx="9.3" cy="11.6" r="2.4" stroke="currentColor" strokeWidth="1.7" />
                        <line x1="21" y1="3" x2="3.5" y2="21" stroke="var(--neon-magenta)" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Settings panel — only for Gesture mode. Has its own ✕ close
              (the gear that opened it may be folded away on portrait
              phones — never leave the panel without a close path). */}
          {showSettings && synthState.appMode === 'gesture' && (
            <div className="frost-panel" style={{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', flexDirection: 'column', gap: '10px', padding: '16px 18px', maxWidth: '700px', fontSize: '0.65rem' }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{ position: 'absolute', top: '6px', right: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', padding: '4px' }}
                data-tip="Close settings"
              >✕</button>
              {/* Performance settings (wraps on narrow screens) */}
              <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', flexWrap: 'wrap' }}>
              {/* Left Hand */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px' }}>
                <label style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left Hand — Harmony</label>
                <select value={synthState.leftHandMode} onChange={(e) => { trackSettingChanged('left_hand_mode', e.target.value); setSynthState(prev => ({ ...prev, leftHandMode: e.target.value as LeftHandMode })); }}>
                  <option value="scaleTilt">Scale notes + tilt major/minor</option>
                  <option value="scaleLocked">Scale notes only (lock mode)</option>
                </select>
                {synthState.leftHandMode === 'scaleTilt' ? (
                  <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Fingers pick the scale degree; wrist tilt flips major ↔ minor.</p>
                ) : (
                  <>
                    <select value={synthState.lockedMode ?? 'major'} onChange={(e) => { trackSettingChanged('locked_mode', e.target.value); setSynthState(prev => ({ ...prev, lockedMode: e.target.value as 'major' | 'minor' })); }}>
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
                <select value={synthState.rightHandMode} onChange={(e) => { trackSettingChanged('right_hand_mode', e.target.value); setSynthState(prev => ({ ...prev, rightHandMode: e.target.value as RightHandMode })); }}>
                  <option value="fingerLayout">Finger layout = chord style</option>
                  <option value="fixedChordStyle">Fixed chord style</option>
                </select>
                {synthState.rightHandMode === 'fingerLayout' ? (
                  <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>1–4 fingers set triad / inversion / 7ths. Height = volume, tilt = tone.</p>
                ) : (
                  <>
                    <select value={synthState.lockedChordStyle ?? 'majorTriad'} onChange={(e) => { trackSettingChanged('chord_style', e.target.value); setSynthState(prev => ({ ...prev, lockedChordStyle: e.target.value as ChordStyle })); }}>
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
                      <select value={synthState.arpSpeed} onChange={(e) => { trackSettingChanged('arp_speed', e.target.value); setSynthState(prev => ({ ...prev, arpSpeed: e.target.value as ArpSpeed })); }} style={{ width: '100%' }}>
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
                        <input type="range" min="0" max="1" step="0.05" value={synthState.bassVolume} onChange={(e) => { trackSettingChanged('bass_volume', e.target.value); setSynthState(prev => ({ ...prev, bassVolume: parseFloat(e.target.value) })); }} style={{ flex: 1, accentColor: 'var(--neon-cyan)' }} />
                        <span style={{ fontSize: '0.6rem', width: '24px' }}>{Math.round(synthState.bassVolume * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>

              {/* Visual atmosphere — stage lighting, WYSIWYG with the live
                  view and the recording window (window only; design bands
                  stay clean). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px', flexWrap: 'wrap' }}>
                <label style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Visual — Atmosphere</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: vignetteStrength > 0 ? 'var(--neon-cyan)' : 'var(--text-muted)', fontSize: '0.6rem', width: '62px' }}>Vignette</span>
                    <input
                      type="range" min="0" max="100" step="5" value={vignetteStrength}
                      onChange={(e) => { trackSettingChanged('vignette', e.target.value); setVignetteStrength(Number(e.target.value)); }}
                      style={{ width: '90px', accentColor: 'var(--neon-cyan)' }}
                    />
                    <span style={{ fontSize: '0.6rem', width: '26px', color: 'var(--text-muted)' }}>{vignetteStrength}%</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: scanlinesStrength > 0 ? 'var(--neon-cyan)' : 'var(--text-muted)', fontSize: '0.6rem', width: '62px' }}>Scanlines</span>
                    <input
                      type="range" min="0" max="100" step="5" value={scanlinesStrength}
                      onChange={(e) => { trackSettingChanged('scanlines', e.target.value); setScanlinesStrength(Number(e.target.value)); }}
                      style={{ width: '90px', accentColor: 'var(--neon-cyan)' }}
                    />
                    <span style={{ fontSize: '0.6rem', width: '26px', color: 'var(--text-muted)' }}>{scanlinesStrength}%</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Onboarding: hands-ready badge (first stable two-hand
                detection, once per session, 3s) ───────────────────── */}
        {showHandsReady && (
          <div className="hands-ready-badge">
            <span style={{ color: 'var(--neon-cyan)' }}>✓</span> Both hands detected — play!
          </div>
        )}

        {/* ─── Help Modal ────────────────────────────────────────────── */}
        {showHelp && (
          <div style={{
            position: 'absolute', top: '12px', left: '12px', width: 'min(360px, calc(100vw - 24px))',
            maxHeight: 'min(80vh, 560px)', overflowY: 'auto',
            background: 'rgba(8, 8, 20, 0.85)', backdropFilter: 'var(--frost-blur)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px',
            padding: '14px 18px', boxShadow: 'var(--frost-shadow)', zIndex: 100,
            fontSize: '0.68rem', color: '#d0d0e8', lineHeight: 1.45,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.82rem', color: 'var(--neon-cyan)' }}>Quick Guide</span>
              <button onClick={() => setShowHelp(false)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '50%', width: '22px', height: '22px', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {/* How it works — two-hand demo: the left hand raises the
                chord degree (real gesture art), the right hand the chord
                type by finger count; together as in real play. The
                matching table row highlights. */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'rgba(0,255,204,0.05)', border: '1px solid rgba(0,255,204,0.15)', borderRadius: '10px', minHeight: '58px' }}>
                {handArt(HELP_DEMO_STEPS[demoStep].left, 52, 'var(--neon-cyan)')}
                <div style={{ fontSize: '0.58rem', lineHeight: 1.5 }}>
                  <div style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left hand — chord</div>
                  <div key={demoStep} className="demo-step-text" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff' }}>{gradeNameFor(HELP_DEMO_STEPS[demoStep].row)}</div>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'rgba(255,110,199,0.05)', border: '1px solid rgba(255,110,199,0.15)', borderRadius: '10px', minHeight: '58px' }}>
                {handArt('1', 52, 'var(--neon-magenta)', true)}
                <div style={{ fontSize: '0.58rem', lineHeight: 1.5 }}>
                  <div style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right hand — sound</div>
                  <div style={{ color: '#d0d0e8' }}>height = volume</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', alignItems: 'flex-start' }}>
              {/* Left hand → chord degree (the one that picks the note) */}
              <table style={{ borderCollapse: 'collapse', flex: 1 }}>
                <thead>
                  <tr style={{ color: '#a0a0c8', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ textAlign: 'left', padding: '3px 10px 3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Left hand</th>
                    <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Chord</th>
                  </tr>
                </thead>
                <tbody>
                  {HELP_DEMO_STEPS.map((s, row) => {
                    const active = row === HELP_DEMO_STEPS[demoStep].row;
                    return (
                      <tr key={s.left} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        background: active ? 'rgba(0,255,204,0.09)' : 'transparent',
                        boxShadow: active ? 'inset 2px 0 0 var(--neon-cyan)' : 'none',
                        transition: 'background 0.25s ease',
                      }}>
                        <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {handArt(s.left, 24, active ? 'var(--neon-cyan)' : '#8fbfd0')}
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{s.left}</span>
                          </div>
                        </td>
                        <td style={{ padding: '3px 0', color: 'var(--neon-cyan)', fontWeight: active ? 800 : 600, fontSize: active ? '0.7rem' : '0.62rem', whiteSpace: 'nowrap' }}>{gradeNameFor(s.row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Right hand → chord type (independent of the chord) */}
              <table style={{ borderCollapse: 'collapse', flexShrink: 0 }}>
                <thead>
                  <tr style={{ color: '#a0a0c8', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ textAlign: 'left', padding: '3px 8px 3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Right hand</th>
                    <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {(['1', '2', '3', '4', 'mute'] as const).map((k) => (
                    <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          {handArt(k, 24, 'var(--neon-magenta)', true)}
                          {k !== 'mute' && (
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.58rem', color: 'var(--text-muted)' }}>{k}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '3px 0', fontSize: '0.6rem', whiteSpace: 'nowrap', color: '#d0d0e8' }}>
                        {k === 'mute' ? 'mute' : ({ '1': '3-note', '2': 'inverted', '3': '4-note', '4': '5-note' } as Record<string, string>)[k]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: '0.54rem', color: '#a0a0c8', lineHeight: 1.5, marginTop: '2px' }}>
                finger count → chord type<br/>enable in Settings · Right hand
              </div>
            </div>

            <div style={{ fontSize: '0.56rem', color: '#b0b0d0', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '6px', paddingTop: '6px' }}>
              <div style={{ color: '#a0a0c8', fontWeight: 600, marginBottom: '4px' }}>Other gestures</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                {handArt('thumb', 24, 'var(--neon-magenta)', true)}
                <span><span style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right thumb</span> out = octave down</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                <span style={{ display: 'inline-block', transform: 'rotate(-16deg)' }}>{handArt('1', 24, 'var(--neon-cyan)')}</span>
                <span style={{ color: '#a0a0c8' }}>↔</span>
                <span style={{ display: 'inline-block', transform: 'rotate(16deg)' }}>{handArt('1', 24, 'var(--neon-cyan)')}</span>
                <span><span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left wrist tilt</span> = major ↔ minor (Settings · Scale+Tilt)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                <span style={{ display: 'inline-block', transform: 'rotate(-16deg)' }}>{handArt('1', 24, 'var(--neon-magenta)', true)}</span>
                <span style={{ color: '#a0a0c8' }}>↔</span>
                <span style={{ display: 'inline-block', transform: 'rotate(16deg)' }}>{handArt('1', 24, 'var(--neon-magenta)', true)}</span>
                <span><span style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right wrist tilt</span> = tone sweep</span>
              </div>
            </div>

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

        {/* Wrap-up 3-2-1 during the last 3s — same language as the opening,
            lighter dim so the hands stay visible; DOM-only, never in the video */}
        {endCount !== null && (
          <div className="countdown-overlay" style={{ background: 'rgba(5, 5, 15, 0.42)' }}>
            <div className="countdown-hint">Wrap up</div>
            <div key={endCount} className="countdown-num wrap-up">{endCount}</div>
          </div>
        )}

        {/* Mode + ratio chooser (bottom sheet on mobile, card on desktop) */}
        {recPhase === 'choosing' && (
          <div className="rec-sheet">
            <div className="rec-body">
              <div className="rec-sheet-title">Record performance</div>
              <div className="rec-sheet-sub">What should the recording capture?</div>
              <div className="rec-options">
                {(['video', 'skeleton', 'audio'] as RecMode[]).map((id) => (
                  <button
                    key={id}
                    className={`rec-option ${recMode === id ? 'active' : ''} ${id !== 'audio' && !VIDEO_REC_SUPPORTED ? 'disabled' : ''}`}
                    onClick={() => { if ((id === 'audio' || VIDEO_REC_SUPPORTED) && id !== recMode) { trackRecordingModeChanged(recMode, id); setRecMode(id); } }}
                  >
                    {REC_SVG_PREVIEWS[id]}
                    <span>
                      <strong>
                        {id === 'video' ? 'Full' : id === 'skeleton' ? 'Skeleton' : 'Audio only'}
                        {/* "default" only makes sense for first-time choosers —
                            returning players see their own saved choice */}
                        {id === 'skeleton' && !savedRecModeExists && <span className="rec-default-tag">default</span>}
                      </strong>
                      {/* Intent labels — kept short enough to fit ONE line
                          on mobile buttons (~160px), so the chooser doesn't
                          grow rows. */}
                      <em>{id === 'video' ? 'Real you — best for sharing' : id === 'skeleton' ? 'Privacy-friendly' : 'Just the sound'}</em>
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
              {/* Mic section: ALWAYS visible so users know the sing-along
                  feature exists — grayed out until the mic is enabled */}
              <div className={`rec-mic-section ${micStreamRef.current ? '' : 'disabled'}`}>
                <label className="rec-mic-toggle">
                  <input type="checkbox" checked={micOn} onChange={(e) => { trackMicToggled(e.target.checked); setMicOn(e.target.checked); }} disabled={!micStreamRef.current} />
                  <span>🎤 Include my voice — sing along with the chords</span>
                </label>
                {micStreamRef.current ? (
                  <>
                    {/* Liquid-glass mic level meter */}
                    <div className="rec-mic-meter" title="Microphone level — speak to test">
                      {Array.from({ length: 14 }, (_, i) => {
                        const h = micLevel > 0.02 ? Math.max(14, Math.min(100, micLevel * 100 * (0.55 + 0.45 * ((i % 3) / 2)))) : 5;
                        return <span key={i} style={{ height: `${h}%`, opacity: micLevel > 0.02 ? 1 : 0.25 }} />;
                      })}
                    </div>
                    {micDevices.length > 1 && (
                      <>
                        <div className="rec-sheet-sub">Microphone</div>
                        <select className="rec-device-select" value={micDeviceId} onChange={(e) => switchMicDevice(e.target.value)}>
                          {micDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <div className="rec-sheet-sub">Recording mix <span className="rec-mix-desc">— balance your voice against the chords</span></div>
                    <div className="rec-mix-row">
                      <span>Voice</span>
                      <input type="range" min={50} max={200} value={Math.round(recVoice * 100)} onChange={(e) => setRecVoice(Number(e.target.value) / 100)} className="rec-mix-slider" />
                      <span>Chords</span>
                    </div>
                    <div className="rec-mix-value">Voice {Math.round(recVoice * 100)}% in the final video</div>
                    <div className="rec-sheet-sub">Vocal polish <span className="rec-mix-desc">— voice effects in the recording</span></div>
                    <select
                      className="rec-device-select"
                      value={recPolish}
                      onChange={(e) => { trackSettingChanged('vocal_polish', e.target.value); setRecPolish(e.target.value as VocalPolish); }}
                    >
                      <option value="off">Off — raw voice</option>
                      <option value="light">Light — subtle</option>
                      <option value="standard">Standard — recommended</option>
                      <option value="strong">Strong — roomy</option>
                    </select>
                  </>
                ) : micPermState === 'denied' ? (
                  <div className="rec-mic-notice">
                    <strong>Sing along?</strong> You can record your voice over the chords — but the
                    microphone is <strong>blocked for this site</strong>. Click the <strong>🔒 lock icon</strong> in the
                    address bar → Site settings → Microphone → <strong>Allow</strong>, then come back here.
                  </div>
                ) : (
                  <>
                    <div className="rec-mic-notice">
                      <strong>Sing along?</strong> You can record your voice over the chords — but the
                      microphone isn't enabled yet.
                    </div>
                    <button className="rec-mic-enable-btn" onClick={() => requestMic()}>🎤 Enable microphone</button>
                  </>
                )}
              </div>
            </div>
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
            {/* In-page playback of the take — video plays immediately
                (muted for autoplay policy; tap the controls for sound).
                WYSIWYG: atmosphere, crop and watermarks all visible here.
                Audio-only takes get an <audio> player (no autoplay —
                playing sound unprompted is rude). */}
            {recPreviewUrl && (recMode === 'audio' ? (
              <audio src={recPreviewUrl} className="rec-preview rec-preview-audio" controls />
            ) : (
              <video
                src={recPreviewUrl}
                className="rec-preview"
                autoPlay
                muted
                playsInline
                controls
              />
            ))}
            <div className="rec-actions">
              <button className="rec-btn" onClick={() => setRecPhase('idle')}>Close</button>
              <button className="rec-btn primary" onClick={() => { recDownloadedRef.current = true; trackDownload(); downloadRec(); }}>💾 Download</button>
              {canFileShare && <button className="rec-btn primary" onClick={shareRec}>📤 Share</button>}
            </div>
            {canFileShare && (
              <div className="rec-sheet-sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
                Share directly: WhatsApp · WeChat · Telegram<br />
                TikTok · Instagram · 抖音: Save to Photos, then upload in-app
              </div>
            )}
            {shareFailed && (
              <div className="rec-warn" style={{ marginTop: 8 }}>Sharing isn't available in this browser — use Download instead.</div>
            )}
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

        {/* ─── Dimmed overlay + Enable Camera button / loading block ──
            The container stays rendered during loading so the brand stays
            as the anchor and the loading block replaces the button. */}
        {!isRunning && !error && (
          <div className="camera-placeholder">
            {/* Brand anchored at a FIXED top position — it never moves
                when the content below switches between button and block. */}
            <div className="camera-placeholder-brand">
              <span className="camera-placeholder-brand-text">Gesture Synth Weld</span>
            </div>
            <div className="camera-placeholder-content">
            {loadingVisible ? (
              /* Loading = the Enable Camera spot turns into a compact,
                 centered block (brand stays above as the anchor). The
                 toolbar/status stay visible — help is reachable while
                 waiting. */
              <div className={`loading-block ${loadingFading ? 'loading-fading' : ''}`}>
                {/* Big progress bar with the "Loading… %" label INSIDE it —
                    the bar IS the loading semantics, no title row needed. */}
                <div className="loading-bar-track">
                  <div className="loading-bar-fill" style={{ width: `${loadProgress}%` }} />
                  <span className="loading-bar-label">Loading… {loadProgress}%</span>
                </div>

                <div className="loading-divider" />

                {/* Gesture carousel: one table row at a time (5s), framed
                    by the dividers — color hierarchy (neon name, muted
                    hint) replaces an inner box. Both hands shown: left =
                    the changing chord gesture (cyan), right = fixed 1-finger
                    posture (magenta, mirrored — same color code as the Help
                    panel), since the right hand plays volume by height. */}
                <div className="loading-zone-label">How to play</div>
                <div className="loading-demo-row">
                  {handArt(LOADING_STEPS[loadingDemoStep].art, 26, 'var(--neon-cyan)')}
                  {handArt('1', 26, 'var(--neon-magenta)', true)}
                  <div>
                    <div className="loading-demo-name">{gradeNameFor(LOADING_STEPS[loadingDemoStep].row)}</div>
                    <div className="loading-demo-hint">{LOADING_STEPS[loadingDemoStep].hint} · Right: height = volume</div>
                  </div>
                </div>

                <div className="loading-divider" />

                <div className="loading-hint">
                  {loadingTimeoutShown ? (
                    <span>Still downloading — it continues in the background either way, so your next start will be instant.</span>
                  ) : (
                    <span>Downloading the hand-tracking model (~20 MB) — the first load takes a moment on slow connections.</span>
                  )}
                </div>

                <button
                  className="loading-cancel"
                  onClick={() => {
                    loadCancelledRef.current = true;
                    if (loadProgTimerRef.current) window.clearInterval(loadProgTimerRef.current);
                    if (loadDemoTimerRef.current) window.clearInterval(loadDemoTimerRef.current);
                    if (loadTimeoutTimerRef.current) window.clearTimeout(loadTimeoutTimerRef.current);
                    setIsLoading(false);
                  }}
                  data-tip="Cancel — the download continues in the background, next start is instant"
                >✕ Cancel</button>
              </div>
            ) : (
              <>
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
              </>
            )}
            </div>
          </div>
        )}

        {/* ─── Error (including camera denied) ───────────────────────── */}
        {error && (
          <div className="camera-placeholder error-state">
            <div className="camera-placeholder-brand">
              <span className="camera-placeholder-brand-text">Gesture Synth Weld</span>
            </div>
            <div className="camera-error-message">{error}</div>
            {/* Personalized single path — camera-related errors only
                (network/model failures shouldn't suggest camera
                permissions). */}
            {cameraErrorType && cameraErrorType !== 'other' && (
              <div className="camera-error-guide">
                <div className="camera-error-guide-item">
                  <span className="camera-error-guide-label">
                    {isIOS ? 'iPhone / iPad' : isAndroid ? 'Android' : /Mac/i.test(navigator.userAgent) ? 'Mac' : 'Windows'}
                  </span>
                  {isIOS ? (
                    <>Settings → Privacy &amp; Security → <strong>Camera</strong> → turn on your browser. Then reload.</>
                  ) : isAndroid ? (
                    <>Settings → Apps → your browser → Permissions → <strong>Camera</strong> → Allow. Then reload.</>
                  ) : /Mac/i.test(navigator.userAgent) ? (
                    <>System Settings → Privacy &amp; Security → <strong>Camera</strong> → turn on your browser. Then reload.</>
                  ) : (
                    <>Settings → Privacy &amp; Security → <strong>Camera</strong> → Camera access: On → make sure your browser is allowed. Then reload.</>
                  )}
                </div>
              </div>
            )}
            {/* Permission denial: VISUAL hint — a mini address bar with the
                lock icon, language-independent (users who can't follow the
                text still find the lock). Feather lock icon (MIT). */}
            {cameraErrorType === 'permission_denied' && (
              <div className="err-visual">
                <div className="err-addressbar">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="err-url">gesturesynthweld.com</span>
                  <span className="err-dots">⋯</span>
                </div>
                <div className="err-steps">
                  <span><b>①</b> Click the lock</span>
                  <span><b>②</b> Camera: Allow</span>
                  <span><b>③</b> Reload &amp; retry</span>
                </div>
              </div>
            )}
            {/* Full step-by-step guide lives in the SEO section below the
                fold — link it for users who need more detail than the
                short hints (per-OS × per-browser × mobile/desktop). */}
            <a
              href="#troubleshooting"
              style={{ color: 'var(--neon-cyan)', fontSize: '0.68rem', textDecoration: 'underline', marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              {/* Feather book icon (MIT) — consistent with the lock icon,
                  no stray emoji in the first screen. */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              View the full troubleshooting guide →
            </a>
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

            {/* Now playing chord — prominent but transparent, centered.
                Four-element hierarchy: [degree chip] Amaj7 (extension
                smaller + dimmer) with the amber 8vb corner badge. */}
            {synthState.appMode === 'gesture' && synthState.isPlaying && (
              <div style={{
                position: 'absolute',
                top: '40%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 3,
                pointerEvents: 'none',
                letterSpacing: '0.1em',
              }}>
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-display)',
                }}>
                  {/* Scale-degree chip — left ear (Inter, small, quiet) */}
                  <span style={{
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    color: 'rgba(150, 255, 235, 0.45)',
                    marginRight: '0.45em',
                    letterSpacing: '0.08em',
                  }}>
                    {GRADE_NAMES[synthState.chordIndex % GRADE_NAMES.length]}
                  </span>
                  {/* Root + quality — the main note */}
                  <span style={{ fontSize: '5rem', fontWeight: 900, color: 'rgba(0, 255, 204, 0.15)', lineHeight: 1 }}>
                    {synthState.chordBase}
                  </span>
                  {/* Extension — right-hand thickness, smaller + dimmer */}
                  <span style={{ fontSize: '2rem', fontWeight: 500, color: 'rgba(0, 255, 204, 0.08)', marginLeft: '0.15em' }}>
                    {synthState.chordExt}
                  </span>
                  {/* Octave badge — floats just outside the chord symbol's
                      right edge (translateX(100%) guarantees it never
                      overlaps the note glyphs). */}
                  {synthState.octaveDown && (
                    <span style={{
                      position: 'absolute',
                      top: '-0.4em',
                      right: 0,
                      transform: 'translateX(100%)',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#ffb84d',
                      background: 'rgba(255, 140, 0, 0.12)',
                      border: '1px solid rgba(255, 160, 40, 0.4)',
                      borderRadius: '999px',
                      padding: '0.15em 0.55em',
                      letterSpacing: '0.04em',
                    }}>
                      8vb
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Waveform visualization — shows whenever hands are active */}
            <div style={{
              position: 'absolute',
              bottom: '45px',
              left: 0,
              right: 0,
              height: '46px',
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

        {/* ─── Status bar — always visible (the old !isLoading guard was
                from the full-screen-loading era; the block-style loading
                doesn't cover it, so the bar must stay) ─────────────── */}
        {(
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
                onChange={(e) => { trackSettingChanged('metronome_bpm', e.target.value); setMetronomeBpm(Number(e.target.value)); }}
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
              <select value={metronomeTimeSig} onChange={(e) => { trackSettingChanged('metronome_time_sig', e.target.value); setMetronomeTimeSig(e.target.value); }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', padding: '1px' }}>
                <option>3/4</option><option>4/4</option><option>5/4</option><option>6/8</option><option>7/8</option>
              </select>
              <select value={metronomeBars} onChange={(e) => { trackSettingChanged('metronome_bars', e.target.value); setMetronomeBars(e.target.value); }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', padding: '1px' }}>
                <option value="1">1 bar</option><option value="2">2 bars</option><option value="4">4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option>
              </select>
              <select value={metronomeSound} onChange={(e) => { trackSettingChanged('metronome_sound', e.target.value); setMetronomeSound(e.target.value); }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem', padding: '1px' }}>
                <option value="click">Click</option><option value="wood">Wood</option><option value="beep">Beep</option><option value="hihat">Hi-hat</option>
              </select>
              <button
                onClick={() => { trackSettingChanged('metronome', metronomeOn ? 'off' : 'on'); setMetronomeOn(!metronomeOn); }}
                style={{
                  background: metronomeOn ? 'rgba(0,255,204,0.15)' : 'transparent',
                  border: `1px solid ${metronomeOn ? 'rgba(0,255,204,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '3px', color: metronomeOn ? 'var(--neon-cyan)' : 'var(--text-muted)',
                  fontSize: '0.6rem', padding: '1px 5px', cursor: 'pointer',
                }}
              >
                ♪
              </button>
              <input type="range" min="0" max="1" step="0.05" value={metronomeVolume} onChange={(e) => { trackSettingChanged('metronome_volume', e.target.value); setMetronomeVolume(Number(e.target.value)); }} style={{ width: '50px', accentColor: 'var(--neon-cyan)' }} />
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

