// routing.js — where a connection goes in 3D. Three styles (cables.js `style`), every one of them
// leaving an out port towards +X and entering an in port from −X, passing through the cable's
// waypoints in order and staying planar (low over the floor) in the 2D editing mode:
//  • smooth: a cubic Bezier with horizontal tangents (routeCurve — lanes, lift and obstacle
//    avoidance as before); with waypoints a centripetal Catmull-Rom through them, the tangents at
//    the pins still horizontal (phantom points a stub past each pin);
//  • orthogonal: a Manhattan polyline like a cable tray — a straight stub out of each pin, a short
//    drop beside it to the cable's one routing height (the lower pin's, or the tray just above the
//    floor for long runs and runs that would cross another block), horizontal runs in x and z with
//    90° turns, a short rise beside the far pin; a forward link turns at a mid column that parallel
//    cables stagger into lanes, a backward link goes around the end blocks horizontally; the corners
//    are rounded by `cornerRadius` (quadratic arcs, 0 = sharp);
//  • straight: direct segments pin → waypoints → pin.
// Lanes: connections sharing a source or destination port fan out with small offsets so they never
// overlap along their whole length. `RouteNode` is a waypoint: a point shared by one cable (a private
// waypoint) or by several (a manual bundle — dragging it moves every cable through it).
// `routePath` returns a THREE.Curve the tube geometry is built from; a polyline style also records
// its corner points on `curve.polyline` (tests, the bundler).
import * as THREE from 'three';
import { sizes } from './theme.js';
import { PLAN_CABLE_Y } from './plan.js';

const _box = new THREE.Box3();
const _pt = new THREE.Vector3();
const SAMPLES = 14;
const EPS = 1e-4;

/** A waypoint on one or more cables' routes. `conns` lists the cables that pass through it. */
export class RouteNode {
  constructor(point, id = null) {
    this.id = id || `r${Math.random().toString(36).slice(2, 8)}`;
    this.position = new THREE.Vector3();
    if (point) this.position.copy(Array.isArray(point) ? _pt.fromArray(point) : point);
    this.conns = new Set();
  }
  /** Live cables through this node (those still in `world`). */
  liveConns(world) { return [...this.conns].filter((c) => !world || world.connections.includes(c)); }
  /** Shared by two or more live cables: a manual bundle node. */
  sharedIn(world) { return this.liveConns(world).length > 1; }
}

/** Lane index / count for a connection among the links sharing its ports, plus its index among the cables between the same two blocks. */
export function laneInfo(c, connections) {
  const fromSiblings = connections.filter((x) => x.from === c.from && x.to);
  const toSiblings = c.to ? connections.filter((x) => x.to === c.to) : [c];
  // stable order: by the other endpoint's height then depth so lanes do not cross
  const byOther = (getOther) => (a, b) => { const pa = getOther(a), pb = getOther(b); return (pb.y - pa.y) || (pa.z - pb.z); };
  const fo = fromSiblings.map((x) => ({ c: x, p: x.to.getWorldPosition(new THREE.Vector3()) }));
  fo.sort((a, b) => byOther((e) => e.p)(a, b));
  const to = toSiblings.map((x) => ({ c: x, p: x.from.getWorldPosition(new THREE.Vector3()) }));
  to.sort((a, b) => byOther((e) => e.p)(a, b));
  const A = c.from?.owner, B = c.to?.owner;
  const pair = A && B ? connections.filter((x) => x.to && ((x.from.owner === A && x.to.owner === B) || (x.from.owner === B && x.to.owner === A))).sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)) : [c];
  return {
    fromIndex: fo.findIndex((e) => e.c === c), fromCount: fo.length,
    toIndex: to.findIndex((e) => e.c === c), toCount: to.length,
    pairIndex: Math.max(0, pair.indexOf(c)), pairCount: pair.length,
  };
}

/**
 * The smooth style without waypoints: a cubic Bezier.
 * @param {THREE.Vector3} p0 output port position
 * @param {THREE.Vector3} p3 input port position
 * @param {object} o { lanes, obstacles: Block3D[], skip: Set<Block3D>, planar }
 */
