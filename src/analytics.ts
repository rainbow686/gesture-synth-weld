/**
 * Analytics events — Microsoft Clarity + Google Analytics 4 custom events.
 *
 * Both SDKs load via index.html <head> with synchronous shims (window.clarity
 * and window.gtag exist from parse time and queue calls until the real SDK
 * arrives), so calling track() at any point is safe and adds zero network
 * overhead. Only low-frequency UI events are tracked here — never hot loops.
 */

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

/** Push one custom event to both Clarity and GA4 (guarded, no-op if absent). */
function track(name: string, params?: Record<string, unknown>): void {
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
