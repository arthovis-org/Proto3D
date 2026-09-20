// layout.js — Edit → Auto-layout: arrange blocks as a left-to-right layered graph that follows
// the cable direction (Sugiyama-style), and the small tween that animates them there.
//
//   1. Items. The blocks to arrange (the selection, or every visible block) become layout items:
//      an ungrouped block is one item; the members of an expanded group become one *cluster* item
//      whose members are laid out first, by the same algorithm, so a group stays contiguous and is
//      placed as a unit (members of a collapsed group are hidden and left alone).
//   2. Edges follow the cables among the items (from.owner → to.owner), deduplicated; cycles are
//      broken by dropping the back edges a depth-first search finds (`backEdges`, so a caller can
//      tell which cables were allowed to point backwards).
//   3. Layers by longest path from the sources; within a layer the order is refined by a few
//      barycentre sweeps (down then up) to reduce crossings; a node's z is then pulled towards the
//      mean of its neighbours and pushed apart by its size plus a gap, so nothing overlaps.
//   4. Items without any edge go into a tidy grid below the graph. The arranged set keeps the
//      centre it had, so the layout does not wander off; y is left untouched.
//
// The footprint of a block for the layout is width × height (the card as seen in the plan), the
// same in 2D and 3D, so positions mean the same thing in both modes.
export const LAYOUT = { gapX: 4, gapZ: 2.2, groupPad: 1.6, gridGap: 2.4, animate: 0.25 };

/** A block's footprint for the layout: the card seen from above (width × height). */
export function layoutSize(n) { const s = n.scale.x || 1; return { w: n.width * s, d: n.height * s }; }

/* ---------- the layered algorithm on abstract items ---------- */
/**
 * @param {Array<{ w, d }>} items
 * @param {Array<[number, number]>} edges  directed pairs of item indices
 * @param {object} o { gapX, gapZ }
 * @returns {{ pos: Array<{x, z}>, bounds: { minX, maxX, minZ, maxZ }, backEdges: Array<[number, number]>, connected: boolean[] }}
 */
