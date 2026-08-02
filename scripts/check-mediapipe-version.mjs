#!/usr/bin/env node
/**
 * Quarterly MediaPipe update check (see CLAUDE.md "MediaPipe Version Updates").
 * Compares the pinned versions in mediapipe-version.json against:
 *   1. the latest @mediapipe/tasks-vision release on npm
 *   2. the hand_landmarker.task model on Google's bucket (Content-Length fingerprint)
 *
 * Run: node scripts/check-mediapipe-version.mjs
 * Exit code 0 = up to date, 1 = update(s) available.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pinned = JSON.parse(readFileSync(resolve(root, 'mediapipe-version.json'), 'utf8'));

let updates = 0;

// 1. tasks-vision npm package
try {
  const pkg = await (await fetch('https://registry.npmjs.org/@mediapipe/tasks-vision/latest')).json();
  const latest = pkg.version;
  if (latest !== pinned.tasksVision) {
    console.log(`UPDATE: @mediapipe/tasks-vision ${pinned.tasksVision} → ${latest}`);
    updates++;
  } else {
    console.log(`OK: @mediapipe/tasks-vision at latest (${latest})`);
  }
} catch (e) {
  console.warn(`WARN: could not check npm registry (${e.message})`);
}

// 2. hand landmarker model (fingerprint = Content-Length of the pinned URL)
try {
  const head = await fetch(pinned.sources.model, { method: 'HEAD' });
  const bytes = Number(head.headers.get('content-length'));
  if (bytes !== pinned.model.bytes) {
    console.log(
      `UPDATE: hand_landmarker.task size changed ${pinned.model.bytes} → ${bytes} bytes` +
        ' (check whether the URL version segment /float16/1/ was bumped)'
    );
    updates++;
  } else {
    console.log(`OK: hand_landmarker.task unchanged (${bytes} bytes)`);
  }
} catch (e) {
  console.warn(`WARN: could not check model URL (${e.message})`);
}

if (updates > 0) {
  console.log(`\n${updates} update(s) available — follow the update procedure in CLAUDE.md.`);
  process.exit(1);
}
console.log('\nAll MediaPipe components up to date.');
