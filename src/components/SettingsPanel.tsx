/**
 * Settings panel (extracted from App.tsx 2026-08-09, pure move — JSX and
 * handlers identical). Left/right hand harmony/expression modes, arp/bass
 * extras, visual atmosphere sliders, and the no-camera keyboard toggle.
 *
 * Pure presentation: every state access and side effect flows through
 * props (synthState/setters + callback handlers); App keeps the business
 * logic (persistence, mode lifecycle).
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ArpSpeed, LeftHandMode, RightHandMode, SynthState } from '../types';
import { CHORD_STYLE_OPTIONS, type ChordStyle } from '../chords';
import { trackSettingChanged } from '../analytics';
import { ACTION_META, ACTION_ORDER, DEFAULT_KEYMAP, KEYMAP_PRESETS, displayKey, isAssignableKey, matchingPresetId, type KbAction } from '../input/keymap';

export interface SettingsPanelProps {
  onClose: () => void;
  synthState: SynthState;
  setSynthState: Dispatch<SetStateAction<SynthState>>;
  vignetteStrength: number;
  setVignetteStrength: (v: number) => void;
  scanlinesStrength: number;
  setScanlinesStrength: (v: number) => void;
  isMobile: boolean;
  keyboardMode: boolean;
  isRunning: boolean;
  /** Keyboard-mode checkbox toggle — App decides what to start/stop. */
  onKeyboardToggle: (on: boolean) => void;
  /** Current player-customizable key bindings (see input/keymap.ts). */
  keymap: Record<KbAction, string>;
  onKeymapChange: (map: Record<KbAction, string>) => void;
  /** Opens the real-keyboard overlay (KbGuide) so the player can see where
   *  every action currently lives before/while rebinding. */
  onOpenGuide: () => void;
}

