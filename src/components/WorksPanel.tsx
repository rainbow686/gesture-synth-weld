/**
 * Local recordings library (2026-08-17, retention experiment - "让用户留下资产").
 *
 * Landing-page entry for the player's previous recordings from IndexedDB
 * (saved automatically on recording completion). Shows a COMPACT one-line
 * entry "My recordings (N)" under the start button - the landing stays
 * focused on its Enable-Camera conversion job - and opens the list in a
 * height-capped modal (internal scroll, player capped too), so nothing
 * ever pushes the page or the status bar (feedback 2026-08-18: the
 * original inline list + player expanded and looked bad).
 *
 * Browser-only, zero uploads; see src/works/workStore.ts. The seen-probe
 * fires when the modal opens (once per SESSION, sessionStorage guard,
 * works present only) - the denominator of the retention judgment
 * (docs/analytics-events.md: replay rate >=20% -> build the shareable
 * R2 backend; <5% -> skip the server entirely).
 */

import { useEffect, useRef, useState } from 'react';
import type { StoredWork } from '../works/workStore';
import {
  trackWorkDownloaded,
  trackWorkReplayed,
  trackWorksListSeen,
} from '../analytics';
import { whatsNewLandingBadge } from '../whatsNew';

const SEEN_GUARD_KEY = 'gsw-works-seen-sent';

function formatWorkDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface WorksPanelProps {
  /** Shared works list (owned by App, 2026-08-18) - null = still loading. */
  works: StoredWork[] | null;
  /** Delete a work - App removes it from the shared list (landing + result panel sync). */
  onDelete: (id: string) => void;
  /** Modal open state (owned by App, 2026-09-20) - the toolbar recordings
      entry and the landing entry open the same modal. */
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/** Recordings entry glyph — frame + play head (2026-09-20, free-drawn).
 *  Shared by the landing entry and the toolbar entry so the feature has
 *  one face. Same stroke language as the toolbar glyphs (currentColor). */
export function RecordingsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.2 9.3 L15.2 12 L10.2 14.7 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** Landing entry — a quiet one-line link under the start button, not a
 *  list (2026-08-18). NEW badge only while the current What's New entry
 *  asks for it AND is within its announce window - expires on its own. */
export function RecordingsEntry({ works, onOpen }: {
  /** Shared works list (owned by App) - null = still loading. */
  works: StoredWork[] | null;
  /** Open the shared modal (owned by App - toolbar entry opens the same one). */
  onOpen: () => void;
}) {
  if (works === null || works.length === 0) return null;
  return (
    <button className="works-entry" onClick={onOpen} data-tip="Replay your previous recordings">
      <span className="works-entry-icon"><RecordingsIcon size={14} /></span> My recordings ({works.length})
      {whatsNewLandingBadge() && <span className="works-entry-new">NEW</span>}
    </button>
  );
}

export default function WorksPanel({ works, onDelete, open, onOpenChange }: WorksPanelProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  // Revoke the leaked object URL on unmount.
  useEffect(() => () => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
  }, []);

  // Esc closes the modal (App's global Esc stops playback instead while
  // running; on the landing it reaches us).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Seen-probe: once per session, only when there is something to see.
  // Fires off the open prop - the landing entry and the toolbar entry open
  // the same App-owned modal, either path lands here.
  useEffect(() => {
    if (!open) return;
    if (works === null || works.length === 0) return;
    if (!sessionStorage.getItem(SEEN_GUARD_KEY)) {
      sessionStorage.setItem(SEEN_GUARD_KEY, '1');
      trackWorksListSeen(works.length);
    }
  }, [open, works]);

  if (works === null || works.length === 0) return null;

  const closeModal = () => {
    onOpenChange(false);
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    lastUrlRef.current = null;
    setPlayingId(null);
    setPlayUrl(null);
  };

  const replay = (work: StoredWork) => {
    trackWorkReplayed();
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    if (playingId === work.id) { // toggle off
      setPlayingId(null);
      setPlayUrl(null);
      lastUrlRef.current = null;
      return;
    }
    const url = URL.createObjectURL(work.blob);
    lastUrlRef.current = url;
    setPlayingId(work.id);
    setPlayUrl(url);
  };

  const download = (work: StoredWork) => {
    trackWorkDownloaded();
    const url = URL.createObjectURL(work.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = work.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = (work: StoredWork) => {
    onDelete(work.id);
    if (works && works.length === 1) onOpenChange(false); // last work gone -> close modal
    if (playingId === work.id) {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
      setPlayingId(null);
      setPlayUrl(null);
    }
  };

  const playing = works.find((w) => w.id === playingId) ?? null;

  // App-level modal (2026-09-20): mounted once at App level so the landing
  // entry AND the toolbar entry open the same modal. Returns null when
  // closed — but hooks above still run unconditionally every render.
  if (!open) return null;
  if (works === null || works.length === 0) return null;

  return (
    <div className="works-modal-overlay" onClick={closeModal}>
      <div className="works-modal" onClick={(e) => e.stopPropagation()}>
        <div className="works-modal-head">
          <span className="works-modal-title">My recordings</span>
          <button className="works-close" onClick={closeModal} aria-label="Close my recordings">✕</button>
        </div>
        <div className="works-modal-sub">Saved in this browser - replay, re-download, or delete.</div>
        <ul className="works-list">
          {works.map((w) => (
            <li key={w.id} className={`works-item${playingId === w.id ? ' active' : ''}`}>
              <span className="works-item-icon">{w.type === 'audio' ? '🎵' : '🎬'}</span>
              <span className="works-item-meta">
                <span className="works-item-date">{formatWorkDate(w.createdAt)}</span>
                <span className="works-item-dur">{Math.floor(w.durationSec / 60)}:{String(w.durationSec % 60).padStart(2, '0')}</span>
              </span>
              <span className="works-item-actions">
                <button className="works-btn" onClick={() => replay(w)} data-tip="Replay">
                  {playingId === w.id ? '■' : '▶'}
                </button>
                <button className="works-btn" onClick={() => download(w)} data-tip="Download">💾</button>
                <button className="works-btn" onClick={() => remove(w)} data-tip="Delete">🗑</button>
              </span>
            </li>
          ))}
        </ul>
        {playing && playUrl && (playing.type === 'audio' ? (
          <audio src={playUrl} className="works-player" controls autoPlay />
        ) : (
          <video src={playUrl} className="works-player" controls autoPlay playsInline />
        ))}
      </div>
    </div>
  );
}