export function routeCurve(p0, p3, { lanes = null, obstacles = [], skip = null, planar = false } = {}) {
  const dist = Math.hypot(p0.x - p3.x, p0.z - p3.z, planar ? 0 : p0.y - p3.y);
  const h = Math.max(sizes.connection.tangentMin, dist * sizes.connection.tangent);
  if (planar) {
    // 2D: a flat spline whose middle runs at PLAN_CABLE_Y under the cards (the handles dip lower to
    // pull the body down from the pins), fanned out in z, wider loops for backward links
    const yc = THREE.MathUtils.clamp((PLAN_CABLE_Y - 0.125 * (p0.y + p3.y)) / 0.75, -0.4, PLAN_CABLE_Y);
    const p1 = new THREE.Vector3(p0.x + h, yc, p0.z), p2 = new THREE.Vector3(p3.x - h, yc, p3.z);
    if (lanes) {
      const L = sizes.connection.lane * 1.8;
      p1.z += (lanes.fromIndex - (lanes.fromCount - 1) / 2) * L;
      p2.z += (lanes.toIndex - (lanes.toCount - 1) / 2) * L;
    }
    if (p3.x < p0.x + 1) { const extra = Math.min(6, (p0.x - p3.x) * 0.35 + 1.5); p1.x += extra; p2.x -= extra; }
    return new THREE.CubicBezierCurve3(p0.clone(), p1, p2, p3.clone());
  }
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

/* ------------------------------------------------------------------ */
/* Polylines                                                            */
/* ------------------------------------------------------------------ */
const AXES = ['x', 'y', 'z'];
const ORDERS = [['x', 'y', 'z'], ['x', 'z', 'y'], ['y', 'x', 'z'], ['y', 'z', 'x'], ['z', 'x', 'y'], ['z', 'y', 'x']];
const axisDir = (a, s) => { const v = new THREE.Vector3(); v[a] = Math.sign(s); return v; };
const segDir = (a, b) => new THREE.Vector3().subVectors(b, a).normalize();

/**
 * The axis-aligned moves that take `from` to `to`, as corner points (without `from`). The axis
 * order is picked so the first move never doubles back on `prevDir` and the last never doubles
 * back on `nextDir` (x, y, z otherwise), so a leg between anchors only ever turns by 90°.
 */
export function manhattanLeg(from, to, prevDir = null, nextDir = null) {
  let best = null;
  ORDERS.forEach((order, oi) => {
    const moves = order.filter((a) => Math.abs(to[a] - from[a]) > EPS);
    let score = oi * 0.01;
    if (moves.length) {
      const first = axisDir(moves[0], to[moves[0]] - from[moves[0]]), last = axisDir(moves[moves.length - 1], to[moves[moves.length - 1]] - from[moves[moves.length - 1]]);
      if (prevDir && first.dot(prevDir) < -0.5) score += 100;
      if (nextDir && last.dot(nextDir) < -0.5) score += 100;
    }
    if (!best || score < best.score) best = { score, moves };
  });
  const out = []; const cur = from.clone();
  for (const a of best.moves) { cur[a] = to[a]; out.push(cur.clone()); }
  return out;
}

/** Drop near-duplicate points and merge collinear runs; the result has no zero-length segment. */
export function cleanPolyline(points) {
  const out = [];
  for (const p of points) if (!out.length || out[out.length - 1].distanceToSquared(p) > EPS * EPS) out.push(p.clone());
  for (let i = 1; i < out.length - 1;) {
    const d1 = segDir(out[i - 1], out[i]), d2 = segDir(out[i], out[i + 1]);
    if (d1.dot(d2) > 0.9999) out.splice(i, 1); else i++;
  }
  return out;
}

/**
 * A CurvePath along a polyline: straight lines, every corner rounded by `radius` (a quadratic arc
 * that stays within half of each adjacent segment; 0 = sharp). `curve.polyline` keeps the corners.
 */
export function polyCurve(points, radius = 0) {
  const pts = cleanPolyline(points);
  const path = new THREE.CurvePath();
  path.polyline = pts;
  if (pts.length < 2) { path.add(new THREE.LineCurve3(pts[0] || new THREE.Vector3(), (pts[0] || new THREE.Vector3()).clone())); return path; }
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const c = pts[i];
    if (i === pts.length - 1 || radius <= 0) { path.add(new THREE.LineCurve3(prev, c)); prev = c; continue; }
    const n = pts[i + 1];
    const lenIn = c.distanceTo(prev), lenOut = c.distanceTo(n);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    if (r < 1e-3) { path.add(new THREE.LineCurve3(prev, c)); prev = c; continue; }
    const a = c.clone().lerp(prev, r / lenIn), b = c.clone().lerp(n, r / lenOut);
    if (a.distanceTo(prev) > EPS) path.add(new THREE.LineCurve3(prev, a));
    path.add(new THREE.QuadraticBezierCurve3(a, c.clone(), b));
    prev = b;
  }
  return path;
}

