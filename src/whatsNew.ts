/**
 * What's-new mechanism (2026-08-09): one place to announce new features.
 *
 * Two touchpoints, two mechanisms — each maps to a different moment in
 * the user's journey (user decision 2026-08-09):
 *
 *  - LANDING hint (below the main button): TIME-based conversion assist
 *    at the "should I enable the camera?" decision point. Shows while
 *    the announcement is ACTIVE (ANNOUNCE_DAYS window), then stops on
 *    its own. No ✕, no dismissal — it can't be "seen once and lost"
 *    and the player never has to close it. Click = enter the feature.
 *
 *  - PLAYING-scene card (below the toolbar, camera modes only — a
 *    keyboard-mode player IS the new feature): DISMISSAL-based
 *    announcement at the moment the player is in the experience. Shows
 *    every session while active until the player closes it with the ✕
 *    (localStorage gsw-whatsnew-dismissed). Sits at Help's corner UNDER
 *    Help's z-index, so the two never stack at any resolution: Help open
 *    covers the card (and shows the full announcement anyway).
 *
 *  - Help modal: shows "New in this version" permanently (changelog
 *    role) — reading it dismisses nothing.
 *
 *  - After the announce window both touchpoints go quiet on their own.
 */

export interface WhatsNewEntry {
  /** Displayed in the badge; also the localStorage seen-marker. */
  version: string;
  /** ISO date of release — the announce window starts here. */
  releasedAt: string;
  title: string;
  body: string;
}

/** How long the landing hint stays active after release. */
const ANNOUNCE_DAYS = 14;

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: 'v2.1',
    releasedAt: '2026-08-09',
    title: 'Keyboard mode — no camera needed',
    body: 'Turn your physical keyboard into the instrument: hold 1-7 for chords, [ ] for major/minor, Shift for octave down, arrows for volume & filter. Enable it in Settings — no camera permission, no model download. An interactive real-keyboard guide teaches every key.',
  },
];

/** Version of the newest entry — the localStorage marker for "seen". */
export const LATEST_VERSION = WHATS_NEW[0]?.version ?? '';

/** Announcement is still within its release window. */
export function whatsNewActive(): boolean {
  const entry = WHATS_NEW[0];
  if (!entry) return false;
  const released = Date.parse(entry.releasedAt);
  if (Number.isNaN(released)) return false;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Date.now() - released <= ANNOUNCE_DAYS * msPerDay;
}

/** The player dismissed the card — never show it again. */
export function whatsNewDismissed(): boolean {
  try { return localStorage.getItem('gsw-whatsnew-dismissed') === LATEST_VERSION; } catch { return true; }
}

export function markWhatsNewDismissed(): void {
  if (!LATEST_VERSION) return;
  try { localStorage.setItem('gsw-whatsnew-dismissed', LATEST_VERSION); } catch { /* private mode */ }
}
