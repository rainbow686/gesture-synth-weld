/**
 * Renders one of the licensed hand artworks, sized by height
 * (extracted from App.tsx 2026-08-09, pure move — shared by the Help
 * modal and the loading screen).
 * mirrored flips the hand horizontally (right-hand view: thumb right).
 */

import type { ReactNode } from 'react';
import { HAND_ART } from '../handArt';

export function renderHandArt(key: string, size: number, color: string, mirrored = false): ReactNode {
  const a = HAND_ART[key];
  if (!a) return null;
  return (
    <svg viewBox={a.vb} style={{
      height: size, width: 'auto', color, flexShrink: 0, display: 'block',
      transform: mirrored ? 'scaleX(-1)' : undefined,
    }} dangerouslySetInnerHTML={{ __html: a.body }} />
  );
}
