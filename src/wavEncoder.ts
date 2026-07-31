/* ─── Recording Utilities ────────────────────────────────────────────── */

/**
 * Create a timestamp-based filename for recordings.
 */
export function makeRecordingFilename(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `gesture-synth-weld-${ts}.webm`;
}
