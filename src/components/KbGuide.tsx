/**
 * Keyboard guide overlay — the first-run (and replayable) teaching layer
 * for no-camera Keyboard Mode.
 *
 * Design (2026-08-09, user feedback): a REAL physical keyboard layout, not
 * an abstract mini-keypad. Two reasons, both from user review:
 *   1. Position recognition — QWERTY is the player's muscle-memory map;
 *      the numbered row, [ ] and the arrow keys are already known places,
 *      so the map is legible in a second.
 *   2. Press-to-learn — every mapped key highlights LIVE while pressed and
 *      shows what it produces (degree / function), so the eye tracks the
 *      pressed key and the brain forms the association. Playing IS the
 *      lesson.
 *
 * Demo animation (2026-08-09, user feedback: "teaching only works as
 * animation"): on open, the guide AUTO-CYCLES through every mapped key —
 * each glows for ~1.4s with a caption explaining it ("Press 6 → VI"),
 * looping until the player presses a mapped key themselves. The demo then
 * pauses and the caption line keeps showing the key the player pressed —
 * same teaching copy, live.
 *
 * Dismissal (2026-08-09, user decision): explicit close button (top-right
 * ✕) + overlay click + Esc. NO auto-hide (was 8s on first-run) and NO
 * key-press dismissal — the first keypress is the lesson, closing on it
 * would interrupt the learning action. Same behavior for the first-run
 * auto-pop and the Help-modal replay.
 *
 * Color coding (brand-consistent):
 *   cyan (harmony)  — degree1-7 scale degrees, minor/major
 *   pink (expression) — chordStyle1-4, octaveDown, volume/filter sweeps
 *   red (stop)      — Space
 * Unmapped keys stay dim — the contrast shows what is usable.
 *
 * (2026-08-10) Which physical key drives each action is player-customizable
 * (Settings → Customize Keys) — this component takes the live `keymap` as a
 * prop and renders everything (keycap overlays, demo script, hint line)
 * from it instead of hardcoded literals, so a rebind (e.g. minor/major off
 * '[' / ']', hard to reach on German QWERTZ) is reflected immediately.
 */

import { useEffect, useMemo, useState } from 'react';
import { ACTION_META, ACTION_ORDER, displayKey, type KbAction } from '../input/keymap';

interface KbKey {
  /** e.key value used for live highlight matching (physical key identity —
   *  NOT tied to whichever action is currently bound here). */
  key: string;
  /** Text printed on the keycap. */
  cap: string;
  /** Static function label — only Space uses this; every customizable key
   *  gets its label/color from the live keymap instead (see charToAction). */
  label?: string;
  /** Width in key units (1 = standard letter key). */
  wide?: number;
  /** Static accent group — only Space uses this (see `label` above). */
  color?: 'harmony' | 'expression' | 'stop';
}

/** Caption phrasing per action — kept separate from ACTION_META.label
 *  (Settings UI copy) since the guide's teaching voice differs: lowercase
 *  ("minor" not "Minor"), "Hold" for sustain actions, ":" separator for
 *  the actual arrow keys (a "→" mapping arrow next to an arrow-key glyph
 *  reads as a second key to press — bug 2026-08-09). */
const CAPTION_TEXT: Record<KbAction, string> = {
  degree1: 'I (tonic)', degree2: 'II', degree3: 'III', degree4: 'IV', degree5: 'V', degree6: 'VI', degree7: 'VII',
  minor: 'minor', major: 'major',
  chordStyle1: 'triad', chordStyle2: '1st inversion', chordStyle3: '7th chord', chordStyle4: '9th chord',
  octaveDown: 'octave down (8vb)',
  volumeUp: 'volume up', volumeDown: 'volume down', filterLeft: 'filter sweep left', filterRight: 'filter sweep right',
};
const CAPTION_HOLD = new Set<KbAction>(['octaveDown', 'volumeUp', 'volumeDown', 'filterLeft', 'filterRight']);
const CAPTION_COLON = new Set<KbAction>(['volumeUp', 'volumeDown', 'filterLeft', 'filterRight']);

