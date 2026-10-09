/**
 * Analytics events — Microsoft Clarity + Google Analytics 4 custom events.
 *
 * Both SDKs load via index.html <head> with synchronous shims (window.clarity
 * and window.gtag exist from parse time and queue calls until the real SDK
 * arrives), so calling track() at any point is safe and adds zero network
 * overhead. Only low-frequency UI events are tracked here — never hot loops.
 *
 * The GA4/Clarity IDs in index.html belong to THIS site's deployment. A repo
 * fork that forgets to replace them would push its visitors' data into our
 * reports, so events are only sent from our own hostnames — forks are
 * silently dropped (and should swap the IDs anyway).
 */

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

/** Hostnames allowed to report: production, Vercel previews, local dev. */
const TRACKABLE_HOST = /(^|\.)gesturesynthweld\.com$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

/** Push one custom event to both Clarity and GA4 (guarded, no-op if absent). */
function track(name: string, params?: Record<string, unknown>): void {
  if (!TRACKABLE_HOST.test(window.location.hostname)) return;
  if (typeof window.clarity === 'function') {
    window.clarity('event', name, params);
  }
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
}

/** User switched the recording mode in the chooser (from = previous mode). */
export function trackRecordingModeChanged(from: string, to: string): void {
  track('recording_mode_changed', { from, to });
}

/** Camera-freeze watchdog fired and restarted the video stream. */
export function trackWatchdogTriggered(reason: string): void {
  track('watchdog_triggered', { reason });
}

/** Help button pressed (opening the hand-gesture guide). */
export function trackHelpButtonClicked(): void {
  track('help_button_clicked');
}

/* ─── Activation funnel (added 2026-08-04, see docs/sessions) ─────────── */

/** Camera start pressed — which surface converted the user. */
export function trackCameraClicked(source: 'main_button' | 'retry' | 'seo_cta' = 'main_button'): void {
  track('camera_button_clicked', { device: isMobileDevice() ? 'mobile' : 'desktop', source });
}

/** getUserMedia outcome for the camera permission prompt. */
export function trackCameraPermission(result: 'granted' | 'denied'): void {
  track('camera_permission_' + result);
}

/** startCamera threw — classifies why users end up on the Retry screen. */
export function trackCameraStartFailed(errorType: string, message: string): void {
  track('camera_start_failed', { error_type: errorType, message: message.slice(0, 80) });
}

/** Model source label used in load events: 'cf' or 'vercel'. */
export function modelSourceLabel(wasmUrl: string): string {
  return wasmUrl.startsWith('https://') ? 'cf' : 'vercel';
}

export function trackModelLoad(
  event: 'started' | 'completed' | 'failed',
  params: { source: string; duration_ms?: number; reason?: string },
): void {
  track('model_load_' + event, params);
}

/** First hand detected after the camera starts (real activation moment). */
export function trackFirstGesture(secondsSinceLoad: number): void {
  track('first_gesture_detected', { seconds_since_load: Math.round(secondsSinceLoad) });
}

export function trackRecording(
  event: 'started' | 'completed',
  opts?: { durationSec?: number; ended?: 'timeout' | 'user'; mode?: 'camera' | 'keyboard' },
): void {
  track(
    'recording_' + event,
    opts
      ? {
          ...(opts.durationSec !== undefined ? { duration_seconds: Math.round(opts.durationSec) } : {}),
          ...(opts.ended ? { ended: opts.ended } : {}),
          ...(opts.mode ? { mode: opts.mode } : {}),
        }
      : undefined,
  );
}

/** Per-session traffic-source tag (Clarity custom tag — attaches to every
 *  event of the session, so no event needs its own source param). */
export function initTrafficSource(): void {
  const ref = document.referrer || '';
  const source = /google|bing|yahoo|baidu|duckduckgo/i.test(ref)
    ? 'search'
    : /twitter|x\.com|reddit|youtube|tiktok|facebook|instagram|weibo|wechat/i.test(ref)
      ? 'social'
      : ref
        ? 'referral'
        : 'direct';
  if (typeof window.clarity === 'function') {
    window.clarity('set', 'traffic_source', source);
  }
}

/**
 * Loading screen exposure: how long users actually stared at the loading
 * UI (cache hits skip it entirely, so model_load duration alone overstates
 * the ad window). Fired at the end of every camera start, success or not.
 */
export function trackLoadingScreenVisible(durationMs: number, result: 'success' | 'failed'): void {
  track('loading_screen_visible', {
    duration_ms: Math.round(durationMs),
    result,
    cached: durationMs < 300, // sub-300ms ≈ browser-cached model, screen barely shows
  });
}

/** User stayed on the page ≥10s (funnel start: "came but never touched the
 *  camera"). Fires once per page load. */
export function trackPageEngaged(): void {
  const ref = document.referrer || '';
  const referrerType = /google|bing|yahoo|baidu|duckduckgo/i.test(ref)
    ? 'search'
    : /twitter|x\.com|reddit|youtube|tiktok/i.test(ref)
      ? 'social'
      : 'other';
  track('page_engaged', { seconds_on_page: 10, referrer_type: referrerType });
}

/** User previewed the recording result ≥5s without downloading. */
export function trackRecordingViewed(): void {
  track('recording_viewed', { preview_seconds: 5, downloaded: false });
}

const settingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Settings-panel interaction (Freemium paywall signal — which advanced
 * controls get used). Debounced 500ms per setting so range sliders log
 * their final value once instead of firing per drag tick.
 */
