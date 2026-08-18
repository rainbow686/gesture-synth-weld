/**
 * Local works gallery (2026-08-17, retention experiment - "让用户留下资产").
 *
 * Stores finished recordings in IndexedDB - the browser's built-in local
 * database - so a returning player finds their previous takes on the
 * landing page. ZERO server round-trips: nothing is uploaded anywhere,
 * works live only in this browser (cleared with site data, invisible on
 * other devices). That is deliberate - this is the cheap validation
 * stage of the retention hypothesis ("will users come back for their
 * works?"); the R2 + shareable-link backend is only built if the
 * work_replayed / works_list_seen data says it's worth it
 * (thresholds in docs/analytics-events.md).
 */

/** One stored recording. `blob` holds the finished, branded file. */
export interface StoredWork {
  id: string;
  /** 'audio' | 'video' (video covers full-video and skeleton modes). */
  type: 'audio' | 'video';
  mimeType: string;
  filename: string;
  blob: Blob;
  createdAt: number;
  durationSec: number;
}

/** Cap on stored works - oldest is pruned first, keeping storage bounded. */
const MAX_WORKS = 20;

const DB_NAME = 'gsw-works';
const STORE = 'works';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      // Private-mode Safari and very old browsers lack indexedDB - the
      // gallery simply stays empty there; callers catch and move on.
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
  }
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
  });
}

/** Persist one work; prunes past the cap. Rejects on quota/DB failure. */
export async function saveWork(work: StoredWork): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  store.put(work);
  const all = await new Promise<StoredWork[]>((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result as StoredWork[]);
    r.onerror = () => reject(r.error ?? new Error('getAll failed'));
  });
  // Over the cap: delete oldest until back at MAX_WORKS.
  all.sort((a, b) => a.createdAt - b.createdAt);
  for (const old of all.slice(0, Math.max(0, all.length - MAX_WORKS))) {
    store.delete(old.id);
  }
  await txDone(tx);
}

/** All works, newest first. Empty array if storage is unavailable. */
export async function listWorks(): Promise<StoredWork[]> {
  try {
    const db = await openDb();
    return await new Promise<StoredWork[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () =>
        resolve(((r.result as StoredWork[]) ?? []).sort((a, b) => b.createdAt - a.createdAt));
      r.onerror = () => reject(r.error ?? new Error('getAll failed'));
    });
  } catch {
    return [];
  }
}

/** Remove one work by id. */
export async function deleteWork(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
}
