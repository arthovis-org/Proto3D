// routing.js — where a connection goes in 3D. Cubic Bezier with horizontal tangents (in ports
// face −X, out ports face +X), plus:
//  • lanes: connections sharing a source or destination port fan out with small vertical /
//    depth offsets so they never overlap along their whole length;
//  • lift: long links rise a little, and any link whose samples pass through another block's
//    bounding box raises its control points until it clears the box (2 relaxation passes);
// The result is a THREE.CubicBezierCurve3 the tube geometry is built from.
import * as THREE from 'three';
import { sizes } from './theme.js';

const _box = new THREE.Box3();
const _pt = new THREE.Vector3();
const SAMPLES = 14;

/** Lane index / count for a connection among the links sharing its ports. */
export function laneInfo(c, connections) {
  const fromSiblings = connections.filter((x) => x.from === c.from && x.to);
  const toSiblings = c.to ? connections.filter((x) => x.to === c.to) : [c];
  // stable order: by the other endpoint's height then depth so lanes do not cross
  const byOther = (getOther) => (a, b) => { const pa = getOther(a), pb = getOther(b); return (pb.y - pa.y) || (pa.z - pb.z); };
  const fo = fromSiblings.map((x) => ({ c: x, p: x.to.getWorldPosition(new THREE.Vector3()) }));
  fo.sort((a, b) => byOther((e) => e.p)(a, b));
  const to = toSiblings.map((x) => ({ c: x, p: x.from.getWorldPosition(new THREE.Vector3()) }));
  to.sort((a, b) => byOther((e) => e.p)(a, b));
  return {
    fromIndex: fo.findIndex((e) => e.c === c), fromCount: fo.length,
    toIndex: to.findIndex((e) => e.c === c), toCount: to.length,
  };
}

/**
 * Compute the curve for a connection.
 * @param {THREE.Vector3} p0 output port position
 * @param {THREE.Vector3} p3 input port position
 * @param {object} o { lanes, obstacles: Block3D[], skip: Set<Block3D> }
 */
export function routeCurve(p0, p3, { lanes = null, obstacles = [], skip = null } = {}) {
  const dist = p0.distanceTo(p3);
  const h = Math.max(sizes.connection.tangentMin, dist * sizes.connection.tangent);
  const p1 = new THREE.Vector3(p0.x + h, p0.y, p0.z);
  const p2 = new THREE.Vector3(p3.x - h, p3.y, p3.z);

  // lanes: spread siblings vertically (and a touch in depth) right after leaving the port
  if (lanes) {
    const L = sizes.connection.lane;
    const f = lanes.fromIndex - (lanes.fromCount - 1) / 2;
    const t = lanes.toIndex - (lanes.toCount - 1) / 2;
    p1.y += f * L; p1.z += f * L * 0.35;
    p2.y += t * L; p2.z += t * L * 0.35;
  }
  // backwards links (input left of output) loop around: widen the handles so the loop is readable
  if (p3.x < p0.x + 1) { const extra = Math.min(6, (p0.x - p3.x) * 0.35 + 1.5); p1.x += extra; p2.x -= extra; }

  // long links rise gently so they read as "over" the work rather than through it
  let lift = THREE.MathUtils.clamp((dist - 14) * 0.05, 0, 1.4);

  // obstacle avoidance: raise control points until the sampled curve clears every box
  if (obstacles.length) {
    for (let pass = 0; pass < 2; pass++) {
      const curve = new THREE.CubicBezierCurve3(p0, p1.clone().setY(p1.y + lift / 0.75), p2.clone().setY(p2.y + lift / 0.75), p3);
      let need = 0;
      for (const b of obstacles) {
        if (!b.visible || (skip && skip.has(b))) continue;
        b.getAABB(_box);
        _box.expandByScalar(0.35);
        // quick reject on x-range
        const minX = Math.min(p0.x, p3.x, p1.x, p2.x), maxX = Math.max(p0.x, p3.x, p1.x, p2.x);
        if (_box.max.x < minX || _box.min.x > maxX) continue;
        for (let i = 1; i < SAMPLES; i++) {
          curve.getPoint(i / SAMPLES, _pt);
          if (_box.containsPoint(_pt)) need = Math.max(need, _box.max.y + 0.45 - _pt.y);
        }
      }
      if (need <= 0.01) break;
      lift += need;
    }
  }
  p1.y += lift / 0.75; p2.y += lift / 0.75;
  return new THREE.CubicBezierCurve3(p0.clone(), p1, p2, p3.clone());
}