/** Total length of a polyline. */
export const polylineLength = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; };
/** The point `d` units along a polyline. */
export function polylinePointAt(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = pts[i].distanceTo(pts[i - 1]);
    if (acc + L >= d) return pts[i - 1].clone().lerp(pts[i], L > 0 ? (d - acc) / L : 0);
    acc += L;
  }
  return pts[pts.length - 1].clone();
}
/** The part of a polyline between `from` and `to` units along it. */
export function trimPolyline(pts, from, to) {
  const out = [polylinePointAt(pts, from)];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = pts[i].distanceTo(pts[i - 1]);
    if (acc + L > from && acc + L < to) out.push(pts[i].clone());
    acc += L;
  }
  out.push(polylinePointAt(pts, to));
  return cleanPolyline(out);
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */
const planY = (p, planar) => (planar ? new THREE.Vector3(p.x, PLAN_CABLE_Y, p.z) : p.clone());
/** The shared cable-tray height just above the floor: long orthogonal runs, and runs that would cross another block, drop to it. */
export const TRAY_Y = 0.3;
const TRAY_RUN = 24;

/** Whether the horizontal runs of an orthogonal polyline (not the stubs and the drops beside the pins) pass through another block. */
function crossesBlocks(pts, obstacles, skip) {
  if (!obstacles?.length || pts.length < 6) return false;
  const boxes = [];
  for (const b of obstacles) { if (!b.visible || (skip && skip.has(b)) || !b.getAABB) continue; boxes.push(b.getAABB(new THREE.Box3()).expandByScalar(0.15)); }
  if (!boxes.length) return false;
  for (let i = 2; i < pts.length - 3; i++) {
    const a = pts[i], b = pts[i + 1], L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= n; k++) { _pt.copy(a).lerp(b, k / n); for (const box of boxes) if (box.containsPoint(_pt)) return true; }
  }
  return false;
}

/**
 * The orthogonal polyline from an out pin to an in pin: p0 → stub → a short drop beside the pin to
 * the cable's one **routing height** → axis-aligned runs in x and z at that height → a short rise
 * beside the far pin → stub → p3. The height is the ports' height when they match, else the lower
 * port's; a run longer than TRAY_RUN or one that would cross another block goes down to the shared
 * cable tray just above the floor (TRAY_Y); the plan runs at PLAN_CABLE_Y; `height` forces one (a
 * bundle trunk). Nothing ever rises above the higher pin and no middle segment has a y component.
 * A forward link turns at a mid column staggered per lane in x; a backward link goes around the end
 * blocks horizontally — between the rows when they stand in different rows, past their front edge in
 * z otherwise. Waypoints are visited in order at the routing height (their own y is ignored here).
 */
export function orthoPolyline(p0, p3, { lanes = null, waypoints = [], planar = false, fromBox = null, toBox = null, hash = 0, obstacles = [], skip = null, height = null } = {}) {
  const S = sizes.connection.stub, L = sizes.connection.lane;
  const f = lanes ? lanes.fromIndex - (lanes.fromCount - 1) / 2 : 0;
  const t = lanes ? lanes.toIndex - (lanes.toCount - 1) / 2 : 0;
  const pair = lanes ? lanes.pairIndex - (lanes.pairCount - 1) / 2 : 0;
  // close neighbours get shorter stubs so a forward link still turns at a mid column instead of detouring
  const dx = p3.x - p0.x;
  const stub = dx >= 1.1 ? Math.min(S, Math.max(0.25, (dx - 0.6) / 2)) : S;
  const s0 = new THREE.Vector3(p0.x + stub, p0.y, p0.z), s3 = new THREE.Vector3(p3.x - stub, p3.y, p3.z);
  const jitter = (hash ? (hash % 7) / 6 - 0.5 : 0) * L;   // unrelated cables that would share a run land on distinct lanes (smaller than one lane step, so sibling lanes stay apart)
  const X = new THREE.Vector3(1, 0, 0);
  const build = (Y) => {
    const at = (x, z) => new THREE.Vector3(x, Y, z);
    const pts = [p0.clone(), s0.clone(), at(s0.x, s0.z)];
    const end = at(s3.x, s3.z);
    const prevDir = () => (pts.length > 1 && pts[pts.length - 1].distanceToSquared(pts[pts.length - 2]) > EPS * EPS ? segDir(pts[pts.length - 2], pts[pts.length - 1]) : X);
    let cur = pts[2];
    if (waypoints.length) {
      for (const w of waypoints) { const target = at(w.x, w.z); for (const q of manhattanLeg(cur, target, prevDir(), null)) pts.push(q); cur = target; }
      for (const q of manhattanLeg(cur, end, prevDir(), X)) pts.push(q);
    } else if (s3.x - s0.x >= 0.5) {
      // forward: turn at a mid column, staggered per lane so parallel cables never share a run
      const midX = (s0.x + s3.x) / 2 + (f + t + pair * 1.2) * L * 2.2 + jitter;
      pts.push(at(midX, s0.z), at(midX, s3.z));
    } else {
      // backward: leave the pin, turn into a z run clear of both bodies — between the rows when the
      // blocks stand in different rows, past their front edge otherwise — run back in x past the far
      // block's left edge, turn into the target's row and come in from the left
      const xLeft = Math.min(s3.x, fromBox ? fromBox.min.x - 0.6 : Infinity) - Math.max(0, t) * L + Math.min(0, jitter);
      const zGap = Math.abs(s3.z - s0.z) - ((fromBox ? fromBox.max.z - fromBox.min.z : 0.8) + (toBox ? toBox.max.z - toBox.min.z : 0.8)) / 2;
      const zRun = zGap > 1.2 ? (s0.z + s3.z) / 2 + jitter : Math.max(fromBox ? fromBox.max.z : s0.z, toBox ? toBox.max.z : s3.z, s0.z, s3.z) + 0.8 + (f + t) * L * 1.5 + jitter;
      pts.push(at(s0.x, zRun), at(xLeft, zRun), at(xLeft, s3.z));
    }
    pts.push(end, s3.clone(), p3.clone());
    return cleanPolyline(pts);
  };
  if (planar) return build(PLAN_CABLE_Y);
  if (height !== null) return build(height);
  let pts = build(Math.min(p0.y, p3.y));
  if (Math.hypot(p3.x - p0.x, p3.z - p0.z) > TRAY_RUN || crossesBlocks(pts, obstacles, skip)) pts = build(Math.min(TRAY_Y, p0.y, p3.y));
  return pts;
}

