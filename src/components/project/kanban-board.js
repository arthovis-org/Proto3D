// Kanban Board — a standing 3D board: translucent column panels side by side on a plinth, cards
// as small slabs stacked top-down inside their column (title, priority stripe, assignee chip,
// due date, tag pills, checklist progress, lock glyph when blocked), a "+" tile at the foot of
// every column, dashed arcs for card dependencies. Cards are child pickables: click selects one
// (the panel shows the card editor), drag moves it to another column / position with a ghost and
// a drop slot. The board is also a running component: `add card` / `move` event inputs mutate
// it, `card moved` / `done` pulse out, `stats` and `cards` feed timelines, dashboards, people.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, states, sizes, hex } from '../../theme.js';
import { roundRect, font } from '../../faces.js';
import {
  normalizeBoard, boardStats, flatCards, pushBurndown, addCard, moveCard, findCard, findColumn, isBlocked, isOverdue,
  initials, checklistRatio, PRIORITY_COLOURS, fmtDate, lastColumn,
} from '../../pm/model.js';
import { commitBoard } from '../../pm/board-ops.js';
import { buildBoardPanel } from '../../pm/panel-pm.js';
import { makeCanvasPlane } from '../../shape3d.js';

/* ---------------- geometry constants (scene units, 1 = 10 cm) ---------------- */
const COL_W = 3.4, COL_GAP = 0.3, MARGIN = 1.5, TOP = 1.0, COL_H = 6.6, PLINTH = 0.36, DEPTH = 0.6;
const CARD_W = COL_W - 0.4, CARD_H = 1.15, CARD_D = 0.12, CARD_GAP = 0.14, ADD_H = 0.42, CARD_Z = 0.16;

