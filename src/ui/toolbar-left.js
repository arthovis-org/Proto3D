// ui/toolbar-left.js — the vertical Add toolbar on the left. Collapsed: one icon per registry
// category (+ search). Clicking a category or the search field opens a flyout listing components
// (icon, label, one-line description). Click adds at the camera target; drag into the scene
// drops where the ray hits the floor, with a ghost footprint while dragging. Categories and
// components come from the registry so new definitions appear automatically.
import * as THREE from 'three';
import { slabGeometry } from '../geometry.js';
import { registry } from '../core/registry.js';
import { icons } from '../icons.js';
import { nodeDimensions } from '../node3d.js';
import { sizes, states } from '../theme.js';

export class LeftToolbar {
  /**
   * @param {object} o { el, ws, world, interaction, onAdd(def, position|null) }
   */
  constructor({ el, ws, world, interaction, onAdd }) {
    Object.assign(this, { el, ws, world, interaction, onAdd });
    this.activeCategory = null;
    this.query = '';
    this.drag = null;
    this.ghost = null;
    this._build();
    registry.onRegister(() => this._build());
  }

  _build() {
    this.el.innerHTML = '';
    const rail = document.createElement('div'); rail.className = 'rail';
    const add = document.createElement('div'); add.className = 'rail-title'; add.textContent = 'Add';
    rail.appendChild(add);
    const searchBtn = this._railButton('search', 'Search components (Shift+A)', icons.search, () => this.open('search'));
    rail.appendChild(searchBtn);
    const cats = registry.categories();
    let lastKind = null;
    for (const c of cats) {
      if (lastKind && lastKind !== c.kind) { const sep = document.createElement('div'); sep.className = 'rail-sep'; rail.appendChild(sep); }
      lastKind = c.kind;
      rail.appendChild(this._railButton(c.id, `${c.label} — ${c.description}`, icons[c.id] || icons.node, () => this.toggle(c.id)));
    }
    this.el.appendChild(rail);

    const fly = document.createElement('div'); fly.className = 'flyout'; fly.hidden = true;
    fly.innerHTML = `<div class="fly-head"><input id="add-search" type="search" placeholder="Search components…" autocomplete="off" /><button type="button" class="fly-close" title="Close (Esc)">${icons.close}</button></div><div class="fly-list"></div>`;
    this.el.appendChild(fly);
    this.fly = fly;
    this.search = fly.querySelector('#add-search');
    this.list = fly.querySelector('.fly-list');
    this.search.addEventListener('input', () => { this.query = this.search.value; this.activeCategory = null; this._renderList(); this._syncRail(); });
    this.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.close(); e.stopPropagation(); } if (e.key === 'Enter') { const first = this.list.querySelector('.comp'); if (first) this.onAdd(registry.get(first.dataset.type), null); } });
    fly.querySelector('.fly-close').addEventListener('click', () => this.close());
    this._syncRail();
  }
  _railButton(id, title, svg, onClick) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'rail-btn'; b.dataset.cat = id; b.title = title;
    b.innerHTML = `${svg}<span class="rail-label">${id === 'search' ? 'Search' : registry.category(id).label}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }
  _syncRail() {
    this.el.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', !this.fly.hidden && (b.dataset.cat === this.activeCategory || (b.dataset.cat === 'search' && !this.activeCategory))));
  }

  get isOpen() { return !this.fly.hidden; }
  toggle(catId) { if (this.isOpen && this.activeCategory === catId) this.close(); else this.open(catId); }
  open(catId = 'search') {
    this.activeCategory = catId === 'search' ? null : catId;
    if (catId !== 'search') { this.query = ''; this.search.value = ''; }
    this.fly.hidden = false;
    this._renderList();
    this._syncRail();
    if (catId === 'search') this.search.focus();
  }
  close() { this.fly.hidden = true; this.activeCategory = null; this._syncRail(); this.search.blur(); }

  _renderList() {
    this.list.innerHTML = '';
    const cats = registry.categories();
    const q = this.query.trim();
    const groups = q ? cats.map((c) => ({ ...c, components: registry.search(q).filter((d) => d.category === c.id) })).filter((c) => c.components.length)
      : this.activeCategory ? cats.filter((c) => c.id === this.activeCategory) : cats;
    if (!groups.length) { const e = document.createElement('div'); e.className = 'fly-empty'; e.textContent = `No component matches “${q}”`; this.list.appendChild(e); return; }
    for (const c of groups) {
      const h = document.createElement('div'); h.className = 'fly-cat'; h.innerHTML = `${icons[c.id] || icons.node}<span>${c.label}</span><small>${c.description}</small>`;
      this.list.appendChild(h);
      for (const def of c.components) this.list.appendChild(this._item(def));
    }
  }
  _item(def) {
    const it = document.createElement('div'); it.className = 'comp'; it.dataset.type = def.id; it.title = 'Click to add · drag into the scene to place';
    it.innerHTML = `<span class="ic">${def.icon || icons.node}</span><div><b>${def.label}</b><small>${def.description}</small></div><span class="ports">${def.inputs.length}→${def.outputs.length}</span>`;
    it.addEventListener('pointerdown', (e) => this._pressItem(e, def, it));
    return it;
  }

  /* ---------- click vs drag-to-scene ---------- */
  _pressItem(e, def, it) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) { dragging = true; this._beginGhost(def); it.classList.add('dragging'); }
      if (dragging) this._moveGhost(ev);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      it.classList.remove('dragging');
      if (!dragging) { this.onAdd(def, null); return; }
      const pos = this._ghostPosition(ev);
      this._endGhost();
      if (pos) this.onAdd(def, pos);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  _footprint(def) {
    if (def.device) { const s = sizes.device[def.device]; return { w: s.w, d: Math.max(s.d, s.baseDepth || 1.2) }; }
    const d = nodeDimensions(def); return { w: d.width, d: 1.2 };
  }
  _beginGhost(def) {
    const { w, d } = this._footprint(def);
    const g = new THREE.Group();
    const plate = new THREE.Mesh(slabGeometry(w + 0.6, d + 0.6, 0.06, { radius: 0.4, bevel: 0.01 }), new THREE.MeshBasicMaterial({ color: states.selected, transparent: true, opacity: 0.35, depthWrite: false }));
    plate.position.y = 0.03;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), new THREE.MeshBasicMaterial({ color: states.selected, transparent: true, opacity: 0.6 }));
    post.position.y = 1.1;
    g.add(plate, post);
    g.visible = false;
    this.ws.scene.add(g);
    this.ghost = { group: g, def };
    document.body.classList.add('placing');
  }
  _ghostPosition(ev) {
    const r = this.ws.renderer.domElement.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return null;
    this.interaction._setPointer(ev);
    return this.interaction.floorPoint(0);
  }
  _moveGhost(ev) {
    const p = this._ghostPosition(ev);
    if (!this.ghost) return;
    this.ghost.group.visible = !!p;
    if (p) this.ghost.group.position.set(p.x, 0, p.z);
  }
  _endGhost() {
    if (!this.ghost) return;
    this.ws.scene.remove(this.ghost.group);
    this.ghost.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.ghost = null;
    document.body.classList.remove('placing');
  }
}