export function trackSettingChanged(setting: string, value: string): void {
  const t = settingTimers.get(setting);
  if (t) clearTimeout(t);
  settingTimers.set(
    setting,
    setTimeout(() => track('setting_changed', { setting, value }), 500),
  );
}

/** Download button pressed in the result panel. */
export function trackDownload(): void {
  track('download_clicked');
}

/**
 * Share-sheet outcome (mobile Web Share API) — closes the recording
 * funnel's blind spot: recordings previewed but never downloaded may
 * actually be leaving via the share sheet. mode 'text' = the file share
 * was rejected and the brand message fell back to a text-only share.
 */
export function trackShare(result: 'success' | 'canceled' | 'failed', mode: 'file' | 'text' = 'file'): void {
  track('share_attempted', { result, mode });
}

/**
 * Caption copied (desktop share path, 2026-10-07). Desktop browsers have
 * no Web Share API — the loop there is download the video, upload it,
 * paste this caption. Own event name (not a share_attempted mode) so it
 * shows up in the standard eventName breakdown without registering a
 * custom dimension.
 */
export function trackCaptionCopied(): void {
  track('caption_copied');
}

/** Record button pressed with idle → chooser (the funnel entry). */
export function trackRecordButtonClicked(): void {
  track('record_button_clicked');
}

/** "Include my voice" toggle in the recording chooser. */
export function trackMicToggled(on: boolean): void {
  track('mic_toggled', { on: on ? 'on' : 'off' });
}

/** User scrolled the SEO content (Playbook) into view — ad placement signal. */
export function trackScrollToPlaybook(): void {
  track('scroll_to_playbook');
}

/* ─── Keyboard mode funnel (added 2026-08-09, see docs/analytics-events.md) ──
 *
 * Measures interest in the no-camera feature: which surface converts
 * (entry source), whether users actually play (first note + notes on
 * exit), and bounce (session duration on exit). Session = one keyboard
 * start; exit fires on switch-back, settings-off, or page close. */

export type KeyboardModeSource = 'main_button' | 'landing_hint' | 'toolbar' | 'settings' | 'seo_cta';

/** Keyboard mode started — which surface converted the user. */
export function trackKeyboardModeEntered(source: KeyboardModeSource): void {
  track('kb_mode_enter', { source });
}

/** Keyboard session ended — bounce and depth in one low-frequency event. */
export function trackKeyboardModeExited(params: {
  source: 'toolbar' | 'settings' | 'page_close';
  durationSec: number;
  notesPlayed: number;
}): void {
  track('kb_mode_exit', {
    source: params.source,
    duration_s: Math.round(params.durationSec),
    notes_played: params.notesPlayed,
  });
}

/** First note pressed in a keyboard session (activation, mirror of
 *  first_gesture_detected — the "actually tried it" signal). */
export function trackKeyboardFirstNote(secondsSinceStart: number): void {
  track('kb_first_note', { seconds_since_start: Math.round(secondsSinceStart) });
}

/** Keyboard guide shown — first-run auto-pop or Help replay. */
export function trackKeyboardGuideShown(source: 'auto' | 'replay'): void {
  track('kb_guide_shown', { source });
}

/** Guide dismissed — which path closed it (health of the teaching moment). */
export function trackKeyboardGuideDismissed(method: 'close' | 'x' | 'overlay' | 'esc'): void {
  track('kb_guide_dismissed', { method });
}

/* ─── Pro-gate probe (2026-08-10; front-end only, no payment code) ─────
 *
 * The free build shows the Pro teaser (lock icon + copy) but never
 * blocks a feature. seen/clicked are the engagement signals for it. */

export type ProGateLocation = 'rec_chooser' | 'rec_result' | 'settings';

/** The Pro teaser is visible (chooser open / result panel / settings panel). */
export function trackProGateSeen(location: ProGateLocation): void {
  track('pro_gate_seen', { location });
}

/** The player clicked the Pro teaser (locked-feature interest signal). */
export function trackProGateClicked(location: ProGateLocation): void {
  track('pro_gate_clicked', { location });
}

/* ─── Local recordings library events (2026-08-17) ────────────────────
 *
 * Finished recordings auto-save to browser IndexedDB (zero upload); a
 * returning player sees "My recordings" on the landing page and can
 * replay / re-download. These events measure whether the library earns
 * return visits. */

/** A recording finished and saved to local storage (the denominator;
 *  never fires on failure — save health = work_saved / recording_completed). */
export function trackWorkSaved(type: 'audio' | 'video'): void {
  track('work_saved', { type });
}

/** The player saw the recordings list (max once per session, only when
 *  count > 0) — the core denominator. 2026-08-18 correction: whichever
 *  list renders first counts (landing modal OR result-panel list, guarded
 *  by sessionStorage); previously only the landing counted while replays
 *  counted from both places, under-reporting the replay rate. */
export function trackWorksListSeen(count: number): void {
  track('works_list_seen', { count });
}

/** The player replayed a recording — the direct "came back for it" signal. */
export function trackWorkReplayed(): void {
  track('work_replayed');
}

/** The player re-downloaded a recording from the list (a weaker signal
 *  than replay). */
export function trackWorkDownloaded(): void {
  track('work_downloaded');
}

/** The player deleted a recording (2026-08-18; negative signal — the
 *  library being used and curated). `source` records where it happened.
 *  Low-frequency action. */
export function trackWorkDeleted(source: 'result_panel' | 'landing'): void {
  track('work_deleted', { source });
}

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}
