// Kanban Board — a standing 3D board: translucent column panels side by side on a plinth, cards
// as small slabs stacked top-down inside their column (title, priority stripe, assignee chip,
// due date, tag pills, checklist progress, lock glyph when blocked), a "+" tile at the foot of
// every column, dashed arcs for card dependencies. Cards are child pickables: click selects one
// (the panel shows the card editor), drag moves it to another column / position with a ghost and
// a drop slot, drop it on a Person block to assign it. Double-click a card title or a column title
// to rename it where it is; a click on a column's "+" tile types the new card's title in place.
//
// Relationships, not just values: People plugged into the `people` slot (a multi input that
// grows one slot per person) change how the board is laid out — `people view` highlights their
// cards, filters to them, or draws a swimlane per person (the board grows taller for the lanes);
// dropping a card into another person's lane re-assigns it. A Milestone on the `milestone` input
// shows in the header with its countdown and flags every card due after it. `add task` / `move
// task` events mutate the board; `when a card moves` / `when a card is done` pulse out; `progress`
// (stats) and `tasks` (the cards) feed dashboards, timelines and people.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, states, sizes, hex, setLabelText, materials } from '../../theme.js';
import { roundRect, font, drawChip, fitLine, tabular, bitmapFor } from '../../faces.js';
import { panelGeometry, slabGeometry, outlineGeometry } from '../../geometry.js';
import {
  normalizeBoard, boardStats, flatCards, pushBurndown, addCard, moveCard, updateCard, updateColumn, findCard, findColumn, isBlocked, isOverdue,
  initials, checklistRatio, PRIORITY_COLOURS, fmtDate, lastColumn, daysUntil, coverRecord,
} from '../../pm/model.js';
import { commitBoard } from '../../pm/board-ops.js';
import { buildBoardPanel } from '../../pm/panel-pm.js';
import { connectedPeople, personFor, sameName } from '../../pm/relations.js';
import { makeCanvasPlane } from '../../shape3d.js';

/* ---------------- geometry constants (scene units, 1 = 10 cm) ---------------- */
const COL_W = 3.4, COL_GAP = 0.3, MARGIN = 1.5, TOP = 1.0, COL_H = 6.6, PLINTH = 0.3, DEPTH = 0.6, BACK_D = 0.24;
const CARD_W = COL_W - 0.4, CARD_H = 1.15, CARD_D = 0.1, CARD_GAP = 0.14, ADD_H = 0.42, CARD_Z = 0.14, CARD_R = 0.12;
const LANE_MIN = 2.0;                                   // a swimlane fits one card and its label
const H0 = TOP + 0.25 + COL_H + PLINTH + 0.25;         // base height: the body grows upward from here for lanes
const UNASSIGNED = '__unassigned__';

