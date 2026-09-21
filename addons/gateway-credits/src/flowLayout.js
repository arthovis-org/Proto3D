// flowLayout.js — the n8n-style arrangement for a gateway graph, as a PURE function over plain
// data (no Three, no world), so it is unit-tested and reused by the sample builder. Three levels
// along y organise the graph (Justin: "use y space to organise stuff"):
//
//   • LEVEL 1 · the flow (y = levels.flow, eye level): the main chain runs LEFT → RIGHT by
//     topological rank (trigger → agent → log …), one column per rank, columns as wide as their
//     widest item, equal gaps; parallel branches stack in z inside a column (rows ordered by the
//     barycentre of their predecessors, so cables cross as little as possible), centred on the chain;
//   • LEVEL 0 · resources (the floor): SLOT CHILDREN — anything cabled into a `model` / `memory` /
//     `tool…` slot — leave the ranking and stand on the floor DIRECTLY BENEATH their parent, in a
//     centred horizontal row a small step toward the camera so their faces read from the front,
//     alternating between two z lanes (`slotForward ± slotStagger`) so a cable leaving a block's
//     right edge never starts inside its neighbour's plane; their cables then climb to the parent
//     like n8n's drop-lines; a child of
//     a child steps down too when there is vertical room under its parent, otherwise it steps
//     forward in z in front of it. The floor level is the block's BOTTOM (the core keeps a block's
//     bottom ≥ 0.2), so a resource's centre is levels.ground + h / 2 — pass the measured `h`
//     (host.layout.graph()) or rely on the per-size default;
//   • LEVEL 2 · governance (y = levels.top, or higher when the flow is tall): budget / meter blocks
//     (`topTypes`) float ABOVE the workflow they govern, in a row centred over the chain's x-extent.
//
//   `flat: true` gives the old ground-plane arrangement for the 2D plan (children BEHIND their
//   parent in z, top row behind the chain, y untouched) and returns [x, z] pairs.
//
// Plan/3D convention of the core: x runs left → right, z runs toward the camera (it looks along
// −z), y is up; positions are [x, y, z].
//
//   flowLayout(nodes, connections, opts) → Map(uid → [x, y, z])       (opts.flat → Map(uid → [x, z]))
//   nodes        [{ uid, type, size?: 'S'|'M'|'L'|'XL', w?, d?, h? }]   (w / d / h in world units; defaults per size)
//   connections  [{ from: uid, to: uid, toKey }]
//   opts         { levels: { flow, top, ground }, flat, anchor: { x, z }, topTypes, …FLOW }
export const FLOW = Object.freeze({ colGap: 3.4, rowGap: 2.6, slotGap: 0.9, slotDrop: 2.2, topGap: 2.6, slotForward: 0.6, slotStagger: 0.6, levelGap: 1.2 });
/** The three heights: the chain's centre, the governance row's centre (a floor: a tall flow lifts it), the floor a resource's bottom rests on. */
export const LEVELS = Object.freeze({ flow: 9, top: 17, ground: 0.2 });
/** Footprints per node size when the caller has no measured block: width × plan depth (the card's height, what the 2D plan stacks) × height. */
export const DEFAULT_SIZE = Object.freeze({ S: { w: 3.6, d: 3.2, h: 3.9 }, M: { w: 4.6, d: 4.8, h: 3.9 }, L: { w: 6.4, d: 6, h: 5.1 }, XL: { w: 9, d: 7, h: 6.3 } });
export const TOP_TYPES = Object.freeze(['gw-budget', 'gw-meter']);
const SLOT_RE = /^(model|memory|tools?\d*)$/;
/** Is an input key a slot (its cable hangs the source under the target)? */
export const isSlotKey = (key) => SLOT_RE.test(String(key || ''));

export function sizeOf(n) { const def = DEFAULT_SIZE[n.size] || DEFAULT_SIZE.S; return { w: n.w > 0 ? n.w : def.w, d: n.d > 0 ? n.d : def.d, h: n.h > 0 ? n.h : def.h }; }