export function layeredLayout(items, edges, { gapX = LAYOUT.gapX, gapZ = LAYOUT.gapZ } = {}) {
  const n = items.length;
  const pos = items.map(() => ({ x: 0, z: 0 }));
  if (!n) return { pos, bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, backEdges: [], connected: [] };
  // dedupe, drop self-loops
  const seen = new Set(); const E = [];
  for (const [a, b] of edges) { if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue; const k = `${a}>${b}`; if (!seen.has(k)) { seen.add(k); E.push([a, b]); } }
  const connected = items.map(() => false);
  for (const [a, b] of E) { connected[a] = true; connected[b] = true; }
  // break cycles: DFS, back edges dropped
  const out = items.map(() => []); for (const [a, b] of E) out[a].push(b);
  const state = new Array(n).fill(0); const backEdges = []; const backSet = new Set();
  const dfs = (u) => { state[u] = 1; for (const v of out[u]) { if (state[v] === 1) { backEdges.push([u, v]); backSet.add(`${u}>${v}`); } else if (state[v] === 0) dfs(v); } state[u] = 2; };
  for (let i = 0; i < n; i++) if (state[i] === 0 && connected[i]) dfs(i);
  const D = E.filter(([a, b]) => !backSet.has(`${a}>${b}`));
  const succ = items.map(() => []), pred = items.map(() => []);
  for (const [a, b] of D) { succ[a].push(b); pred[b].push(a); }
  // layers: longest path from the sources (Kahn order)
  const layer = new Array(n).fill(0); const indeg = pred.map((p) => p.length);
  const queue = []; for (let i = 0; i < n; i++) if (connected[i] && indeg[i] === 0) queue.push(i);
  while (queue.length) { const u = queue.shift(); for (const v of succ[u]) { layer[v] = Math.max(layer[v], layer[u] + 1); if (--indeg[v] === 0) queue.push(v); } }
  const conn = []; for (let i = 0; i < n; i++) if (connected[i]) conn.push(i);
  const L = conn.length ? Math.max(...conn.map((i) => layer[i])) + 1 : 0;
  const layers = Array.from({ length: L }, () => []);
  for (const i of conn) layers[layer[i]].push(i);
  // order within a layer: barycentre sweeps
  const order = new Array(n).fill(0);
  layers.forEach((list) => list.forEach((i, k) => { order[i] = k; }));
  const bary = (i, nb) => (nb.length ? nb.reduce((s, j) => s + order[j], 0) / nb.length : order[i]);
  for (let it = 0; it < 8; it++) {
    const down = it % 2 === 0;
    for (let l = down ? 1 : L - 2; down ? l < L : l >= 0; l += down ? 1 : -1) {
      const list = layers[l];
      const key = new Map(list.map((i) => [i, bary(i, down ? pred[i] : succ[i])]));
      list.sort((a, b) => (key.get(a) - key.get(b)) || (order[a] - order[b]));
      list.forEach((i, k) => { order[i] = k; });
    }
  }
  // x by layer: each layer as wide as its widest item
  const widths = layers.map((list) => Math.max(0, ...list.map((i) => items[i].w)));
  let x = 0; const layerX = [];
  for (let l = 0; l < L; l++) { layerX.push(x + widths[l] / 2); x += widths[l] + gapX; }
  // z: stack each layer, then pull towards the neighbours' mean (two passes) without overlaps
  const stack = (list) => {
    let z = 0; const zs = [];
    for (const i of list) { zs.push(z + items[i].d / 2); z += items[i].d + gapZ; }
    const mid = z ? (z - gapZ) / 2 : 0;
    list.forEach((i, k) => { pos[i].z = zs[k] - mid; });
  };
  layers.forEach(stack);
  const settle = (list, want) => {
    // keep the order, enforce the minimum separation around the wanted positions, then recentre the drift
    const zs = list.map((i) => want.get(i));
    for (let k = 1; k < list.length; k++) zs[k] = Math.max(zs[k], zs[k - 1] + (items[list[k - 1]].d + items[list[k]].d) / 2 + gapZ);
    const drift = zs.reduce((s, z, k) => s + (z - want.get(list[k])), 0) / list.length;
    list.forEach((i, k) => { pos[i].z = zs[k] - drift; });
  };
  const meanZ = (nb, fallback) => (nb.length ? nb.reduce((s, j) => s + pos[j].z, 0) / nb.length : fallback);
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < L; l++) settle(layers[l], new Map(layers[l].map((i) => [i, meanZ(pred[i], pos[i].z)])));
    for (let l = L - 2; l >= 0; l--) settle(layers[l], new Map(layers[l].map((i) => [i, meanZ(succ[i], pos[i].z)])));
  }
  layers.forEach((list, l) => list.forEach((i) => { pos[i].x = layerX[l]; }));
  // bounds of the graph
  const B = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (i) => { const it = items[i], p = pos[i]; B.minX = Math.min(B.minX, p.x - it.w / 2); B.maxX = Math.max(B.maxX, p.x + it.w / 2); B.minZ = Math.min(B.minZ, p.z - it.d / 2); B.maxZ = Math.max(B.maxZ, p.z + it.d / 2); };
  conn.forEach(grow);
  // the unconnected: a tidy grid below the graph (or on its own when nothing is connected)
  const loose = []; for (let i = 0; i < n; i++) if (!connected[i]) loose.push(i);
  if (loose.length) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(loose.length * 1.6)));
    const cw = Math.max(...loose.map((i) => items[i].w)), cd = Math.max(...loose.map((i) => items[i].d));
    const rows = Math.ceil(loose.length / cols);
    const gridW = cols * cw + (cols - 1) * LAYOUT.gridGap;
    const x0 = conn.length ? (B.minX + B.maxX) / 2 - gridW / 2 + cw / 2 : -gridW / 2 + cw / 2;
    const z0 = conn.length ? B.maxZ + LAYOUT.gridGap * 1.5 + cd / 2 : -(rows * cd + (rows - 1) * LAYOUT.gridGap) / 2 + cd / 2;
    loose.forEach((i, k) => { pos[i].x = x0 + (k % cols) * (cw + LAYOUT.gridGap); pos[i].z = z0 + Math.floor(k / cols) * (cd + LAYOUT.gridGap); grow(i); });
  }
  return { pos, bounds: B, backEdges, connected };
}

/* ---------- the world: blocks, groups as clusters ---------- */
/**
 * Plan a layout for `nodes` (default: every visible block). Returns `{ nodes, positions, backEdges }`:
 * the blocks that move, their new `[x, y, z]` (y unchanged) in the same order, and the cables that
 * were allowed to point backwards (cycles). Nothing is applied; see `layoutCommand`.
 */
