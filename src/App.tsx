import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  initHandTracking,
  prefetchModel,
} from './handTracker';
import { audioEngine } from './audioEngine';
import { CameraSource } from './input/cameraSource';
import { KeyboardSource } from './input/keyboardSource';
import type { HandFrame } from './input/types';
import { DEFAULT_KEYMAP, displayKey, loadKeymap, saveKeymap, type KbAction } from './input/keymap';
import { KbGuide } from './components/KbGuide';
import { SettingsPanel } from './components/SettingsPanel';
import { HelpModal } from './components/HelpModal';
import { renderHandArt } from './components/HandArt';
import {
  roundRectPath,
  drawUrlPill,
  drawMetalBrand,
  drawChordHud,
  drawChordText,
  drawStageBackground,
  drawHandSkeleton,
} from './hud/draw';
import { drawWaveform } from './hud/waveform';
import { useRecording } from './recording/useRecording';
import { RecSheet } from './recording/RecSheet';
import { RECORD_SECONDS, VIDEO_REC_SUPPORTED } from './recording/constants';
import { WHATS_NEW, whatsNewActive, whatsNewDismissed, markWhatsNewDismissed } from './whatsNew';
import {
  DIATONIC_CHORDS,
  KEYS,
  getChordName,
  getChordParts,
  midiToFreq,
  type ChordStyle,
} from './chords';
import {
  FINGER_TO_CHORD_INDEX,
  FINGER_TO_NOTE_INTERVAL,
  type GestureState,
  type HandData,
  type SynthState,
  type AppMode,
  type RecMode,
  type RecRatio,
  type RecPhase,
} from './types';
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
  trackScrollToPlaybook,
  trackSettingChanged,
  trackWatchdogTriggered,
  trackKeyboardModeEntered,
  trackKeyboardModeExited,
  trackKeyboardFirstNote,
  trackKeyboardGuideShown,
  trackKeyboardGuideDismissed,
  type KeyboardModeSource,
} from './analytics';
import { AFFILIATE_CARD_URL, ENABLE_AFFILIATE_CARD } from './config';
// Config imports removed — external scripts feature not currently active

/* Keys KeyboardSource maps — their default browser behavior (page
 * scrolling for ↑/↓/Space) is blocked while keyboard mode is active.
 * Everything else keeps native behavior (Tab, F5, …). Player-customizable
 * (2026-08-10) — the live set lives in the mappedKeysRef declared inside
 * the component (derived from `keymap`), not a static list here. */

/* ─── Gesture Synth Weld — Two-Hand Division System ─────────────────── */

