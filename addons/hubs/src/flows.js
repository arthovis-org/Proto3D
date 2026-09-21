// flows.js — pure 3D layout math. `layoutFlow(flowId, items)` takes the hub nodes as plain items
// ({ uid, type, params, width?, height? }) and returns a Map uid → { x, y, z, ry }: x / z the block's
// centre on the floor plan, y the elevation of the block's BASE (0 = the floor; callers add
// height / 2 + the floor gap), ry the rotation about y in radians (0 = facing +z, the default camera).
// Height is an organising axis: flows stack levels (floors) whose spacing clears the tallest card
// in the level plus a margin, so a stack reads as floors from the framing camera.
//   delivery  one climbing arc per client (a level each), cards facing the arc's centre, blueprint front-centre, headers above their section
//   audience  floors per audience (customers at the ground, then everyone, staff, owner, developers, machine), each floor a row stepped back a little
//   sitemap   the hub page at the base, the sections as a semicircular ring one level up, pages rising above their section
//   compare   clients as floors, sections as columns: a column reads top-to-bottom as the same section across clients
//   devices   phone / tablet / desktop as three arcs, one level each
// Footprints are the real card sizes (items carry width / height; hub-page cards default to
// sizing.cardDims), so tall cards get taller floors. Deterministic in the items' order.
import { PHASES, AUDIENCES, phaseOf } from './template.js';
import { cardDims } from './sizing.js';

export const FLOWS = Object.freeze([
  { id: 'delivery', label: 'Delivery', hint: 'A climbing arc per client in delivery order: hub → website → app → staff → … → machine' },
  { id: 'audience', label: 'Audience', hint: 'Floors by audience: customers at the ground, staff, owner, developers and machine above' },
  { id: 'sitemap', label: 'Site map', hint: 'Hub at the base, sections in a ring one level up, pages rising above their section' },
  { id: 'compare', label: 'Compare', hint: 'Clients as floors × sections as columns: read a column top-to-bottom' },
  { id: 'devices', label: 'Devices', hint: 'Phone, tablet and desktop pages as three arcs, one level each' },
]);
export const FLOW_IDS = Object.freeze(FLOWS.map((f) => f.id));
export const flowById = (id) => FLOWS.find((f) => f.id === id) || null;

/** Spacing in world units. */
export const GAP = Object.freeze({ x: 1.4, section: 2.2, level: 1.6, floor: 0.4, stepBack: 3.2, front: 6, minRadius: 12, maxArc: 2.4 });
/** Default footprints of the non-page hub nodes (Node3D XL / M with a face). */
export const NODE_DIMS = Object.freeze({ 'hub-blueprint': { width: 9, height: 6.06 }, 'hub-section': { width: 4.6, height: 3.86 } });

const isPage = (it) => it.type === 'hub-page';
const isBlueprint = (it) => it.type === 'hub-blueprint';
const isHeader = (it) => it.type === 'hub-section';
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v) => String(v ?? '');
/** Width / height of an item: its own, else the type's default (pages from their params). */
export function dimsOf(it) {
  if (Number.isFinite(+it.width) && Number.isFinite(+it.height) && +it.width > 0 && +it.height > 0) return { width: +it.width, height: +it.height };
  if (isPage(it)) { const d = cardDims(it.params); return { width: d.width, height: d.height }; }
  return NODE_DIMS[it.type] || { width: 4, height: 3 };
}
const W = (it) => dimsOf(it).width, Hh = (it) => dimsOf(it).height;
const maxH = (list) => (list.length ? Math.max(...list.map(Hh)) : 0);
/** Pages in delivery order: phase, then `order`, then title (stable on ties). */
export function sortPages(pages) {
  return [...pages].sort((a, b) => (phaseOf(a.params.section) - phaseOf(b.params.section)) || (num(a.params.order) - num(b.params.order)) || str(a.params.title).localeCompare(str(b.params.title)) || str(a.uid).localeCompare(str(b.uid)));
}
/** Client keys in order of first appearance (blueprints first, then pages); '' = no client. */
export function clientOrder(items) {
  const seen = []; const add = (k) => { if (!seen.includes(k)) seen.push(k); };
  for (const it of items) if (isBlueprint(it)) add(str(it.params.slug).trim());
  for (const it of items) if (isPage(it)) add(str(it.params.client).trim());
  for (const it of items) if (isHeader(it)) add(str(it.params.client).trim());
  return seen;
}
const groupBy = (list, key) => { const m = new Map(); for (const it of list) { const k = key(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); } return m; };
const r3 = (v) => +v.toFixed(3);

