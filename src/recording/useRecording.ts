/**
 * Recording domain hook (extracted from App.tsx 2026-08-09, pure move —
 * every line behaves identically; only the boundaries changed).
 *
 * Owns the FULL recording domain: chooser state, mic (sing-along),
 * countdown → record → result flow, branded output (tags + cover art),
 * share/download, the composited recording canvas, and the per-frame
 * compositor (drawRecFrame).
 *
 * State lives HERE (not in App) — the App renders the result, the rAF
 * loop calls drawRecFrame, but nothing outside this hook touches the
 * internals. Inputs are the few App-owned refs the recording pipeline
 * must read (video/canvas/gesture/atmosphere).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RecMode, RecPhase, RecRatio, SynthState } from '../types';
import { audioEngine, type VocalPolish } from '../audioEngine';
import { composeRecordingFrame } from '../hud/recording';
import { drawStageBackground } from '../hud/draw';
import { injectBrandTags } from '../mp4tags';
import { makeRecordingFilename } from '../wavEncoder';
import {
  trackRecording,
  trackRecordingModeChanged,
  trackRecordingViewed,
  trackRecordButtonClicked,
  trackShare,
} from '../analytics';
import { RECORD_SECONDS, VIDEO_REC_SUPPORTED, REC_RATIO_DIMS } from './constants';
import { makeCoverBlob, pickRecMimeType } from './utils';

export interface UseRecordingDeps {
  isRunning: boolean;
  keyboardMode: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  waveformCanvasRef: RefObject<HTMLCanvasElement | null>;
  synthRef: { current: SynthState };
  vignetteStrengthRef: { current: number };
  scanlinesStrengthRef: { current: number };
  /** Soft-palette skeleton used inside recordings (owned by App, reads gesture state). */
  drawOverlayVideoRef: { current: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | undefined };
  /** Close the ⋯ panel + settings — menus must not appear in the recording. */
  onCloseMenus: () => void;
}

