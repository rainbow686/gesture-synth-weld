/**
 * What's-new mechanism (2026-08-09): one place to announce new features.
 *
 * How it works:
 *  - Add the newest entry at the TOP of WHATS_NEW.
 *  - The landing page shows a "NEW" line under the main button until the
 *    player has seen this version (localStorage gsw-whatsnew-seen).
 *  - The Help modal shows "New in this version" (always; the badge state
 *    only controls the landing hint).
 *  - Clicking the landing hint (or opening Help) marks the version seen.
 */

export interface WhatsNewEntry {
  /** Displayed in the badge; also the localStorage seen-marker. */
  version: string;
  title: string;
  body: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: 'v2.1',
    title: 'Keyboard mode — no camera needed',
    body: 'Turn your physical keyboard into the instrument: hold 1-7 for chords, [ ] for major/minor, Shift for octave down, arrows for volume & filter. Enable it in Settings — no camera permission, no model download. An interactive real-keyboard guide teaches every key.',
  },
];

/** Version of the newest entry — the localStorage marker for "seen". */
export const LATEST_VERSION = WHATS_NEW[0]?.version ?? '';

export function whatsNewSeen(): boolean {
  try { return localStorage.getItem('gsw-whatsnew-seen') === LATEST_VERSION; } catch { return true; }
}

export function markWhatsNewSeen(): void {
  if (!LATEST_VERSION) return;
  try { localStorage.setItem('gsw-whatsnew-seen', LATEST_VERSION); } catch { /* private mode */ }
}
