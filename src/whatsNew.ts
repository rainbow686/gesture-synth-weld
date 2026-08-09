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
 *    desktopOnly entries are skipped on mobile (bug 2026-08-09: mobile
 *    users clicked into a desktop-only mode with no way back).
 *
 *  - PLAYING-scene card: DISMISSAL-based announcement at the moment the
 *    player is in the experience — a GENERIC announcement slot that
 *    shows in EVERY playing mode, camera and keyboard (user decision
 *    2026-08-09: it's a description, not a keyboard shortcut, so the
 *    old !keyboardMode gate is gone; future features announce here in
 *    any scene). Shows every session while active until the player
 *    closes it with the ✕ (localStorage gsw-whatsnew-dismissed).
 *    DESKTOP: bottom-left, above the status bar (--status-bar-h + 10px)
 *    — clear of the toolbar, Help and the waveform. MOBILE: top-left,
 *    below the compact toolbar — the Scale Guide's 8 degree blocks own
 *    the bottom area, and the tiny viewfinder can't spare a full card, so
 *    it AUTO-COLLAPSES after 4s into a small NEW dot (iOS floating-pill
 *    pattern, user decision 2026-08-09): tap to re-expand, ✕ to dismiss.
 *    TEACHING card, not a shortcut: it points at the toolbar control the
 *    entry declares in pulseTarget (that button pulses while the card is
 *    visible, per-mode teaching line from entry.teach) — the player
 *    learns the PERMANENT control, which outlives the 14-day card.
 *    Future entries without pulseTarget/teach simply show no pulse and
 *    no teaching line.
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
  /** Optional: toolbar control the playing-scene card teaches — that
   *  button pulses while the card is visible (semantic key; 'mode-switch'
   *  = the camera↔keyboard switch). Future entries that don't teach a
   *  toolbar control simply omit it — no pulse. (User decision
   *  2026-08-09: the pulse must not be hardcoded to the mode switch;
   *  the card is a generic announcement slot.) */
  pulseTarget?: string;
  /** Optional: per-mode teaching line on the playing-scene card — the
   *  card is a description, NOT a shortcut, so it points at the control
   *  instead of jumping. Per-mode so the line can name the current
   *  mode's actual button label. */
  teach?: { camera?: string; keyboard?: string };
  /** Optional: this announcement targets a DESKTOP-ONLY feature — on
   *  mobile the landing hint and the playing-scene card are skipped
   *  (bug 2026-08-09: mobile users clicked the landing hint into
   *  keyboard mode, which is desktop-only — a dead end with no way
   *  back, since every switch control is desktop-gated). Future
   *  mobile-relevant entries omit it and show everywhere. */
  desktopOnly?: boolean;
}

/** How long the landing hint stays active after release. */
const ANNOUNCE_DAYS = 14;

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: 'v2.1',
    releasedAt: '2026-08-09',
    title: 'Keyboard mode — no camera needed',
    body: 'Turn your physical keyboard into the instrument: hold 1-7 for chords, [ ] for major/minor, Shift for octave down, arrows for volume & filter. Enable it in Settings — no camera permission, no model download. An interactive real-keyboard guide teaches every key.',
    pulseTarget: 'mode-switch',
    teach: {
      camera: 'Switch via the keyboard button in the top toolbar',
      keyboard: 'Switch back via the Camera button in the top toolbar',
    },
    desktopOnly: true, // keyboard mode is desktop-only (no physical keys on phones)
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
