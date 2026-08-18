/**
 * Local works gallery (2026-08-17, retention experiment - "让用户留下资产").
 *
 * Landing-page panel listing the player's previous takes from IndexedDB
 * (saved automatically on recording completion). Gives a returning player
 * a reason to come back: their works are still here - replay, re-download,
 * or delete. Browser-only, zero uploads; see src/works/workStore.ts.
 *
 * The seen-probe fires once per SESSION (sessionStorage guard) and only
 * with works present - it is the denominator of the retention judgment
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

const SEEN_GUARD_KEY = 'gsw-works-seen-sent';

function formatWorkDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function WorksPanel() {
  const [works, setWorks] = useState<StoredWork[] | null>(null); // null = still loading
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  // Object URLs pile up - revoke the previous one when replaying another work.
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    listWorks().then((list) => {
      if (!alive) return;
      setWorks(list);
      // Seen-probe: once per session, only when there is something to see.
      if (list.length > 0 && !sessionStorage.getItem(SEEN_GUARD_KEY)) {
        sessionStorage.setItem(SEEN_GUARD_KEY, '1');
        trackWorksListSeen(list.length);
      }
    });
    return () => { alive = false; };
  }, []);

  // Revoke the leaked object URL on unmount (the player navigated away).
  useEffect(() => () => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
  }, []);

  if (works === null || works.length === 0) return null;

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
    setWorks((prev) => prev?.filter((w) => w.id !== work.id) ?? null);
    if (playingId === work.id) {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
      setPlayingId(null);
      setPlayUrl(null);
    }
  };

  const playing = works.find((w) => w.id === playingId) ?? null;

  return (
    <div className="works-panel">
      <div className="works-panel-title">🎵 我的作品 / My works</div>
      <div className="works-panel-sub">
        Saved in this browser - come back anytime to replay or download.
      </div>
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
  );
}
