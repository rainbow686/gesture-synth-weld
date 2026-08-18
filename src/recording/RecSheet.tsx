/**
 * Recording UI sheet (extracted from App.tsx Render 2026-08-09, pure
 * move): 3-2-1 countdown + wrap-up overlays, the mode/ratio/mic chooser,
 * and the result panel (in-page preview, download, share).
 *
 * Pure presentation — every value comes from useRecording's returned
 * surface (the App passes the same object it destructured), so the sheet
 * never touches recording internals.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { RecMode, RecPhase, RecRatio } from '../types';
import type { VocalPolish } from '../audioEngine';
import type { StoredWork } from '../works/workStore';
import {
  trackDownload,
  trackMicToggled,
  trackProGateClicked,
  trackProGateSeen,
  trackRecordingModeChanged,
  trackSettingChanged,
  trackWorkDownloaded,
  trackWorkReplayed,
} from '../analytics';
import { REC_RATIO_HINTS, REC_SVG_PREVIEWS, VIDEO_REC_SUPPORTED } from './constants';

export interface RecSheetProps {
  recPhase: RecPhase;
  setRecPhase: Dispatch<SetStateAction<RecPhase>>;
  recCount: number;
  endCount: number | null;
  recMode: RecMode;
  setRecMode: Dispatch<SetStateAction<RecMode>>;
  recRatio: RecRatio;
  setRecRatio: Dispatch<SetStateAction<RecRatio>>;
  savedRecModeExists: boolean;
  keyboardMode: boolean;
  // mic (sing-along)
  micStreamRef: { current: MediaStream | null };
  micOn: boolean;
  setMicOn: (v: boolean) => void;
  micLevel: number;
  micPermState: 'unknown' | 'granted' | 'denied' | 'prompt';
  micDevices: MediaDeviceInfo[];
  micDeviceId: string;
  recVoice: number;
  setRecVoice: (v: number) => void;
  recPolish: VocalPolish;
  setRecPolish: (v: VocalPolish) => void;
  requestMic: () => Promise<boolean>;
  switchMicDevice: (deviceId: string) => void;
  // result
  recBlob: { blob: Blob; filename: string } | null;
  recPreviewUrl: string | null;
  shareFailed: boolean;
  canFileShare: boolean;
  downloadRec: () => void;
  shareRec: () => void;
  handleStartRecording: () => void;
  // local works gallery (shared with the landing, 2026-08-18): the
  // history list below the preview - deleting here syncs everywhere.
  works: StoredWork[] | null;
  onDeleteWork: (id: string) => void;
}

export function RecSheet(props: RecSheetProps) {
  const {
    recPhase, setRecPhase, recCount, endCount,
    recMode, setRecMode, recRatio, setRecRatio, savedRecModeExists, keyboardMode,
    micStreamRef, micOn, setMicOn, micLevel, micPermState, micDevices, micDeviceId,
    recVoice, setRecVoice, recPolish, setRecPolish, requestMic, switchMicDevice,
    recBlob, recPreviewUrl, shareFailed, canFileShare, downloadRec, shareRec,
    handleStartRecording, works, onDeleteWork,
  } = props;

  // Result-panel preview switching (2026-08-18): the player defaults to
  // THIS take (recPreviewUrl); clicking a history row swaps it to that
  // work's blob. Local UI state only - recording domain is untouched.
  const [histUrl, setHistUrl] = useState<string | null>(null);
  const histUrlRef = useRef<string | null>(null);
  const [histId, setHistId] = useState<string | null>(null);

  // New take ready (or panel closed) -> back to THIS recording.
  useEffect(() => {
    setHistUrl(null);
    setHistId(null);
  }, [recBlob, recPhase]);

  // Revoke preview object URLs on unmount.
  useEffect(() => () => {
    if (histUrlRef.current) URL.revokeObjectURL(histUrlRef.current);
  }, []);

  // Pro-gate probe: the teaser is visible exactly while its section is —
  // seen fires once per open (phase changes are the open/close signals).
  useEffect(() => {
    if (recPhase === 'choosing') trackProGateSeen('rec_chooser');
    if (recPhase === 'result') trackProGateSeen('rec_result');
  }, [recPhase]);

  return (
    <>
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
            <div className="rec-sheet-sub">
              {keyboardMode
                ? 'Keyboard mode records audio only — no camera feed to capture'
                : 'What should the recording capture?'}
            </div>
            <div className="rec-options">
              {((keyboardMode ? ['audio'] : ['video', 'skeleton', 'audio']) as RecMode[]).map((id) => (
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
          {/* Pro-gate probe: advertises the Pro boundary without gating
              anything — clicks = paid-intent signal (no payment involved). */}
          <div
            className="pro-teaser"
            role="button"
            tabIndex={0}
            onClick={() => trackProGateClicked('rec_chooser')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trackProGateClicked('rec_chooser'); } }}
          >
            🔒 <strong>Pro</strong> (coming soon): unlimited recording · no watermark · more instruments
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
                    {(() => {
            const playerSrc = histUrl ?? recPreviewUrl;
            if (!playerSrc) return null;
            return recMode === 'audio' ? (
              <audio src={playerSrc} className="rec-preview rec-preview-audio" controls />
            ) : (
              <video
                src={playerSrc}
                className="rec-preview"
                autoPlay
                muted
                playsInline
                controls
              />
            );
          })()}
          {/* Previewing an older take - say so (default = THIS recording). */}
          {histUrl && (
            <div className="rec-previewing">▶ Previewing an earlier take - the buttons below still apply to this recording</div>
          )}
          {/* History list (2026-08-18, feedback - full version): the takes
              from this browser, newest first (the just-saved one on top,
              matching the default preview). Click a row to preview it;
              per-row re-download or delete. Fixed height + scroll so the
              mobile sheet stays bounded; delete syncs to the landing via
              App's shared works state. */}
          {works && works.length > 0 && (
            <>
              <div className="rec-works-title">My works ({works.length})</div>
              <ul className="rec-works-list">
                {works.map((w) => (
                  <li key={w.id} className={`rec-works-item${histId === w.id ? ' active' : ''}`}>
                    <button
                      className="rec-works-play"
                      onClick={() => {
                        if (histUrlRef.current) URL.revokeObjectURL(histUrlRef.current);
                        const url = URL.createObjectURL(w.blob);
                        histUrlRef.current = url;
                        setHistUrl(url);
                        setHistId(w.id);
                        trackWorkReplayed();
                      }}
                      title="Preview this take"
                    >{histId === w.id ? '■' : '▶'}</button>
                    <span className="rec-works-icon">{w.type === 'audio' ? '🎵' : '🎬'}</span>
                    <span className="rec-works-date">
                      {new Date(w.createdAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} {new Date(w.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="rec-works-dur">{Math.floor(w.durationSec / 60)}:{String(w.durationSec % 60).padStart(2, '0')}</span>
                    <button
                      className="works-btn"
                      onClick={() => { trackWorkDownloaded(); const u = URL.createObjectURL(w.blob); const a = document.createElement('a'); a.href = u; a.download = w.filename; a.click(); URL.revokeObjectURL(u); }}
                      title="Download"
                    >💾</button>
                    <button
                      className="works-btn"
                      onClick={() => { onDeleteWork(w.id); if (histId === w.id) { setHistId(null); setHistUrl(null); } }}
                      title="Delete"
                    >🗑</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="rec-actions">
            <button className="rec-btn" onClick={() => setRecPhase('idle')}>Close</button>
            <button className="rec-btn primary" onClick={() => { trackDownload(); downloadRec(); }}>💾 Download</button>
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
          {/* Local works gallery discoverability: the take was auto-saved
              to this browser - tell the player they have a reason to come
              back (2026-08-17 retention experiment). */}
          <div className="rec-sheet-sub" style={{ marginTop: 8 }}>
            ✓ Auto-saved to this browser - "My works" appears under the start button on your next visit
          </div>
          {/* Pro-gate probe (result panel): the "keep the take" moment —
              the most natural place to test paid-intent for removal of
              limits/watermark. Click = signal, never a paywall. */}
          <div
            className="pro-teaser"
            role="button"
            tabIndex={0}
            onClick={() => trackProGateClicked('rec_result')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trackProGateClicked('rec_result'); } }}
          >
            🔒 <strong>Pro</strong> (coming soon): unlimited recording · no watermark · more instruments
          </div>
        </div>
      )}
    </>
  );
}