/**
 * Cards along an arc that bulges away from the viewer: the arc's centre C sits at (cx, cz + R),
 * cards face C (ry = -a). Arc length = the cards' widths + gaps; the radius is what keeps the
 * sweep under GAP.maxArc (a horseshoe at most), never under GAP.minRadius. `climb` lifts the
 * bases linearly from the first card to the last. Returns [{ it, x, z, ry, dy }] and the arc { R, theta }.
 */
export function arcPlace(list, { cx = 0, cz = 0, climb = 0, gap = GAP.x } = {}) {
  const n = list.length;
  if (!n) return { placed: [], R: GAP.minRadius, theta: 0 };
  const widths = list.map(W);
  const L = widths.reduce((s, w) => s + w, 0) + gap * (n - 1);
  const R = Math.max(GAP.minRadius, L / GAP.maxArc);
  const theta = L / R;
  let s = 0; const placed = [];
  list.forEach((it, i) => {
    const centre = s + widths[i] / 2; s += widths[i] + gap;
    const a = n === 1 ? 0 : -theta / 2 + (centre / L) * theta;
    placed.push({ it, x: cx + R * Math.sin(a), z: cz + R - R * Math.cos(a), ry: -a, dy: n > 1 ? climb * (i / (n - 1)) : 0 });
  });
  return { placed, R, theta };
}
/** A straight row centred on cx: [{ it, x }]. */
function rowPlace(list, cx, gap = GAP.x) {
  const widths = list.map(W); const L = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, list.length - 1);
  let x = cx - L / 2; const out = [];
  list.forEach((it, i) => { out.push({ it, x: x + widths[i] / 2 }); x += widths[i] + gap; });
  return { placed: out, width: L };
}
/** Base elevations of stacked levels: each clears the tallest card below it plus the margin. */
export function levelBases(levelHeights) {
  const bases = []; let y = 0;
  for (const h of levelHeights) { bases.push(r3(y)); y += h + GAP.level; }
  return bases;
}

export function layoutFlow(flowId, items, { origin = [0, 0] } = {}) {
  const fn = LAYOUTS[flowId] || LAYOUTS.delivery;
  const out = new Map();
  const put = (it, x, y, z, ry = 0) => out.set(it.uid, { x: r3(x), y: r3(Math.max(0, y)), z: r3(z), ry: r3(ry) });
  fn(items.filter((it) => it && it.uid), put, origin[0], origin[1]);
  const rest = items.filter((it) => it?.uid && !out.has(it.uid));
  if (rest.length) {   // anything the preset did not place (unknown types): a column on the ground, clear of everything else
    let minX = origin[0]; for (const [uid, p] of out) { const it = items.find((x) => x.uid === uid); minX = Math.min(minX, p.x - (it ? W(it) / 2 : 5)); }
    rest.forEach((it, k) => put(it, minX - GAP.section - 6 - W(it) / 2, 0, origin[1] + k * 6));
  }
  return out;
}

