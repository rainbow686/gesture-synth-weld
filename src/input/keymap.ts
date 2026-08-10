/**
 * Customizable keyboard-mode key bindings (2026-08-10).
 *
 * KeyboardSource's mapping used to be hardcoded `e.key` literals — notably
 * '[' / ']' for minor/major, which sit behind AltGr on German QWERTZ and
 * are awkward to reach while holding a degree key. This module is the
 * single source of truth for the default bindings, their display copy, and
 * localStorage persistence of player overrides; KeyboardSource, App,
 * SettingsPanel, and KbGuide all read/write through it so nothing drifts.
 *
 * Space (stop-all) is intentionally NOT an action here — it's handled in
 * App "by category convention" (see keyboardSource.ts) and stays fixed.
 */

export type KbAction =
  | 'degree1' | 'degree2' | 'degree3' | 'degree4' | 'degree5' | 'degree6' | 'degree7'
  | 'minor' | 'major'
  | 'chordStyle1' | 'chordStyle2' | 'chordStyle3' | 'chordStyle4'
  | 'octaveDown'
  | 'volumeUp' | 'volumeDown' | 'filterLeft' | 'filterRight';

export interface KbActionMeta {
  label: string;
  group: 'harmony' | 'expression';
}

export const ACTION_META: Record<KbAction, KbActionMeta> = {
  degree1: { label: 'I (tonic)', group: 'harmony' },
  degree2: { label: 'II', group: 'harmony' },
  degree3: { label: 'III', group: 'harmony' },
  degree4: { label: 'IV', group: 'harmony' },
  degree5: { label: 'V', group: 'harmony' },
  degree6: { label: 'VI', group: 'harmony' },
  degree7: { label: 'VII', group: 'harmony' },
  minor: { label: 'Minor', group: 'harmony' },
  major: { label: 'Major', group: 'harmony' },
  chordStyle1: { label: 'Triad', group: 'expression' },
  chordStyle2: { label: '1st inversion', group: 'expression' },
  chordStyle3: { label: '7th chord', group: 'expression' },
  chordStyle4: { label: '9th chord', group: 'expression' },
  octaveDown: { label: 'Octave down (8vb)', group: 'expression' },
  volumeUp: { label: 'Volume up', group: 'expression' },
  volumeDown: { label: 'Volume down', group: 'expression' },
  filterLeft: { label: 'Filter sweep left', group: 'expression' },
  filterRight: { label: 'Filter sweep right', group: 'expression' },
};

export const ACTION_ORDER: KbAction[] = [
  'degree1', 'degree2', 'degree3', 'degree4', 'degree5', 'degree6', 'degree7',
  'minor', 'major',
  'chordStyle1', 'chordStyle2', 'chordStyle3', 'chordStyle4',
  'octaveDown',
  'volumeUp', 'volumeDown', 'filterLeft', 'filterRight',
];

export const DEFAULT_KEYMAP: Record<KbAction, string> = {
  degree1: '1', degree2: '2', degree3: '3', degree4: '4', degree5: '5', degree6: '6', degree7: '7',
  minor: '[', major: ']',
  chordStyle1: '8', chordStyle2: '9', chordStyle3: '0', chordStyle4: '-',
  octaveDown: 'Shift',
  volumeUp: 'ArrowUp', volumeDown: 'ArrowDown', filterLeft: 'ArrowLeft', filterRight: 'ArrowRight',
};

export interface KeymapPreset {
  id: string;
  label: string;
  map: Record<KbAction, string>;
}

/** Built-in full-keymap presets (2026-08-10) — a starting point players can
 *  still rebind individual keys on top of. QWERTZ (German, and most other
 *  EU layouts) puts '[' / ']' behind AltGr — awkward mid-play — so that
 *  preset moves minor/major to 'q' / 'w' instead (free, adjacent to the
 *  degree row, no AltGr on any layout). Everything else (digits, Shift,
 *  arrows) is layout-agnostic already, so only minor/major needs to move. */
export const KEYMAP_PRESETS: KeymapPreset[] = [
  { id: 'qwerty', label: 'QWERTY (default)', map: { ...DEFAULT_KEYMAP } },
  { id: 'qwertz', label: 'German (QWERTZ)', map: { ...DEFAULT_KEYMAP, minor: 'q', major: 'w' } },
];

/** Which preset (if any) exactly matches the current map — 'custom' when
 *  the player has rebound something on top of a preset (or from scratch). */
export function matchingPresetId(map: Record<KbAction, string>): string {
  const preset = KEYMAP_PRESETS.find((p) => ACTION_ORDER.every((a) => p.map[a] === map[a]));
  return preset?.id ?? 'custom';
}

const STORAGE_KEY = 'gsw-keyboard-keymap';

/** Keys a rebind may never be assigned — reserved by App (stop / reset). */
const RESERVED_KEYS = new Set([' ', 'Escape']);

export function isAssignableKey(key: string): boolean {
  return !RESERVED_KEYS.has(key);
}

/** Glyph for UI display — arrows/Space get symbols, everything else uppercases. */
export function displayKey(key: string): string {
  switch (key) {
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case ' ': return 'Space';
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Loads saved overrides merged onto DEFAULT_KEYMAP (missing/future actions
 *  always resolve to their default, even against an old partial save). */
export function loadKeymap(): Record<KbAction, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEYMAP };
    const saved = JSON.parse(raw) as Partial<Record<KbAction, string>>;
    return { ...DEFAULT_KEYMAP, ...saved };
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(map: Record<KbAction, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable (private mode, quota) — binding just won't persist.
  }
}