function captionFor(action: KbAction, key: string): string {
  const verb = CAPTION_HOLD.has(action) ? 'Hold' : 'Press';
  const sep = CAPTION_COLON.has(action) ? ':' : '→';
  return `${verb} ${displayKey(key)} ${sep} ${CAPTION_TEXT[action]}`;
}

/** Demo pacing: one key per 1.4s — readable, not rushed. */
const DEMO_MS = 1400;

const ROW_0: KbKey[] = [
  { key: '`', cap: '`' },
  { key: '1', cap: '1' },
  { key: '2', cap: '2' },
  { key: '3', cap: '3' },
  { key: '4', cap: '4' },
  { key: '5', cap: '5' },
  { key: '6', cap: '6' },
  { key: '7', cap: '7' },
  { key: '8', cap: '8' },
  { key: '9', cap: '9' },
  { key: '0', cap: '0' },
  { key: '-', cap: '-' },
  { key: '=', cap: '=' },
];

const ROW_1: KbKey[] = [
  { key: 'q', cap: 'Q' },
  { key: 'w', cap: 'W' },
  { key: 'e', cap: 'E' },
  { key: 'r', cap: 'R' },
  { key: 't', cap: 'T' },
  { key: 'y', cap: 'Y' },
  { key: 'u', cap: 'U' },
  { key: 'i', cap: 'I' },
  { key: 'o', cap: 'O' },
  { key: 'p', cap: 'P' },
  { key: '[', cap: '[' },
  { key: ']', cap: ']' },
];

const ROW_2: KbKey[] = [
  { key: 'a', cap: 'A' },
  { key: 's', cap: 'S' },
  { key: 'd', cap: 'D' },
  { key: 'f', cap: 'F' },
  { key: 'g', cap: 'G' },
  { key: 'h', cap: 'H' },
  { key: 'j', cap: 'J' },
  { key: 'k', cap: 'K' },
  { key: 'l', cap: 'L' },
  { key: ';', cap: ';' },
  { key: "'", cap: "'" },
];

const ROW_3: KbKey[] = [
  { key: 'z', cap: 'Z' },
  { key: 'x', cap: 'X' },
  { key: 'c', cap: 'C' },
  { key: 'v', cap: 'V' },
  { key: 'b', cap: 'B' },
  { key: 'n', cap: 'N' },
  { key: 'm', cap: 'M' },
  { key: ',', cap: ',' },
  { key: '.', cap: '.' },
  { key: '/', cap: '/' },
];

const ROW_4: KbKey[] = [
  { key: 'Shift', cap: 'Shift', wide: 2.25 },
  { key: ' ', cap: 'Space', label: 'Stop all', wide: 5.5, color: 'stop' },
  { key: 'ArrowUp', cap: '↑' },
  { key: 'ArrowDown', cap: '↓' },
  { key: 'ArrowLeft', cap: '←' },
  { key: 'ArrowRight', cap: '→' },
];

interface KbGuideProps {
  keymap: Record<KbAction, string>;
  onDismiss: (method: 'close' | 'x' | 'overlay' | 'esc') => void;
}

