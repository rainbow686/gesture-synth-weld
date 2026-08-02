/* ─── Recording Utilities ────────────────────────────────────────────── */

/**
 * Create a timestamp-based filename for recordings.
 * @param ext file extension without dot (default 'webm' — audio recordings)
 */
export function makeRecordingFilename(ext: string = 'webm'): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `gesture-synth-weld-${ts}.${ext}`;
}