export function layoutPlan(world, nodes = null) {
  const list = (nodes && nodes.length ? nodes : world.nodes).filter((n) => n && n.visible && n.kind !== 'group' && n.kind !== 'connection');
  const set = new Set(list);
  if (!set.size) return { nodes: [], positions: [], backEdges: [] };
  // items: clusters for expanded groups with members in the set, plain items for the rest
  const items = []; const itemOf = new Map();
  const clusters = new Map();   // group → { members, item }
  for (const n of list) {
    const g = n.group && !n.group.collapsed ? n.group : null;
    if (g) { if (!clusters.has(g)) clusters.set(g, { members: [] }); clusters.get(g).members.push(n); }
  }
  const inner = new Map();      // cluster item index → { members, layout }
  const links = world.connections.filter((c) => c.to && set.has(c.from.owner) && set.has(c.to.owner) && c.from.owner !== c.to.owner);
  for (const [g, c] of clusters) {
    const mIdx = new Map(c.members.map((m, i) => [m, i]));
    const edges = links.filter((l) => mIdx.has(l.from.owner) && mIdx.has(l.to.owner)).map((l) => [mIdx.get(l.from.owner), mIdx.get(l.to.owner)]);
    const lay = layeredLayout(c.members.map(layoutSize), edges);
    const w = lay.bounds.maxX - lay.bounds.minX + 2 * LAYOUT.groupPad, d = lay.bounds.maxZ - lay.bounds.minZ + 2 * LAYOUT.groupPad;
    const idx = items.length; items.push({ w, d, group: g });
    inner.set(idx, { members: c.members, layout: lay });
    c.members.forEach((m) => itemOf.set(m, idx));
  }
  for (const n of list) if (!itemOf.has(n)) { itemOf.set(n, items.length); items.push({ ...layoutSize(n), node: n }); }
  const edges = links.map((l) => [itemOf.get(l.from.owner), itemOf.get(l.to.owner)]).filter(([a, b]) => a !== b);
  const top = layeredLayout(items, edges);
  // compose: members offset by their cluster's centre; anchor the whole set on its previous centre
  const target = new Map();
  items.forEach((it, i) => {
    const p = top.pos[i];
    if (it.node) { target.set(it.node, { x: p.x, z: p.z }); return; }
    const { members, layout } = inner.get(i);
    const cx = (layout.bounds.minX + layout.bounds.maxX) / 2, cz = (layout.bounds.minZ + layout.bounds.maxZ) / 2;
    members.forEach((m, k) => target.set(m, { x: p.x + layout.pos[k].x - cx, z: p.z + layout.pos[k].z - cz }));
  });
  const before = footprintCentre(list, (n) => ({ x: n.position.x, z: n.position.z }));
  const after = footprintCentre(list, (n) => target.get(n));
  const dx = before.x - after.x, dz = before.z - after.z;
  const positions = list.map((n) => { const t = target.get(n); return [+(t.x + dx).toFixed(3), n.position.y, +(t.z + dz).toFixed(3)]; });
  // back edges as cables (item-level cycles; inside clusters too)
  const backPairs = new Set(top.backEdges.map(([a, b]) => `${a}>${b}`));
  for (const [i, { members, layout }] of inner) for (const [a, b] of layout.backEdges) backPairs.add(`${i}:${members[a].uid}>${members[b].uid}`);
  const backEdges = links.filter((l) => { const a = itemOf.get(l.from.owner), b = itemOf.get(l.to.owner); return backPairs.has(`${a}>${b}`) || (a === b && backPairs.has(`${a}:${l.from.owner.uid}>${l.to.owner.uid}`)); });
  return { nodes: list, positions, backEdges };
}
function footprintCentre(list, at) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const n of list) { const p = at(n), s = layoutSize(n); minX = Math.min(minX, p.x - s.w / 2); maxX = Math.max(maxX, p.x + s.w / 2); minZ = Math.min(minZ, p.z - s.d / 2); maxZ = Math.max(maxZ, p.z + s.d / 2); }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

/* ---------- tweened positions ---------- */
const tweens = new Map();   // node → { from, to, t, dur, world }
const _ease = (k) => 1 - Math.pow(1 - k, 3);
/** Animate a block to `[x, y, z]` over `dur` seconds (0 = at once). A block being dragged is left alone. */
export function tweenTo(node, to, dur = LAYOUT.animate, world = node.world) {
  if (dur <= 0 || node.dragging) { tweens.delete(node); node.position.fromArray(to); world?.bumpLayout(); return; }
  tweens.set(node, { from: node.position.toArray(), to: [...to], t: 0, dur, world });
}
/** Per frame: advance every tween; returns true while any block is still moving. */
export function updateTweens(dt) {
  if (!tweens.size) return false;
  const done = [];
  for (const [n, tw] of tweens) {
    if (n.dragging) { done.push(n); continue; }
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = _ease(tw.t);
    n.position.set(tw.from[0] + (tw.to[0] - tw.from[0]) * e, tw.from[1] + (tw.to[1] - tw.from[1]) * e, tw.from[2] + (tw.to[2] - tw.from[2]) * e);
    if (tw.t >= 1) { n.position.fromArray(tw.to); done.push(n); }
  }
  const worlds = new Set();
  for (const n of done) { worlds.add(tweens.get(n)?.world); tweens.delete(n); }
  worlds.forEach((w) => { w?.bumpLayout(); if (!tweens.size) w?.changed('move'); });
  return tweens.size > 0;
}
export const tweening = () => tweens.size > 0;

/** One undoable command that animates `nodes` to `positions` (and back on undo). */
export function layoutCommand(world, nodes, positions, { animate = LAYOUT.animate } = {}) {
  const before = nodes.map((n) => n.position.toArray());
  const apply = (snaps) => { nodes.forEach((n, i) => tweenTo(n, snaps[i], animate, world)); world.bumpLayout(); world.changed('move'); };
  return { label: `Auto-layout ${nodes.length}`, nodes, do: () => apply(positions), undo: () => apply(before) };
}

/** True when two blocks' plan footprints overlap (tests, and a sanity check for callers). */
export function overlaps(a, b, at = (n) => n.position) {
  const A = layoutSize(a), B = layoutSize(b), pa = at(a), pb = at(b);
  return Math.abs(pa.x - pb.x) < (A.w + B.w) / 2 - 1e-6 && Math.abs(pa.z - pb.z) < (A.d + B.d) / 2 - 1e-6;
}