/**
 * The curve for a connection in the current style.
 * @param {THREE.Vector3} p0 output port position
 * @param {THREE.Vector3} p3 input port position
 * @param {object} o { style, cornerRadius, lanes, obstacles, skip, planar, waypoints: THREE.Vector3[], fromBox, toBox, hash (a small integer per cable: lane jitter), height (orthogonal: force the routing height) }
 */
export function routePath(p0, p3, { style = 'smooth', cornerRadius = 0.35, waypoints = [], planar = false, fromBox = null, toBox = null, hash = 0, height = null, ...o } = {}) {
  const wps = waypoints || [];
  if (style === 'orthogonal') {
    const pts = orthoPolyline(p0, p3, { lanes: o.lanes, waypoints: wps, planar, fromBox, toBox, hash, obstacles: o.obstacles, skip: o.skip, height });
    const curve = polyCurve(pts, cornerRadius);
    curve.routeY = pts.length > 3 ? pts[2].y : p0.y;   // the routing height (where the handles sit)
    return curve;
  }
  if (style === 'straight') {
    const pts = [p0.clone()];
    if (planar) pts.push(new THREE.Vector3(p0.x + 0.5, PLAN_CABLE_Y, p0.z));
    wps.forEach((w) => pts.push(planY(w, planar)));
    if (planar) pts.push(new THREE.Vector3(p3.x - 0.5, PLAN_CABLE_Y, p3.z));
    pts.push(p3.clone());
    return polyCurve(pts, 0);
  }
  if (!wps.length) return routeCurve(p0, p3, { ...o, planar });
  // smooth through waypoints: a centripetal Catmull-Rom whose phantom points a stub past each pin keep the tangents horizontal
  const first = planY(wps[0], planar), last = planY(wps[wps.length - 1], planar);
  const h0 = THREE.MathUtils.clamp(first.distanceTo(p0) * 0.35, 0.6, 2.2), h3 = THREE.MathUtils.clamp(last.distanceTo(p3) * 0.35, 0.6, 2.2);
  const a = new THREE.Vector3(p0.x + h0, planar ? PLAN_CABLE_Y : p0.y, p0.z), b = new THREE.Vector3(p3.x - h3, planar ? PLAN_CABLE_Y : p3.y, p3.z);
  if (o.lanes) { const L = sizes.connection.lane; const f = o.lanes.fromIndex - (o.lanes.fromCount - 1) / 2, t = o.lanes.toIndex - (o.lanes.toCount - 1) / 2; if (planar) { a.z += f * L * 1.8; b.z += t * L * 1.8; } else { a.y += f * L; b.y += t * L; } }
  const pts = [p0.clone(), a, ...wps.map((w) => planY(w, planar)), b, p3.clone()];
  const curve = new THREE.CatmullRomCurve3(cleanPolyline(pts), false, 'centripetal', 0.5);
  curve.polyline = pts;
  return curve;
}
