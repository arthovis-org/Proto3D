// face-canvas.js — the backing store behind every canvas face: node faces, device screens, the
// sticky-note paper, board cards and timeline bars. Renderers draw in one fixed logical coordinate
// system (`sizes.face.pxPerUnit` = 120 px per world unit) and never learn about resolution; the
// surface scales its bitmap like a HiDPI DOM canvas (`canvas.width = cw × scale`, then
// `setTransform(scale)`) so texel density follows how large the face is on screen. The LOD pass
// (lod.js) measures device pixels per world unit every frame and re-bakes the surfaces whose tier
// changed, a few blocks per frame, so zooming in on a face keeps its type crisp.
import * as THREE from 'three';
import { sizes, gpu } from './theme.js';

/** First-paint scale: the device pixel ratio, capped like the renderer's (workspace.js). */
export function baseFaceScale() {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(Math.max(1, dpr), 2);
}

/** Smallest tier that covers `ratio` (device px per logical face px), or the largest tier. */
export function tierFor(ratio) {
  const T = sizes.face.tiers;
  for (const t of T) if (t >= ratio) return t;
  return T[T.length - 1];
}

/**
 * The scale a surface at `cur` should move to when the face needs `ratio` × its logical density.
 * Hysteresis both ways (`sizes.face.hysteresis`) keeps a camera hovering near a threshold from
 * re-baking every frame; `allowance` caps the result (far, off-screen and low-ranked faces stay at 1×).
 */
export function fitTier(cur, ratio, allowance = sizes.face.maxScale) {
  const hys = 1 + sizes.face.hysteresis;
  const up = tierFor(ratio);
  let want = cur;
  if (up > cur) { if (ratio > cur * hys) want = up; }
  else if (up < cur) { const down = tierFor(ratio * hys); if (down < cur) want = down; }
  return Math.min(want, Math.max(allowance, sizes.face.tiers[0]));
}

/**
 * A canvas + CanvasTexture pair with a logical size (`cw × ch` px) and a backing-store `scale`.
 * `setScale(s)` resizes the bitmap and re-applies the transform; the owner repaints afterwards
 * (`redraw`, set by the owner). The texture carries `userData.surface` so a block can find every
 * surface on its meshes when its resolution tier changes.
 */
export function createSurface(w, h, { px = sizes.face.pxPerUnit, scale = baseFaceScale() } = {}) {
  const canvas = document.createElement('canvas');
  const cw = Math.max(2, Math.round(w * px)), ch = Math.max(2, Math.round(h * px));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = gpu.maxAnisotropy;
  const g = canvas.getContext('2d');
  const surface = {
    canvas, g, texture, w, h, cw, ch, scale: 0, redraw: null,
    /** Resize the backing store (clamped so no side exceeds `sizes.face.maxSide`). Returns true when it changed. */
    setScale(s) {
      s = Math.max(0.25, Math.min(s, sizes.face.maxSide / Math.max(cw, ch)));
      if (Math.abs(s - surface.scale) < 1e-6) return false;
      surface.scale = s;
      canvas.width = Math.max(1, Math.round(cw * s)); canvas.height = Math.max(1, Math.round(ch * s));
      g.setTransform(s, 0, 0, s, 0, 0);
      // the GPU copy was allocated at the old size (texStorage2D); drop it so the next upload re-creates it
      texture.dispose();
      texture.needsUpdate = true;
      return true;
    },
  };
  texture.userData.surface = surface;
  surface.setScale(scale);
  return surface;
}
