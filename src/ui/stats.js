// ui/stats.js — the performance readout at the bottom right (View → Performance stats, key I).
// Collapsed it is one line: fps · frame time · JS heap. Hover or pin it (click the line) for the
// full panel: frame timing with a sparkline of the last 60 frames, the renderer's draw calls and
// triangles, geometry / texture counts with an *estimated* GPU memory figure summed from our own
// buffers (browsers do not expose real VRAM), the JS heap where the browser exposes it (Chromium;
// Firefox and Safari show n/a), device RAM class, the scene (components, connections, groups,
// far-LOD blocks, faces baked above 1×) and browser storage. Sampling is cheap: `frame(dt)` only
// records a frame time and every 500 ms one pass reads the numbers and patches the DOM; when the
// overlay is off `frame()` returns immediately and nothing is walked or written.
import * as THREE from 'three';
import { icons } from '../icons.js';

const KEY = 'proto3d.stats.v1';
const INTERVAL = 500;      // ms between readouts
const SLOW_INTERVAL = 5000; // ms between storage estimates
const HISTORY = 60;         // frames in the sparkline

const fmtMB = (b) => (b >= 1024 * 1024 * 1024 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`);
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

export class StatsOverlay {
  /** @param {object} o { el, ws, world, onChange?() } */
  constructor({ el, ws, world, onChange = () => {} }) {
    Object.assign(this, { el, ws, world, onChange });
    this.on = false; this.pinned = false; this.hover = false;
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { this.on = !!s.on; this.pinned = !!s.pinned; } } catch (_) { /* private mode */ }
    this.times = [];           // last frame times in ms, newest last
    this._last = 0; this._slowAt = 0;
    this.storage = null;       // { usage, quota } from navigator.storage.estimate()
    this.localBytes = 0;
    this.gpuName = null;
    this.sample = null;        // the last readout (tests read it)
    this._build();
    this.el.addEventListener('pointerenter', () => { this.hover = true; this._syncExpanded(); });
    this.el.addEventListener('pointerleave', () => { this.hover = false; this._syncExpanded(); });
    this.el.querySelector('.st-line').addEventListener('click', () => { this.pinned = !this.pinned; this._persist(); this._syncExpanded(); });
    this.el.querySelector('.st-close').addEventListener('click', (e) => { e.stopPropagation(); this.setOn(false); });
    this._apply();
  }
  _persist() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, pinned: this.pinned })); } catch (_) { /* ignore */ } }
  setOn(v) { v = !!v; if (v === this.on) return; this.on = v; this._persist(); this._apply(); this.onChange(this.on); }
  toggle() { this.setOn(!this.on); }
  _apply() {
    this.el.hidden = !this.on;
    document.body.classList.toggle('stats-on', this.on);
    if (this.on) { this.times.length = 0; this._last = 0; this._slowAt = 0; this._readout(performance.now()); }
    this._syncExpanded();
  }
  get expanded() { return this.on && (this.pinned || this.hover); }
  _syncExpanded() {
    this.el.classList.toggle('expanded', this.expanded);
    this.el.classList.toggle('pinned', this.pinned);
    this.el.querySelector('.st-line').setAttribute('aria-expanded', String(this.expanded));
  }

  _build() {
    const row = (k, label, title = '') => `<div class="st-row" ${title ? `title="${title}"` : ''}><span>${label}</span><b data-k="${k}">—</b></div>`;
    this.el.innerHTML = `
      <div class="st-line" role="button" tabindex="0" aria-expanded="false" title="Performance stats · click to pin open, I hides">
        <span class="st-dot" data-k="dot"></span>
        <b data-k="fps">—</b><span class="st-unit">fps</span>
        <b data-k="ms">—</b><span class="st-unit">ms</span>
        <span class="st-sep"></span>
        <b data-k="heapShort" title="JS heap used (Chromium only)">—</b><span class="st-unit">heap</span>
        <span class="st-grow"></span>
        <button type="button" class="st-close ghost" title="Hide (I)" aria-label="Hide performance stats">${icons.close}</button>
      </div>
      <div class="st-body">
        <section>
          <h4>Frame <small>rolling 1 s</small></h4>
          <svg class="st-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="120" data-k="guide" y1="13" y2="13"/><polyline data-k="spark" points=""/></svg>
          ${row('fpsAvg', 'frames / s')}${row('msAvg', 'frame time', 'Average over the last second · worst frame in brackets')}
        </section>
        <section>
          <h4>GPU <small>estimated</small></h4>
          <div class="st-gpu" data-k="gpu">—</div>
          ${row('calls', 'draw calls')}${row('tris', 'triangles')}${row('geos', 'geometries', 'three.js renderer.info.memory.geometries · buffer bytes summed from every attribute in the scene')}${row('texs', 'textures', 'three.js renderer.info.memory.textures · bytes = width × height × bytes per pixel (+ mipmaps) of every texture in the scene')}
          ${row('gpuMem', 'est. GPU memory', 'Sum of the geometry buffers and texture bitmaps above. Browsers do not expose real VRAM use.')}
        </section>
        <section>
          <h4>Memory</h4>
          ${row('heap', 'JS heap', 'performance.memory (Chromium). Firefox and Safari do not expose the heap.')}
          <div class="st-bar"><i data-k="heapBar"></i></div>
          ${row('device', 'device RAM', 'navigator.deviceMemory: a coarse class (0.25 – 8 GB), rounded down by the browser for privacy')}
        </section>
        <section>
          <h4>Scene</h4>
          ${row('comps', 'components')}${row('links', 'connections')}${row('lod', 'far LOD', 'Blocks drawn in the far level of detail (past sizes.lod.far)')}${row('faces', 'faces above 1×', 'Canvas surfaces re-baked above their base density because they are close to the camera')}
          ${row('storage', 'browser storage', 'navigator.storage.estimate(): everything this origin stores (localStorage autosave, IndexedDB key vault, caches) against the quota')}${row('local', 'localStorage', 'Autosave, recent projects and settings in localStorage')}
        </section>
      </div>`;
    this.k = {}; this.el.querySelectorAll('[data-k]').forEach((n) => { this.k[n.dataset.k] = n; });
  }

  /** Per frame, after the render. Only a push while on; a no-op while off. */
  frame(dt) {
    if (!this.on) return;
    const ms = dt * 1000;
    this.times.push(ms); if (this.times.length > 2 * HISTORY) this.times.splice(0, this.times.length - 2 * HISTORY);
    const now = performance.now();
    if (now - this._last >= INTERVAL) { this._last = now; this._readout(now); }
  }

  _readout(now) {
    const s = this._collect(now);
    this.sample = s;
    const K = this.k;
    K.fps.textContent = s.fps ? s.fps.toFixed(0) : '—';
    K.ms.textContent = s.msAvg ? s.msAvg.toFixed(1) : '—';
    K.fpsAvg.textContent = s.fps ? `${s.fps.toFixed(0)}` : '—';
    K.msAvg.textContent = s.msAvg ? `${s.msAvg.toFixed(1)} ms (${s.msMax.toFixed(0)})` : '—';
    K.dot.className = `st-dot ${s.fpsClass}`;
    K.fps.className = s.fpsClass;
    if (s.heap) {
      K.heapShort.textContent = fmtMB(s.heap.used); K.heapShort.className = s.heapClass;
      K.heap.textContent = `${fmtMB(s.heap.used)} of ${fmtMB(s.heap.limit)}`; K.heap.className = s.heapClass;
      K.heapBar.style.width = `${Math.min(100, s.heap.used / s.heap.limit * 100).toFixed(1)}%`; K.heapBar.className = s.heapClass;
    } else {
      K.heapShort.textContent = 'n/a'; K.heapShort.className = 'dim'; K.heap.textContent = 'n/a · not exposed by this browser'; K.heap.className = 'dim'; K.heapBar.style.width = '0%';
    }
    K.device.textContent = s.deviceMemory ? `≈ ${s.deviceMemory} GB class` : 'n/a';
    K.gpu.textContent = s.gpuName || 'renderer name not exposed';
    K.calls.textContent = fmtInt(s.calls); K.tris.textContent = fmtInt(s.triangles);
    K.geos.textContent = `${fmtInt(s.geometries)} · ${fmtMB(s.geometryBytes)}`;
    K.texs.textContent = `${fmtInt(s.textures)} · ${fmtMB(s.textureBytes)}`;
    K.gpuMem.textContent = `≈ ${fmtMB(s.geometryBytes + s.textureBytes)}`;
    K.comps.textContent = `${s.nodes}${s.groups ? ` · ${s.groups} group${s.groups > 1 ? 's' : ''}` : ''}`;
    K.links.textContent = fmtInt(s.connections);
    K.lod.textContent = `${s.far} of ${s.nodes}`;
    K.faces.textContent = `${s.facesAbove1} of ${s.faceBlocks}${s.tiers ? ` (${s.tiers})` : ''}`;
    K.storage.textContent = s.storage ? `${fmtMB(s.storage.usage)} of ${fmtMB(s.storage.quota)}` : 'n/a';
    K.local.textContent = s.localBytes ? fmtMB(s.localBytes) : '—';
    // sparkline: newest frame on the right, 26 px tall, scaled to the worst frame but never below 33 ms
    const hist = this.times.slice(-HISTORY);
    const top = Math.max(33.4, ...hist);
    const pts = hist.map((t, i) => `${(i / (HISTORY - 1) * 120).toFixed(1)},${(26 - Math.min(1, t / top) * 24 - 1).toFixed(1)}`);
    K.spark.setAttribute('points', pts.join(' '));
    const gy = 26 - (16.7 / top) * 24 - 1;   // the 60 fps line
    K.guide.setAttribute('y1', gy.toFixed(1)); K.guide.setAttribute('y2', gy.toFixed(1));
  }

  _collect(now) {
    // rolling second: walk back from the newest frame until 1 s has accumulated
    let sum = 0, n = 0, max = 0;
    for (let i = this.times.length - 1; i >= 0 && sum < 1000; i--) { sum += this.times[i]; n++; max = Math.max(max, this.times[i]); }
    const msAvg = n ? sum / n : 0, fps = msAvg ? 1000 / msAvg : 0;
    const info = this.ws.renderer.info;
    const mem = typeof performance !== 'undefined' && performance.memory ? performance.memory : null;
    const heap = mem && mem.jsHeapSizeLimit ? { used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit } : null;
    const heapRatio = heap ? heap.used / heap.limit : 0;
    if (!this.gpuName) this.gpuName = this._gpuName();
    if (now - this._slowAt >= SLOW_INTERVAL) {
      this._slowAt = now;
      this.localBytes = this._localBytes();
      if (navigator.storage?.estimate) navigator.storage.estimate().then((e) => { this.storage = { usage: e.usage || 0, quota: e.quota || 0 }; }).catch(() => {});
    }
    const gpu = this._gpuEstimate();
    const nodes = this.world.nodes;
    let far = 0, faceBlocks = 0, facesAbove1 = 0; const tiers = new Map();
    for (const b of nodes) {
      if (b.lod) far++;
      if (b.face || b.def?.body3d) { faceBlocks++; if (b.faceScale > 1) facesAbove1++; tiers.set(b.faceScale, (tiers.get(b.faceScale) || 0) + 1); }
    }
    const tierText = [...tiers.entries()].sort((a, b) => b[0] - a[0]).map(([t, c]) => `${c}×${t}`).join(' ');
    return {
      fps, msAvg, msMax: max, frames: n,
      fpsClass: !fps ? '' : fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad',
      heap, heapClass: !heap ? 'dim' : heapRatio < 0.6 ? 'ok' : heapRatio < 0.85 ? 'warn' : 'bad',
      deviceMemory: typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : null,
      gpuName: this.gpuName,
      calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      geometryBytes: gpu.geometryBytes, textureBytes: gpu.textureBytes, geometryCount: gpu.geometries, textureCount: gpu.textures,
      nodes: nodes.length, connections: this.world.connections.length, groups: this.world.groups.length, far, faceBlocks, facesAbove1, tiers: tierText,
      storage: this.storage, localBytes: this.localBytes,
    };
  }
  _gpuName() {
    try {
      const gl = this.ws.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
    } catch (_) { return null; }
  }
  /** Bytes our own buffers occupy: every unique geometry's attributes and every unique texture bitmap in the scene. */
  _gpuEstimate() {
    const geos = new Set(), texs = new Set();
    let geometryBytes = 0, textureBytes = 0;
    const addTex = (t) => {
      if (!t || texs.has(t)) return;
      texs.add(t);
      const img = t.image; if (!img) return;
      const w = img.width || img.videoWidth || 0, h = img.height || img.videoHeight || 0;
      const bpp = t.type === THREE.HalfFloatType ? 8 : t.type === THREE.FloatType ? 16 : 4;
      textureBytes += w * h * bpp * (t.generateMipmaps ? 4 / 3 : 1);
    };
    this.ws.scene.traverse((o) => {
      const g = o.geometry;
      if (g && !geos.has(g)) { geos.add(g); for (const a of Object.values(g.attributes || {})) geometryBytes += a.array?.byteLength || 0; if (g.index) geometryBytes += g.index.array?.byteLength || 0; }
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        addTex(m.map); addTex(m.emissiveMap); addTex(m.alphaMap); addTex(m.normalMap); addTex(m.roughnessMap); addTex(m.metalnessMap); addTex(m.envMap);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) addTex(u.value);
      }
    });
    addTex(this.ws.scene.environment); addTex(this.ws.scene.background?.isTexture ? this.ws.scene.background : null);
    return { geometryBytes, textureBytes, geometries: geos.size, textures: texs.size };
  }
  _localBytes() {
    try { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length) * 2; } return n; } catch (_) { return 0; }
  }
}
