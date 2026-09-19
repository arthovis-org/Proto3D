// ui/overlays.js — HTML layers that explain the 3D scene: a tooltip that follows a port or a
// block, the floating label beside the pointer while a cable is dragged, a short toast, the
// small end labels on a selected block's cables ("→ Laptop.screen"), and the empty-scene hint.
// Everything here is presentation only: it projects world positions to the screen every frame
// and never writes to the world.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Overlays {
  /** @param {object} o { camera, renderer, world, els: { tip, dragLabel, toast, endLabels, emptyHint } } */
  constructor({ camera, renderer, world, els }) {
    Object.assign(this, { camera, renderer, world });
    this.el = els;
    this._tip = null;           // { anchor: Vector3 | null, screen: [x, y] | null, offset }
    this._endLabels = [];       // [{ conn, end, el }]
    this._toastTimer = 0;
    this._pending = null;       // delayed tooltip { html, anchor, at }
    if (world?.onChange) world.onChange(() => this.setEmptyHint(world.nodes.length === 0));
    this.setEmptyHint(world ? world.nodes.length === 0 : false);
  }

  /** Project a world point to canvas-relative CSS pixels. */
  project(v, out = {}) {
    _v.copy(v).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    out.x = r.left + (_v.x + 1) / 2 * r.width; out.y = r.top + (1 - _v.y) / 2 * r.height;
    out.visible = _v.z < 1 && _v.x > -1.2 && _v.x < 1.2 && _v.y > -1.2 && _v.y < 1.2;
    return out;
  }

  /* ---------- tooltip ---------- */
  /** Show the tooltip anchored to a world position (follows it) or to screen coordinates. `delay` ms defers it. */
  tip(html, { anchor = null, screen = null, offset = [14, -12], cls = '', delay = 0 } = {}) {
    const spec = { html, anchor: anchor ? anchor.clone() : null, screen, offset, cls };
    if (delay > 0) { this._pending = { spec, at: performance.now() + delay }; return; }
    this._pending = null;
    this._showTip(spec);
  }
  _showTip(spec) {
    this._tip = spec;
    const el = this.el.tip;
    el.className = spec.cls;
    el.innerHTML = spec.html;
    el.hidden = false;
    this._placeTip();
  }
  hideTip() { this._tip = null; this._pending = null; this.el.tip.hidden = true; }
  get tipVisible() { return !this.el.tip.hidden; }
  /** Update the anchored world position of the current tooltip (e.g. the port moved). */
  moveTip(anchor) { if (this._tip) { this._tip.anchor = anchor.clone(); this._placeTip(); } }
  _placeTip() {
    const t = this._tip; if (!t) return;
    let x, y;
    if (t.anchor) { const p = this.project(t.anchor); if (!p.visible) { this.el.tip.hidden = true; return; } this.el.tip.hidden = false; x = p.x; y = p.y; }
    else if (t.screen) { [x, y] = t.screen; }
    else return;
    this._clampTo(this.el.tip, x + t.offset[0], y + t.offset[1]);
  }
  _clampTo(el, x, y) {
    const w = el.offsetWidth || 160, h = el.offsetHeight || 40;
    const r = this.renderer.domElement.getBoundingClientRect();
    x = Math.min(Math.max(x, r.left + 6), r.right - w - 6);
    y = Math.min(Math.max(y, r.top + 6), r.bottom - h - 6);
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  /* ---------- drag label (beside the pointer while a cable is dragged) ---------- */
  dragLabel(html, x, y, cls = '') {
    const el = this.el.dragLabel;
    if (!html) { el.hidden = true; return; }
    el.hidden = false; el.className = cls; el.innerHTML = html;
    this._clampTo(el, x + 18, y + 18);
  }

  /* ---------- toast ---------- */
  toast(text, ms = 1600) {
    const el = this.el.toast;
    el.textContent = text; el.hidden = false; el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.classList.remove('show'); el.hidden = true; }, ms);
  }

  /* ---------- cable end labels ---------- */
  /** @param {Array<{conn, end: 'from'|'to', text}>} list */
  setEndLabels(list) {
    const sig = list.map((s) => `${s.conn.uid}:${s.end}:${s.text}`).join('|');
    if (sig === this._endSig) return;   // world changes arrive often; only rebuild when the labels differ
    this._endSig = sig;
    const root = this.el.endLabels;
    root.innerHTML = '';
    this._endLabels = list.map((s) => {
      const el = document.createElement('div');
      el.className = 'end-label ' + (s.end === 'to' ? 'at-to' : 'at-from');
      el.textContent = s.text;
      el.style.setProperty('--c', s.color || 'var(--accent)');
      root.appendChild(el);
      return { ...s, el };
    });
    root.hidden = !list.length;
    this._placeEndLabels();
  }
  _placeEndLabels() {
    const pos = new THREE.Vector3();
    for (const L of this._endLabels) {
      if (!L.conn.visible || !L.conn.curve) { L.el.hidden = true; continue; }
      // sit a little inside the cable so the label does not cover the port
      L.conn.curve.getPoint(L.end === 'to' ? 0.86 : 0.14, pos);
      const p = this.project(pos);
      L.el.hidden = !p.visible;
      if (p.visible) L.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(${L.end === 'to' ? '-100%' : '0'}, -130%)`;
    }
  }

  /* ---------- empty scene hint ---------- */
  setEmptyHint(on) { this.el.emptyHint.hidden = !on; }

  /* ---------- per frame ---------- */
  update() {
    if (this._pending && performance.now() >= this._pending.at) { const s = this._pending.spec; this._pending = null; this._showTip(s); }
    if (this._tip) this._placeTip();
    if (this._endLabels.length) this._placeEndLabels();
  }
}