export function useRecording(deps: UseRecordingDeps) {
  const { isRunning, keyboardMode } = deps;

  /* ─── State ─────────────────────────────────────────────────────────── */

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
  const [shareFailed, setShareFailed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Mic (sing-along) — recording-only feature, so it lives with the domain.
  const [micOn, setMicOn] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [micPermState, setMicPermState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [recVoice, setRecVoice] = useState(() => Number(localStorage.getItem('gsw-rec-voice')) || 1.3);
  const [recPolish, setRecPolish] = useState<VocalPolish>(() => {
    try { return (localStorage.getItem('gsw-rec-polish') as VocalPolish) || 'standard'; } catch { return 'standard'; }
  });
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');

  /* ─── Refs ──────────────────────────────────────────────────────────── */

  const micStreamRef = useRef<MediaStream | null>(null);
  const micOnRef = useRef(true);
  const recVoiceRef = useRef(1.3);
  const micRetriedRef = useRef(false);
  const recModeRef = useRef<RecMode>('audio');
  const recRatioRef = useRef<RecRatio>('9:16');
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const endCountTimerRef = useRef<number | null>(null);
  const recordingAbortedRef = useRef(false);
  const blurBufRef = useRef<HTMLCanvasElement | null>(null);
  const recBlurAtRef = useRef(0); // last blur-bg redraw (throttled to ~5fps)
  const recordingStartRef = useRef<number | null>(null);
  const recDownloadedRef = useRef(false);

  /* ─── Effects: keep refs/engine/localStorage in sync ────────────────── */

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

  const recPreviewUrl = useMemo(() => {
    if (!recBlob) return null;
    return URL.createObjectURL(recBlob.blob);
  }, [recBlob]);
  // Revoke ONLY on unmount/change — the original App code revoked in the
  // effect body too, which killed the freshly-created URL before the
  // result panel could play it (regression 2026-08-09: previews were
  // black while downloads worked — downloadRec builds its own URL).
  useEffect(() => {
    return () => {
      if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
    };
  }, [recPreviewUrl]);

  /* ─── Mic ───────────────────────────────────────────────────────────── */

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

  /* ─── Compositor (per-frame, called by the App rAF loop) ────────────── */

  const drawRecFrame = useCallback(() => {
    const rec = recCanvasRef.current;
    const src = skeletonCanvasRef.current; // recording-source canvas (stage or camera + soft skeleton)
    if (!rec || !src || !src.width || !src.height) return;
    composeRecordingFrame({
      rec,
      src,
      mode: recModeRef.current,
      ratio: recRatioRef.current,
      synth: deps.synthRef.current,
      analyser: audioEngine.getAnalyser(),
      vignetteStrength: deps.vignetteStrengthRef.current / 100,
      scanlinesStrength: deps.scanlinesStrengthRef.current / 100,
      blurBuf: blurBufRef,
    });
  }, [deps]);

  /* ─── Result actions (download / share) ─────────────────────────────── */

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

  /* ─── Flow: chooser → countdown → record → result ───────────────────── */

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
      const live = deps.canvasRef.current;
      if (!live || !live.width) {
        setRecPhase('idle');
        return;
      }
      // The recording-source canvas (stage or camera + soft skeleton) is
      // the source for BOTH video modes. It must be VIDEO-NATIVE size —
      // the live canvas is display-size (16:9 screen), and a 9:16/1:1
      // cover-crop from a 16:9 source captures only 32% of the video
      // width (was 42% from the 4:3 source pre-refactor — recordings
      // silently lost content, bug 2026-08-09). No camera (keyboard
      // mode): fall back to a 4:3 640×480 source.
      if (!skeletonCanvasRef.current) {
        skeletonCanvasRef.current = document.createElement('canvas');
      }
      const srcVideo = deps.videoRef.current;
      skeletonCanvasRef.current.width = srcVideo?.videoWidth || 640;
      skeletonCanvasRef.current.height = srcVideo?.videoHeight || 480;
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
              deps.drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
              const wf0 = deps.waveformCanvasRef.current;
              if (wf0) sctx.drawImage(wf0, 0, 0, sc.width, sc.height);
            } else {
              sctx.fillStyle = '#050510';
              sctx.fillRect(0, 0, sc.width, sc.height);
              sctx.save();
              sctx.scale(-1, 1);
              const v0 = deps.videoRef.current;
              if (v0) sctx.drawImage(v0, -sc.width, 0, sc.width, sc.height);
              sctx.restore();
              sctx.fillStyle = 'rgba(10, 10, 26, 0.15)';
              sctx.fillRect(0, 0, sc.width, sc.height);
              deps.drawOverlayVideoRef.current?.(sctx, sc.width, sc.height);
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
  }, [drawRecFrame, deps]);

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
      trackRecording('completed', {
        durationSec: dur,
        ended: dur >= RECORD_SECONDS ? 'timeout' : 'user',
        mode: keyboardMode ? 'keyboard' : 'camera',
      });
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
    // Recording = the player is about to perform — drop any open menus
    // (⋯ panel and settings panel must not appear in the recording)
    deps.onCloseMenus();
    // Platforms without canvas.captureStream (iOS Safari) can't record
    // video — fall back to audio before showing the chooser.
    if (!VIDEO_REC_SUPPORTED && recMode !== 'audio') {
      setRecMode('audio');
    }
    // Keyboard mode records AUDIO ONLY: its video modes would capture a
    // feed-less stage + waveform — no gestures, no face (user decision
    // 2026-08-09: "a video of keys jumping — what's the point?").
    if (keyboardMode && recMode !== 'audio') {
      setRecMode('audio');
    }
    setRecPhase((p) => (p === 'choosing' ? 'idle' : p === 'idle' ? 'choosing' : p));
    // Funnel entry: only when the chooser actually opens (idle → choosing).
    if (recPhase === 'idle') trackRecordButtonClicked();
  }, [isRunning, isRecording, finishRecording, recMode, recPhase, keyboardMode, deps]);

  const handleStartRecording = useCallback(() => {
    localStorage.setItem('gsw-rec-mode', recMode);
    localStorage.setItem('gsw-rec-ratio', recRatio);
    setRecPhase('idle'); // close the chooser
    trackRecording('started', { mode: keyboardMode ? 'keyboard' : 'camera' });
    startCountdown();
  }, [recMode, recRatio, keyboardMode, startCountdown]);

  /* ─── Effects: recording lifecycle ──────────────────────────────────── */

  // Paywall signal: user previewed the result ≥5s without downloading.
  useEffect(() => {
    if (recPhase === 'result' && recBlob) {
      recDownloadedRef.current = false;
      const t = setTimeout(() => {
        if (!recDownloadedRef.current) trackRecordingViewed();
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [recPhase, recBlob]);

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

  return {
    // state
    recPhase, setRecPhase, recMode, setRecMode, recRatio, setRecRatio, recCount, endCount,
    savedRecModeExists,
    recBlob, recPreviewUrl, shareFailed, isRecording, recordingTime,
    micOn, setMicOn, micLevel, micPermState, micDevices, micDeviceId,
    recVoice, setRecVoice, recPolish, setRecPolish,
    // refs the App touches (rAF loop reads recModeRef/skeletonCanvasRef;
    // camera lifecycle attaches micStreamRef to the engine; the result
    // panel marks recDownloadedRef on download; stopCamera aborts an
    // in-flight recording via mediaRecorderRef + recordingAbortedRef)
    micStreamRef, recModeRef, skeletonCanvasRef, recDownloadedRef,
    mediaRecorderRef, recordingAbortedRef, countdownTimerRef,
    // actions
    requestMic, switchMicDevice, downloadRec, shareRec, canFileShare,
    onRecordButton, handleStartRecording, drawRecFrame,
  };
}
