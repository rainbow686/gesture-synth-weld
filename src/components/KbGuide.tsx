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
 * The component self-contains the highlight logic (its own window
 * keydown/keyup listeners while mounted); App only toggles visibility.
 * Dismissal: overlay click, Esc, or App's auto-hide timer (8s).
 *
 * Color coding (brand-consistent):
 *   cyan (harmony)  — 1-7 scale degrees, [ ] minor/major
 *   pink (expression) — 8/9/0/- chord style, Shift 8vb, arrow sweeps
 *   red (stop)      — Space
 * Unmapped keys stay dim — the contrast shows what is usable.
 */

import { useEffect, useState } from 'react';

interface KbKey {
  /** e.key value used for live highlight matching. */
  key: string;
  /** Text printed on the keycap. */
  cap: string;
  /** Function/degree label under the cap. */
  label?: string;
  /** Width in key units (1 = standard letter key). */
  wide?: number;
  /** Accent group. */
  color?: 'harmony' | 'expression' | 'stop';
}

const ROW_0: KbKey[] = [
  { key: '`', cap: '`' },
  { key: '1', cap: '1', label: 'I', color: 'harmony' },
  { key: '2', cap: '2', label: 'II', color: 'harmony' },
  { key: '3', cap: '3', label: 'III', color: 'harmony' },
  { key: '4', cap: '4', label: 'IV', color: 'harmony' },
  { key: '5', cap: '5', label: 'V', color: 'harmony' },
  { key: '6', cap: '6', label: 'VI', color: 'harmony' },
  { key: '7', cap: '7', label: 'VII', color: 'harmony' },
  { key: '8', cap: '8', label: 'Triad', color: 'expression' },
  { key: '9', cap: '9', label: '1st inv', color: 'expression' },
  { key: '0', cap: '0', label: '7th', color: 'expression' },
  { key: '-', cap: '-', label: '9th', color: 'expression' },
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
  { key: '[', cap: '[', label: 'Minor', color: 'harmony' },
  { key: ']', cap: ']', label: 'Major', color: 'harmony' },
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
  { key: 'Shift', cap: 'Shift', label: '8vb', wide: 2.25, color: 'expression' },
  { key: ' ', cap: 'Space', label: 'Stop all', wide: 5.5, color: 'stop' },
  { key: 'ArrowUp', cap: '↑', label: 'Volume', color: 'expression' },
  { key: 'ArrowDown', cap: '↓', label: 'Volume', color: 'expression' },
  { key: 'ArrowLeft', cap: '←', label: 'Filter', color: 'expression' },
  { key: 'ArrowRight', cap: '→', label: 'Filter', color: 'expression' },
];

interface KbGuideProps {
  onDismiss: () => void;
}

export function KbGuide({ onDismiss }: KbGuideProps) {
  // Set (not single key) so 'hold 5 + press 8' highlights both.
  const [activeKeys, setActiveKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
        return;
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
  }, [onDismiss]);

  const renderRow = (row: KbKey[]) => (
    <div className="kb-row">
      {row.map((k) => (
        <div
          key={k.key}
          className={`kb-key${k.color ? ` kb-key-${k.color}` : ''}${activeKeys.has(k.key) ? ' kb-key-active' : ''}`}
          style={k.wide ? { flex: `${k.wide} 1 0` } : undefined}
        >
          <span className="kb-key-cap">{k.cap}</span>
          {k.label && <span className="kb-key-label">{k.label}</span>}
        </div>
      ))}
    </div>
  );

  return (
    <div className="kb-guide" onClick={onDismiss}>
      <div className="kb-guide-title">Keyboard Mode — how to play</div>
      <div className="kb-guide-sub">Press the real keys — they light up as you play</div>
      <div className="kb-keyboard">
        {renderRow(ROW_0)}
        {renderRow(ROW_1)}
        {renderRow(ROW_2)}
        {renderRow(ROW_3)}
        {renderRow(ROW_4)}
      </div>
      <div className="kb-guide-hint">
        Hold 1–7 to play · [ ] minor/major · Shift = octave down · click or Esc to close
      </div>
    </div>
  );
}