/** parent uid → [child uid…] in connection order (a child keeps its first parent). */
export function slotChildren(nodes, connections) {
  const ids = new Set(nodes.map((n) => n.uid));
  const parentOf = new Map(), kids = new Map();
  for (const c of connections) {
    if (!isSlotKey(c.toKey) || !ids.has(c.from) || !ids.has(c.to) || c.from === c.to || parentOf.has(c.from)) continue;
    parentOf.set(c.from, c.to);
    if (!kids.has(c.to)) kids.set(c.to, []);
    kids.get(c.to).push(c.from);
  }
  return { parentOf, kids };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @returns {Map<string, [number, number, number]>} uid → [x, y, z]  (opts.flat: uid → [x, z])
 */
export function flowLayout(nodes, connections, opts = {}) {
  const o = { ...FLOW, topTypes: TOP_TYPES, anchor: { x: 0, z: 0 }, flat: false, ...opts, levels: { ...LEVELS, ...(opts.levels || {}) } };
  const out = new Map();
  if (!nodes?.length) return out;
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const size = (uid) => sizeOf(byUid.get(uid));
  const { parentOf, kids } = slotChildren(nodes, connections);
  const isTop = (n) => o.topTypes.includes(n.type) && !parentOf.has(n.uid);
  const main = nodes.filter((n) => !parentOf.has(n.uid) && !isTop(n)).map((n) => n.uid);
  const mainSet = new Set(main);
  const L = o.levels;
  /** A resource stands on the floor: its centre is one half-height above the ground level. */
  const groundY = (uid) => L.ground + size(uid).h / 2;
  /** Is there vertical room for `child` to stand on the floor under a parent whose centre is at `py`? */
  const fitsUnder = (parent, py, child) => py - size(parent).h / 2 - (L.ground + size(child).h) >= o.levelGap;

  /* ---- footprint of an item: its own box plus its slot children (recursively) — flat: the rows hang behind it; 3D: they stand under it (only a child without room steps forward) ---- */
  const footprint = (uid, py = L.flow, depth = 0) => {
    const s = size(uid); const ch = kids.get(uid) || [];
    if (!ch.length || depth > 6) return { w: s.w, d: s.d };
    const rows = ch.map((c) => footprint(c, groundY(c), depth + 1));
    const rowW = rows.reduce((a, r) => a + r.w, 0) + o.slotGap * (rows.length - 1);
    const rowD = Math.max(...rows.map((r) => r.d));
    if (o.flat) return { w: Math.max(s.w, rowW), d: s.d + o.slotDrop + rowD };
    const under = ch.every((c) => fitsUnder(uid, py, c));
    return { w: Math.max(s.w, rowW), d: under ? Math.max(s.d, 2 * (o.slotForward + o.slotStagger) + rowD) : s.d + o.slotDrop + rowD };
  };

  /* ---- ranks: longest path from the sources over main (non-slot) edges; cycles fall back to input order ---- */
  const edges = []; const seen = new Set();
  for (const c of connections) {
    if (isSlotKey(c.toKey) || !mainSet.has(c.from) || !mainSet.has(c.to) || c.from === c.to) continue;
    const k = `${c.from}>${c.to}`; if (seen.has(k)) continue; seen.add(k); edges.push([c.from, c.to]);
  }
  const succ = new Map(main.map((u) => [u, []])), pred = new Map(main.map((u) => [u, []]));
  for (const [a, b] of edges) { succ.get(a).push(b); pred.get(b).push(a); }
  const rank = new Map(); const indeg = new Map(main.map((u) => [u, pred.get(u).length]));
  const queue = main.filter((u) => indeg.get(u) === 0 && (succ.get(u).length || pred.get(u).length));
  queue.forEach((u) => rank.set(u, 0));
  while (queue.length) { const u = queue.shift(); for (const v of succ.get(u)) { rank.set(v, Math.max(rank.get(v) ?? 0, rank.get(u) + 1)); indeg.set(v, indeg.get(v) - 1); if (indeg.get(v) === 0) queue.push(v); } }
  const connected = main.filter((u) => rank.has(u));
  const maxRank = connected.length ? Math.max(...connected.map((u) => rank.get(u))) : -1;
  for (const u of main) if (!rank.has(u)) rank.set(u, maxRank + 1);   // cycle members and loose blocks: a trailing column
  const R = main.length ? Math.max(...main.map((u) => rank.get(u))) + 1 : 0;
  const cols = Array.from({ length: R }, () => []);
  for (const u of main) cols[rank.get(u)].push(u);

  /* ---- rows: barycentre of the predecessors' row (one sweep, left to right); ties keep input order ---- */
  const row = new Map();
  cols.forEach((list, r) => {
    if (r > 0) {
      const key = new Map(list.map((u) => { const ps = pred.get(u).filter((p) => row.has(p)); return [u, ps.length ? ps.reduce((a, p) => a + row.get(p), 0) / ps.length : Infinity]; }));
      list.sort((a, b) => (key.get(a) - key.get(b)) || (main.indexOf(a) - main.indexOf(b)));
    }
    list.forEach((u, i) => row.set(u, i));
  });

  /* ---- columns: x by cumulative width, z stacked and centred on the chain; the chain sits at the flow level ---- */
  const fp = new Map(main.map((u) => [u, footprint(u)]));
  let x = o.anchor.x;
  const colX = [];
  cols.forEach((list) => { const w = Math.max(0, ...list.map((u) => fp.get(u).w)); colX.push(x + w / 2); x += w + o.colGap; });
  cols.forEach((list, r) => {
    // stack the footprints (own box + children) along z, then shift the column so the mean of the
    // items' OWN centres sits on the chain row: a lone item lands exactly on it; two branches straddle it
    let z = 0; const own = [];
    for (const u of list) { const f = fp.get(u); own.push(z + (o.flat ? size(u).d / 2 : f.d / 2)); z += f.d + o.rowGap; }
    const mean = own.reduce((a, v) => a + v, 0) / (own.length || 1);
    list.forEach((u, i) => out.set(u, [colX[r], L.flow, o.anchor.z + own[i] - mean]));
  });

  /* ---- slot children: a centred row under the parent — flat: one z-step behind; 3D: standing on the floor beneath it on two alternating z lanes (or forward when there is no room) ---- */
  const hang = (parent, depth = 0) => {
    const ch = kids.get(parent) || []; if (!ch.length || depth > 6 || !out.has(parent)) return;
    const [px, py, pz] = out.get(parent); const pd = size(parent).d;
    const fps = ch.map((c) => footprint(c, groundY(c), depth + 1));
    const rowW = fps.reduce((a, f) => a + f.w, 0) + o.slotGap * (ch.length - 1);
    let cx = px - rowW / 2;
    ch.forEach((c, i) => {
      const s = size(c);
      if (o.flat) out.set(c, [cx + fps[i].w / 2, py, pz + pd / 2 + o.slotDrop + s.d / 2]);
      else out.set(c, [cx + fps[i].w / 2, groundY(c), fitsUnder(parent, py, c) ? pz + o.slotForward + (ch.length > 1 ? (i % 2 ? 1 : -1) * o.slotStagger : 0) : pz + pd / 2 + o.slotDrop + s.d / 2]);
      cx += fps[i].w + o.slotGap;
    });
    ch.forEach((c) => hang(c, depth + 1));
  };
  main.forEach((u) => hang(u));
  // a child whose parent was itself never placed (parent chain broken): put it in the trailing column so every node gets a position
  for (const n of nodes) if (parentOf.has(n.uid) && !out.has(n.uid)) out.set(n.uid, [colX[R - 1] ?? o.anchor.x, L.flow, o.anchor.z]);

  /* ---- top row: budgets and meters — flat: behind everything, left-aligned with the first column; 3D: floating above the flow, centred over its x-extent ---- */
  const top = nodes.filter(isTop).map((n) => n.uid);
  if (top.length) {
    const placed = [...out.entries()];
    const rowD = Math.max(...top.map((u) => size(u).d)), rowH = Math.max(...top.map((u) => size(u).h));
    const minX = placed.length ? Math.min(...placed.map(([u, [xx]]) => xx - size(u).w / 2)) : o.anchor.x;
    if (o.flat) {
      const minZ = placed.length ? Math.min(...placed.map(([u, [, , z]]) => z - size(u).d / 2)) : o.anchor.z;
      let tx = minX;
      for (const u of top) { const s = size(u); out.set(u, [tx + s.w / 2, L.flow, minZ - o.topGap - rowD / 2]); tx += s.w + o.slotGap; }
    } else {
      const maxX = placed.length ? Math.max(...placed.map(([u, [xx]]) => xx + size(u).w / 2)) : o.anchor.x;
      const maxTop = placed.length ? Math.max(...placed.map(([u, [, y]]) => y + size(u).h / 2)) : L.flow;
      const ty = Math.max(L.top, maxTop + o.topGap + rowH / 2);
      const rowW = top.reduce((a, u) => a + size(u).w, 0) + o.slotGap * (top.length - 1);
      let tx = (minX + maxX) / 2 - rowW / 2;
      for (const u of top) { const s = size(u); out.set(u, [tx + s.w / 2, ty, o.anchor.z]); tx += s.w + o.slotGap; }
    }
  }
  for (const [u, p] of out) out.set(u, o.flat ? [r3(p[0]), r3(p[2])] : [r3(p[0]), r3(p[1]), r3(p[2])]);
  return out;
}

/**
 * Pairs of nodes whose boxes overlap at `positions`: plan footprints (w × d) for [x, z] pairs, full
 * boxes (w × h × d) for [x, y, z] triples — two blocks apart on any one axis are clear. [] means a clean layout.
 */
export function overlapping(nodes, positions) {
  const bad = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]; const pa = positions.get(a.uid), pb = positions.get(b.uid); if (!pa || !pb) continue;
    const A = sizeOf(a), B = sizeOf(b);
    const three = pa.length === 3 && pb.length === 3;
    const [ax, ay, az] = three ? pa : [pa[0], 0, pa[1]], [bx, by, bz] = three ? pb : [pb[0], 0, pb[1]];
    const hitX = Math.abs(ax - bx) < (A.w + B.w) / 2 - 1e-6, hitZ = Math.abs(az - bz) < (A.d + B.d) / 2 - 1e-6;
    const hitY = !three || Math.abs(ay - by) < (A.h + B.h) / 2 - 1e-6;
    if (hitX && hitY && hitZ) bad.push([a.uid, b.uid]);
  }
  return bad;
}
