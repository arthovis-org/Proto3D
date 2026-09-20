// ui/tour.js — first-run walkthrough: six steps with a spotlight over the thing being
// explained (the Add toolbar, a real output port with a ghost cable running to a compatible
// input, the board's people slot, a card on the board, a cable end, the File menu that holds Connections) and a small card with
// Next / Skip. Shown once
// (localStorage flag) and re-openable from the "?" menu. The backdrop does not swallow pointer
// events, so the person can try things while reading.
import * as THREE from 'three';
import { Connection3D } from '../connection3d.js';
import { isWiringOn, setWiring } from '../wiring.js';
import { nav } from '../controls/navigation.js';

export const TOUR_KEY = 'proto3d.tour.v1';
export function tourSeen(key = TOUR_KEY) { try { return localStorage.getItem(key) === 'done'; } catch (_) { return true; } }
export function markTourSeen(key = TOUR_KEY) { try { localStorage.setItem(key, 'done'); } catch (_) { /* private mode */ } }

/** Step 1 reads the active navigation preset so the hint matches the mouse bindings. */
const navHint = () => `${nav.binding('orbit') || 'Drag'} orbits, ${nav.binding('pan') || 'right-drag'} pans, the wheel zooms (${nav.preset.label} controls; change them under View → Navigation).`;
const STEPS = [
  { id: 'toolbar', title: 'Add and move around', text: () => `Add components from the left toolbar: pick a category, then click a component or drag it into the room. ${navHint()} You can build without cables: drop a component onto another to link them.` },
  { id: 'connect', title: 'Connect ports (optional)', text: 'With Wiring on (P) every block shows its pins. Connect an output on the right of a node to an input on the left of another. Matching colours fit; chevrons are events, circles carry data.', wiring: true },
  { id: 'people', title: 'Plug people into the board', text: 'Plug a person into the board\'s people slot to see their tasks: the rectangle grows one slot per person, the board draws a lane per person and each Person card lists their tasks. Without wiring: drop the Person onto the board.', wiring: true },
  { id: 'card', title: 'Edit on the right', text: 'Click a card on the board to edit it in the properties panel on the right. Drag a card to move it between columns, or drop it on a Person to assign it.' },
  { id: 'reroute', title: 'Move or remove a cable', text: 'Grab a cable end to move it to another port; drop it on empty space to disconnect. Undo anything with Ctrl+Z.', wiring: true },
  { id: 'connections', title: 'Generate content', text: 'The Generate zone writes a launch tweet and paints a key visual with the offline Demo provider. Add your own keys under File → Connections… to go live with OpenRouter (text), fal.ai or kie.ai (images, video, audio) — keys stay encrypted in this browser.' },
];

export class Tour {
  /** @param {object} o { ws, world, el (#tour), overlays, onDone } */
  constructor({ ws, world, el, onDone = () => {} }) {
    Object.assign(this, { ws, world, el, onDone });
    this.spot = el.querySelector('.tour-spot');
    this.card = el.querySelector('.tour-card');
    this.stepEl = el.querySelector('.tour-step');
    this.titleEl = el.querySelector('.tour-title');
    this.textEl = el.querySelector('.tour-text');
    this.nextBtn = el.querySelector('.tour-next');
    this.skipBtn = el.querySelector('.tour-skip');
    this.index = -1;
    this.ghost = null;      // { conn, from, to, k }
    this.anchor = null;     // () => THREE.Vector3 | DOMRect | null
    this.nextBtn.addEventListener('click', () => this.next());
    this.skipBtn.addEventListener('click', () => this.skip());
    window.addEventListener('keydown', (e) => { if (this.active && e.key === 'Escape') this.skip(); });
  }
  get active() { return this.index >= 0; }
  get steps() { return STEPS; }

  start() { this.index = -1; this.el.hidden = false; this._wiringBefore = isWiringOn(); this.next(); }
  /** Re-render the current step's text (the navigation preset changed). */
  refreshText() { if (this.active) { const t = STEPS[this.index].text; this.textEl.textContent = typeof t === 'function' ? t() : t; } }
  next() {
    this.index += 1;
    if (this.index >= STEPS.length) { this.finish(); return; }
    this._show(STEPS[this.index]);
  }
  skip() { this.finish(); }
  finish() {
    if (!this.active) return;
    this.index = -1;
    this._clearGhost();
    this.el.hidden = true;
    if (this._wiringBefore !== undefined) { setWiring(this._wiringBefore); this._wiringBefore = undefined; }   // restore the wiring switch the tour turned on
    markTourSeen();
    this.onDone();
  }

