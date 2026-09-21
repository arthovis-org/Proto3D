// flowLayout.js — the n8n-style arrangement for a gateway graph, as a PURE function over plain
// data (no Three, no world), so it is unit-tested and reused by the sample builder:
//
//   • the main chain runs LEFT → RIGHT by topological rank (trigger → agent → log …), one column
//     per rank, columns as wide as their widest item, equal gaps;
//   • parallel branches stack TOP → DOWN inside a column (rows ordered by the barycentre of their
//     predecessors, so cables cross as little as possible), centred on the chain;
//   • SLOT CHILDREN — anything cabled into a `model` / `memory` / `tool…` slot — leave the ranking
//     and hang BELOW their parent in one horizontal row, one z-step down, centred under it (the
//     way n8n hangs a Chat Model, Memory and Tools under an agent); a column reserves the width
//     and depth of those rows, so nothing overlaps;
//   • budget / meter blocks (`topTypes`) sit in a row ABOVE the chain, left-aligned with it.
//
// Plan/3D convention of the core: x runs left → right, z runs top → down on the screen (the camera
// looks along −z), so "below" is a larger z. y is not this module's business.
//
//   flowLayout(nodes, connections, opts) → Map(uid → [x, z])
//   nodes        [{ uid, type, size?: 'S'|'M'|'L'|'XL', w?, d? }]   (w / d in world units; defaults per size)
//   connections  [{ from: uid, to: uid, toKey }]
export const FLOW = Object.freeze({ colGap: 3.4, rowGap: 2.6, slotGap: 0.9, slotDrop: 2.2, topGap: 2.6 });
/** Footprints (plan view: width × depth) per node size when the caller has no measured block. */
export const DEFAULT_SIZE = Object.freeze({ S: { w: 3.6, d: 3.2 }, M: { w: 4.6, d: 4.8 }, L: { w: 6.4, d: 6 }, XL: { w: 9, d: 7 } });
export const TOP_TYPES = Object.freeze(['gw-budget', 'gw-meter']);
const SLOT_RE = /^(model|memory|tools?\d*)$/;
/** Is an input key a slot (its cable hangs the source under the target)? */
export const isSlotKey = (key) => SLOT_RE.test(String(key || ''));

export function sizeOf(n) { const def = DEFAULT_SIZE[n.size] || DEFAULT_SIZE.S; return { w: n.w > 0 ? n.w : def.w, d: n.d > 0 ? n.d : def.d }; }

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
 * @returns {Map<string, [number, number]>} uid → [x, z]
 */
export function flowLayout(nodes, connections, opts = {}) {
  const o = { ...FLOW, topTypes: TOP_TYPES, anchor: { x: 0, z: 0 }, ...opts };
  const out = new Map();
  if (!nodes?.length) return out;
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const size = (uid) => sizeOf(byUid.get(uid));
  const { parentOf, kids } = slotChildren(nodes, connections);
  const isTop = (n) => o.topTypes.includes(n.type) && !parentOf.has(n.uid);
  const main = nodes.filter((n) => !parentOf.has(n.uid) && !isTop(n)).map((n) => n.uid);
  const mainSet = new Set(main);

  /* ---- footprint of a main item: its own box plus the rows of slot children under it (recursively) ---- */
  const footprint = (uid, depth = 0) => {
    const s = size(uid); const ch = kids.get(uid) || [];
    if (!ch.length || depth > 6) return { w: s.w, d: s.d };
    const rows = ch.map((c) => footprint(c, depth + 1));
    const rowW = rows.reduce((a, r) => a + r.w, 0) + o.slotGap * (rows.length - 1);
    const rowD = Math.max(...rows.map((r) => r.d));
    return { w: Math.max(s.w, rowW), d: s.d + o.slotDrop + rowD };
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
  for (const u of main) if (!rank.has(u)) rank.set(u, pred.get(u).length || succ.get(u).length ? maxRank + 1 : maxRank + 1);   // cycle members and loose blocks: a trailing column
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

  /* ---- columns: x by cumulative width, z stacked and centred on the chain ---- */
  const fp = new Map(main.map((u) => [u, footprint(u)]));
  let x = o.anchor.x;
  const colX = [];
  cols.forEach((list) => { const w = Math.max(0, ...list.map((u) => fp.get(u).w)); colX.push(x + w / 2); x += w + o.colGap; });
  cols.forEach((list, r) => {
    // stack the footprints (own box + hanging children) top → down, then shift the column so the
    // mean of the items' OWN centres sits on the chain row: a lone item lands exactly on it, its
    // children hang below; two branches straddle it
    let z = 0; const own = [];
    for (const u of list) { const f = fp.get(u); own.push(z + size(u).d / 2); z += f.d + o.rowGap; }
    const mean = own.reduce((a, v) => a + v, 0) / (own.length || 1);
    list.forEach((u, i) => out.set(u, [colX[r], o.anchor.z + own[i] - mean]));
  });

  /* ---- slot children: a centred row under the parent, one step down (children of children recurse) ---- */
  const hang = (parent, depth = 0) => {
    const ch = kids.get(parent) || []; if (!ch.length || depth > 6 || !out.has(parent)) return;
    const [px, pz] = out.get(parent); const pd = size(parent).d;
    const fps = ch.map((c) => footprint(c, depth + 1));
    const rowW = fps.reduce((a, f) => a + f.w, 0) + o.slotGap * (ch.length - 1);
    let cx = px - rowW / 2;
    ch.forEach((c, i) => { const s = size(c); out.set(c, [cx + fps[i].w / 2, pz + pd / 2 + o.slotDrop + s.d / 2]); cx += fps[i].w + o.slotGap; });
    ch.forEach((c) => hang(c, depth + 1));
  };
  main.forEach((u) => hang(u));
  // a child whose parent was itself never placed (parent chain broken): put it in the trailing column so every node gets a position
  for (const n of nodes) if (parentOf.has(n.uid) && !out.has(n.uid)) out.set(n.uid, [colX[R - 1] ?? o.anchor.x, o.anchor.z]);

  /* ---- top row: budgets and meters above everything, left-aligned with the first column ---- */
  const top = nodes.filter(isTop).map((n) => n.uid);
  if (top.length) {
    const placed = [...out.entries()];
    const minZ = placed.length ? Math.min(...placed.map(([u, [, z]]) => z - size(u).d / 2)) : o.anchor.z;
    const minX = placed.length ? Math.min(...placed.map(([u, [xx]]) => xx - size(u).w / 2)) : o.anchor.x;
    const rowD = Math.max(...top.map((u) => size(u).d));
    let tx = minX;
    for (const u of top) { const s = size(u); out.set(u, [tx + s.w / 2, minZ - o.topGap - rowD / 2]); tx += s.w + o.slotGap; }
  }
  for (const [u, p] of out) out.set(u, [r3(p[0]), r3(p[1])]);
  return out;
}

/** Pairs of nodes whose plan footprints overlap at `positions` (Map uid → [x, z]); [] means a clean layout. */
export function overlapping(nodes, positions) {
  const bad = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]; const pa = positions.get(a.uid), pb = positions.get(b.uid); if (!pa || !pb) continue;
    const A = sizeOf(a), B = sizeOf(b);
    if (Math.abs(pa[0] - pb[0]) < (A.w + B.w) / 2 - 1e-6 && Math.abs(pa[1] - pb[1]) < (A.d + B.d) / 2 - 1e-6) bad.push([a.uid, b.uid]);
  }
  return bad;
}
