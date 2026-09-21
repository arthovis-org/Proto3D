// flows.js — pure layout math. `layoutFlow(flowId, items)` takes the hub nodes as plain items
// ({ uid, type, params }) and returns a Map uid → [x, null, z] (y = null: keep the node's height).
// Five presets, all deterministic in the items' order:
//   delivery  one row per client, left→right in template phase order, blueprint first
//   audience  swimlanes by audience (rows), pages left→right within a lane
//   sitemap   the hub page at the front-centre, sections in an arc behind it, pages in columns behind each section
//   compare   clients as rows × sections as columns, the same section of every client lines up
//   devices   phone / tablet / desktop pages in three bands
// Standing XL cards are 9 units wide and ~6 tall, so the row pitch (z) is generous enough that a
// row does not hide the one behind it from the framing camera's 35° elevation.
import { PHASES, AUDIENCES, phaseOf } from './template.js';

export const FLOWS = Object.freeze([
  { id: 'delivery', label: 'Delivery', hint: 'One row per client in delivery order: hub → website → app → staff → … → machine' },
  { id: 'audience', label: 'Audience', hint: 'Swimlanes: customers, staff, owner, developers, machine' },
  { id: 'sitemap', label: 'Site map', hint: 'Hub in front, sections in an arc, pages behind each section' },
  { id: 'compare', label: 'Compare', hint: 'Clients as rows × sections as columns' },
  { id: 'devices', label: 'Devices', hint: 'Phone, tablet and desktop pages in three bands' },
]);
export const FLOW_IDS = Object.freeze(FLOWS.map((f) => f.id));
export const flowById = (id) => FLOWS.find((f) => f.id === id) || null;

/** Spacing in world units: page pitch along x, row pitch along z, extra gap between sections, the narrower section header. */
export const GAP = Object.freeze({ x: 10.5, z: 9, section: 2.5, header: 6.5, blueprint: 11.5 });

const isPage = (it) => it.type === 'hub-page';
const isBlueprint = (it) => it.type === 'hub-blueprint';
const isHeader = (it) => it.type === 'hub-section';
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v) => String(v ?? '');
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

export function layoutFlow(flowId, items, { origin = [0, 0] } = {}) {
  const fn = LAYOUTS[flowId] || LAYOUTS.delivery;
  const out = new Map();
  const put = (it, x, z) => out.set(it.uid, [+x.toFixed(3), null, +z.toFixed(3)]);
  fn(items.filter((it) => it && it.uid), put, origin[0], origin[1]);
  // anything the preset did not place (unknown types) lands in a tidy column on the far left
  let k = 0;
  for (const it of items) if (it?.uid && !out.has(it.uid)) put(it, origin[0] - 2 * GAP.blueprint, origin[1] + (k++) * 6);
  return out;
}

