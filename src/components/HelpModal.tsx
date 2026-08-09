/**
 * Quick Guide modal (extracted from App.tsx Render 2026-08-09, pure
 * move). Two-hand demo with rotating gesture art, left/right mapping
 * tables, other gestures, keyboard-mode section + guide replay.
 *
 * Owns its demo animation state (rotating step every 1.8s while open);
 * App passes the chord-name formatter (also used by the loading screen)
 * and the keyboard-guide replay hook.
 */

import { useEffect, useState } from 'react';
import { renderHandArt } from './HandArt';
import { WHATS_NEW, markWhatsNewDismissed } from '../whatsNew';

/** Rotating left-hand demo script (rows match DIATONIC_CHORDS order). */
const HELP_DEMO_STEPS = [
  { left: '1', row: 0 },
  { left: '2', row: 1 },
  { left: '3', row: 2 },
  { left: '4', row: 3 },
  { left: '5', row: 4 },
  { left: 'VI', row: 5 },
  { left: 'VII', row: 6 },
  { left: 'mute', row: 7 },
] as const;

export interface HelpModalProps {
  onClose: () => void;
  isMobile: boolean;
  /** "I · C" style chord name for a scale degree (App-owned; the loading
   *  screen reuses it). */
  gradeNameFor: (chordIndex: number) => string;
  /** Replay the keyboard-mode first-run guide. */
  onReplayKeyboardGuide: () => void;
}