const boardOf = (x) => normalizeBoard(x && x.params ? x.params.board : null);
const columnsOf = (defOrNode) => (defOrNode.params ? boardOf(defOrNode).columns.length : 4);
/** How connected people show: 'auto' = swimlanes for 2+, highlight for 1. */
function peopleMode(node) {
  const people = node.params ? connectedPeople(node) : [];
  const v = node.params?.peopleView || 'auto';
  if (!people.length) return { mode: v === 'swimlanes' ? 'swimlanes' : 'none', people };
  if (v === 'auto') return { mode: people.length >= 2 ? 'swimlanes' : 'highlight', people };
  return { mode: v, people };
}
/** Lane definitions for swimlane mode: one per connected person (cable order) plus "unassigned" at the bottom. */
function laneDefs(node) {
  const { mode, people } = peopleMode(node);
  if (mode !== 'swimlanes') return null;
  return [...people.map((p) => ({ key: p.uid, name: String(p.params.name), colour: p.params.colour || '#5aa9ff', person: p })), { key: UNASSIGNED, name: people.length ? 'Unassigned / others' : 'All cards', colour: '#6f8bb0', person: null }];
}
const colHeightFor = (lanes) => (lanes ? Math.max(COL_H, lanes.length * LANE_MIN) : COL_H);
const dims = (defOrNode) => {
  const n = Math.max(1, columnsOf(defOrNode));
  const colH = colHeightFor(defOrNode.params ? laneDefs(defOrNode) : null);
  return { width: 2 * MARGIN + n * COL_W + (n - 1) * COL_GAP, height: TOP + 0.25 + colH + PLINTH + 0.25, depth: DEPTH };
};
/** Frame geometry from the node's current size: the bottom is anchored at −H0/2 so a taller board grows upward. */
const layout = (node) => {
  const H = node.height, W = node.width, n = boardOf(node).columns.length;
  const colH = node._colH ?? COL_H;
  const bottom = -H0 / 2, top = bottom + H;
  const colTop = top - TOP - 0.25;
  return { W, H, n, top, bottom, centreY: bottom + H / 2, colH, colTop, colBottom: colTop - colH, firstX: -W / 2 + MARGIN + COL_W / 2, colX: (i) => -W / 2 + MARGIN + COL_W / 2 + i * (COL_W + COL_GAP) };
};
/** Card slot centres for `count` cards under `top` within `avail` units (spacing shrinks so a tall stack still fits). */
function slots(count, top, avail) {
  const step = count <= 1 ? CARD_H + CARD_GAP : Math.max(0.3, Math.min(CARD_H + CARD_GAP, (avail - CARD_H) / (count - 1)));
  return { step, y: (i) => top - CARD_H / 2 - i * step };
}
/** Colour for an assignee: a Person component's colour when one matches, else a stable hue. */
function assigneeColour(node, name) {
  if (!name) return null;
  const person = personFor(node, name);
  if (person) return person.params.colour;
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 55%)`;
}

/* ---------------- card face (2D canvas on the slab) ---------------- */
export function drawCard(g, w, h, card, { blocked = false, overdue = false, selected = false, hovered = false, colour = null, done = false, tag = null, flag = false, editing = false } = {}) {
  // the card body is the extruded slab itself: paint edge to edge, the geometry rounds the corners
  g.clearRect(0, 0, w, h);
  g.fillStyle = hex(palette.pmCard); g.fillRect(0, 0, w, h);
  // priority as a 3-px stripe down the left edge; a connected person's colour as a hairline along the top
  g.fillStyle = PRIORITY_COLOURS[card.priority] || PRIORITY_COLOURS.medium; g.fillRect(0, 0, 7, h);
  if (tag) { g.fillStyle = tag; g.fillRect(7, 0, w - 7, 5); }
  if (selected || hovered) { g.strokeStyle = hex(selected ? states.selected : states.hover); g.lineWidth = selected ? 4 : 2.5; roundRect(g, 2, 2, w - 4, h - 4, 12); g.stroke(); }
  const text = palette.pmCardText, dim = palette.pmCardDim;
  const P = 22;
  // cover: a rounded thumbnail on the right (a generated key visual, an attached image)
  let coverW = 0;
  if (card.cover && card.cover.src) {
    const cs = h - 24, cx = w - 12 - cs, cy = 12;
    coverW = cs + 12;
    const bmp = card.cover.kind !== 'audio' ? bitmapFor(card.cover.src, card.cover) : null;
    g.save(); roundRect(g, cx, cy, cs, cs, 10); g.clip();
    g.fillStyle = 'rgba(128,140,160,0.18)'; g.fillRect(cx, cy, cs, cs);
    if (bmp) { const bw = bmp.width || bmp.naturalWidth || 1, bh = bmp.height || bmp.naturalHeight || 1; const sc = Math.max(cs / bw, cs / bh); g.drawImage(bmp, cx + (cs - bw * sc) / 2, cy + (cs - bh * sc) / 2, bw * sc, bh * sc); }
    else { g.strokeStyle = dim; g.lineWidth = 1.5; g.setLineDash([4, 4]); roundRect(g, cx + 4, cy + 4, cs - 8, cs - 8, 8); g.stroke(); g.setLineDash([]); }
    if (card.cover.kind === 'video') { g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(cx + cs / 2, cy + cs / 2, cs * 0.2, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx + cs / 2 - cs * 0.07, cy + cs / 2 - cs * 0.1); g.lineTo(cx + cs / 2 + cs * 0.11, cy + cs / 2); g.lineTo(cx + cs / 2 - cs * 0.07, cy + cs / 2 + cs * 0.1); g.closePath(); g.fill(); }
    g.restore();
  }
  // title (up to 2 lines)
  g.fillStyle = done ? dim : text; g.font = font(25, 600); g.textBaseline = 'top'; g.textAlign = 'left';
  const maxW = w - P - 18 - (blocked ? 34 : 0) - (flag ? 26 : 0) - coverW;
  const words = card.title.split(' '); const lines = []; let line = '';
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = wd; } if (lines.length === 2) break; }
  if (lines.length < 2) lines.push(line);
  if (lines.length > 2) lines.length = 2;
  if (words.join(' ') !== lines.join(' ')) lines[1] = fitLine(g, lines[1], maxW);
  if (!editing) lines.forEach((l, i) => g.fillText(l, P, 16 + i * 30));   // the inline editor sits over the title while it is edited
  if (done && !editing) { g.strokeStyle = dim; g.lineWidth = 1.5; g.beginPath(); g.moveTo(P, 29); g.lineTo(P + Math.min(maxW, g.measureText(lines[0]).width), 29); g.stroke(); }
  // lock glyph when blocked, small flag when due after the milestone
  let gx = w - 34 - coverW;
  if (blocked) {
    const x = gx, y = 16; g.strokeStyle = PRIORITY_COLOURS.urgent; g.lineWidth = 2.5; g.fillStyle = PRIORITY_COLOURS.urgent;
    g.beginPath(); g.arc(x + 9, y + 7, 6, Math.PI, 0); g.stroke(); roundRect(g, x, y + 7, 18, 13, 3); g.fill();
    gx -= 26;
  }
  if (flag) {
    const x = gx + 4, y = 14; g.fillStyle = '#ffd36b'; g.strokeStyle = '#ffd36b'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 22); g.stroke();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 15, y + 5); g.lineTo(x, y + 10); g.closePath(); g.fill();
  }
  // bottom row: assignee chip · due · checklist · tags · estimate
  const by = h - 38, ch = 24;
  let x = P;
  if (card.assignee) {
    const c = colour || '#6f8bb0';
    g.fillStyle = c; g.beginPath(); g.arc(x + ch / 2, by + ch / 2, ch / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = font(11, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials(card.assignee), x + ch / 2, by + ch / 2 + 0.5);
    x += ch + 10;
  }
  g.textAlign = 'left'; g.textBaseline = 'middle'; tabular(g);
  if (card.due) {
    const late = overdue && !done;
    g.fillStyle = late ? PRIORITY_COLOURS.urgent : dim; g.font = font(15, late ? 600 : 500);
    const s2 = (late ? '! ' : '') + fmtDate(card.due); g.fillText(s2, x, by + ch / 2); x += g.measureText(s2).width + 14;
  }
  const ratio = checklistRatio(card);
  if (!Number.isNaN(ratio)) {
    const done2 = card.checklist.filter((i) => i.done).length;
    g.fillStyle = dim; g.font = font(13, 500); const s2 = `${done2}/${card.checklist.length}`; g.fillText(s2, x, by + ch / 2); x += g.measureText(s2).width + 6;
    g.fillStyle = 'rgba(128,140,160,0.3)'; roundRect(g, x, by + ch / 2 - 3, 40, 6, 3); g.fill();
    g.fillStyle = ratio >= 1 ? PRIORITY_COLOURS.medium : hex(palette.pmToday); roundRect(g, x, by + ch / 2 - 3, Math.max(6, 40 * ratio), 6, 3); g.fill(); x += 50;
  }
  for (const tag2 of card.tags || []) {
    g.font = font(12, 600); const tw = g.measureText(tag2).width + 16;
    if (x + tw > w - 14 - coverW - (card.estimate ? 30 : 0)) break;
    x += drawChip(g, tag2, x, by + (ch - 20) / 2, { h: 20, size: 12, bg: 'rgba(90,169,255,0.14)', color: hex(palette.pmToday), padX: 8 }) + 6;
  }
  if (card.estimate && x < w - 50 - coverW) { g.fillStyle = dim; g.font = font(13, 500); g.textAlign = 'right'; g.fillText(`${card.estimate}d`, w - 14 - coverW, by + ch / 2); }
}

/* ---------------- the 3D body ---------------- */
const body3d = {
  dims,
  titleAt: (node) => [-layout(node).W / 2 + 0.6, layout(node).top - TOP / 2 - 0.02, DEPTH / 2 + 0.05],
  titleAlign: 'left', titleColor: 'text',
  /**
   * Ports sit level with what they change (shape3d.js → alignPorts): `people` with the first
   * swimlane header (or the column header row while there are no lanes), `milestone` with the
   * header line that shows it, `cover` with the top card, `move task` with the cards, `add task`
   * with the "+" tiles; `progress` with the column counts, `when a card is done` with the top
   * card slot, `when a card moves` and `tasks` with the cards.
   */
  portAnchors(node) {
    const L = layout(node);
    const lanes = laneDefs(node);
    const laneAreaTop = L.colTop - 0.95, laneAreaH = L.colH - 0.95 - ADD_H - 0.3;
    const cards = laneAreaTop - laneAreaH / 2, topCard = laneAreaTop - CARD_H / 2;
    return {
      in: { people: lanes ? laneAreaTop - 0.19 : L.colTop - 0.42, milestone: L.top - TOP / 2 - 0.08, cover: topCard, moveTask: cards, addTask: L.colBottom + 0.15 + ADD_H / 2 },
      out: { progress: L.colTop - 0.42, done: topCard, moved: cards, tasks: cards - 0.2 },
    };
  },
  /**
   * Editable regions (ui/field-editor.js), body units: every card's title and every column's title
   * (double-click; presses and drags still move cards and select columns) and each "+" tile, where
   * a click types the new card's title. Writes go through `commitBoard` (undoable) and select the card.
   */
  fields(node) {
    const L = layout(node), out = [];
    const write = (res, label, api, sub) => { if (!commitBoard(node, api.history, res, label)) return; if (sub) node.selectSub(sub, api.selection); };
    boardOf(node).columns.forEach((col, ci) => {
      const cx = L.colX(ci);
      out.push({ id: `col:${col.id}`, kind: 'text', label: 'column title', mode: 'through', sub: { kind: 'column', id: col.id }, local: { x: cx - COL_W / 2 + 0.22 + (COL_W - 1.3) / 2, y: L.colTop - 0.42, w: COL_W - 1.3, h: 0.34, z: 0.1 }, font: { labelSize: 0.19, weight: 600, align: 'left' }, get: () => findColumn(boardOf(node), col.id)?.title || '', set: (v, api) => { const t = String(v).trim(); if (t) write(updateColumn(boardOf(node), col.id, { title: t }), 'Rename column', api, { kind: 'column', id: col.id }); } });
      out.push({ id: `add:${col.id}`, kind: 'text', label: 'new card', mode: 'open', placeholder: 'New card', local: { x: cx, y: L.colBottom + 0.15 + ADD_H / 2, w: CARD_W, h: ADD_H, z: 0.1 }, font: { size: 20, weight: 600, align: 'center' }, get: () => '', set: (v, api) => { const t = String(v).trim(); if (!t) return; const res = addCard(boardOf(node), col.id, { title: t }); write(res, 'Add card', api, { kind: 'card', id: res.card.id }); } });
    });
    for (const [id, e] of node._cards) {
      if (!e.group.visible) continue;
      const p = e.group.position, P = 22 / sizes.face.pxPerUnit, tw = CARD_W - (22 + 18) / sizes.face.pxPerUnit;
      out.push({ id: `card:${id}`, kind: 'text', label: 'card title', mode: 'through', sub: { kind: 'card', id }, local: { x: p.x - CARD_W / 2 + P + tw / 2, y: p.y + CARD_H / 2 - (16 + 30) / sizes.face.pxPerUnit, w: tw, h: 0.5, z: p.z + CARD_D / 2 }, font: { size: 25, weight: 600, align: 'left', color: palette.pmCardText }, bg: hex(palette.pmCard), get: () => findCard(boardOf(node), id)?.card.title || '', set: (v, api) => { const t = String(v).trim(); if (t) write(updateCard(boardOf(node), id, { title: t }), 'Rename card', api, { kind: 'card', id }); } });
    }
    return out;
  },
  build(node, h) {
    node._colH = COL_H;
    node.frame = new THREE.Group(); node.add(node.frame);
    body3d._buildFrame(node, h);
    node.rim = h.rim(outlineGeometry(node.width, node.height, BACK_D, sizes.outline.grow, { radius: 0.36 }).translate(0, layout(node).centreY, -BACK_D / 2 + 0.01));
    node._cards = new Map();      // card id → { group, plane, slab }
    node._drag = null;
    node._lodFar = false;
    node._lanes = null;
    // milestone readout in the header (right side)
    node.msLabel = h.label('', { size: 0.22, color: 'textDim', weight: 500, maxWidth: node.width * 0.4 }, [0, 0, DEPTH / 2 + 0.05], { detail: true });
    node.msLabel.visible = false;
    // drop-slot indicator (shown while dragging a card)
    node.slot = new THREE.Mesh(panelGeometry(CARD_W, CARD_H, 0.03, { radius: CARD_R, bevel: 0 }), new THREE.MeshBasicMaterial({ color: states.selected, transparent: true, opacity: 0.28, depthWrite: false }));
    node.slot.visible = false; node.add(node.slot);
  },
  _buildFrame(node, h) {
    const L = layout(node);
    const { W, H } = L;
    const f = node.frame;
    node.meshes = node.meshes.filter((m) => !f.children.includes(m));
    node.themed = node.themed.filter(([m]) => !f.children.includes(m));
    while (f.children.length) { const c = f.children.pop(); c.geometry?.dispose(); c.material?.dispose(); }
    // backing panel (extruded, bevelled), a slim accent line along its top edge, a flat plinth it stands on
    const back = h.part(panelGeometry(W, H, BACK_D, { radius: 0.36 }), h.materials.body(), { parent: f, theme: () => palette.body });
    back.position.set(0, L.centreY, -BACK_D / 2 + 0.01);
    const accent = h.part(new THREE.BoxGeometry(W - 1.2, 0.045, 0.012), h.materials.accent(node.headerColor()), { parent: f, theme: node.headerColor, pick: false });
    accent.position.set(0, L.top - 0.1, 0.03);
    const plinth = h.part(slabGeometry(W + 0.2, 1.5, PLINTH, { radius: 0.24, bevel: 0.02 }), h.materials.body(), { parent: f, theme: () => palette.body });
    plinth.position.set(0, L.bottom + PLINTH / 2 - 0.02, 0.25);
    node.header = accent;
  },
  /** Rebuild the data-driven children: columns, lanes, cards, add tiles, dependency arcs, LOD bars. */
  refresh(node) {
    const board = boardOf(node);
    node.params.board = board;
    const lanes = laneDefs(node);
    node._lanes = lanes;
    const { mode, people } = peopleMode(node);
    node._peopleMode = mode;
    const d = dims(node);
    if (Math.abs(d.width - node.width) > 1e-6 || Math.abs(d.height - node.height) > 1e-6) body3d._resize(node, d);
    else if ((lanes ? lanes.length : 0) !== node._laneCount) node.layoutPorts();   // lanes appeared or went: the people slot follows the lane header
    node._laneCount = lanes ? lanes.length : 0;
    node.clearChildren();
    node._cards = new Map();
    const L = layout(node);
    const sel = node.subSelection, hov = node.hoveredSub;
    const dragging = node._drag;
    node._colBars = [];
    const ms = node.rt?.inputs?.milestone;
    const msDate = ms && ms.date ? String(ms.date).slice(0, 10) : null;
    const mine = (card) => people.some((p) => sameName(p.params.name, card.assignee));
    const laneOf = (card) => { if (!lanes) return null; const i = lanes.findIndex((l) => l.person && sameName(l.name, card.assignee)); return i >= 0 ? i : lanes.length - 1; };
    // lanes: horizontal bands across every column; each starts with a rule in the person's colour
    // and a "MC · Maya" header inside the first column (the left margin belongs to the port labels)
    const LANE_HEAD = 0.38;
    const laneAreaTop = L.colTop - 0.95, laneAreaH = L.colH - 0.95 - ADD_H - 0.3;
    const laneH = lanes ? laneAreaH / lanes.length : 0;
    if (lanes) {
      const x0 = L.colX(0) - COL_W / 2, x1 = L.colX(L.n - 1) + COL_W / 2;
      node._laneBoxes = lanes.map((ln, i) => ({ ...ln, top: laneAreaTop - i * laneH, bottom: laneAreaTop - (i + 1) * laneH }));
      node._laneBoxes.forEach((ln) => {
        const rule = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(ln.colour), transparent: true, opacity: ln.person ? 0.7 : 0.35 }));
        rule.position.set((x0 + x1) / 2, ln.top - 0.02, 0.1); node.children3d.add(rule);
        // swimlane label as a subtle side tab in the left margin
        const text = ln.person ? ln.name.split(' ')[0] : ln.name;
        const tab = new THREE.Mesh(panelGeometry(MARGIN - 0.5, LANE_HEAD - 0.06, 0.04, { radius: 0.08, bevel: 0.006 }), new THREE.MeshBasicMaterial({ color: new THREE.Color(ln.colour), transparent: true, opacity: ln.person ? 0.22 : 0.12 }));
        tab.position.set(x0 - COL_GAP - (MARGIN - 0.5) / 2 + 0.1, ln.top - LANE_HEAD / 2, 0.1); node.children3d.add(tab);
        node.childLabel(text, { size: 0.15, color: ln.person ? ln.colour : 'textDim', weight: 600, caps: true, spacing: 0.06, maxWidth: MARGIN - 0.7 }, [tab.position.x, ln.top - LANE_HEAD / 2 - 0.005, 0.13]);
        if (ln.person) { const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(ln.colour) })); dot.position.set(x0 + 0.12, ln.top - 0.02, 0.12); node.children3d.add(dot); }
      });
    } else node._laneBoxes = null;
    board.columns.forEach((col, ci) => {
      const cx = L.colX(ci);
      // translucent column panel (a sub: click selects the column in the panel)
      // frosted column panel with a thin divider look (a sub: click selects the column in the panel)
      const panel = new THREE.Mesh(panelGeometry(COL_W, L.colH, 0.06, { radius: 0.18, bevel: 0.008 }), materials.frosted());
      panel.position.set(cx, L.colTop - L.colH / 2, 0.04);
      panel.renderOrder = 0;
      if (sel?.kind === 'column' && sel.id === col.id) { panel.material.emissive = new THREE.Color(states.selected); panel.material.emissiveIntensity = 0.2; }
      node.childSub(panel, { kind: 'column', id: col.id });
      const over = col.wipLimit && col.cards.length > col.wipLimit;
      const shown = mode === 'filter' ? col.cards.filter(mine) : col.cards;
      // column title in small caps + a count pill at the right
      const title = node.childLabel(col.title, { size: 0.19, color: 'text', weight: 600, caps: true, spacing: 0.08, maxWidth: COL_W - 1.3 }, [0, L.colTop - 0.42, 0.1]);
      title.position.x = cx - COL_W / 2 + 0.22 + title.userData.worldW / 2;
      if (node._editing === `col:${col.id}`) title.visible = false;   // the inline editor sits over it
      const countText = mode === 'filter' ? `${shown.length} of ${col.cards.length}` : `${col.cards.length}${col.wipLimit ? ' / ' + col.wipLimit : ''}`;
      const count = node.childLabel(countText, { size: 0.18, color: over ? '#ff5c6c' : 'textDim', weight: 600 }, [0, L.colTop - 0.42, 0.11]);
      const pillW = count.userData.worldW + 0.26;
      const pill = new THREE.Mesh(panelGeometry(pillW, 0.32, 0.02, { radius: 0.16, bevel: 0, curveSegments: 8 }), new THREE.MeshBasicMaterial({ color: over ? 0xff5c6c : palette.pmCard, transparent: true, opacity: over ? 0.25 : 0.9 }));
      pill.position.set(cx + COL_W / 2 - 0.22 - pillW / 2, L.colTop - 0.42, 0.08); node.children3d.add(pill);
      count.position.x = pill.position.x;
      count.userData.isCount = true; pill.userData.isCount = true;
      // a hairline under the column header
      const rule = new THREE.Mesh(new THREE.PlaneGeometry(COL_W - 0.36, 0.012), new THREE.MeshBasicMaterial({ color: palette.textDim, transparent: true, opacity: 0.35, depthWrite: false }));
      rule.position.set(cx, L.colTop - 0.72, 0.08); node.children3d.add(rule);
      // card positions: one stack per column, or one stack per lane cell
      const place = new Map();   // card id → y
      if (lanes) {
        node._laneBoxes.forEach((ln, li) => {
          const cell = shown.filter((c) => laneOf(c) === li);
          const S = slots(cell.length, ln.top - LANE_HEAD, laneH - LANE_HEAD - 0.14);
          cell.forEach((c, i) => place.set(c.id, S.y(i)));
        });
      } else {
        const S = slots(shown.length, laneAreaTop, laneAreaH);
        shown.forEach((c, i) => place.set(c.id, S.y(i)));
      }
      col.cards.forEach((card, i) => {
        if (!place.has(card.id)) return;   // filtered out
        const group = new THREE.Group();
        group.position.set(cx, place.get(card.id), CARD_Z + CARD_D / 2 - i * 0.008);
        // one extruded card: the canvas is the front cap's texture (UVs map it exactly), the sides are plain
        const plane = makeCanvasPlane(CARD_W, CARD_H, { emissive: 0.4, owner: node });
        const faceMat = new THREE.MeshPhysicalMaterial({ map: plane.texture, emissive: 0xffffff, emissiveMap: plane.texture, emissiveIntensity: 0.35, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.3, transparent: true, opacity: 1 });
        const sideMat = materials.panel(palette.pmCard, { transparent: true, opacity: 1 });
        const slab = new THREE.Mesh(panelGeometry(CARD_W, CARD_H, CARD_D, { radius: CARD_R, bevel: 0.012 }), [faceMat, sideMat]);
        const sub = { kind: 'card', id: card.id, column: col.id, index: i };
        node.childSub(slab, sub);
        group.add(slab);
        node.children3d.add(group);
        const person = personFor(node, card.assignee);
        const linked = !!person && people.includes(person);
        const entry = { group, plane, slab, card, column: col, index: i, dim: mode === 'highlight' && people.length > 0 && !linked, tag: linked ? person.params.colour : null, flag: !!(msDate && card.due && card.due > msDate && col !== lastColumn(board)) };
        node._cards.set(card.id, entry);
        body3d._paintCard(node, entry, board);
        if (sel?.kind === 'card' && sel.id === card.id) group.position.z += 0.08;
        if (dragging && dragging.id === card.id) group.visible = false;
      });
      // "+" tile
      const add = new THREE.Mesh(panelGeometry(CARD_W, ADD_H, 0.05, { radius: 0.1, bevel: 0.006 }), materials.frosted(palette.pmCard, 0.45));
      add.position.set(cx, L.colBottom + 0.15 + ADD_H / 2, 0.1);
      node.childSub(add, { kind: 'add', id: col.id });
      const plus = node.childLabel('+', { size: 0.3, color: 'textDim', weight: 500 }, [cx, L.colBottom + 0.15 + ADD_H / 2, 0.14], true);
      if (node._editing === `add:${col.id}`) plus.userData.alpha = 0;
      // far-LOD bar: card count as a column of colour
      const bh = Math.min(L.colH - 1.6, 0.35 + col.cards.length * 0.55);
      const bar = new THREE.Mesh(panelGeometry(COL_W * 0.55, bh, 0.16, { radius: 0.2 }), materials.panel(node.headerColor(), { emissive: node.headerColor(), emissiveIntensity: 0.3 }));
      bar.position.set(cx, L.colBottom + 0.7 + bh / 2, 0.1);
      bar.visible = false; node.children3d.add(bar); node._colBars.push(bar);
      const big = node.childLabel(String(col.cards.length), { size: 0.9, color: 'text', weight: 700 }, [cx, L.colTop - 1.3, 0.2]);
      big.visible = false; node._colBars.push(big);
    });
    // dependency arcs: blocker → blocked
    if (node.params.showArcs !== false) for (const [, e] of node._cards) {
      for (const bid of e.card.blockedBy || []) {
        const from = node._cards.get(bid); if (!from) continue;
        const a = from.group.position, b = e.group.position;
        const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.3, 0.9);
        const curve = new THREE.QuadraticBezierCurve3(a.clone().setZ(0.3), mid, b.clone().setZ(0.3));
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: PRIORITY_COLOURS.urgent, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.85 }));
        line.computeLineDistances();
        node.children3d.add(line);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), new THREE.MeshBasicMaterial({ color: PRIORITY_COLOURS.urgent }));
        const end = curve.getPoint(1), tan = curve.getTangent(1);
        tip.position.copy(end).addScaledVector(tan, -0.55); tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
        node.children3d.add(tip);
      }
    }
    // milestone in the header: title + countdown; hidden when nothing is connected
    if (ms && ms.date) {
      const dl = daysUntil(ms.date);
      setLabelText(node.msLabel, `⚑ ${ms.title || 'Milestone'} · ${Number.isNaN(dl) ? fmtDate(ms.date) : dl > 0 ? `${dl} d left` : dl === 0 ? 'today' : `${-dl} d ago`}`);
      node.msLabel.visible = true;
      node.msLabel.position.set(L.W / 2 - 0.5 - node.msLabel.userData.worldW / 2, L.top - TOP / 2 - 0.08, DEPTH / 2 + 0.05);
    } else node.msLabel.visible = false;
    body3d.applyLOD(node, node.lodBlend, true);
    if (hov) node.hoveredSub = null;
  },
  _paintCard(node, entry, board) {
    const sel = node.subSelection, hov = node.hoveredSub;
    entry.plane.draw((g, w, h) => drawCard(g, w, h, entry.card, {
      blocked: isBlocked(board, entry.card), overdue: isOverdue(entry.card), done: entry.column === lastColumn(board),
      selected: sel?.kind === 'card' && sel.id === entry.card.id, hovered: hov?.kind === 'card' && hov.id === entry.card.id,
      colour: assigneeColour(node, entry.card.assignee), tag: entry.tag, flag: entry.flag, editing: node._editing === `card:${entry.card.id}`,
    }));
    // highlight view: cards of people who are not connected fade back
    const o = entry.dim ? 0.3 : 1;
    entry.slab.material.forEach((m) => { m.opacity = o; });
  },
  /** Column count or lane count changed: resize the frame, rim, shadow and move the ports. */
  _resize(node, d) {
    node.width = d.width; node.height = d.height;
    node._colH = colHeightFor(laneDefs(node));
    body3d._buildFrame(node, node._helpers());
    const L = layout(node);
    node.bodyOffsetY = L.centreY;
    node.rim.geometry.dispose(); node.rim.geometry = outlineGeometry(d.width, d.height, BACK_D, sizes.outline.grow, { radius: 0.36 }).translate(0, L.centreY, -BACK_D / 2 + 0.01);
    node.shadow.geometry.dispose(); node.shadow.geometry = new THREE.PlaneGeometry(d.width * 1.4, DEPTH * 3.2);
    node.layoutPorts();   // re-aligns the pins with the header, lanes and cards of the new frame, names beside them
    const at = body3d.titleAt(node);
    node.titleLabel.position.set(at[0] + node.titleLabel.userData.worldW / 2, at[1], at[2]);
    node._titleY = node.titleLabel.position.y; node._titleX = node.titleLabel.position.x;
    node.world?.bumpLayout();
  },
  applyLOD(node, k, force = false) {
    const far = k >= 0.5;
    if (far === node._lodFar && !force) return;
    node._lodFar = far;
    const bars = node._colBars || [];
    node.children3d.children.forEach((c) => { if (!bars.includes(c) && !c.userData.isCount) c.visible = !far || c.userData.sub?.kind === 'column'; });
    for (const l of node.labels) if (l.parent === node.children3d && !bars.includes(l)) l.visible = !far;
    (node._colBars || []).forEach((b) => { b.visible = far; });
    for (const [id, e] of node._cards) if (node._drag && node._drag.id === id) e.group.visible = false;
  },
  onSubHover(node, sub) {
    const board = boardOf(node);
    for (const [, e] of node._cards) {
      const was = e._hover, now = sub?.kind === 'card' && sub.id === e.card.id;
      if (was !== now) { e._hover = now; node.hoveredSub = sub; body3d._paintCard(node, e, board); }
    }
    node.hoveredSub = sub;
  },
  /* ---- a block dropped on a card (interaction.js): a Person assigns the card ---- */
  acceptsDrop: (node, sub, block) => sub.kind === 'card' && block.typeId === 'person',
  dropLabel: (node, sub, block) => `assign to ${block.params.name}`,
  onDropBlock(node, sub, block, ev) { body3d._assign(node, sub.id, block, ev.history, ev.selection); },
  _assign(node, cardId, person, history, selection) {
    const board = boardOf(node);
    const hit = findCard(board, cardId); if (!hit) return false;
    const name = String(person.params.name);
    if (sameName(hit.card.assignee, name)) { node.world?.overlays?.toast(`${hit.card.title} is already ${name}'s`); return false; }
    const res = updateCard(board, cardId, { assignee: name });
    commitBoard(node, history, res, 'Assign card');
    node.world?.overlays?.toast(`Assigned "${hit.card.title}" to ${name} · Ctrl+Z to undo`, 2000);
    node.selectSub({ kind: 'card', id: cardId }, selection);
    return true;
  },
  /** Person blocks under the pointer ray (a card dragged onto one is assigned to them). */
  _personUnderRay(node, ray) {
    const world = node.world; if (!world) return null;
    const rc = new THREE.Raycaster(ray.origin, ray.direction);
    const meshes = [];
    for (const n of world.nodes) if (n.typeId === 'person' && n.visible) for (const m of [n.body, n.face?.mesh]) if (m) { m.userData.__person = n; meshes.push(m); }
    const hit = rc.intersectObjects(meshes, false)[0];
    return hit ? { person: hit.object.userData.__person, point: hit.point } : null;
  },
  /** Pointer events on cards, column panels and "+" tiles. */
  onSubPointer(node, ev) {
    const board = boardOf(node);
    const sub = ev.sub;
    if (!sub) return false;
    if (ev.type === 'down') {
      if (sub.kind === 'card') {
        const e = node._cards.get(sub.id);
        if (e) node._drag = { id: sub.id, from: e.column.id, index: e.index, start: e.group.position.clone(), rot: e.group.rotation.z, target: null, person: null };
      }
      return true;
    }
    if (ev.type === 'drag' && node._drag) {
      const e = node._cards.get(node._drag.id); if (!e) return true;
      const D = node._drag;
      // over a Person block? the card leaves the board and the person lights up as the drop target
      const over = body3d._personUnderRay(node, ev.ray);
      if (D.person !== (over?.person || null)) { D.person?.setDropTarget(false); D.person = over?.person || null; D.person?.setDropTarget(true); }
      if (over) {
        const local = node.worldToLocal(over.point.clone());
        e.group.position.set(local.x, local.y, local.z + 0.3); e.group.rotation.z = -0.08; e.group.visible = true;
        e.slab.material.forEach((m) => { m.opacity = 0.85; });
        node.slot.visible = false; D.target = null;
        node.world?.overlays?.dragLabel(`<b>${e.card.title}</b> → assign to ${over.person.params.name}`, ev.x || 0, ev.y || 0);
        return true;
      }
      node.world?.overlays?.dragLabel(null);
      const p = body3d._pointOnBoard(node, ev.ray); if (!p) return true;
      e.group.position.set(p.x, p.y, 0.95); e.group.rotation.z = -0.04; e.group.visible = true;
      e.slab.material.forEach((m) => { m.opacity = 0.85; });
      // target column (+ lane) + index
      const L = layout(node);
      const ci = Math.max(0, Math.min(board.columns.length - 1, Math.round((p.x - L.firstX) / (COL_W + COL_GAP))));
      const col = board.columns[ci];
      const lanes = node._laneBoxes;
      const laneAreaTop = L.colTop - 0.95, laneAreaH = L.colH - 0.95 - ADD_H - 0.3;
      if (lanes) {
        let li = lanes.findIndex((ln) => p.y <= ln.top && p.y > ln.bottom);
        if (li < 0) li = p.y > lanes[0].top ? 0 : lanes.length - 1;
        const ln = lanes[li];
        const inLane = (c) => { const i = lanes.findIndex((x) => x.person && sameName(x.name, c.assignee)); return (i >= 0 ? i : lanes.length - 1) === li; };
        const cell = col.cards.filter((c) => c.id !== D.id && inLane(c));
        const S = slots(cell.length + 1, ln.top - 0.38, laneAreaH / lanes.length - 0.38 - 0.14);
        let idx = 0; for (let i = 0; i < cell.length; i++) if (p.y < S.y(i)) idx = i + 1;
        // position inside the column: before the idx-th card of this lane cell, else after the cell's last card
        const others = col.cards.filter((c) => c.id !== D.id);
        const colIndex = idx < cell.length ? others.indexOf(cell[idx]) : cell.length ? others.indexOf(cell[cell.length - 1]) + 1 : others.length;
        D.target = { column: col.id, index: colIndex, assignee: ln.person ? ln.name : (cell.length || !others.length ? undefined : ''), lane: li };
        node.slot.visible = true; node.slot.position.set(L.colX(ci), S.y(idx), CARD_Z + 0.02);
      } else {
        const others = col.cards.filter((c) => c.id !== D.id);
        const S = slots(others.length + 1, laneAreaTop, laneAreaH);
        let idx = 0; for (let i = 0; i < others.length; i++) if (p.y < S.y(i)) idx = i + 1;   // below card i's centre → after it
        D.target = { column: col.id, index: idx };
        node.slot.visible = true; node.slot.position.set(L.colX(ci), S.y(idx), CARD_Z + 0.02);
      }
      return true;
    }
    if (ev.type === 'drop' || ev.type === 'cancel') {
      node.slot.visible = false;
      node.world?.overlays?.dragLabel(null);
      const d = node._drag; node._drag = null;
      if (!d) return true;
      d.person?.setDropTarget(false);
      const e = node._cards.get(d.id);
      if (e) { e.group.position.copy(d.start); e.group.rotation.z = d.rot; e.group.visible = true; }
      node.faceDirty = true;   // repaint: opacities, lanes, tags
      if (ev.type === 'drop' && d.person) { body3d._assign(node, d.id, d.person, ev.history, ev.selection); return true; }
      if (ev.type === 'drop' && d.target) {
        const same = d.target.column === d.from;
        const card = findCard(board, d.id)?.card;
        const reassign = d.target.assignee !== undefined && card && !sameName(card.assignee, d.target.assignee) && d.target.assignee !== '';
        let res = moveCard(board, d.id, d.target.column, d.target.index);
        if (res && reassign) { const r2 = updateCard(res.board, d.id, { assignee: d.target.assignee }); if (r2) res = { ...res, board: r2.board, card: r2.card, changed: true }; }
        if (res && (!same || res.index !== d.index || reassign)) {
          commitBoard(node, ev.history, res, reassign ? 'Move and assign card' : 'Move card');
          if (reassign) node.world?.overlays?.toast(`Assigned "${res.card.title}" to ${d.target.assignee}`, 2000);
        }
        node.selectSub({ kind: 'card', id: d.id }, ev.selection);
      }
      return true;
    }
    if (ev.type === 'click') {
      node.slot.visible = false; node._drag?.person?.setDropTarget(false); node._drag = null;
      if (sub.kind === 'card') node.selectSub({ kind: 'card', id: sub.id }, ev.selection);
      else if (sub.kind === 'column') node.selectSub({ kind: 'column', id: sub.id }, ev.selection);
      else if (sub.kind === 'add') {
        const res = addCard(board, sub.id, { title: 'New card' });
        commitBoard(node, ev.history, res, 'Add card');
        node.selectSub({ kind: 'card', id: res.card.id }, ev.selection);
      }
      return true;
    }
    return false;
  },
  /** Intersect the pointer ray with the board's front plane; returns a local-space point. */
  _pointOnBoard(node, ray) {
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld);
    const origin = node.localToWorld(new THREE.Vector3(0, 0, 0.95));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return null;
    return node.worldToLocal(hit);
  },
};

