/**
 * What's-new mechanism (2026-08-09): one place to announce new features.
 *
 * How it works:
 *  - Add the newest entry at the TOP of WHATS_NEW (with releasedAt).
 *  - Landing page: shows a "NEW" card under the main button while the
 *    announcement is ACTIVE (within the ANNOUNCE_DAYS window) and the
 *    player hasn't dismissed it. It reappears on EVERY visit until
 *    dismissed — the player decides when they've seen it (a one-time or
 *    once-per-session hint proved too easy to miss; user decision
 *    2026-08-09).
 *  - Dismissal = clicking the card (entering the feature), its ✕ button,
 *    or opening Help (which shows the full announcement) — all mark it
 *    told forever (localStorage gsw-whatsnew-seen).
 *  - After the announce window the card disappears on its own.
 *  - Help modal: shows "New in this version" permanently (changelog role).
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

/** The player dismissed/told — never show the card again. */
export function whatsNewDismissed(): boolean {
  try { return localStorage.getItem('gsw-whatsnew-seen') === LATEST_VERSION; } catch { return true; }
}

export function markWhatsNewDismissed(): void {
  if (!LATEST_VERSION) return;
  try { localStorage.setItem('gsw-whatsnew-seen', LATEST_VERSION); } catch { /* private mode */ }
}
