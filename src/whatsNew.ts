/**
 * What's-new mechanism (2026-08-09): one place to announce new features.
 *
 * How it works:
 *  - Add the newest entry at the TOP of WHATS_NEW (with releasedAt).
 *  - Landing page: shows a "NEW" hint line under the main button while the
 *    announcement is ACTIVE (within the ANNOUNCE_DAYS window) and the
 *    player hasn't CLICKED it — at most ONCE per session (sessionStorage),
 *    so a missed hint reappears on the next visit but a refresh doesn't
 *    nag. Clicking it (entering the feature) marks it seen forever.
 *  - Help modal: shows "New in this version" permanently (changelog role).
 *
 * Rationale (user decision 2026-08-09): a single one-time hint is easy to
 * miss; an eternal hint is noise on a conversion page. The announce window
 * + once-per-session rule reaches players across visits without nagging.
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

/** The player CLICKED the hint (entered the feature) — seen forever. */
export function whatsNewClicked(): boolean {
  try { return localStorage.getItem('gsw-whatsnew-seen') === LATEST_VERSION; } catch { return true; }
}

export function markWhatsNewClicked(): void {
  if (!LATEST_VERSION) return;
  try { localStorage.setItem('gsw-whatsnew-seen', LATEST_VERSION); } catch { /* private mode */ }
}

/** Once per session — a refresh must not re-show the hint. */
export function whatsNewShownThisSession(): boolean {
  try { return sessionStorage.getItem('gsw-whatsnew-session') === LATEST_VERSION; } catch { return true; }
}

export function markWhatsNewShownThisSession(): void {
  if (!LATEST_VERSION) return;
  try { sessionStorage.setItem('gsw-whatsnew-session', LATEST_VERSION); } catch { /* private mode */ }
}