export function HelpModal({ onClose, isMobile, gradeNameFor, onReplayKeyboardGuide }: HelpModalProps) {
  const [demoStep, setDemoStep] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setDemoStep((s) => (s + 1) % HELP_DEMO_STEPS.length), 1800);
    return () => window.clearInterval(t);
  }, []);
  // Opening Help shows the full announcement — counts as told.
  useEffect(() => { markWhatsNewDismissed(); }, []);

  const latest = WHATS_NEW[0];

  return (
    <div style={{
      position: 'absolute', top: '12px', left: '12px', width: 'min(360px, calc(100vw - 24px))',
      maxHeight: 'min(80vh, 560px)', overflowY: 'auto',
      background: 'rgba(8, 8, 20, 0.85)', backdropFilter: 'var(--frost-blur)',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px',
      padding: '14px 18px', boxShadow: 'var(--frost-shadow)', zIndex: 100,
      fontSize: '0.68rem', color: '#d0d0e8', lineHeight: 1.45,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.82rem', color: 'var(--neon-cyan)' }}>Quick Guide</span>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '50%', width: '22px', height: '22px', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      </div>

      {/* New in this version — the latest feature announcement (see
          src/whatsNew.ts; the landing page shows a matching NEW hint). */}
      {latest && (
        <div style={{ border: '1px solid rgba(255,110,199,0.25)', background: 'rgba(255,110,199,0.05)', borderRadius: '10px', padding: '8px 10px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <span style={{ fontSize: '0.52rem', fontWeight: 800, letterSpacing: '0.08em', color: '#ff6ec7', border: '1px solid rgba(255,110,199,0.4)', borderRadius: '4px', padding: '1px 5px' }}>NEW · {latest.version}</span>
            <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.62rem' }}>{latest.title}</span>
          </div>
          <div style={{ fontSize: '0.56rem', color: '#b0b0d0', lineHeight: 1.5 }}>{latest.body}</div>
        </div>
      )}

      {/* How it works — two-hand demo: the left hand raises the
          chord degree (real gesture art), the right hand the chord
          type by finger count; together as in real play. The
          matching table row highlights. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'rgba(0,255,204,0.05)', border: '1px solid rgba(0,255,204,0.15)', borderRadius: '10px', minHeight: '58px' }}>
          {renderHandArt(HELP_DEMO_STEPS[demoStep].left, 52, 'var(--neon-cyan)')}
          <div style={{ fontSize: '0.58rem', lineHeight: 1.5 }}>
            <div style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left hand — chord</div>
            <div key={demoStep} className="demo-step-text" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff' }}>{gradeNameFor(HELP_DEMO_STEPS[demoStep].row)}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'rgba(255,110,199,0.05)', border: '1px solid rgba(255,110,199,0.15)', borderRadius: '10px', minHeight: '58px' }}>
          {renderHandArt('1', 52, 'var(--neon-magenta)', true)}
          <div style={{ fontSize: '0.58rem', lineHeight: 1.5 }}>
            <div style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right hand — sound</div>
            <div style={{ color: '#d0d0e8' }}>height = volume</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', alignItems: 'flex-start' }}>
        {/* Left hand → chord degree (the one that picks the note) */}
        <table style={{ borderCollapse: 'collapse', flex: 1 }}>
          <thead>
            <tr style={{ color: '#a0a0c8', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ textAlign: 'left', padding: '3px 10px 3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Left hand</th>
              <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Chord</th>
            </tr>
          </thead>
          <tbody>
            {HELP_DEMO_STEPS.map((s, row) => {
              const active = row === HELP_DEMO_STEPS[demoStep].row;
              return (
                <tr key={s.left} style={{
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: active ? 'rgba(0,255,204,0.09)' : 'transparent',
                  boxShadow: active ? 'inset 2px 0 0 var(--neon-cyan)' : 'none',
                  transition: 'background 0.25s ease',
                }}>
                  <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {renderHandArt(s.left, 24, active ? 'var(--neon-cyan)' : '#8fbfd0')}
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{s.left}</span>
                    </div>
                  </td>
                  <td style={{ padding: '3px 0', color: 'var(--neon-cyan)', fontWeight: active ? 800 : 600, fontSize: active ? '0.7rem' : '0.62rem', whiteSpace: 'nowrap' }}>{gradeNameFor(s.row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Right hand → chord type (independent of the chord) */}
        <table style={{ borderCollapse: 'collapse', flexShrink: 0 }}>
          <thead>
            <tr style={{ color: '#a0a0c8', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ textAlign: 'left', padding: '3px 8px 3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Right hand</th>
              <th style={{ textAlign: 'left', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {(['1', '2', '3', '4', 'mute'] as const).map((k) => (
              <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {renderHandArt(k, 24, 'var(--neon-magenta)', true)}
                    {k !== 'mute' && (
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.58rem', color: 'var(--text-muted)' }}>{k}</span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '3px 0', fontSize: '0.6rem', whiteSpace: 'nowrap', color: '#d0d0e8' }}>
                  {k === 'mute' ? 'mute' : ({ '1': '3-note', '2': 'inverted', '3': '4-note', '4': '5-note' } as Record<string, string>)[k]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: '0.54rem', color: '#a0a0c8', lineHeight: 1.5, marginTop: '2px' }}>
          finger count → chord type<br/>enable in Settings · Right hand
        </div>
      </div>

      <div style={{ fontSize: '0.56rem', color: '#b0b0d0', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '6px', paddingTop: '6px' }}>
        <div style={{ color: '#a0a0c8', fontWeight: 600, marginBottom: '4px' }}>Other gestures</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          {renderHandArt('thumb', 24, 'var(--neon-magenta)', true)}
          <span><span style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right thumb</span> out = octave down</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          <span style={{ display: 'inline-block', transform: 'rotate(-16deg)' }}>{renderHandArt('1', 24, 'var(--neon-cyan)')}</span>
          <span style={{ color: '#a0a0c8' }}>↔</span>
          <span style={{ display: 'inline-block', transform: 'rotate(16deg)' }}>{renderHandArt('1', 24, 'var(--neon-cyan)')}</span>
          <span><span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left wrist tilt</span> = major ↔ minor (Settings · Scale+Tilt)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          <span style={{ display: 'inline-block', transform: 'rotate(-16deg)' }}>{renderHandArt('1', 24, 'var(--neon-magenta)', true)}</span>
          <span style={{ color: '#a0a0c8' }}>↔</span>
          <span style={{ display: 'inline-block', transform: 'rotate(16deg)' }}>{renderHandArt('1', 24, 'var(--neon-magenta)', true)}</span>
          <span><span style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right wrist tilt</span> = tone sweep</span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0', paddingTop: '6px', fontSize: '0.58rem', lineHeight: 1.6 }}>
        <span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Left Hand</span> — Fingers = scale degree, wrist tilt = major / minor (Scale+Tilt mode)<br/>
        <span style={{ color: 'var(--neon-magenta)', fontWeight: 600 }}>Right Hand</span> — Height = volume, fingers = chord type<br/>
        <span style={{ color: '#b0b0d0' }}>Both hands required · Left fist mutes · Right fist continues · ⟿ Arp  ∿ Bass  ● Rec  ♪ Metronome</span>
      </div>

      <a href="#gesture-guide" onClick={onClose} style={{ color: 'var(--neon-cyan)', fontSize: '0.58rem', textDecoration: 'underline' }}>
        Full guide & tips below ↓
      </a>

      {/* Keyboard mode (no-camera fallback, desktop only) */}
      {!isMobile && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0', paddingTop: '6px', fontSize: '0.58rem', lineHeight: 1.6 }}>
          <span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>Keyboard Mode</span> — no camera? Play with the keyboard.<br/>
          <span style={{ color: '#b0b0d0' }}>Hold 1-7 = chords (I-VII) · [ ] = minor / major · 8 9 0 - = chord style · Shift = octave down · ↑↓ volume · ←→ filter · Space = stop</span>
          <button
            onClick={onReplayKeyboardGuide}
            style={{ marginTop: '6px', padding: '4px 10px', background: 'rgba(0,255,204,0.08)', border: '1px solid rgba(0,255,204,0.3)', borderRadius: '8px', color: 'var(--neon-cyan)', fontSize: '0.56rem', cursor: 'pointer' }}
          >
            ▶ Replay keyboard guide
          </button>
        </div>
      )}
    </div>
  );
}
