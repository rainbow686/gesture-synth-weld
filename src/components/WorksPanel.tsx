/**
 * Local works gallery (2026-08-17, retention experiment - "让用户留下资产").
 *
 * Landing-page entry for the player's previous takes from IndexedDB
 * (saved automatically on recording completion). Shows a COMPACT one-line
 * entry "🎵 My works (N)" under the start button - the landing stays
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
import { deleteWork, listWorks, type StoredWork } from '../works/workStore';
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

export default function WorksPanel() {
  const [works, setWorks] = useState<StoredWork[] | null>(null); // null = still loading
  const [open, setOpen] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    listWorks().then((list) => { if (alive) setWorks(list); });
    return () => { alive = false; };
  }, []);

  // Revoke the leaked object URL on unmount.
  useEffect(() => () => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
  }, []);

  // Esc closes the modal (App's global Esc stops playback instead while
  // running; on the landing it reaches us).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (works === null || works.length === 0) return null;

  const openModal = () => {
    setOpen(true);
    // Seen-probe: once per session, only when there is something to see.
    if (!sessionStorage.getItem(SEEN_GUARD_KEY)) {
      sessionStorage.setItem(SEEN_GUARD_KEY, '1');
      trackWorksListSeen(works.length);
    }
  };

  const closeModal = () => {
    setOpen(false);
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

  const remove = async (work: StoredWork) => {
    await deleteWork(work.id);
    setWorks((prev) => {
      const next = prev?.filter((w) => w.id !== work.id) ?? null;
      if (next && next.length === 0) setOpen(false); // last work gone -> close modal
      return next;
    });
    if (playingId === work.id) {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
      setPlayingId(null);
      setPlayUrl(null);
    }
  };

  const playing = works.find((w) => w.id === playingId) ?? null;

  return (
    <>
      {/* Compact landing entry - a quiet link line, not a list (2026-08-18).
          NEW badge only while the current What's New entry asks for it AND
          is within its announce window - expires on its own (2026-08-18). */}
      <button className="works-entry" onClick={openModal} data-tip="Replay your previous takes">
        🎵 My works ({works.length})
        {whatsNewLandingBadge() && <span className="works-entry-new">NEW</span>}
      </button>

      {open && (
        <div className="works-modal-overlay" onClick={closeModal}>
          <div className="works-modal" onClick={(e) => e.stopPropagation()}>
            <div className="works-modal-head">
              <span className="works-modal-title">My works</span>
              <button className="works-close" onClick={closeModal} aria-label="Close my works">✕</button>
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
      )}
    </>
  );
}
