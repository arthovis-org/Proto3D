// ui/guides.js — the snap and alignment guides shown while a block is dragged: an SVG layer over
// the viewport (pointer-events none) holding world-space segments that are re-projected every
// frame. `align` guides are the accent-coloured lines along an edge or centre that lines up with a
// neighbour (design-tool smart guides); `grid` guides are the subtle dashed ticks that show the
// block's centre landed on the grid. The interaction layer sets them during a drag and clears them
// on release; nothing here writes to the world.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const NS = 'http://www.w3.org/2000/svg';

export class Guides {
  /** @param {object} o { el: SVGElement, ws } */
  constructor({ el, ws }) {
    this.el = el; this.ws = ws;
    this.lines = [];        // [{ a: Vector3, b: Vector3, kind }]
    this.nodes = [];        // SVG <line> elements, reused
    this.el.setAttribute('aria-hidden', 'true');
  }
  /** SVG elements have no `hidden` property, so the attribute is toggled by hand. */
  get visible() { return !this.el.hasAttribute('hidden'); }
  /** Replace the guides: `lines` = [{ a, b, kind: 'align' | 'grid' }] in world space. */
  set(lines) {
    this.lines = lines.map((l) => ({ a: l.a.clone(), b: l.b.clone(), kind: l.kind || 'align' }));
    while (this.nodes.length < this.lines.length) { const n = document.createElementNS(NS, 'line'); this.el.appendChild(n); this.nodes.push(n); }
    this.nodes.forEach((n, i) => { const l = this.lines[i]; if (l) { n.setAttribute('class', `guide guide-${l.kind}`); n.style.display = ''; } else n.style.display = 'none'; });
    this.el.toggleAttribute('hidden', !this.lines.length);
    this.update();
  }
  clear() { if (this.lines.length) this.set([]); }
  /** Per frame: project the segments to the page. */
  update() {
    if (!this.lines.length) return;
    const cam = this.ws.camera, r = this.ws.renderer.domElement.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    this.el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const P = (v) => { _v.copy(v).project(cam); return [r.left + (_v.x + 1) / 2 * r.width, r.top + (1 - _v.y) / 2 * r.height, _v.z]; };
    this.lines.forEach((l, i) => {
      const a = P(l.a), b = P(l.b), n = this.nodes[i];
      if (a[2] > 1 || b[2] > 1) { n.style.display = 'none'; return; }
      n.style.display = '';
      n.setAttribute('x1', a[0].toFixed(1)); n.setAttribute('y1', a[1].toFixed(1)); n.setAttribute('x2', b[0].toFixed(1)); n.setAttribute('y2', b[1].toFixed(1));
    });
  }
}
