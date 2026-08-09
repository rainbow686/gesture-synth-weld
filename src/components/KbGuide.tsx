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
 * each glows for ~1.4s with a caption explaining it ("6 = VI 级"), looping
 * until the player presses a mapped key themselves (then the demo pauses
 * and the guide becomes a live press-to-learn display).
 *
 * Auto-hide: ONLY for the first-run auto-pop (8s, App-controlled). The
 * Help-modal replay passes autoHide=false — the player asked to see it,
 * so it stays open until they click or press Esc.
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

/** Keys the app maps — pressing any of these hands control to the player
 *  (demo pauses; the guide becomes a live press-to-learn display). */
const MAPPED_KEY_SET = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-',
  '[', ']', 'Shift',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ' ',
]);

/** Auto-demo script: every mapped key in teaching order, one caption each. */
const DEMO_STEPS: { key: string; caption: string }[] = [
  { key: '1', caption: '按 1 → I 级（主和弦）' },
  { key: '2', caption: '按 2 → II 级' },
  { key: '3', caption: '按 3 → III 级' },
  { key: '4', caption: '按 4 → IV 级' },
  { key: '5', caption: '按 5 → V 级' },
  { key: '6', caption: '按 6 → VI 级' },
  { key: '7', caption: '按 7 → VII 级' },
  { key: '[', caption: '按 [ → 小调' },
  { key: ']', caption: '按 ] → 大调' },
  { key: '8', caption: '按 8 → 三和弦' },
  { key: '9', caption: '按 9 → 第一转位' },
  { key: '0', caption: '按 0 → 七和弦' },
  { key: '-', caption: '按 - → 九和弦' },
  { key: 'Shift', caption: '按住 Shift → 低八度（8vb）' },
  { key: 'ArrowUp', caption: '按住 ↑ → 音量增大' },
  { key: 'ArrowDown', caption: '按住 ↓ → 音量减小' },
  { key: 'ArrowLeft', caption: '按住 ← → 滤波扫频（左）' },
  { key: 'ArrowRight', caption: '按住 → → 滤波扫频（右）' },
  { key: ' ', caption: '按 Space → 停止所有声音' },
];

/** Demo pacing: one key per 1.4s — readable, not rushed. */
const DEMO_MS = 1400;

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
  // Auto-demo state: null = not demoing (player took over), else the
  // current DEMO_STEPS index.
  const [demoStep, setDemoStep] = useState<number | null>(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
        return;
      }
      // First mapped key the player presses ends the demo — they're
      // playing now, the guide becomes a live press-to-learn display.
      if (MAPPED_KEY_SET.has(e.key)) setDemoStep(null);
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

  // Demo timer — loops through the script until the player takes over
  // (functional update keeps the latest state; no stale closures).
  useEffect(() => {
    const id = window.setInterval(() => {
      setDemoStep((cur) => (cur === null ? null : (cur + 1) % DEMO_STEPS.length));
    }, DEMO_MS);
    return () => window.clearInterval(id);
  }, []);

  const demoKey = demoStep === null ? null : DEMO_STEPS[demoStep]?.key ?? null;
  const demoCaption = demoStep === null ? null : DEMO_STEPS[demoStep]?.caption ?? null;

  const renderRow = (row: KbKey[]) => (
    <div className="kb-row">
      {row.map((k) => (
        <div
          key={k.key}
          className={`kb-key${k.color ? ` kb-key-${k.color}` : ''}${activeKeys.has(k.key) || k.key === demoKey ? ' kb-key-active' : ''}${k.key === demoKey ? ' kb-key-demo' : ''}`}
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
      <div className="kb-guide-sub">Watch the demo, then press the keys yourself — they light up as you play</div>
      <div className="kb-keyboard">
        {renderRow(ROW_0)}
        {renderRow(ROW_1)}
        {renderRow(ROW_2)}
        {renderRow(ROW_3)}
        {renderRow(ROW_4)}
      </div>
      <div className={`kb-guide-demo${demoCaption ? ' visible' : ''}`}>
        {demoCaption ?? '你按的键会在这里亮起 — 自己试试吧！'}
      </div>
      <div className="kb-guide-hint">
        Hold 1–7 to play · [ ] minor/major · Shift = octave down · click or Esc to close
      </div>
    </div>
  );
}