const def = registry.register({
  id: 'kanban-board', category: 'project', label: 'Kanban Board', icon: icons['kanban-board'], size: 'XL',
  description: 'A standing board with columns and draggable cards that lays out a lane per person plugged into it',
  inputs: [
    { key: 'people', label: 'people', type: 'data', subtype: 'person', multi: true, optional: true },
    { key: 'milestone', label: 'milestone', type: 'data', subtype: 'milestone', optional: true },
    { key: 'addTask', label: 'add task', type: 'event', optional: true },
    { key: 'moveTask', label: 'move task', type: 'event', optional: true },
    { key: 'cover', label: 'cover', type: 'media', optional: true },
  ],
  outputs: [
    { key: 'moved', label: 'when a card moves', type: 'event' },
    { key: 'done', label: 'when a card is done', type: 'event' },
    { key: 'progress', label: 'progress', type: 'data', subtype: 'stats' },
    { key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks' },
  ],
  params: [
    { key: 'board', label: 'board', type: 'json', default: { columns: ['To do', 'In progress', 'Review', 'Done'].map((title) => ({ title })) }, hidden: true },
    { key: 'peopleView', label: 'people view', type: 'select', options: ['auto', 'highlight', 'filter', 'swimlanes'], default: 'auto' },
    { key: 'showArcs', label: 'dependency arcs', type: 'boolean', default: true },
    { key: 'coverCard', label: 'cover → card', type: 'text', default: '' },   // title or id of the card that takes the `cover` input; empty = the first card
  ],
  body3d,
  panel: buildBoardPanel,
  onCreate(node) { node.params.board = normalizeBoard(node.params.board); },
  /** Event inputs mutate the board (not undoable: they come from the running system). */
  onEvent({ params, instance, emit }, key, pulse) {
    const board = boardOf(instance);
    const p = pulse.payload;
    if (key === 'addTask') {
      const data = typeof p === 'string' || typeof p === 'number' ? { title: String(p) } : p && typeof p === 'object' && !p.__pulse ? p : { title: `Card ${boardStats(board).total + 1}` };
      const res = addCard(board, data.column || board.columns[0].id, data);
      commitBoard(instance, null, res);
    } else if (key === 'moveTask' && p && typeof p === 'object') {
      const res = moveCard(board, p.cardId || p.id || p.card || p.title, p.column || p.to || lastColumn(board).id, Number.isFinite(+p.index) ? +p.index : -1);
      if (res) commitBoard(instance, null, res);
    }
  },
  evaluate({ params, state, instance, inputs }) {
    let board = boardOf(instance);
    // a media object on `cover` becomes the cover of the named card (or the first card); engine-driven, not undoable
    const cv = inputs.cover;
    if (cv && typeof cv.src === 'string') {
      const hit = params.coverCard ? findCard(board, params.coverCard) : (board.columns.find((c) => c.cards.length)?.cards[0] ? findCard(board, board.columns.find((c) => c.cards.length).cards[0].id) : null);
      if (hit && hit.card.cover?.src !== cv.src) { const res = updateCard(board, hit.card.id, { cover: coverRecord(cv) }); if (res) { commitBoard(instance, null, res); board = res.board; } }
    }
    const stats = boardStats(board);
    state.history = pushBurndown(state.history, stats);
    // relationships that change the layout: who is plugged into `people`, which milestone is set
    const people = connectedPeople(instance);
    const ms = inputs.milestone;
    const sig = JSON.stringify([people.map((p) => [p.uid, p.params.name, p.params.colour]), params.peopleView, ms && ms.date ? [ms.title, ms.date] : null]);
    if (sig !== instance._relSig) { instance._relSig = sig; instance.faceDirty = true; }   // on the instance: a loaded world must re-apply it
    return { progress: { ...stats, burndown: state.history }, tasks: flatCards(board) };
  },
});
export default def;
export { boardOf, layout as boardLayout, slots as cardSlots, findCard, findColumn, laneDefs, peopleMode };
