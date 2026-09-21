// layers.js — depth layering of stacked surfaces. Every body is a slab whose front face carries
// things: a canvas face, thin rules and shades, bars and cards, and labels on top of those. Two
// surfaces at (nearly) the same depth z-fight: the depth buffer cannot order them, so pixels flip
// between the two colours as the camera moves. This module is the one place that says how far
// apart stacked surfaces sit and how they win the depth test when the gap is below the buffer's
// precision (far away, or in the 2D plan where blocks lie flat and depth is measured along Y).
//
//   faceLayer(n)        the offset along the face normal for layer n (n · LAYER units):
//                         1  the face canvas, accent line, shades and rules drawn on a body front
//                         2  a plane on top of a layer-1 surface (a bar's title, a pill's count)
//                         3  labels and markers above everything on the face
//   layered(mat, n)     polygon offset toward the camera by n depth units (+ slope): the surface
//                       wins a tie against whatever it sits on, at any distance and any angle,
//                       without a visible gap. Applied to every canvas face, canvas plane and label.
//
// A stacked surface should do both: sit at `front + faceLayer(n)` (a real gap, correct from every
// angle, correct in picking) and carry `layered(material, n)` (holds when the gap falls below the
// buffer's precision). Bodies are opaque and never offset, so nothing pulls in front of a block
// that stands closer to the camera by more than a few depth units.
export const LAYER = 0.012;
/** Offset of stacked layer `n` (1 = directly on the front) along the face normal, in world units. */
export const faceLayer = (n = 1) => n * LAYER;
/** Polygon-offset a material so it wins depth ties against the surface under it. Returns the material. */
export function layered(material, n = 1) {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2 * n;
  return material;
}