export function SettingsPanel({
  onClose,
  synthState,
  setSynthState,
  vignetteStrength,
  setVignetteStrength,
  scanlinesStrength,
  setScanlinesStrength,
  isMobile,
  keyboardMode,
  isRunning,
  onKeyboardToggle,
  keymap,
  onKeymapChange,
  onOpenGuide,
}: SettingsPanelProps) {
  // Rebind capture: which action is armed to receive the next keypress.
  const [listeningFor, setListeningFor] = useState<KbAction | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!listeningFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      if (e.key === 'Escape') {
        setListeningFor(null);
        setConflictMsg(null);
        return;
      }
      if (!isAssignableKey(e.key)) {
        setConflictMsg(`"${displayKey(e.key)}" is reserved`);
        return;
      }
      const takenBy = ACTION_ORDER.find((a) => a !== listeningFor && keymap[a] === e.key);
      if (takenBy) {
        setConflictMsg(`Already used by ${ACTION_META[takenBy].label}`);
        return;
      }
      onKeymapChange({ ...keymap, [listeningFor]: e.key });
      setListeningFor(null);
      setConflictMsg(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listeningFor, keymap, onKeymapChange]);

  const renderKeyRow = (action: KbAction) => {
    const meta = ACTION_META[action];
    const isListening = listeningFor === action;
    return (
      <div key={action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>{meta.label}</span>
        <button
          onClick={() => { setListeningFor(action); setConflictMsg(null); }}
          style={{
            fontSize: '0.6rem',
            padding: '2px 8px',
            minWidth: '64px',
            borderRadius: '4px',
            border: `1px solid ${isListening ? 'var(--neon-magenta)' : 'rgba(255,255,255,0.15)'}`,
            background: isListening ? 'rgba(255,0,255,0.1)' : 'transparent',
            color: isListening ? 'var(--neon-magenta)' : 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {isListening ? 'Press a key…' : displayKey(keymap[action])}
        </button>
      </div>
    );
  };
  return (
    <div className="frost-panel" style={{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', flexDirection: 'column', gap: '10px', padding: '16px 18px', maxWidth: '700px', fontSize: '0.65rem' }}>
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: '6px', right: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', padding: '4px' }}
        data-tip="Close settings"
      >✕</button>
      {/* Performance settings (wraps on narrow screens) */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', flexWrap: 'wrap' }}>
      {/* Left Hand */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px' }}>
        <label style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left Hand — Harmony</label>
        <select value={synthState.leftHandMode} onChange={(e) => { trackSettingChanged('left_hand_mode', e.target.value); setSynthState(prev => ({ ...prev, leftHandMode: e.target.value as LeftHandMode })); }}>
          <option value="scaleTilt">Scale notes + tilt major/minor</option>
          <option value="scaleLocked">Scale notes only (lock mode)</option>
        </select>
        {synthState.leftHandMode === 'scaleTilt' ? (
          <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Fingers pick the scale degree; wrist tilt flips major ↔ minor.</p>
        ) : (
          <>
            <select value={synthState.lockedMode ?? 'major'} onChange={(e) => { trackSettingChanged('locked_mode', e.target.value); setSynthState(prev => ({ ...prev, lockedMode: e.target.value as 'major' | 'minor' })); }}>
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </select>
            <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Fingers pick the scale degree only. Mode is locked above.</p>
          </>
        )}
      </div>

      <span className="divider" style={{ height: 'auto', alignSelf: 'stretch' }} />

      {/* Right Hand */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
        <label style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right Hand — Expression</label>
        <select value={synthState.rightHandMode} onChange={(e) => { trackSettingChanged('right_hand_mode', e.target.value); setSynthState(prev => ({ ...prev, rightHandMode: e.target.value as RightHandMode })); }}>
          <option value="fingerLayout">Finger layout = chord style</option>
          <option value="fixedChordStyle">Fixed chord style</option>
        </select>
        {synthState.rightHandMode === 'fingerLayout' ? (
          <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>1–4 fingers set triad / inversion / 7ths. Height = volume, tilt = tone.</p>
        ) : (
          <>
            <select value={synthState.lockedChordStyle ?? 'majorTriad'} onChange={(e) => { trackSettingChanged('chord_style', e.target.value); setSynthState(prev => ({ ...prev, lockedChordStyle: e.target.value as ChordStyle })); }}>
              {CHORD_STYLE_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>
            <p style={{ fontSize: '0.55rem', color: 'var(--text-muted)', margin: 0 }}>Chord style is locked. Right hand still controls volume and tone.</p>
          </>
        )}
      </div>

      {/* Arp / Bass extras */}
      {(synthState.arpeggiate || synthState.autoBass) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '120px' }}>
          {synthState.arpeggiate && (
            <div>
              <label style={{ color: 'var(--neon-purple)', fontWeight: 600 }}>Arpeggiator</label>
              <select value={synthState.arpSpeed} onChange={(e) => { trackSettingChanged('arp_speed', e.target.value); setSynthState(prev => ({ ...prev, arpSpeed: e.target.value as ArpSpeed })); }} style={{ width: '100%' }}>
                <option value="slow">Slow (120ms)</option>
                <option value="normal">Normal (80ms)</option>
                <option value="fast">Fast (50ms)</option>
              </select>
            </div>
          )}
          {synthState.autoBass && (
            <div>
              <label style={{ color: 'var(--neon-amber)', fontWeight: 600 }}>Bass Volume</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="range" min="0" max="1" step="0.05" value={synthState.bassVolume} onChange={(e) => { trackSettingChanged('bass_volume', e.target.value); setSynthState(prev => ({ ...prev, bassVolume: parseFloat(e.target.value) })); }} style={{ flex: 1, accentColor: 'var(--neon-cyan)' }} />
                <span style={{ fontSize: '0.6rem', width: '24px' }}>{Math.round(synthState.bassVolume * 100)}%</span>
              </div>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Visual atmosphere — stage lighting, WYSIWYG with the live
          view and the recording window (window only; design bands
          stay clean). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px', flexWrap: 'wrap' }}>
        <label style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Visual — Atmosphere</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: vignetteStrength > 0 ? 'var(--neon-cyan)' : 'var(--text-muted)', fontSize: '0.6rem', width: '62px' }}>Vignette</span>
            <input
              type="range" min="0" max="100" step="5" value={vignetteStrength}
              onChange={(e) => { trackSettingChanged('vignette', e.target.value); setVignetteStrength(Number(e.target.value)); }}
              style={{ width: '90px', accentColor: 'var(--neon-cyan)' }}
            />
            <span style={{ fontSize: '0.6rem', width: '26px', color: 'var(--text-muted)' }}>{vignetteStrength}%</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: scanlinesStrength > 0 ? 'var(--neon-cyan)' : 'var(--text-muted)', fontSize: '0.6rem', width: '62px' }}>Scanlines</span>
            <input
              type="range" min="0" max="100" step="5" value={scanlinesStrength}
              onChange={(e) => { trackSettingChanged('scanlines', e.target.value); setScanlinesStrength(Number(e.target.value)); }}
              style={{ width: '90px', accentColor: 'var(--neon-cyan)' }}
            />
            <span style={{ fontSize: '0.6rem', width: '26px', color: 'var(--text-muted)' }}>{scanlinesStrength}%</span>
          </label>
        </div>
      </div>
      {/* No-camera mode — keyboard drives the same pipeline.
          Desktop only: phones have no physical keyboard (soft
          keyboards cover the screen; Shift/arrow keys are unusable). */}
      {!isMobile && (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={keyboardMode}
            onChange={(e) => onKeyboardToggle(e.target.checked)}
            style={{ accentColor: 'var(--neon-cyan)' }}
          />
          <span style={{ color: keyboardMode ? 'var(--neon-cyan)' : 'var(--text-secondary)', fontSize: '0.68rem', fontWeight: 600 }}>
            No camera? Keyboard mode (desktop)
          </span>
        </label>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
          — or switch anytime with the ⌨ Keyboard / 📷 Camera button in the top toolbar
        </span>
      </div>
      )}
      {/* Customize Keys — rebind any keyboard-mode action (2026-08-10:
          '[' / ']' minor/major sit behind AltGr on German QWERTZ, hard to
          reach mid-play). Escape cancels a pending rebind; Space can't be
          reassigned (reserved for stop-all). */}
      {!isMobile && keyboardMode && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
          <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.68rem' }}>Customize Keys</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              value={matchingPresetId(keymap)}
              onChange={(e) => {
                const preset = KEYMAP_PRESETS.find((p) => p.id === e.target.value);
                if (preset) { trackSettingChanged('keymap_preset', preset.id); onKeymapChange({ ...preset.map }); setListeningFor(null); setConflictMsg(null); }
              }}
              style={{ fontSize: '0.58rem', padding: '2px 4px' }}
              data-tip="Layout preset — a starting point, still rebindable below"
            >
              {KEYMAP_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              {!KEYMAP_PRESETS.some((p) => p.id === matchingPresetId(keymap)) && <option value="custom">Custom</option>}
            </select>
            <button
              onClick={onOpenGuide}
              style={{ fontSize: '0.58rem', padding: '2px 6px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer' }}
              data-tip="Show the real keyboard with every current binding"
            >
              View keyboard layout
            </button>
            <button
              onClick={() => { onKeymapChange({ ...DEFAULT_KEYMAP }); setListeningFor(null); setConflictMsg(null); }}
              style={{ fontSize: '0.58rem', padding: '2px 6px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              Reset to defaults
            </button>
          </div>
        </div>
        {conflictMsg && (
          <p style={{ fontSize: '0.58rem', color: 'var(--neon-magenta)', margin: 0 }}>{conflictMsg} — press another key, or Esc to cancel.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '180px' }}>
            <span style={{ fontSize: '0.58rem', color: 'var(--neon-cyan)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Harmony</span>
            {ACTION_ORDER.filter((a) => ACTION_META[a].group === 'harmony').map(renderKeyRow)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '180px' }}>
            <span style={{ fontSize: '0.58rem', color: 'var(--neon-magenta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Expression</span>
            {ACTION_ORDER.filter((a) => ACTION_META[a].group === 'expression').map(renderKeyRow)}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