export function KbGuide({ keymap, onDismiss }: KbGuideProps) {
  // Physical key → action, inverted from the live keymap — drives keycap
  // overlays (label/color) so a rebind shows up wherever it lands, not at
  // the old default position.
  const charToAction = useMemo(() => {
    const m = new Map<string, KbAction>();
    for (const a of ACTION_ORDER) m.set(keymap[a], a);
    return m;
  }, [keymap]);

  const mappedKeySet = useMemo(() => new Set([...Object.values(keymap), ' ']), [keymap]);

  const demoSteps = useMemo(() => {
    const steps = ACTION_ORDER.map((a) => ({ key: keymap[a], caption: captionFor(a, keymap[a]) }));
    steps.push({ key: ' ', caption: 'Press Space → stop all notes' });
    return steps;
  }, [keymap]);
  // Set (not single key) so 'hold 5 + press 8' highlights both.
  const [activeKeys, setActiveKeys] = useState<ReadonlySet<string>>(new Set());
  // Auto-demo state: null = not demoing (player took over), else the
  // current demoSteps index.
  const [demoStep, setDemoStep] = useState<number | null>(0);
  // The last mapped key the player pressed — its caption replaces the
  // demo caption once the player takes over (same teaching copy, live).
  const [lastKey, setLastKey] = useState<string | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // NOTE: Escape dismissal lives in App's global handler (it also
      // resets the synth) — a duplicate here would fire dismiss twice in
      // the same tick and double-report analytics.
      // First mapped key the player presses ends the demo — they're
      // playing now; the caption line follows their own presses.
      if (mappedKeySet.has(e.key)) {
        setDemoStep(null);
        setLastKey(e.key);
      }
      setActiveKeys((prev) => {
        if (prev.has(e.key)) return prev; // auto-repeat
        const next = new Set(prev);
        next.add(e.key);
        return next;
      });
    };
    const up = (e: KeyboardEvent) => setActiveKeys((prev) => {
      if (!prev.has(e.key)) return prev;
      const next = new Set(prev);
      next.delete(e.key);
      return next;
    });
    const clear = () => setActiveKeys(new Set());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, [onDismiss, mappedKeySet]);

  // Demo timer — loops through the script until the player takes over
  // (functional update keeps the latest state; no stale closures).
  useEffect(() => {
    const id = window.setInterval(() => {
      setDemoStep((cur) => (cur === null ? null : (cur + 1) % demoSteps.length));
    }, DEMO_MS);
    return () => window.clearInterval(id);
  }, [demoSteps.length]);

  const demoKey = demoStep === null ? null : demoSteps[demoStep]?.key ?? null;
  const keyCaptions = useMemo(() => new Map(demoSteps.map((s) => [s.key, s.caption])), [demoSteps]);
  const caption = demoStep !== null
    ? demoSteps[demoStep]?.caption ?? null
    : lastKey !== null
      ? keyCaptions.get(lastKey) ?? null
      : null;

  const renderRow = (row: KbKey[]) => (
    <div className="kb-row">
      {row.map((k) => {
        // Space keeps its static label/color (not part of the customizable
        // keymap); every other key's overlay follows whichever action is
        // currently bound to this physical position.
        const action = charToAction.get(k.key);
        const meta = action ? ACTION_META[action] : undefined;
        const label = k.label ?? meta?.label;
        const color = k.color ?? meta?.group;
        return (
          <div
            key={k.key}
            className={`kb-key${color ? ` kb-key-${color}` : ''}${activeKeys.has(k.key) || k.key === demoKey ? ' kb-key-active' : ''}${k.key === demoKey ? ' kb-key-demo' : ''}`}
            style={k.wide ? { flex: `${k.wide} 1 0` } : undefined}
          >
            <span className="kb-key-cap">{k.cap}</span>
            {label && <span className="kb-key-label">{label}</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="kb-guide" onClick={() => onDismiss('overlay')}>
      {/* Screen-corner ✕ (standard position — the explicit "Close" button
          below is the primary dismissal, so the ✕ is free to sit where
          users expect it; the in-panel corner crowded the number row). */}
      <button
        className="kb-guide-close"
        onClick={(e) => { e.stopPropagation(); onDismiss('x'); }}
        aria-label="Close keyboard guide"
        title="Close"
      >
        {/* Feather X (MIT) — consistent with the rest of the UI, no emoji */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="kb-guide-title">Keyboard Mode — how to play</div>
      <div className="kb-guide-sub">Watch the demo, then press the keys yourself — they light up as you play</div>
      <div className="kb-keyboard">
        {renderRow(ROW_0)}
        {renderRow(ROW_1)}
        {renderRow(ROW_2)}
        {renderRow(ROW_3)}
        {renderRow(ROW_4)}
      </div>
      <div className={`kb-guide-demo${caption ? ' visible' : ''}`}>
        {caption ?? 'Press any key above to see what it does'}
      </div>
      <button className="kb-guide-close-btn" onClick={(e) => { e.stopPropagation(); onDismiss('close'); }}>
        Close
      </button>
      <div className="kb-guide-hint">
        Hold {displayKey(keymap.degree1)}–{displayKey(keymap.degree7)} to play · {displayKey(keymap.minor)} {displayKey(keymap.major)} minor/major · {displayKey(keymap.octaveDown)} = octave down · back to camera: top toolbar camera button
      </div>
    </div>
  );
}