// Recording domain: constants (RECORD_SECONDS, VIDEO_REC_SUPPORTED,
// REC_RATIO_*, REC_SVG_PREVIEWS) live in src/recording/constants.tsx;
// cover art + mime picking in src/recording/utils.ts; the whole flow
// (chooser → countdown → record → result, mic, compositor) in
// src/recording/useRecording.ts (extracted 2026-08-09, pure move).

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
  const [hasLeftHand, setHasLeftHand] = useState(false);
  const [hasRightHand, setHasRightHand] = useState(false);

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
  // Keyboard input source (no-camera mode).
  const keyboardSourceRef = useRef<KeyboardSource | null>(null);
  if (!keyboardSourceRef.current) keyboardSourceRef.current = new KeyboardSource();

  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // What's-new dismissed state — mirrored in React so the landing card
  // disappears the moment Help opens (localStorage alone can't trigger a
  // re-render, bug 2026-08-09: the card stayed visible under Help).
  const [whatsNewDismissedState, setWhatsNewDismissedState] = useState(() => whatsNewDismissed());

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
  // No-camera mode (2026-08-09, refactor branch): keyboard drives the
  // same consume pipeline via synthetic HandData (see input/keyboardSource).
  // Persisted so camera-less users stay productive across visits.
  const [keyboardMode, setKeyboardMode] = useState(() => {
    try { return localStorage.getItem('gsw-keyboard-mode') === '1'; } catch { return false; }
  });
  const keyboardModeRef = useRef(keyboardMode);
  useEffect(() => { keyboardModeRef.current = keyboardMode; }, [keyboardMode]);
  // Player-customizable keyboard bindings (2026-08-10) — persisted so a
  // rebind (e.g. minor/major off '[' / ']', hard to reach on German
  // QWERTZ) survives visits. KeyboardSource resolves actions through
  // whatever's currently set here (see input/keymap.ts).
  const [keymap, setKeymapState] = useState<Record<KbAction, string>>(() => loadKeymap());
  const handleKeymapChange = useCallback((map: Record<KbAction, string>) => {
    saveKeymap(map);
    setKeymapState(map);
  }, []);
  useEffect(() => {
    keyboardSourceRef.current?.setKeymap(keymap);
  }, [keymap]);
  // Mirrored into a ref so the keydown/keyup effect (empty deps, see below)
  // always reads the current bindings without re-subscribing listeners.
  const mappedKeysRef = useRef<string[]>([...Object.values(DEFAULT_KEYMAP), ' ']);
  useEffect(() => {
    mappedKeysRef.current = [...Object.values(keymap), ' '];
  }, [keymap]);
  // Data-driven pulse: the ACTIVE entry declares which toolbar control it
  // teaches (pulseTarget) — future announcements that don't teach a
  // control simply omit it and nothing pulses (user decision 2026-08-09).
  const whatsNewEntry = WHATS_NEW[0];
  // Playing-scene What's-new card visibility — shows in EVERY playing
  // mode (user decision 2026-08-09: the card is a GENERIC announcement
  // slot, not a keyboard shortcut, so the old !keyboardMode gate is
  // gone; future features announce here in any scene). desktopOnly
  // entries are skipped on mobile (bug 2026-08-09: the announcement
  // would teach a desktop-only feature and a dead-end switch). Shared
  // by the card JSX and the toolbar mode-switch pulse (the card teaches
  // the switch button; the button glows while the card is shown).
  const whatsNewCardVisible = isRunning && whatsNewActive() && !whatsNewDismissedState
    && !(whatsNewEntry?.desktopOnly && isMobile);
  const pulseModeSwitch = whatsNewCardVisible && whatsNewEntry?.pulseTarget === 'mode-switch';
  // Mobile auto-collapse (iOS floating-pill pattern, user decision
  // 2026-08-09): after 4s the card tucks into a small NEW dot at the same
  // corner — the tiny viewfinder stays clear but the announcement keeps
  // its every-session presence; tap the dot to re-expand. The card
  // auto-tucks again after every re-expansion (the expanded card must
  // become quiet on its own — ✕ is only the PERMANENT dismissal; user
  // decision 2026-08-09). Desktop keeps the card expanded (380px in the
  // corner blocks nothing).
  const [whatsNewCollapsed, setWhatsNewCollapsed] = useState(false);
  useEffect(() => {
    if (!whatsNewCardVisible || !isMobile) { setWhatsNewCollapsed(false); return; }
    // Re-runs on every expansion (whatsNewCollapsed flips false on tap):
    // first show AND each dot-tap re-expansion both auto-tuck after 4s.
    if (!whatsNewCollapsed) {
      const t = window.setTimeout(() => setWhatsNewCollapsed(true), 4000);
      return () => window.clearTimeout(t);
    }
  }, [whatsNewCardVisible, isMobile, whatsNewCollapsed]);
  // First-run keyboard guide overlay: auto-shows once (localStorage flag),
  // dismisses on any key or after a few seconds; replayable from Help.
  const [showKbGuide, setShowKbGuide] = useState(false);
  const showKbGuideRef = useRef(false);
  useEffect(() => { showKbGuideRef.current = showKbGuide; }, [showKbGuide]);
  // Whether the performance pipeline was already running when the guide
  // opened. If it wasn't (Help replay on the landing page), closing the
  // guide must restore the idle state — and the guide's keypresses still
  // sound because the guide runs the keyboard pipeline while open
  // (bug 2026-08-09: guide presses were silent on first ever use, since
  // audioEngine.init() only ran on camera start).
  const kbGuideWasRunningRef = useRef(false);
  // Keyboard-session analytics: one session per keyboard start; exit
  // (switch back / settings off / page close) reports duration + notes.
  const kbSessionRef = useRef({ active: false, start: 0, notes: 0, firstNoteSent: false });
  const dismissKbGuide = useCallback((method: 'close' | 'x' | 'overlay' | 'esc') => {
    if (!showKbGuideRef.current) return;
    setShowKbGuide(false);
    trackKeyboardGuideDismissed(method);
    if (!kbGuideWasRunningRef.current) {
      // Guide borrowed the pipeline — hand it back to idle.
      keyboardSourceRef.current?.reset();
      audioEngine.stopAll();
      setIsRunning(false);
    }
    kbGuideWasRunningRef.current = false;
  }, []);
  // NO auto-hide (user decision 2026-08-09): the guide closes only on its
  // Close button, overlay click, or Esc — for BOTH the first-run auto-pop
  // and the Help replay. A timed dismissal would yank a player mid-lesson,
  // and key-press dismissal would kill the first practice press (the
  // earlier "flashed away" bug). Dismissing is always within reach.
  const showKbGuidePanel = useCallback(async () => {
    kbGuideWasRunningRef.current = isRunning || keyboardModeRef.current;
    if (!kbGuideWasRunningRef.current) {
      // Guide runs the keyboard pipeline so its presses sound (first-ever
      // visit: the audio engine was never initialized — only camera start
      // used to init it, bug 2026-08-09). The button click is the user
      // gesture that unlocks the AudioContext.
      await audioEngine.init();
      keyboardSourceRef.current?.reset();
      setIsRunning(true);
    }
    trackKeyboardGuideShown('replay');
    setShowKbGuide(true);
  }, [isRunning]);
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
  useEffect(() => { try { localStorage.setItem('gsw-vignette', String(vignetteStrength)); } catch { /* private mode */ } }, [vignetteStrength]);
  useEffect(() => { try { localStorage.setItem('gsw-scanlines', String(scanlinesStrength)); } catch { /* private mode */ } }, [scanlinesStrength]);

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
      // No-camera mode: forward mapped keys to the keyboard source
      // (only while it's the active input).
      if (keyboardModeRef.current || showKbGuideRef.current) {
        // The page scrolls (toolbar + SEO content below the fold) — ↑/↓
        // (and Space) would scroll it mid-play and drag the playing area
        // out of view (bug 2026-08-09). Block defaults for our keys while
        // keyboard mode runs OR the keyboard guide is open (the guide can
        // be replayed from Help while keyboard mode is off — the mapped
        // keys must not scroll the page there either, bug 2026-08-09).
        // Everything else (Tab, F5, …) keeps browser behavior.
        if (mappedKeysRef.current.includes(e.key)) e.preventDefault();
      }
      if (keyboardModeRef.current || showKbGuideRef.current) {
        keyboardSourceRef.current?.handleKey(e, true);
        // Space still stops all notes below (mute convenience).
      }

      // Keyboard-session analytics: first note = activation (mirror of
      // first_gesture_detected); every non-repeat mapped press counts
      // toward the depth reported on session exit. Only while a keyboard
      // session runs — guide-only presses from a camera-mode Help replay
      // (keyboardModeRef false) don't count.
      if (keyboardModeRef.current && !e.repeat && mappedKeysRef.current.includes(e.key)) {
        const s = kbSessionRef.current;
        if (s.active) {
          s.notes++;
          if (!s.firstNoteSent) {
            s.firstNoteSent = true;
            trackKeyboardFirstNote((performance.now() - s.start) / 1000);
          }
        }
      }

      // Space: Stop all notes
      if (e.key === ' ') {
        e.preventDefault();
        audioEngine.stopAll();
        setSynthState(prev => ({ ...prev, isPlaying: false }));
        return;
      }

      // Escape: Reset state (+ close the keyboard guide if open)
      if (e.key === 'Escape') {
        dismissKbGuide('esc');
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

    const handleKeyUp = (e: KeyboardEvent) => {
      // Forward releases while keyboard mode runs OR the guide is open —
      // the keydown guard already covers the guide, and a release without
      // this guard left the key "stuck" (note kept sounding) when the
      // guide was replayed from the camera mode (bug 2026-08-09).
      if (keyboardModeRef.current || showKbGuideRef.current) keyboardSourceRef.current?.handleKey(e, false);
      // NOTE: no guide dismissal here — the keyup of the very keystroke
      // that activated the mode button (Enter/Space) used to flash the
      // first-run guide away before it could be read (bug 2026-08-09).
      // The guide closes on overlay click, Esc, or its auto-hide timer.
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
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
      // Camera-only: the keyboard source reports exact fingers, so a pinky
      // it already released must not linger (bug: 7→1/2/3/4/5 passed through
      // VI for ~2s after the camera-style memory).
      if (frame.source === 'camera') {
        if (extended.includes('pinky')) {
          pinkyMemoryRef.current = 60;
        } else if (pinkyMemoryRef.current > 0) {
          pinkyMemoryRef.current--;
        }
      } else {
        pinkyMemoryRef.current = 0;
      }
      // Camera reads the smoothed memory (compensates for flaky Y-axis
      // pinky detection); keyboard reports exact fingers instantaneously —
      // forcing it through the memory (always 0 here) broke VI/VII
      // (bug 2026-08-10: '6'/'7' resolved to II/III instead, since pinky
      // was always false so the VI/VII match never fired, falling through
      // to fingerCount 2/3).
      const pinky = frame.source === 'camera' ? pinkyMemoryRef.current > 0 : extended.includes('pinky');
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

  const drawOverlayRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number, crop?: { dx: number; dy: number; dw: number; dh: number }) => void>();
  drawOverlayRef.current = (ctx, w, h, crop) => {
    if (!showSkeleton) return;
    const g = gestureRef.current;
    // Live canvas bitmap is display-size × dpr; skeleton params were tuned
    // for a 640px-wide canvas (video native, pre-refactor). Without the
    // rescale the lines shrink to hairlines after CSS downscaling
    // (bug 2026-08-09: "skeleton lines thinner than before").
    const s = w / 640;
    // crop = the video's cover-crop rect (from the loop's drawImage math)
    // — without it the skeleton maps to the full canvas and drifts toward
    // the center on cropped frames (bug 2026-08-09, mobile).
    if (g.left) drawHandSkeleton(ctx, g.left, w, h, '#00ffcc', 'rgba(0,255,204,0.4)', 3, 8, s, crop);
    if (g.right) drawHandSkeleton(ctx, g.right, w, h, '#ff00ff', 'rgba(255,0,255,0.4)', 3, 8, s, crop);
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

  // Draw waveform visualization — three-channel HUD. The drawing body
  // lives in src/hud/waveform.ts (drawWaveform — extracted 2026-08-09,
  // pure move); this ref wires the App-owned inputs.
  const drawWaveformRef = useRef<() => void>();
  drawWaveformRef.current = () => {
    drawWaveform({
      canvas: waveformCanvasRef.current,
      analyser: audioEngine.getAnalyser(),
      hands: gestureRef.current,
      synth: synthRef.current,
      degreeColor: degreeColorRef.current,
    });
  };

  /* ─── Recording domain (chooser → countdown → record → result, mic,
         compositor) — lives in src/recording/useRecording.ts (extracted
         2026-08-09, pure move). App keeps the rAF loop and rendering; the
         hook owns every recording state/ref and exposes the API below. ── */
  const rec = useRecording({
    isRunning,
    keyboardMode,
    videoRef,
    canvasRef,
    waveformCanvasRef,
    synthRef,
    vignetteStrengthRef,
    scanlinesStrengthRef,
    drawOverlayVideoRef,
    onCloseMenus: () => { setMoreOpen(false); setShowSettings(false); },
  });
  const {
    recPhase, setRecPhase, recMode, setRecMode, recRatio, setRecRatio, recCount, endCount,
    savedRecModeExists, recBlob, recPreviewUrl, shareFailed,
    isRecording, recordingTime, micOn, setMicOn, micLevel, micPermState,
    micDevices, micDeviceId, recVoice, setRecVoice, recPolish, setRecPolish,
    micStreamRef, recModeRef, skeletonCanvasRef, recDownloadedRef,
    mediaRecorderRef, recordingAbortedRef, countdownTimerRef,
    requestMic, switchMicDevice, downloadRec, shareRec, canFileShare,
    onRecordButton, handleStartRecording, drawRecFrame,
  } = rec;
  // rAF-loop mirror of isRecording (avoid re-running the loop on change)
  useEffect(() => {
    recordingActiveRef.current = isRecording;
  }, [isRecording]);

  /* ─── Animation loop ───────────────────────────────────────────────── */

  useEffect(() => {
    if (!isRunning) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The keyboard guide can run the keyboard pipeline while keyboard mode
    // itself is off (Help replay on the landing page) — bug 2026-08-09:
    // guide keypresses were silent.
    if (!keyboardModeRef.current && !showKbGuideRef.current && !video) return;

    runningRef.current = true;
    lastDetectRef.current = 0;
    isDetectingRef.current = false;

    const loop = async (timestamp: number) => {
      if (!runningRef.current) return;
      rafIdRef.current = requestAnimationFrame(loop);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // No-camera mode: synthetic hands + stage background (no video feed).
      // Also used while the keyboard guide is open (its presses must sound).
      if (keyboardModeRef.current || showKbGuideRef.current) {
        if (canvas.width !== 640 || canvas.height !== 480) {
          canvas.width = 640;
          canvas.height = 480;
        }
        drawStageBackground(ctx, canvas.width, canvas.height);
        try {
          const frame = keyboardSourceRef.current?.getFrame() ?? { left: null, right: null, source: 'keyboard' as const };
          processHandsRef.current?.(frame);
        } catch (e) {
          console.warn('Keyboard frame error:', e);
        }
        drawOverlayRef.current?.(ctx, canvas.width, canvas.height);
        drawWaveformRef.current?.();
        return;
      }

      const cam = video as HTMLVideoElement; // camera branch (keyboardMode returned above)
      // Canvas bitmap = display size (device pixels). The video is drawn
      // with the SAME cover-crop math as the recording compositor, so the
      // live view and the recording show identical framing (WYSIWYG —
      // reported 2026-08-09: 9:16 live vs recording widths differed because
      // CSS object-fit:cover and the recorder's cover formula disagreed).
      const dpr = window.devicePixelRatio || 1;
      const dispW = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const dispH = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== dispW || canvas.height !== dispH) {
        canvas.width = dispW;
        canvas.height = dispH;
      }

      ctx.save();
      ctx.scale(-1, 1);
      const sw = cam.videoWidth || 640;
      const sh = cam.videoHeight || 480;
      const scale = Math.max(dispW / sw, dispH / sh);
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);
      const dx = Math.round((dispW - dw) / 2);
      const dy = Math.round((dispH - dh) / 2);
      // Mirror-space correction: after scale(-1,1) the visible canvas is
      // x ∈ [-dispW, 0], so the source rect that maps back to screen
      // [dx, dx+dw] starts at -dx-dw. (Bug: using dx here drew the video
      // off-screen left — black frame with skeleton visible, 2026-08-09.)
      ctx.drawImage(cam, -dx - dw, dy, dw, dh);
      ctx.restore();

      ctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!isDetectingRef.current && timestamp - lastDetectRef.current > detectIntervalRef.current) {
        lastDetectRef.current = timestamp;
        isDetectingRef.current = true;
        const t0 = performance.now();
        try {
          // Camera branch only (keyboardMode returned above), so video is present.
          const frame = cameraSourceRef.current?.getFrame(video as HTMLVideoElement, timestamp) ?? { left: null, right: null, source: 'camera' as const };
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

      drawOverlayRef.current?.(ctx, canvas.width, canvas.height, { dx, dy, dw, dh });
      drawWaveformRef.current?.();

      // B2: camera-freeze watchdog — while visible, if the video clock
      // hasn't advanced for ~4s the OS killed the stream (long screen
      // lock on Android). Restart it so the picture comes back.
      if (document.visibilityState === 'visible' && video && !video.paused && video.videoWidth > 0) {
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
          // Video-NATIVE size (never the live screen-size canvas) — see
          // beginRecording for why; a screen-size source shrank the 9:16
          // crop from 42% to 32% of the video (bug 2026-08-09).
          const srcV = videoRef.current;
          const sw = srcV?.videoWidth || 640;
          const sh = srcV?.videoHeight || 480;
          if (sc.width !== sw || sc.height !== sh) {
            sc.width = sw;
            sc.height = sh;
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
              // No-camera mode (keyboard): no feed — stage + waveform.
              const v0 = videoRef.current;
              if (!v0) {
                drawStageBackground(sctx, sc.width, sc.height);
                const wf = waveformCanvasRef.current;
                if (wf) sctx.drawImage(wf, 0, 0, sc.width, sc.height);
              } else {
              sctx.fillStyle = '#050510';
              sctx.fillRect(0, 0, sc.width, sc.height);
              sctx.save();
              sctx.scale(-1, 1);
              sctx.drawImage(v0, -sc.width, 0, sc.width, sc.height);
              sctx.restore();
              sctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
              sctx.fillRect(0, 0, sc.width, sc.height);
              drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
              }
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

  // No-camera mode: no getUserMedia, no model download — the keyboard
  // source drives the same pipeline from the rAF loop. Persist the choice.
  // First run auto-shows the keyboard guide (once); replay lives in Help.
  const startKeyboardMode = useCallback(async (source: KeyboardModeSource = 'main_button') => {
    try { localStorage.setItem('gsw-keyboard-mode', '1'); } catch { /* private mode */ }
    setKeyboardMode(true);
    setError(null);
    setCameraErrorType(null);
    firstGestureSentRef.current = false;
    setIsLoading(false);
    // First-ever keyboard start (no camera history): the engine was never
    // initialized — only camera start used to init it, so the keyboard
    // was silently silent (bug 2026-08-09). The click is the user gesture.
    await audioEngine.init();
    setIsRunning(true);
    // Keyboard-session analytics: fresh session per start; kb_mode_exit
    // (switch back / settings off / page close) carries duration + notes.
    kbSessionRef.current = { active: true, start: performance.now(), notes: 0, firstNoteSent: false };
    trackKeyboardModeEntered(source);
    let guideSeen = false;
    try { guideSeen = localStorage.getItem('gsw-keyboard-guide-seen') === '1'; } catch { /* private mode */ }
    if (!guideSeen) {
      try { localStorage.setItem('gsw-keyboard-guide-seen', '1'); } catch { /* private mode */ }
      trackKeyboardGuideShown('auto');
      // Open directly (not via showKbGuidePanel): the pipeline is ALREADY
      // running above, and its isRunning closure would still read false
      // here (state settles after this call) — which would make the guide
      // tear the keyboard mode down on close.
      kbGuideWasRunningRef.current = true;
      setShowKbGuide(true);
    }
  }, []);

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
    keyboardSourceRef.current?.reset();
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

  // Settings-panel keyboard toggle — owns persistence + mode lifecycle
  // (the panel component stays presentation-only).
  // Symmetric behavior (user decision 2026-08-09): ENABLING keyboard mode
  // starts playing at once; DISABLING it starts the camera at once —
  // no idle hop through the Enable Camera landing, the player keeps
  // operating. (First camera start still shows the loading flow with the
  // model download.)
  // source is the ENTRY/EXIT surface: only toolbar/settings can toggle off
  // (main_button / landing_hint are enter-only), so the exit event's source
  // type is the narrow union.
  const handleKeyboardToggle = useCallback((on: boolean, source: 'toolbar' | 'settings' = 'settings') => {
    trackSettingChanged('keyboard_mode', on ? 'on' : 'off');
    try { localStorage.setItem('gsw-keyboard-mode', on ? '1' : '0'); } catch { /* private mode */ }
    setKeyboardMode(on);
    if (on && !isRunning) {
      // Start immediately when enabled from idle
      startKeyboardMode(source);
    } else if (on && isRunning) {
      // Camera → keyboard: stop the camera pipeline CLEANLY first —
      // flipping the mode alone left the camera stream live (LED on,
      // stream held) and the old session resident. Restart the keyboard
      // pipeline fresh (stopCamera → isRunning false → startKeyboardMode).
      stopCamera();
      void startKeyboardMode(source);
    } else if (!on && isRunning) {
      // Keyboard → camera: stop the keyboard pipeline cleanly first, then
      // start the camera — the direct-start path left the old stream and
      // loop resident and gestures came back DEAD (bug 2026-08-09:
      // landing→camera worked, switch-back didn't; MediaPipe's session
      // was still bound to the pre-swap state). This mirrors the
      // provably-working fresh path exactly (isRunning false → true).
      // The keyboard session's exit event (duration + notes played) closes
      // the funnel for this run.
      const s = kbSessionRef.current;
      if (s.active) {
        s.active = false;
        trackKeyboardModeExited({
          source,
          durationSec: (performance.now() - s.start) / 1000,
          notesPlayed: s.notes,
        });
      }
      stopCamera();
      void startCamera();
    }
    // (!on && !isRunning): just flips the mode on the landing — no start.
  }, [isRunning, startKeyboardMode, startCamera, stopCamera]);

  // Keyboard session end on tab close/reload: visibilitychange fires
  // reliably on both, so the exit event's page_close source completes the
  // funnel (sessions otherwise only close on a mode switch).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      const s = kbSessionRef.current;
      if (!s.active) return;
      s.active = false;
      trackKeyboardModeExited({
        source: 'page_close',
        durationSec: (performance.now() - s.start) / 1000,
        notesPlayed: s.notes,
      });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

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
        {(recPhase === 'countdown' || recPhase === 'recording') && recMode !== 'audio' && (() => {
          // Viewfinder = the recorded region mapped onto the screen. Both
          // are cover-fits of the same video, so per dimension:
          //   visible on the video = min(1, screenAspect / videoAspect)
          //   recorded on the video = min(1, ratioAspect / videoAspect)
          //   window size = recorded / visible, capped at the screen.
          // The old single-fraction formula (ratio × videoH/videoW)
          // assumed a landscape screen — on portrait phones it drew narrow
          // strips while the recording covered the full screen, and 16:9
          // had no sync at all (static 12.5% strips — recorded hands were
          // invisible in the frame; bugs 2026-08-09).
          const rv = videoRef.current;
          const rvw = rv?.videoWidth || 640;
          const rvh = rv?.videoHeight || 480;
          const rw = recRatio === '9:16' ? 9 / 16 : recRatio === '1:1' ? 1 : 16 / 9;
          const screenAspect = window.innerWidth / window.innerHeight;
          const videoAspect = rvw / rvh;
          const wFrac = Math.min(1, Math.min(1, rw / videoAspect) / Math.min(1, screenAspect / videoAspect));
          const hFrac = Math.min(1, Math.min(1, videoAspect / rw) / Math.min(1, videoAspect / screenAspect));
          return (
            <div className={`rec-frame-overlay ${recRatio === '1:1' ? 'ratio-1x1' : recRatio === '9:16' ? 'ratio-916' : 'ratio-169'}`}
                 style={{
                   ['--rec-win-w' as string]: `${(wFrac * 100).toFixed(2)}%`,
                   ['--rec-win-h' as string]: `${(hFrac * 100).toFixed(2)}%`,
                 }}>
              <div className="rec-window" />
              <div className="rec-tag">REC {recRatio}</div>
            </div>
          );
        })()}

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
            {/* Camera ↔ keyboard mode switch — the PERMANENT, prominent
                way to change input source (the NEW card and the settings
                toggle are the other paths; the card expires after the
                announce window, this button doesn't — user decision
                2026-08-09: keyboard-mode players must always be able to
                find their way back to the camera).
                (2026-08-10, reversing the 2026-08-09 "labeled capsule"
                decision — user feedback: a single button whose label
                names the mode you'd switch TO read as confusing, "Camera"
                showing while you're actively IN keyboard mode. Then
                reworked again same day — user feedback: two independently
                clickable icon segments read as two buttons, not one
                control.) Now a single classic switch: icon · track+dot ·
                icon — the dot slides left (camera) or right (keyboard).
                One click anywhere always toggles. */}
            {!isMobile && (
            <button
              className={`mode-switch-toggle mobile-collapse${pulseModeSwitch ? ' help-pulse' : ''}`}
              onClick={() => handleKeyboardToggle(!keyboardMode, 'toolbar')}
              role="switch"
              aria-checked={keyboardMode}
              data-tip={keyboardMode
                ? 'Switch to camera mode — play with hand gestures'
                : 'Switch to keyboard mode — no camera needed'}
            >
              {/* Camera pictogram (Apple-style) — no magenta slash (that
                  slash marks STOP on the button next to it) */}
              <svg className={`mode-switch-icon${!keyboardMode ? ' active' : ''}`} width="16" height="13" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="6.6" width="14.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.9" />
                <path d="M7.2 6.6 L8.3 4.3 L12.4 4.3 L13.5 6.6" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                <circle cx="9.3" cy="11.6" r="2.4" stroke="currentColor" strokeWidth="1.9" />
              </svg>
              <span className="mode-switch-track">
                <span className={`mode-switch-dot${keyboardMode ? ' right' : ''}`} />
              </span>
              {/* Keyboard pictogram — stroke-based to match the camera icon's
                  style (the dot-grid glyph used on the landing button
                  turns into an unreadable smudge at this toolbar size). */}
              <svg className={`mode-switch-icon${keyboardMode ? ' active' : ''}`} width="16" height="13" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.9" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14.5h12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </button>
            )}
            {/* Stop is CAMERA-mode only (user decision 2026-08-09): in
                keyboard mode there's no camera to stop and the Camera
                capsule takes its role (leaving keyboard mode), so the
                misleading stop-camera button is hidden there. In camera
                mode it stays — the only way to leave the playing scene
                back to the landing. HIDDEN with visibility (not unmount)
                in keyboard mode — the centered toolbar must not shift
                when toggling modes (user decision 2026-08-09). */}
            <button
              className="icon-btn mobile-collapse"
              onClick={stopCamera}
              data-tip="Stop camera and audio"
              style={keyboardMode ? { visibility: 'hidden' } : undefined}
            >
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
            <SettingsPanel
              onClose={() => setShowSettings(false)}
              synthState={synthState}
              setSynthState={setSynthState}
              vignetteStrength={vignetteStrength}
              setVignetteStrength={setVignetteStrength}
              scanlinesStrength={scanlinesStrength}
              setScanlinesStrength={setScanlinesStrength}
              isMobile={isMobile}
              keyboardMode={keyboardMode}
              isRunning={isRunning}
              onKeyboardToggle={handleKeyboardToggle}
              keymap={keymap}
              onKeymapChange={handleKeymapChange}
              onOpenGuide={showKbGuidePanel}
            />
          )}
        </div>

        {/* ─── Onboarding: hands-ready badge (first stable two-hand
                detection, once per session, 3s) ───────────────────── */}
        {showHandsReady && (
          <div className="hands-ready-badge">
            <span style={{ color: 'var(--neon-cyan)' }}>✓</span> Both hands detected — play!
          </div>
        )}

        {/* ─── What's-new card in the PLAYING scene — camera modes only
                (keyboard-mode players ARE the new feature; camera-less
                users get the landing hint instead). Bottom-left, above
                the status bar (user decision 2026-08-09). DISMISSAL-based:
                shows every session while active (14-day window) until the
                player closes it with ✕ (gsw-whatsnew-dismissed).
                TEACHING card, NOT a shortcut (user decision 2026-08-09):
                the body doesn't jump to keyboard mode — it points at the
                toolbar mode-switch button, which pulses while the card is
                visible, so the player learns the permanent switch (the
                card expires after 14 days; the button doesn't). ───────── */}
        {whatsNewCardVisible && whatsNewEntry && (
          whatsNewCollapsed ? (
            /* Collapsed mobile dot (iOS floating-pill pattern): keeps the
               every-session presence without occupying the tiny
               viewfinder; tap to re-expand the card. */
            <button
              className="whatsnew-dot"
              onClick={() => setWhatsNewCollapsed(false)}
              aria-label="What's new"
              title={whatsNewEntry.title}
            >
              NEW
            </button>
          ) : (
          <div className="whatsnew-card whatsnew-card--scene">
            <button
              className="whatsnew-close"
              onClick={() => { markWhatsNewDismissed(); setWhatsNewDismissedState(true); }}
              aria-label="Dismiss what's new"
              title="Dismiss"
            >
              {/* Feather X (MIT) */}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="whatsnew-body">
              <span className="whatsnew-badge">NEW</span>
              <span>
                <strong>{whatsNewEntry.title}</strong>
                {/* Teaching line (from the entry, per-mode): points at the
                    toolbar control's ACTUAL label in the current mode —
                    reinforcing the habit both ways. No entry teach = no
                    line (and no pulse, via pulseTarget). */}
                {whatsNewEntry.teach && (
                  <span className="whatsnew-teach">
                    {whatsNewEntry.teach[keyboardMode ? 'keyboard' : 'camera'] ?? whatsNewEntry.teach.camera}
                  </span>
                )}
              </span>
            </div>
          </div>
          )
        )}

        {/* ─── Help Modal (component: demo animation, mapping tables,
                keyboard-mode section — owns its demo step state) ──────── */}
        {showHelp && (
          <HelpModal
            onClose={() => setShowHelp(false)}
            isMobile={isMobile}
            gradeNameFor={gradeNameFor}
            onReplayKeyboardGuide={showKbGuidePanel}
          />
        )}

        {/* ─── B2: recording UI — chooser, countdown, result (RecSheet) ── */}
        <RecSheet
          recPhase={recPhase}
          setRecPhase={setRecPhase}
          recCount={recCount}
          endCount={endCount}
          recMode={recMode}
          setRecMode={setRecMode}
          recRatio={recRatio}
          setRecRatio={setRecRatio}
          savedRecModeExists={savedRecModeExists}
          keyboardMode={keyboardMode}
          micStreamRef={micStreamRef}
          micOn={micOn}
          setMicOn={setMicOn}
          micLevel={micLevel}
          micPermState={micPermState}
          micDevices={micDevices}
          micDeviceId={micDeviceId}
          recVoice={recVoice}
          setRecVoice={setRecVoice}
          recPolish={recPolish}
          setRecPolish={setRecPolish}
          requestMic={requestMic}
          switchMicDevice={switchMicDevice}
          recBlob={recBlob}
          recPreviewUrl={recPreviewUrl}
          shareFailed={shareFailed}
          canFileShare={canFileShare}
          downloadRec={() => { recDownloadedRef.current = true; downloadRec(); }}
          shareRec={shareRec}
          handleStartRecording={handleStartRecording}
        />

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
                  {renderHandArt(LOADING_STEPS[loadingDemoStep].art, 26, 'var(--neon-cyan)')}
                  {renderHandArt('1', 26, 'var(--neon-magenta)', true)}
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
                  onClick={keyboardMode ? () => startKeyboardMode('main_button') : startCamera}
                  disabled={isLoading}
                  onMouseEnter={prefetchTracking}
                  onFocus={prefetchTracking}
                  onTouchStart={prefetchTracking}
                >
                  <svg className="enable-camera-btn-icon" viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                    {keyboardMode ? (
                      <path fillRule="evenodd" d="M3 6a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm2.5 1a.5.5 0 100 1 .5.5 0 000-1zm2 0a.5.5 0 100 1 .5.5 0 000-1zM5 9.5a.5.5 0 100 1 .5.5 0 000-1zm2 0a.5.5 0 100 1 .5.5 0 000-1zm4 0a.5.5 0 100 1 .5.5 0 000-1zM9 11.5a.5.5 0 100 1 .5.5 0 000-1zm2 0a.5.5 0 100 1 .5.5 0 000-1zm2 0a.5.5 0 100 1 .5.5 0 000-1zM5 13.5a.5.5 0 100 1 .5.5 0 000-1zm2 0a.5.5 0 100 1 .5.5 0 000-1zm4 0a.5.5 0 100 1 .5.5 0 000-1zm-1-3a.5.5 0 100 1 .5.5 0 000-1zm3 0a.5.5 0 100 1 .5.5 0 000-1z" clipRule="evenodd" />
                    ) : (
                      <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2H4zm10 1.5l3.5-2.25A.75.75 0 0118.5 5v10a.75.75 0 01-1 .69L14 13.5V6.5z" clipRule="evenodd" />
                    )}
                  </svg>
                  <span>{keyboardMode ? 'Start Playing (Keyboard)' : 'Enable Camera'}</span>
                </button>
                <p className="camera-placeholder-hint">
                  {keyboardMode
                    ? 'Hold 1-7 to play · [ ] major-minor · 8/9/0/- style · Shift octave · arrows volume/filter · Space stop'
                    : 'Allow camera access to start playing with hand gestures'}
                </p>
                {/* LANDING hint — TIME-based conversion assist: shows
                    while the announcement is active (14-day window), then
                    stops on its own. No ✕, no dismissal — it can't be
                    "seen once and lost", and the player never has to
                    close it. Click = enter keyboard mode. The PLAYING
                    card below is the dismissal-based announcement. */}
                {!keyboardMode && !(whatsNewEntry?.desktopOnly && isMobile) && whatsNewActive() && (
                  <div className="whatsnew-card">
                    <button className="whatsnew-body" onClick={() => startKeyboardMode('landing_hint')}>
                      <span className="whatsnew-badge">NEW</span>
                      <span>
                        <strong>Keyboard mode</strong> — no camera needed
                      </span>
                    </button>
                  </div>
                )}
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
            {/* Scale Guide - 8 blocks showing scale degrees.
                Shown in BOTH modes (bug 2026-08-09: keyboard mode hid it
                entirely — the player still needs the degree map). The hint
                line switches semantics: key numbers vs finger gestures. */}
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
                  const kk = (a: KbAction) => `key ${displayKey(keymap[a])}`;
                  const keyNotes = [
                    { note: mkNote(0),  roman: 'I',   hint: keyboardMode ? kk('degree1') : '1 finger' },
                    { note: mkNote(2),  roman: 'II',  hint: keyboardMode ? kk('degree2') : '2 fingers' },
                    { note: mkNote(4),  roman: 'III', hint: keyboardMode ? kk('degree3') : '3 fingers' },
                    { note: mkNote(5),  roman: 'IV',  hint: keyboardMode ? kk('degree4') : '4 fingers' },
                    { note: mkNote(7),  roman: 'V',   hint: keyboardMode ? kk('degree5') : '5 fingers' },
                    { note: mkNote(9),  roman: 'VI',  hint: keyboardMode ? kk('degree6') : 'idx + pky' },
                    { note: mkNote(11), roman: 'VII', hint: keyboardMode ? kk('degree7') : 'i + p + t' },
                    { note: mkNote(0),  roman: 'I\'', hint: keyboardMode ? `${displayKey(keymap.octaveDown)} = 8vb` : '1 fing (oct)' },
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

      {/* ─── Keyboard guide overlay (first-run + replayable) ──────────── */}
      {showKbGuide && <KbGuide keymap={keymap} onDismiss={dismissKbGuide} />}

    </div>
  );
}