const boardOf = (x) => normalizeBoard(x && x.params ? x.params.board : null);
const columnsOf = (defOrNode) => (defOrNode.params ? boardOf(defOrNode).columns.length : 4);
const dims = (defOrNode) => {
  const n = Math.max(1, columnsOf(defOrNode));
  return { width: 2 * MARGIN + n * COL_W + (n - 1) * COL_GAP, height: TOP + 0.25 + COL_H + PLINTH + 0.25, depth: DEPTH };
};
const layout = (node) => {
  const H = node.height, W = node.width, n = boardOf(node).columns.length;
  const colTop = H / 2 - TOP - 0.25;
  return { W, H, n, colTop, colBottom: colTop - COL_H, firstX: -W / 2 + MARGIN + COL_W / 2, colX: (i) => -W / 2 + MARGIN + COL_W / 2 + i * (COL_W + COL_GAP) };
};
/** Card slot centres for a column with `count` cards (spacing shrinks so a tall stack still fits). */
function slots(count, colTop) {
  const avail = COL_H - 0.95 - ADD_H - 0.3;
  const step = count <= 1 ? CARD_H + CARD_GAP : Math.min(CARD_H + CARD_GAP, (avail - CARD_H) / (count - 1));
  return { step, y: (i) => colTop - 0.95 - CARD_H / 2 - i * step };
}
/** Colour for an assignee: a Person component's colour when one matches, else a stable hue. */
function assigneeColour(node, name) {
  if (!name) return null;
  const person = node.world?.nodes.find((n) => n.typeId === 'person' && String(n.params.name).trim().toLowerCase() === String(name).trim().toLowerCase());
  if (person) return person.params.colour;
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 55%)`;
}

/* ---------------- card face (2D canvas on the slab) ---------------- */
export function drawCard(g, w, h, card, { blocked = false, overdue = false, selected = false, hovered = false, colour = null, done = false } = {}) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = hex(palette.pmCard);
  roundRect(g, 1, 1, w - 2, h - 2, 14); g.fill();
  if (selected || hovered) { g.strokeStyle = hex(selected ? states.selected : states.hover); g.lineWidth = selected ? 6 : 3; roundRect(g, 3, 3, w - 6, h - 6, 12); g.stroke(); }
  // priority stripe
  g.fillStyle = PRIORITY_COLOURS[card.priority] || PRIORITY_COLOURS.medium;
  g.save(); roundRect(g, 1, 1, w - 2, h - 2, 14); g.clip(); g.fillRect(0, 0, 12, h); g.restore();
  const text = palette.pmCardText, dim = palette.pmCardDim;
  // title (up to 2 lines)
  g.fillStyle = done ? dim : text; g.font = font(27, 600); g.textBaseline = 'top'; g.textAlign = 'left';
  const maxW = w - 30 - (blocked ? 40 : 0);
  const words = card.title.split(' '); const lines = []; let line = '';
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = wd; } if (lines.length === 2) break; }
  if (lines.length < 2) lines.push(line);
  if (lines.length > 2) lines.length = 2;
  if (words.join(' ') !== lines.join(' ')) { let l = lines[1]; while (l.length && g.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[1] = l + '…'; }
  lines.forEach((l, i) => g.fillText(l, 24, 12 + i * 32));
  if (done) { g.strokeStyle = dim; g.lineWidth = 2; g.beginPath(); g.moveTo(24, 26); g.lineTo(24 + Math.min(maxW, g.measureText(lines[0]).width), 26); g.stroke(); }
  // lock glyph when blocked
  if (blocked) {
    const x = w - 38, y = 14; g.strokeStyle = PRIORITY_COLOURS.urgent; g.lineWidth = 3; g.fillStyle = PRIORITY_COLOURS.urgent;
    g.beginPath(); g.arc(x + 11, y + 9, 7, Math.PI, 0); g.stroke(); roundRect(g, x, y + 9, 22, 16, 3); g.fill();
  }
  // bottom row: assignee chip · due · checklist · tags
  const by = h - 34;
  let x = 24;
  if (card.assignee) {
    g.fillStyle = colour || '#6f8bb0'; g.beginPath(); g.arc(x + 14, by + 12, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = font(13, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials(card.assignee), x + 14, by + 13);
    x += 36;
  }
  g.textAlign = 'left'; g.textBaseline = 'middle';
  if (card.due) {
    g.fillStyle = overdue && !done ? PRIORITY_COLOURS.urgent : dim; g.font = font(17, overdue && !done ? 700 : 500);
    const s = (overdue && !done ? '! ' : '') + fmtDate(card.due); g.fillText(s, x, by + 12); x += g.measureText(s).width + 14;
  }
  const ratio = checklistRatio(card);
  if (!Number.isNaN(ratio)) {
    const done2 = card.checklist.filter((i) => i.done).length;
    g.fillStyle = dim; g.font = font(15, 500, true); const s = `${done2}/${card.checklist.length}`; g.fillText(s, x, by + 12); x += g.measureText(s).width + 6;
    g.fillStyle = 'rgba(128,140,160,0.35)'; roundRect(g, x, by + 8, 44, 8, 4); g.fill();
    g.fillStyle = ratio >= 1 ? PRIORITY_COLOURS.medium : hex(palette.pmToday); roundRect(g, x, by + 8, 44 * ratio, 8, 4); g.fill(); x += 54;
  }
  for (const tag of card.tags || []) {
    g.font = font(13, 600); const tw = g.measureText(tag).width + 14;
    if (x + tw > w - 12) break;
    g.fillStyle = 'rgba(90,169,255,0.18)'; roundRect(g, x, by + 2, tw, 20, 10); g.fill();
    g.fillStyle = hex(palette.pmToday); g.fillText(tag, x + 7, by + 12); x += tw + 6;
  }
  if (card.estimate && x < w - 60) { g.fillStyle = dim; g.font = font(14, 500, true); g.textAlign = 'right'; g.fillText(`${card.estimate}d`, w - 14, by + 12); }
}

/* ---------------- the 3D body ---------------- */
const body3d = {
  dims,
  titleAt: (node) => [0, node.height / 2 - TOP / 2 - 0.08, DEPTH / 2 + 0.05],
  ports(node) {
    const L = layout(node);
    const y0 = L.colTop - 1.2;
    return { in: node.def.inputs.map((_, i) => [-L.W / 2, y0 - i * sizes.port.gap, 0]), out: node.def.outputs.map((_, i) => [L.W / 2, y0 - i * sizes.port.gap, 0]) };
  },
  build(node, h) {
    node.frame = new THREE.Group(); node.add(node.frame);
    body3d._buildFrame(node, h);
    node._cards = new Map();      // card id → { group, plane, slab }
    node._drag = null;
    node._lodFar = false;
    // drop-slot indicator (shown while dragging a card)
    node.slot = new THREE.Mesh(new h.RoundedBoxGeometry(CARD_W, CARD_H, 0.06, 2, 0.08), new THREE.MeshBasicMaterial({ color: states.selected, transparent: true, opacity: 0.28, depthWrite: false }));
    node.slot.visible = false; node.add(node.slot);
  },
  _buildFrame(node, h) {
    const { W, H } = layout(node);
    const f = node.frame;
    node.meshes = node.meshes.filter((m) => !f.children.includes(m));
    node.themed = node.themed.filter(([m]) => !f.children.includes(m));
    while (f.children.length) { const c = f.children.pop(); c.geometry?.dispose(); c.material?.dispose(); }
    // backing slab, header band (category tint), plinth
    const back = h.part(new h.RoundedBoxGeometry(W, H, 0.3, 3, 0.16), h.materials.body(), { parent: f, theme: () => palette.body });
    back.position.z = -0.15;
    const header = h.part(new h.RoundedBoxGeometry(W - 0.3, TOP - 0.2, 0.34, 3, 0.1), h.materials.header(node.headerColor()), { parent: f, theme: node.headerColor });
    header.position.set(0, H / 2 - TOP / 2 - 0.08, 0.02);
    const plinth = h.part(new h.RoundedBoxGeometry(W, PLINTH, 1.4, 3, 0.08), h.materials.body(), { parent: f, theme: () => palette.body });
    plinth.position.set(0, -H / 2 + PLINTH / 2, 0.2);
    node.header = header;
  },
  /** Rebuild the data-driven children: columns, cards, add tiles, dependency arcs, LOD bars. */
  refresh(node) {
    const board = boardOf(node);
    node.params.board = board;
    const d = dims(node);
    if (Math.abs(d.width - node.width) > 1e-6) body3d._resize(node, d);
    node.clearChildren();
    node._cards = new Map();
    const L = layout(node);
    const sel = node.subSelection, hov = node.hoveredSub;
    const dragging = node._drag;
    node._colBars = [];
    board.columns.forEach((col, ci) => {
      const cx = L.colX(ci);
      // translucent column panel (a sub: click selects the column in the panel)
      const panel = new THREE.Mesh(new THREE.BoxGeometry(COL_W, COL_H, 0.1), new THREE.MeshStandardMaterial({ color: palette.pmColumn, transparent: true, opacity: palette.pmColumnAlpha, roughness: 0.8, depthWrite: false }));
      panel.position.set(cx, L.colTop - COL_H / 2, 0.05);
      panel.renderOrder = 0;
      if (sel?.kind === 'column' && sel.id === col.id) { panel.material.emissive = new THREE.Color(states.selected); panel.material.emissiveIntensity = 0.25; }
      node.childSub(panel, { kind: 'column', id: col.id });
      const over = col.wipLimit && col.cards.length > col.wipLimit;
      node.childLabel(col.title, { size: 0.3, color: 'text', weight: 600, maxWidth: COL_W - 1.2 }, [cx - 0.25, L.colTop - 0.42, 0.13]);
      const count = node.childLabel(`${col.cards.length}${col.wipLimit ? ' / ' + col.wipLimit : ''}`, { size: 0.24, color: over ? '#ff4d5e' : 'textDim', weight: 600 }, [cx + COL_W / 2 - 0.45, L.colTop - 0.42, 0.13]);
      count.userData.isCount = true;
      // cards
      const S = slots(col.cards.length, L.colTop);
      col.cards.forEach((card, i) => {
        const group = new THREE.Group();
        group.position.set(cx, S.y(i), CARD_Z + CARD_D / 2 - i * 0.008);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D), new THREE.MeshStandardMaterial({ color: palette.pmCard, roughness: 0.55 }));
        const plane = makeCanvasPlane(CARD_W - 0.04, CARD_H - 0.04);
        plane.mesh.position.z = CARD_D / 2 + 0.004;
        const sub = { kind: 'card', id: card.id, column: col.id, index: i };
        node.childSub(slab, sub); node.childSub(plane.mesh, sub);
        plane.mesh.userData.sub = slab.userData.sub;
        group.add(slab, plane.mesh);
        node.children3d.add(group);
        const entry = { group, plane, slab, card, column: col, index: i };
        node._cards.set(card.id, entry);
        body3d._paintCard(node, entry, board);
        if (sel?.kind === 'card' && sel.id === card.id) group.position.z += 0.08;
        if (dragging && dragging.id === card.id) group.visible = false;
      });
      // "+" tile
      const add = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, ADD_H, 0.08), new THREE.MeshStandardMaterial({ color: palette.pmCard, transparent: true, opacity: 0.55, roughness: 0.7 }));
      add.position.set(cx, L.colBottom + 0.15 + ADD_H / 2, 0.12);
      node.childSub(add, { kind: 'add', id: col.id });
      node.childLabel('+', { size: 0.32, color: 'textDim', weight: 600 }, [cx, L.colBottom + 0.15 + ADD_H / 2, 0.17], true);
      // far-LOD bar: card count as a column of colour
      const bh = Math.min(COL_H - 1.6, 0.35 + col.cards.length * 0.55);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(COL_W * 0.55, bh, 0.2), new THREE.MeshStandardMaterial({ color: node.headerColor(), emissive: node.headerColor(), emissiveIntensity: 0.35, roughness: 0.6 }));
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
    body3d.applyLOD(node, node.lodBlend, true);
    if (hov) node.hoveredSub = null;
  },
  _paintCard(node, entry, board) {
    const sel = node.subSelection, hov = node.hoveredSub;
    entry.plane.draw((g, w, h) => drawCard(g, w, h, entry.card, {
      blocked: isBlocked(board, entry.card), overdue: isOverdue(entry.card), done: entry.column === lastColumn(board),
      selected: sel?.kind === 'card' && sel.id === entry.card.id, hovered: hov?.kind === 'card' && hov.id === entry.card.id,
      colour: assigneeColour(node, entry.card.assignee),
    }));
  },
  /** Column count changed: resize the frame, rim, shadow and move the ports. */
  _resize(node, d) {
    node.width = d.width; node.height = d.height;
    body3d._buildFrame(node, node._helpers());
    node.rim.geometry.dispose(); node.rim.geometry = new THREE.BoxGeometry(d.width + 0.1, d.height + 0.1, DEPTH + 0.1);
    node.shadow.geometry.dispose(); node.shadow.geometry = new THREE.PlaneGeometry(d.width * 1.4, DEPTH * 3.2);
    const P = body3d.ports(node);
    node.inputs.forEach((p, i) => { p.group.position.set(...P.in[i]); p.labelMesh.position.x = P.in[i][0] + 0.22 + p.labelMesh.userData.worldW / 2; });
    node.outputs.forEach((p, i) => { p.group.position.set(...P.out[i]); p.labelMesh.position.x = P.out[i][0] - 0.22 - p.labelMesh.userData.worldW / 2; });
    node.titleLabel.position.set(...body3d.titleAt(node));
    node._titleY = node.titleLabel.position.y;
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
  /** Pointer events on cards, column panels and "+" tiles. */
  onSubPointer(node, ev) {
    const board = boardOf(node);
    const sub = ev.sub;
    if (!sub) return false;
    if (ev.type === 'down') {
      if (sub.kind === 'card') {
        const e = node._cards.get(sub.id);
        if (e) node._drag = { id: sub.id, from: e.column.id, index: e.index, start: e.group.position.clone(), rot: e.group.rotation.z, target: null };
      }
      return true;
    }
    if (ev.type === 'drag' && node._drag) {
      const e = node._cards.get(node._drag.id); if (!e) return true;
      const p = body3d._pointOnBoard(node, ev.ray); if (!p) return true;
      e.group.position.set(p.x, p.y, 0.95); e.group.rotation.z = -0.04; e.group.visible = true;
      e.slab.material.transparent = true; e.slab.material.opacity = 0.85;
      // target column + index
      const L = layout(node);
      const ci = Math.max(0, Math.min(board.columns.length - 1, Math.round((p.x - L.firstX) / (COL_W + COL_GAP))));
      const col = board.columns[ci];
      const others = col.cards.filter((c) => c.id !== node._drag.id);
      const S = slots(others.length + 1, L.colTop);
      let idx = 0; for (let i = 0; i < others.length; i++) if (p.y < S.y(i)) idx = i + 1;   // below card i's centre → after it
      node._drag.target = { column: col.id, index: idx };
      node.slot.visible = true; node.slot.position.set(L.colX(ci), S.y(idx), CARD_Z + 0.02);
      return true;
    }
    if (ev.type === 'drop' || ev.type === 'cancel') {
      node.slot.visible = false;
      const d = node._drag; node._drag = null;
      if (!d) return true;
      const e = node._cards.get(d.id);
      if (e) { e.group.position.copy(d.start); e.group.rotation.z = d.rot; e.slab.material.opacity = 1; e.group.visible = true; }
      if (ev.type === 'drop' && d.target) {
        const same = d.target.column === d.from;
        const res = moveCard(board, d.id, d.target.column, d.target.index);
        if (res && (!same || res.index !== d.index)) commitBoard(node, ev.history, res, 'Move card');
        else node.faceDirty = true;
        node.selectSub({ kind: 'card', id: d.id }, ev.selection);
      }
      return true;
    }
    if (ev.type === 'click') {
      node.slot.visible = false; node._drag = null;
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
  description: 'Standing board with columns and draggable cards; emits card moved / done, outputs stats and cards',
  inputs: [
    { key: 'addCard', label: 'add card', type: 'event', optional: true },
    { key: 'move', label: 'move', type: 'event', optional: true },
  ],
  outputs: [
    { key: 'cardMoved', label: 'card moved', type: 'event' },
    { key: 'done', label: 'done', type: 'event' },
    { key: 'stats', label: 'stats', type: 'data' },
    { key: 'cards', label: 'cards', type: 'data' },
  ],
  params: [
    { key: 'board', label: 'board', type: 'json', default: { columns: ['To do', 'In progress', 'Review', 'Done'].map((title) => ({ title })) }, hidden: true },
    { key: 'showArcs', label: 'dependency arcs', type: 'boolean', default: true },
  ],
  body3d,
  panel: buildBoardPanel,
  onCreate(node) { node.params.board = normalizeBoard(node.params.board); },
  /** Event inputs mutate the board (not undoable: they come from the running system). */
  onEvent({ params, instance, emit }, key, pulse) {
    const board = boardOf(instance);
    const p = pulse.payload;
    if (key === 'addCard') {
      const data = typeof p === 'string' || typeof p === 'number' ? { title: String(p) } : p && typeof p === 'object' && !p.__pulse ? p : { title: `Card ${boardStats(board).total + 1}` };
      const res = addCard(board, data.column || board.columns[0].id, data);
      commitBoard(instance, null, res);
    } else if (key === 'move' && p && typeof p === 'object') {
      const res = moveCard(board, p.cardId || p.id || p.card || p.title, p.column || p.to || lastColumn(board).id, Number.isFinite(+p.index) ? +p.index : -1);
      if (res) commitBoard(instance, null, res);
    }
  },
  evaluate({ params, state, instance }) {
    const board = boardOf(instance);
    const stats = boardStats(board);
    state.history = pushBurndown(state.history, stats);
    return { stats: { ...stats, burndown: state.history }, cards: flatCards(board) };
  },
});
export default def;
export { boardOf, layout as boardLayout, slots as cardSlots, findCard, findColumn };