const LAYOUTS = {
  delivery(items, put, ox, oz) {
    const clients = clientOrder(items);
    const pages = groupBy(sortPages(items.filter(isPage)), (p) => str(p.params.client).trim());
    const bps = groupBy(items.filter(isBlueprint), (b) => str(b.params.slug).trim());
    const heads = groupBy(items.filter(isHeader), (h) => str(h.params.client).trim());
    clients.forEach((c, row) => {
      const z = oz + row * GAP.z; let x = ox;
      for (const b of bps.get(c) || []) { put(b, x, z); x += GAP.blueprint; }
      let section = null;
      const headers = new Map((heads.get(c) || []).map((h) => [h.params.section, h]));
      for (const p of pages.get(c) || []) {
        if (p.params.section !== section) {
          if (section !== null) x += GAP.section;
          section = p.params.section;
          const h = headers.get(section); if (h) { put(h, x - 1.5, z); x += GAP.header; headers.delete(section); }
        }
        put(p, x, z); x += GAP.x;
      }
      for (const h of headers.values()) { put(h, x, z); x += GAP.header; }   // headers of sections without pages trail the row
    });
  },
  audience(items, put, ox, oz) {
    const pages = sortPages(items.filter(isPage));
    const lanes = AUDIENCES.filter((a) => pages.some((p) => p.params.audience === a));
    for (const p of pages) if (!lanes.includes(p.params.audience)) lanes.push(p.params.audience || 'everyone');
    const byLane = groupBy(pages, (p) => (lanes.includes(p.params.audience) ? p.params.audience : 'everyone'));
    lanes.forEach((a, row) => { const z = oz + row * GAP.z; (byLane.get(a) || []).forEach((p, k) => put(p, ox + k * GAP.x, z)); });
    // section headers at the start of their audience's lane; blueprints one column further left
    const headsByLane = groupBy(items.filter(isHeader), (h) => { const s = PHASES.find((x) => x.id === h.params.section); return s && lanes.includes(s.audience) ? s.audience : lanes[0] || 'everyone'; });
    lanes.forEach((a, row) => (headsByLane.get(a) || []).forEach((h, k) => put(h, ox - GAP.header - k * GAP.header, oz + row * GAP.z)));
    const maxHeads = Math.max(0, ...lanes.map((a) => (headsByLane.get(a) || []).length));
    items.filter(isBlueprint).forEach((b, i) => put(b, ox - GAP.header * Math.max(1, maxHeads) - GAP.blueprint, oz + i * GAP.z));
  },
  sitemap(items, put, ox, oz) {
    const pages = sortPages(items.filter(isPage));
    const hubs = pages.filter((p) => p.params.section === 'hub');
    hubs.forEach((p, k) => put(p, ox + (k - (hubs.length - 1) / 2) * GAP.x, oz));
    items.filter(isBlueprint).forEach((b, i) => put(b, ox - ((hubs.length || 1) + 1) / 2 * GAP.x - GAP.blueprint * 0.5 - i * GAP.blueprint, oz));
    const rest = pages.filter((p) => p.params.section !== 'hub');
    const heads = groupBy(items.filter(isHeader), (h) => h.params.section);
    const sections = PHASES.filter((s) => s.id !== 'hub' && (rest.some((p) => p.params.section === s.id) || heads.has(s.id)));
    const bySection = groupBy(rest, (p) => p.params.section);
    const n = sections.length;
    sections.forEach((s, i) => {
      const x = ox + (i - (n - 1) / 2) * GAP.x;
      const dx = x - ox;
      const zTop = oz - 1.4 * GAP.z - 0.006 * dx * dx;   // the arc: outer sections sit a little further back
      let k = 0;
      for (const h of heads.get(s.id) || []) put(h, x, zTop - (k++) * GAP.z);
      for (const p of bySection.get(s.id) || []) put(p, x, zTop - (k++) * GAP.z);
    });
    for (const [sid, list] of heads) if (!sections.some((s) => s.id === sid)) list.forEach((h, k) => put(h, ox - 2 * GAP.blueprint, oz - k * 6));
  },
  compare(items, put, ox, oz) {
    const clients = clientOrder(items);
    const pages = sortPages(items.filter(isPage));
    const heads = groupBy(items.filter(isHeader), (h) => h.params.section);
    const sections = PHASES.filter((s) => pages.some((p) => p.params.section === s.id) || heads.has(s.id));
    const cell = new Map();   // `${client}|${section}` → pages
    for (const p of pages) { const k = `${str(p.params.client).trim()}|${p.params.section}`; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(p); }
    // column x: as wide as the busiest cell of that section
    const colX = new Map(); let x = ox;
    for (const s of sections) { const width = Math.max(1, ...clients.map((c) => (cell.get(`${c}|${s.id}`) || []).length)); colX.set(s.id, x); x += width * GAP.x + GAP.section; }
    const headerRow = heads.size ? 1 : 0;
    sections.forEach((s) => (heads.get(s.id) || []).forEach((h, k) => put(h, colX.get(s.id) + k * GAP.header, oz)));
    const bps = groupBy(items.filter(isBlueprint), (b) => str(b.params.slug).trim());
    clients.forEach((c, r) => {
      const z = oz + (r + headerRow) * GAP.z;
      (bps.get(c) || []).forEach((b, k) => put(b, ox - GAP.blueprint * (k + 1), z));
      for (const s of sections) (cell.get(`${c}|${s.id}`) || []).forEach((p, k) => put(p, colX.get(s.id) + k * GAP.x, z));
    });
    for (const [sid, list] of heads) if (!sections.some((s) => s.id === sid)) list.forEach((h, k) => put(h, ox - 2 * GAP.blueprint, oz - (k + 1) * 6));
  },
  devices(items, put, ox, oz) {
    const pages = sortPages(items.filter(isPage));
    const clients = clientOrder(items);
    const byClient = (p) => clients.indexOf(str(p.params.client).trim());
    const band = (d) => (d === 'phone' ? 0 : d === 'tablet' ? 1 : 2);
    const bands = [[], [], []];
    for (const p of pages) bands[band(p.params.device)].push(p);
    bands.forEach((list, row) => list.sort((a, b) => byClient(a) - byClient(b)).forEach((p, k) => put(p, ox + k * GAP.x, oz + row * GAP.z)));
    items.filter(isBlueprint).forEach((b, i) => put(b, ox - GAP.blueprint, oz + i * GAP.z));
    items.filter(isHeader).forEach((h, i) => put(h, ox - GAP.blueprint - GAP.header - 1, oz + i * 6));
  },
};

/** Bounding box of a layout result: { minX, maxX, minZ, maxZ, cx, cz }. */
export function layoutBounds(map) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [, [x, , z]] of map) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, cx: 0, cz: 0 };
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}