  _show(step) {
    this._clearGhost();
    this.anchor = null;
    this.stepEl.textContent = `${this.index + 1} / ${STEPS.length}`;
    this.titleEl.textContent = step.title;
    this.textEl.textContent = typeof step.text === 'function' ? step.text() : step.text;
    // the wiring steps need visible pins and cables; the switch goes back to what it was when the tour ends
    setWiring(step.wiring ? true : this._wiringBefore);
    this.nextBtn.textContent = this.index === STEPS.length - 1 ? 'Done' : 'Next';
    this.spot.classList.toggle('round', step.id !== 'toolbar');
    const nodes = this.world.nodes.filter((n) => n.visible);
    switch (step.id) {
      case 'toolbar': {
        const rail = document.querySelector('#left-bar .rail');
        this.anchor = () => rail?.getBoundingClientRect() || null;
        break;
      }
      case 'connect': {
        const pair = this._pickPair(nodes);
        if (pair) {
          const [from, to] = pair;
          this.ws.frameBlocks([from.owner, to.owner], { fill: 0.6 });
          const conn = new Connection3D(from, from.getWorldPosition(new THREE.Vector3()));
          conn.setDerivedState('idle');
          this.ws.scene.add(conn);
          this.ghost = { conn, from, to, k: 0 };
          this.anchor = () => from.getWorldPosition(new THREE.Vector3());
        }
        break;
      }
      case 'people': {
        const board = nodes.find((n) => n.typeId === 'kanban-board') || null;
        const slot = board?.getPort('people', 'in') || null;
        const people = board ? this.world.connections.filter((c) => c.to === slot).map((c) => c.from.owner) : [];
        if (board) { this.ws.frameBlocks([board, ...people], { fill: 0.6 }); this.anchor = () => slot.getWorldPosition(new THREE.Vector3(), Math.max(0, slot.links - 1) / 2 | 0); }
        break;
      }
      case 'card': {
        const board = nodes.find((n) => n.typeId === 'kanban-board' && n._cards?.size);
        const target = board || nodes[0];
        if (target) {
          this.ws.frameBlocks([target], { fill: 0.7 });
          if (board) { const e = [...board._cards.values()][0]; this.anchor = () => e.group.getWorldPosition(new THREE.Vector3()); }
          else this.anchor = () => { const v = target.position.clone(); if (target.kind === 'device') v.y += target.height / 2; return v; };
        }
        break;
      }
      case 'reroute': {
        const c = this.world.connections.find((x) => x.visible && x.complete);
        if (c) { this.ws.frameBlocks([c.from.owner, c.to.owner], { fill: 0.6 }); this.anchor = () => c.to.getWorldPosition(new THREE.Vector3()); }
        break;
      }
      case 'connections': {
        const gen = nodes.filter((n) => n.def.category === 'generate');
        if (gen.length) this.ws.frameBlocks(gen, { fill: 0.55 });
        const btn = document.querySelector('#menubar .mnu-title[data-menu="file"]');
        this.spot.classList.remove('round');
        this.anchor = () => btn?.getBoundingClientRect() || null;
        break;
      }
      default: break;
    }
    this.update(0);
  }
  /** An output port with a compatible, ideally unconnected, input on another visible block. */
  _pickPair(nodes) {
    let best = null;
    for (const n of nodes) for (const out of n.outputs) {
      const targets = this.world.compatiblePorts(out, nodes);
      if (!targets.length) continue;
      const free = targets.find((t) => !t.connected);
      const cand = [out, free || targets[0]];
      const score = (free ? 2 : 0) + (out.type === 'event' ? 1 : 0);
      if (!best || score > best.score) best = { cand, score };
    }
    return best?.cand || null;
  }
  _clearGhost() { if (this.ghost) { this.ws.scene.remove(this.ghost.conn); this.ghost.conn.dispose(); this.ghost = null; } }

  /** Per frame: animate the ghost cable and keep the spotlight on its target. */
  update(dt) {
    if (!this.active) return;
    if (this.ghost) {
      const g = this.ghost;
      g.k = (g.k + dt / 1.6) % 1.25;   // run, pause at the input, restart
      const e = Math.min(1, g.k); const s = e * e * (3 - 2 * e);
      const p = g.from.getWorldPosition(new THREE.Vector3()).lerp(g.to.getWorldPosition(new THREE.Vector3()), s);
      if (e >= 1) g.conn.setPreviewPort('to', g.to); else g.conn.setPreviewPoint('to', p);
      g.conn.uniforms.dim.value = 0.75 + 0.25 * Math.sin(performance.now() / 180);
    }
    const a = this.anchor ? this.anchor() : null;
    if (!a) { this.spot.hidden = true; this._placeCard(null); return; }
    let rect;
    if (a.isVector3) {
      a.project(this.ws.camera);
      const r = this.ws.renderer.domElement.getBoundingClientRect();
      const x = r.left + (a.x + 1) / 2 * r.width, y = r.top + (1 - a.y) / 2 * r.height;
      const R = 42;
      rect = { left: x - R, top: y - R, width: 2 * R, height: 2 * R, right: x + R, bottom: y + R };
    } else rect = { left: a.left - 6, top: a.top - 6, width: a.width + 12, height: a.height + 12, right: a.right + 6, bottom: a.bottom + 6 };
    this.spot.hidden = false;
    Object.assign(this.spot.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    this._placeCard(rect);
  }
  _placeCard(rect) {
    const W = window.innerWidth, H = window.innerHeight;
    const cw = this.card.offsetWidth || 320, ch = this.card.offsetHeight || 140;
    let x, y;
    if (!rect) { x = (W - cw) / 2; y = (H - ch) / 2; }
    else {
      x = rect.right + 18; y = rect.top;
      if (x + cw > W - 12) x = Math.max(12, rect.left - cw - 18);
      if (y + ch > H - 12) y = Math.max(12, H - ch - 12);
    }
    this.card.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
}
