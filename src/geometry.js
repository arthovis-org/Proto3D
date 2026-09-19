// geometry.js — the one body shape of the platform: a 2D rounded rectangle extruded a little
// and finished with a tiny bevel that catches the light. Front and back faces are flat and
// crisp, the sides are straight, only the bevel curves. Used for node bodies, device slabs,
// group slabs and frames, board frames, column panels, cards, notes, flags and rims.
//
//   panelGeometry(w, h, depth, { radius, bevel })
//     • `w × h` is the OUTER size (bevel included) so callers reason about the footprint;
//     • `depth` is the total thickness, centred on z = 0 (front face at +depth / 2);
//     • the front / back caps carry UVs that map the cap exactly to 0..1 (a canvas texture on
//       the front face lands corner to corner); the side walls get a neutral UV;
//     • ExtrudeGeometry makes two material groups: 0 = caps, 1 = sides + bevel, so a mesh may
//       use `[faceMaterial, sideMaterial]` (a card with its canvas on the front).
import * as THREE from 'three';

/** A rounded rectangle centred on the origin (arcs, not quadratic curves, so the bevel stays even). */
export function roundedRectShape(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); if (r) s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r); if (r) s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1); if (r) s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r); if (r) s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

/** UV generator: caps map their own bounding box (the front face) to 0..1; walls get a flat, neutral UV. */
function capUVGenerator(capW, capH) {
  return {
    generateTopUV(geometry, vertices, a, b, c) {
      const uv = (i) => new THREE.Vector2(vertices[i * 3] / capW + 0.5, vertices[i * 3 + 1] / capH + 0.5);
      return [uv(a), uv(b), uv(c)];
    },
    generateSideWallUV() {
      const p = new THREE.Vector2(0.5, 0.02);   // one texel row near the bottom edge: a plain colour on every canvas we draw
      return [p, p.clone(), p.clone(), p.clone()];
    },
  };
}

/**
 * Extruded, bevelled rounded rectangle. Defaults: radius = 18 % of the short side, bevel 0.02.
 * `geo.userData.panel` keeps the parameters for tests and for rebuilding with a new size.
 */
export function panelGeometry(w, h, depth = 0.16, { radius = null, bevel = 0.02, bevelSegments = 2, curveSegments = 12 } = {}) {
  const r = Math.max(0.01, radius ?? Math.min(w, h) * 0.18);
  const b = Math.max(0, Math.min(bevel, r * 0.6, depth * 0.3));
  const capW = Math.max(0.02, w - 2 * b), capH = Math.max(0.02, h - 2 * b);
  const shape = roundedRectShape(capW, capH, Math.max(0.005, r - b));
  const extrudeDepth = Math.max(0.01, depth - 2 * b);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: 0, bevelSegments, curveSegments,
    UVGenerator: capUVGenerator(capW, capH),
  });
  geo.translate(0, 0, -extrudeDepth / 2);      // the bevels extend ±b beyond the extrusion → centred on z = 0
  geo.computeVertexNormals();
  geo.type = 'PanelGeometry';
  geo.userData.panel = { w, h, depth, radius: r, bevel: b, capW, capH };
  return geo;
}

/** A panel lying flat on the floor (extruded along +Y): `w` along X, `d` along Z, `thickness` tall. Front face up. */
export function slabGeometry(w, d, thickness = 0.12, opts = {}) {
  const geo = panelGeometry(w, d, thickness, opts);
  geo.rotateX(-Math.PI / 2);
  geo.type = 'PanelGeometry';
  return geo;
}

/** A slightly larger back-face shell around a panel: the thin selection / hover outline. */
export function outlineGeometry(w, h, depth, grow = 0.08, opts = {}) {
  const r = (opts.radius ?? Math.min(w, h) * 0.18) + grow / 2;
  return panelGeometry(w + grow, h + grow, depth + grow, { ...opts, radius: r, bevel: Math.min(0.015, grow / 4) });
}