const LAYOUTS = {
  delivery(items, put, ox, oz) {
    const clients = clientOrder(items);
    const pages = groupBy(sortPages(items.filter(isPage)), (p) => str(p.params.client).trim());
    const bps = groupBy(items.filter(isBlueprint), (b) => str(b.params.slug).trim());
    const heads = groupBy(items.filter(isHeader), (h) => str(h.params.client).trim());
    // one level per client: the level clears its tallest page, its header row above and its climb
    const levelH = clients.map((c) => { const ps = pages.get(c) || []; const hs = heads.get(c) || []; const climb = ps.length > 1 ? Math.min(6, 0.3 * ps.length) : 0; return maxH(ps) + climb + (hs.length ? maxH(hs) + 0.6 : 0) + (ps.length ? 0 : maxH(bps.get(c) || [])); });
    const bases = levelBases(levelH);
    clients.forEach((c, li) => {
      const base = bases[li]; const ps = pages.get(c) || [];
      const climb = ps.length > 1 ? Math.min(6, 0.3 * ps.length) : 0;
      const arc = arcPlace(ps, { cx: ox, cz: oz, climb });
      const bySection = new Map();
      for (const p of arc.placed) { put(p.it, p.x, base + p.dy, p.z, p.ry); if (!bySection.has(p.it.params.section)) bySection.set(p.it.params.section, p); }
      const front = oz + Math.min(arc.R * 0.5, arc.R * (1 - Math.cos(arc.theta / 2)) + GAP.front);
      (bps.get(c) || []).forEach((b, k) => put(b, ox + k * (W(b) + GAP.x), base, front + (ps.length ? 0 : 0), 0));
      const rowH = maxH(ps);
      let spare = 0;
      for (const h of heads.get(c) || []) {   // a header floats above the first page of its section; sections without pages trail the arc
        const p = bySection.get(h.params.section);
        if (p) put(h, p.x, base + p.dy + rowH + 0.6, p.z, p.ry);
        else put(h, ox - arc.R - 8, base, oz + (spare++) * 5, 0);
      }
    });
  },
  audience(items, put, ox, oz) {
    const pages = sortPages(items.filter(isPage));
    const order = ['customers', 'everyone', 'staff', 'owner', 'developers', 'machine'];
    const laneOf = (p) => (order.includes(p.params.audience) ? p.params.audience : 'everyone');
    const lanes = order.filter((a) => pages.some((p) => laneOf(p) === a));
    const byLane = groupBy(pages, laneOf);
    const heads = groupBy(items.filter(isHeader), (h) => { const s = PHASES.find((x) => x.id === h.params.section); return s && lanes.includes(s.audience) ? s.audience : lanes[0] || 'everyone'; });
    const bases = levelBases(lanes.map((a) => Math.max(maxH(byLane.get(a) || []), maxH(heads.get(a) || []))));
    let rowStart = Infinity;
    lanes.forEach((a, li) => {
      const row = rowPlace(byLane.get(a), ox);
      const z = oz - li * GAP.stepBack;
      rowStart = Math.min(rowStart, ox - row.width / 2);
      for (const { it, x } of row.placed) put(it, x, bases[li], z + (dimsOf(it).width < 4.5 ? 1.6 : 0), 0);   // narrow (phone) cards step forward a little
    });
    if (!Number.isFinite(rowStart)) rowStart = ox;
    lanes.forEach((a, li) => { let x = rowStart - GAP.x; for (const h of heads.get(a) || []) { x -= W(h) / 2; put(h, x, bases[li], oz - li * GAP.stepBack, 0); x -= W(h) / 2 + GAP.x; } });
    const maxHeads = Math.max(0, ...lanes.map((a) => (heads.get(a) || []).reduce((s, h) => s + W(h) + GAP.x, 0)));
    // blueprints climb the floors at the left end: one per floor, the rest on the ground further out
    items.filter(isBlueprint).forEach((b, k) => { const li = Math.min(k, Math.max(0, lanes.length - 1)); const extra = Math.max(0, k - lanes.length + 1); put(b, rowStart - GAP.x - maxHeads - GAP.x - W(b) / 2 - extra * (W(b) + GAP.x), bases[li] || 0, oz - li * GAP.stepBack, 0); });
    for (const [a, list] of heads) if (!lanes.includes(a)) list.forEach((h, k) => put(h, rowStart - 40, 0, oz + k * 5, 0));
  },
  sitemap(items, put, ox, oz) {
    const pages = sortPages(items.filter(isPage));
    const hubs = pages.filter((p) => p.params.section === 'hub');
    const hubRow = rowPlace(hubs, ox);
    for (const { it, x } of hubRow.placed) put(it, x, 0, oz, 0);
    let bx = ox - hubRow.width / 2 - GAP.x;
    for (const b of items.filter(isBlueprint)) { bx -= W(b) / 2; put(b, bx, 0, oz, 0); bx -= W(b) / 2 + GAP.x; }
    const rest = pages.filter((p) => p.params.section !== 'hub');
    const heads = groupBy(items.filter(isHeader), (h) => h.params.section);
    const sections = PHASES.filter((s) => s.id !== 'hub' && (rest.some((p) => p.params.section === s.id) || heads.has(s.id)));
    const bySection = groupBy(rest, (p) => p.params.section);
    const columns = sections.map((s) => [...(heads.get(s.id) || []), ...(bySection.get(s.id) || [])]);   // the slot occupant first, the rest rise above it
    const ringBase = maxH(hubs.length ? hubs : items.filter(isBlueprint)) + GAP.level;
    const n = sections.length;
    if (!n) return;
    const slotW = columns.map((col) => Math.max(...col.map(W)));
    const L = slotW.reduce((s, w) => s + w, 0) + GAP.section * Math.max(0, n - 1);
    const sweep = Math.min(Math.PI * 0.9, GAP.maxArc);
    const R = Math.max(GAP.minRadius, L / sweep);
    const theta = L / R;
    let s = 0;
    columns.forEach((col, i) => {
      const centre = s + slotW[i] / 2; s += slotW[i] + GAP.section;
      const a = n === 1 ? 0 : -theta / 2 + (centre / L) * theta;   // behind the hub: the ring's centre is the hub, the slots at -z
      let y = ringBase;
      col.forEach((it, k) => {
        const r = R + k * 1.2;
        put(it, ox + r * Math.sin(a), y, oz - r * Math.cos(a), -a);
        y += Hh(it) + GAP.level;
      });
    });
    for (const [sid, list] of heads) if (!sections.some((x) => x.id === sid)) list.forEach((h, k) => put(h, ox - R - 12, 0, oz - k * 5, 0));
  },
  compare(items, put, ox, oz) {
    const clients = clientOrder(items);
    const pages = sortPages(items.filter(isPage));
    const heads = groupBy(items.filter(isHeader), (h) => h.params.section);
    const sections = PHASES.filter((s) => pages.some((p) => p.params.section === s.id) || heads.has(s.id));
    const cell = new Map();   // `${client}|${section}` → pages
    for (const p of pages) { const k = `${str(p.params.client).trim()}|${p.params.section}`; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(p); }
    const cellW = (c, s) => { const ps = cell.get(`${c}|${s.id}`) || []; return ps.reduce((sum, p) => sum + W(p), 0) + GAP.x * Math.max(0, ps.length - 1); };
    // columns as wide as the busiest cell of that section (or its header)
    const colX = new Map(); let x = ox;
    for (const s of sections) { const hs = heads.get(s.id) || []; const width = Math.max(...clients.map((c) => cellW(c, s)), hs.reduce((sum, h) => sum + W(h), 0) + GAP.x * Math.max(0, hs.length - 1), 1); colX.set(s.id, { x, width }); x += width + GAP.section; }
    const bps = groupBy(items.filter(isBlueprint), (b) => str(b.params.slug).trim());
    const bases = levelBases(clients.map((c) => Math.max(maxH(pages.filter((p) => str(p.params.client).trim() === c)), maxH(bps.get(c) || []))));
    clients.forEach((c, li) => {
      const base = bases[li], z = oz - li * GAP.stepBack;
      let bx = ox - GAP.section;
      for (const b of bps.get(c) || []) { bx -= W(b) / 2; put(b, bx, base, z, 0); bx -= W(b) / 2 + GAP.x; }
      for (const s of sections) { let cx = colX.get(s.id).x; for (const p of cell.get(`${c}|${s.id}`) || []) { put(p, cx + W(p) / 2, base, z, 0); cx += W(p) + GAP.x; } }
    });
    // section headers: a label row on the ground in front of the first floor
    for (const s of sections) { let cx = colX.get(s.id).x; for (const h of heads.get(s.id) || []) { put(h, cx + W(h) / 2, 0, oz + GAP.front + 2, 0); cx += W(h) + GAP.x; } }
    for (const [sid, list] of heads) if (!sections.some((x) => x.id === sid)) list.forEach((h, k) => put(h, ox - 30, 0, oz - k * 5, 0));
  },
  devices(items, put, ox, oz) {
    const pages = sortPages(items.filter(isPage));
    const clients = clientOrder(items);
    const byClient = (p) => clients.indexOf(str(p.params.client).trim());
    const band = (p) => (p.params.device === 'phone' ? 0 : p.params.device === 'tablet' ? 1 : 2);
    const bands = [[], [], []];
    for (const p of pages) bands[band(p)].push(p);
    bands.forEach((list) => list.sort((a, b) => byClient(a) - byClient(b)));
    const bases = levelBases(bands.map(maxH));
    let leftmost = ox;
    bands.forEach((list, li) => {
      const arc = arcPlace(list, { cx: ox, cz: oz - li * GAP.stepBack });
      for (const p of arc.placed) { put(p.it, p.x, bases[li], p.z, p.ry); leftmost = Math.min(leftmost, p.x - W(p.it) / 2); }
    });
    let bx = leftmost - GAP.section;
    for (const b of items.filter(isBlueprint)) { bx -= W(b) / 2; put(b, bx, 0, oz + GAP.front, 0); bx -= W(b) / 2 + GAP.x; }
    items.filter(isHeader).forEach((h, i) => put(h, leftmost - GAP.section - W(h) / 2, 0, oz - GAP.stepBack * 3 - i * 5, 0));
  },
};

/** Bounding box of a layout result (centres): { minX, maxX, minY, maxY, minZ, maxZ, cx, cz }. */
export function layoutBounds(map) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [, p] of map) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, cx: 0, cz: 0 };
  return { minX, maxX, minY, maxY, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}
/**
 * True when two placed items could touch: their vertical extents overlap and their footprints (a
 * disc of half the diagonal each, rotation-agnostic) come closer than `slack` allows. Used by the
 * tests; the presets are collision-free by construction.
 */
export function collides(a, pa, b, pb, slack = 0.6) {
  const A = dimsOf(a), B = dimsOf(b);
  if (pa.y + A.height <= pb.y + 1e-6 || pb.y + B.height <= pa.y + 1e-6) return false;
  const dx = pa.x - pb.x, dz = pa.z - pb.z;
  const d = Math.hypot(dx, dz);
  const minX = (A.width + B.width) / 2 - slack;
  const sameRow = Math.abs(dz) < 1.5;
  return sameRow ? Math.abs(dx) < minX : d < 1.5;   // rows: side by side; different rows: never on top of each other
}
