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

/** Enable Camera button pressed. */
export function trackCameraClicked(): void {
  track('camera_button_clicked', { device: isMobileDevice() ? 'mobile' : 'desktop' });
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

export type KeyboardModeSource = 'main_button' | 'landing_hint' | 'toolbar' | 'settings';

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

/* ─── Pro 付费意图探针（2026-08-10，订阅需求验证——纯前端，不动支付）───
 *
 * 免费版画 Pro 边界（锁定图标 + 文案），但功能完全不拦截。谁"看到"、
 * 谁"点击"，即付费意愿信号——不需要 Stripe/付费墙就能先验证需求。
 * 判定阈值见 docs/analytics-events.md。 */

export type ProGateLocation = 'rec_chooser' | 'rec_result' | 'settings';

/** Pro 边界提示对用户可见（chooser 打开 / 结果面板出现 / 设置面板打开）。 */
export function trackProGateSeen(location: ProGateLocation): void {
  track('pro_gate_seen', { location });
}

/** 用户点击了 Pro 边界提示（锁定功能 → 付费意愿信号）。 */
export function trackProGateClicked(location: ProGateLocation): void {
  track('pro_gate_clicked', { location });
}

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}
