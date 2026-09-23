// live-layer.js — the real hub pages, live, on the 3D canvas. A CSS3DRenderer draws a DOM layer
// over the WebGL canvas (which is opaque, alpha: false), positioned by the same camera; every
// live-eligible hub-page gets a <div class="hub-live"> with an <iframe> of its url, placed on the
// node's face where the canvas face drew the device frame (`faceLayout` in nodes.js gives both the
// same rectangle). The element measures the frame's face pixels and the CSS3DObject is scaled by
// 1 / 120 (sizes.face.pxPerUnit), so it covers the frame exactly.
//
// Rules: only the N biggest on-screen pages (projected area) with live = true and status = live get an
// iframe (the budget, default 16, "All" = 40, with hysteresis so frames do not thrash); the layer itself is pointer-events:
// none so dragging, selecting and the camera keep working; a click on a page face makes that one
// element interactive (pointer-events: auto, an accent outline, a Done button) and flies the camera
// to face it; Done, Escape or a pointerdown on the WebGL canvas leave. Elements are hidden while
// the face is back-facing (past ~85°, with hysteresis), off-screen, invisible (< 10 px) or the node
// hidden — the face's static preview shows instead — and disposed when the node is gone, resized or
// out of the budget for a while.
//
// Occlusion: a DOM layer is always painted over the WebGL scene, so a live frame behind a nearer block
// would show through it. Every ranking pass raycasts five points of each live face against the blocks
// whose boxes overlap it on screen (occlusion.js); a frame with anything in front of it (even partly)
// is hidden (visibility: hidden, the iframe stays loaded) after two consecutive passes, and the
// depth-correct canvas face with its static preview shows instead. The interactive frame stays visible.
// Cross-origin pages cannot be read or styled; nothing renders while `status` is not `live`. Off-contract seams used: window.__proto.ws.{renderer, camera, controls, flyTo,
// onCameraSwap}, window.__proto.world.nodes, window.__proto.sizes — see the README's `host.view` proposal.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { routeLabel } from './nodes.js';
import { faceLayout } from './sizing.js';
import * as motion from './motion.js';
import { createOccluder } from './occlusion.js';

const RANK_EVERY = 0.25;       // seconds between budget re-evaluations
const HYSTERESIS = 0.8;        // a page already live counts as this much closer
const UNLOAD_AFTER = 20;       // seconds out of the budget before its iframe is dropped
const FACING_ON = 0.09, FACING_OFF = 0.05;   // cos thresholds (~85°): a frame shows once the face turns past ON and hides past OFF (hysteresis); the static preview covers the rest
const INTERACT_FILL = 0.7;     // the face fills this much of the viewport when interacting
const MIN_PX = 10;             // a card narrower than this on screen is invisible anyway: no iframe
export const BUDGET_MAX = 40;  // "All"

export function createLiveLayer(host, { budget = 8, enabled = true, onChange = null } = {}) {
  const proto = window.__proto;
  const { ws, world } = proto;
  const px = proto.sizes?.face?.pxPerUnit || 120;
  const viewport = document.getElementById('viewport');
  if (!viewport) throw new Error('[hubs] #viewport not found');

  /* ---- the DOM layer ---- */
  const css = new CSS3DRenderer();
  const root = css.domElement;
  root.id = 'hub-live-layer';
  Object.assign(root.style, { position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', pointerEvents: 'none', zIndex: '1' });
  viewport.appendChild(root);
  const cssScene = new THREE.Scene();
  const entries = new Map();   // node → entry
  const occluder = createOccluder(THREE);
  const perf = { lastMs: 0, maxMs: 0, passes: 0 };   // the occlusion pass's cost, for the panel and the tests
  const state = { budget: Math.min(BUDGET_MAX, Math.max(0, +budget || 0)), enabled: enabled !== false, interactive: null, rankAt: -1, liveCount: 0, running: false, raf: 0, last: 0 };

  function resize() {
    const c = ws.renderer.domElement;
    const w = c.clientWidth || viewport.clientWidth || 1, h = c.clientHeight || viewport.clientHeight || 1;
    css.setSize(w, h);
  }
  resize();
  window.addEventListener('resize', resize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; ro?.observe(viewport);
  const offSwap = ws.onCameraSwap ? ws.onCameraSwap(() => { state.rankAt = -1; }) : null;

  /* ---- elements ---- */
  function build(node) {
    const f = node.face; const L = faceLayout(node.params, f.cw, f.ch);
    const el = document.createElement('div');
    el.className = 'hub-live'; el.dataset.uid = node.uid; el.dataset.device = L.kind;
    el.style.width = `${L.element.w}px`; el.style.height = `${L.element.h}px`;
    const screen = document.createElement('div'); screen.className = 'hub-live-screen';
    Object.assign(screen.style, { left: `${L.screen.x - L.element.x}px`, top: `${L.screen.y - L.element.y}px`, width: `${L.screen.w}px`, height: `${L.screen.h}px` });
    const iframe = document.createElement('iframe');
    iframe.loading = 'lazy'; iframe.referrerPolicy = 'no-referrer'; iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.title = `${node.params.title || 'page'} · ${routeLabel(node.params.url)}`;
    Object.assign(iframe.style, { width: `${L.iframe.w}px`, height: `${L.iframe.h}px`, transform: `scale(${L.scale.toFixed(5)})`, transformOrigin: '0 0', border: '0' });
    screen.appendChild(iframe); el.appendChild(screen);
    const done = document.createElement('button'); done.type = 'button'; done.className = 'hub-live-done'; done.textContent = 'Done';
    done.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
    el.appendChild(done);
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });   // never zooms the camera
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const obj = new CSS3DObject(el);
    el.style.pointerEvents = 'none';   // the CSS3DObject constructor sets `auto`; only the interactive one gets it back
    el.style.visibility = 'visible';
    obj.visible = false;
    cssScene.add(obj);
    return { node, el, obj, iframe, layout: L, key: sizeKey(node), url: String(node.params.url || ''), loaded: false, live: false, lastLive: performance.now() / 1000, hidden: true, occluded: false, occludedRuns: 0 };
  }
  /** What the element depends on: the page width / device, the face's logical size, the url. */
  const sizeKey = (node) => `${node.params.aspect || 'device'}|${node.params.device}|${node.params.pageWidth}|${node.face?.cw}|${node.face?.ch}|${node.params.url}`;
  function entryFor(node) {
    let e = entries.get(node);
    if (e && e.key !== sizeKey(node)) { dispose(e); e = null; }   // size, device or url changed: rebuild
    if (!e && node.face?.mesh) { e = build(node); entries.set(node, e); }
    return e || null;
  }
  function dispose(e) {
    if (!e) return;
    if (state.interactive === e.node) leave();
    cssScene.remove(e.obj); e.el.remove(); e.iframe.src = 'about:blank';
    entries.delete(e.node);
  }
  const load = (e) => { if (!e.loaded && e.url) { e.iframe.src = e.url; e.loaded = true; } };
  const eligible = (n) => n.typeId === 'hub-page' && n.params.live !== false && n.params.status === 'live' && !!n.params.url;

  /* ---- placement ---- */
  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scl = new THREE.Vector3(), _off = new THREE.Vector3(), _n = new THREE.Vector3(), _v = new THREE.Vector3();
  const _box = new THREE.Box3(), _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();
  function facing(e, camera) {   // _pos / _quat hold the face's world transform; hysteresis per entry
    _n.set(0, 0, 1).applyQuaternion(_quat);
    if (camera.isOrthographicCamera) camera.getWorldDirection(_v).negate(); else _v.copy(camera.position).sub(_pos).normalize();
    const d = _n.dot(_v);
    e.facing = e.facing ? d > FACING_OFF : d > FACING_ON;
    return e.facing;
  }
  /** Device pixels one world unit covers at the card (perspective: at its distance; orthographic: anywhere). */
  function pxPerUnit(n, camera) {
    const Hpx = ws.renderer.domElement.height || 1;
    return camera.isOrthographicCamera ? Hpx * (camera.zoom || 1) / Math.max(1e-6, camera.top - camera.bottom) : Hpx / (2 * Math.max(1e-3, camera.position.distanceTo(n.position)) * Math.tan(THREE.MathUtils.degToRad(camera.fov || 42) / 2));
  }
  const projectedWidth = (n, camera) => pxPerUnit(n, camera) * n.width * (n.scale?.x || 1);
  /** Projected area in px²: the budget goes to the biggest cards on screen. */
  const projectedArea = (n, camera) => { const k = pxPerUnit(n, camera) * (n.scale?.x || 1); return k * n.width * k * n.height; };
  function place(e, camera) {
    const n = e.node, mesh = n.face?.mesh;
    const show = state.enabled && e.live && mesh && n.visible !== false && (state.interactive === n || projectedWidth(n, camera) >= MIN_PX);
    if (!show) { e.obj.visible = false; return false; }
    if (e.key !== sizeKey(n)) { e.obj.visible = false; state.rankAt = -1; return false; }   // resized this frame: the ranking pass rebuilds it
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(_pos, _quat, _scl);
    if (!facing(e, camera) || !_frustum.intersectsBox(n.getAABB(_box))) { e.obj.visible = false; return false; }
    const L = e.layout, f = n.face;
    _off.set((L.element.x + L.element.w / 2 - f.cw / 2) / px * _scl.x, -(L.element.y + L.element.h / 2 - f.ch / 2) / px * _scl.y, 0.01).applyQuaternion(_quat);
    e.obj.position.copy(_pos).add(_off);
    e.obj.quaternion.copy(_quat);
    e.obj.scale.set(_scl.x / px, _scl.y / px, _scl.z / px);
    e.obj.visible = true;
    return applyOcclusion(e);
  }

  /* ---- the budget ---- */
  function rank(now, camera) {
    state.rankAt = now;
    const cands = [];
    for (const n of world.nodes) {
      if (n.typeId !== 'hub-page') continue;
      const e = entries.get(n);
      if (!state.enabled || !eligible(n) || n.visible === false) { if (e) e.live = false; continue; }
      const pinned = state.interactive === n;
      if (!pinned && (projectedWidth(n, camera) < MIN_PX || !_frustum.intersectsBox(n.getAABB(_box)))) { if (e) e.live = false; continue; }
      let score = projectedArea(n, camera);   // bigger on screen ranks first
      if (e?.live) score /= HYSTERESIS;
      if (pinned) score = Infinity;
      cands.push({ n, score });
    }
    cands.sort((a, b) => b.score - a.score);
    let live = 0;
    cands.forEach(({ n }, i) => {
      const on = i < state.budget || state.interactive === n;
      if (on) { const e = entryFor(n); if (e) { e.live = true; e.lastLive = now; load(e); live++; } }
      else { const e = entries.get(n); if (e) e.live = false; }
    });
    occlusionPass(camera);
    for (const [n, e] of [...entries]) {
      if (!world.nodes.includes(n)) dispose(e);
      else if (e.key !== sizeKey(n)) dispose(e);   // resized / retargeted: rebuilt when it is live again
      else if (!e.live && now - e.lastLive > UNLOAD_AFTER) dispose(e);
    }
    if (state.interactive && !world.nodes.includes(state.interactive)) leave();
    if (live !== state.liveCount) { state.liveCount = live; onChange?.(counts()); }
  }

  /* ---- occlusion: anything between the camera and a live face hides its frame (the preview shows) ---- */
  const _fp = new THREE.Vector3(), _fq = new THREE.Quaternion(), _fs = new THREE.Vector3();
  function occlusionPass(camera) {
    const t0 = performance.now();
    const blocks = [...world.nodes, ...world.groups.filter((g) => g.collapsed)];
    for (const e of entries.values()) {
      if (!e.live || !e.node.face?.mesh) { e.occludedRuns = 0; e.occluded = false; continue; }
      const mesh = e.node.face.mesh; mesh.updateWorldMatrix(true, false); mesh.matrixWorld.decompose(_fp, _fq, _fs);
      const r = occluder.test(e.node, camera, blocks, { facePos: _fp, faceQuat: _fq, w: e.node.face.w * _fs.x, h: e.node.face.h * _fs.y });
      e.occludedRuns = r.occluded ? e.occludedRuns + 1 : 0;
      e.occluded = e.occludedRuns >= 2 || (e.occluded && r.occluded);   // two consecutive passes to hide, one clear pass to show
    }
    perf.lastMs = performance.now() - t0; perf.maxMs = Math.max(perf.maxMs, perf.lastMs); perf.passes++;
  }
  /** Show or hide an element for its occlusion state; the interactive frame is the user's choice and stays visible. */
  function applyOcclusion(e) {
    const hide = e.occluded && state.interactive !== e.node;
    const want = hide ? 'hidden' : 'visible';
    if (e.el.style.visibility !== want) e.el.style.visibility = want;
    return !hide;
  }

  /* ---- frame loop ---- */
  function frame(ts) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(frame);
    const now = ts / 1000; const dt = Math.min(0.05, state.last ? now - state.last : 0.016); state.last = now;
    motion.update();
    const camera = ws.camera;
    if (!camera) return;
    camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (state.rankAt < 0 || now - state.rankAt >= RANK_EVERY) rank(now, camera);
    let any = false;
    for (const e of entries.values()) if (place(e, camera)) any = true;
    if (any || root.childElementCount) css.render(cssScene, camera);
  }
  function start() { if (state.running) return; state.running = true; state.last = 0; state.raf = requestAnimationFrame(frame); }
  function stop() { state.running = false; cancelAnimationFrame(state.raf); }

  /* ---- interaction ---- */
  function resolve(x) { if (!x) return null; if (typeof x === 'string') return world.nodes.find((n) => n.uid === x) || null; return x; }
  function flyToFace(node) {
    const mesh = node.face?.mesh; if (!mesh) return false;
    mesh.updateWorldMatrix(true, false); mesh.matrixWorld.decompose(_pos, _quat, _scl);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(_quat);
    const centre = node.getAABB(_box).getCenter(new THREE.Vector3());
    centre.addScaledVector(n, -_v.subVectors(centre, _pos).dot(n));   // the body centre moved onto the face plane
    const s = node.scale?.x || 1, faceW = node.width * s, faceH = node.height * s;
    const C = ws.controls, cam = C.perspective || ws.camera;
    const r = ws.renderer.domElement.getBoundingClientRect();
    const W = Math.max(1, r.width), H = Math.max(1, r.height), tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov || 42) / 2), aspect = W / H;
    let d = Math.max(faceH / (2 * tanH * INTERACT_FILL), faceW / (2 * tanH * aspect * INTERACT_FILL));
    d = THREE.MathUtils.clamp(d, Math.max(1.5, (C.minDistance || 0) + 0.5), C.maxDistance || 1e9);
    if (Math.abs(n.y) > 0.98) n.set(0, Math.sign(n.y) || 1, 0.004).normalize();   // a flat card in the plan: from straight above
    const position = centre.clone().addScaledVector(n, d);
    if (position.y < 0.3) position.y = 0.3;
    ws.flyTo(position, centre, 0.55);
    return true;
  }
  function interact(nodeOrUid, { fly = true } = {}) {
    const node = resolve(nodeOrUid);
    if (!node || node.typeId !== 'hub-page') return false;
    if (state.interactive && state.interactive !== node) leave({ quiet: true });
    state.interactive = node;
    const e = entryFor(node);
    if (e) {
      if (eligible(node) && state.enabled) { e.live = true; e.lastLive = performance.now() / 1000; load(e); }
      e.el.classList.add('is-interactive'); e.el.style.pointerEvents = 'auto';
    }
    try { host.selection.set([node]); } catch (_) { /* selection unavailable */ }
    if (fly) flyToFace(node);
    state.rankAt = -1;
    host.ui.toast(eligible(node) ? `${node.title} · live and interactive — Done or Esc to leave` : `${node.title} · ${node.params.status === 'live' ? 'live frames are off' : 'no live frame: status is ' + node.params.status}`, 2200);
    onChange?.(counts());
    return true;
  }
  function leave({ quiet = false } = {}) {
    const node = state.interactive; if (!node) return false;
    state.interactive = null;
    const e = entries.get(node);
    if (e) { e.el.classList.remove('is-interactive'); e.el.style.pointerEvents = 'none'; e.occludedRuns = 0; }
    state.rankAt = -1;   // re-rank now: the occlusion of the frame the user just left is checked again
    if (!quiet) onChange?.(counts());
    return true;
  }
  const onKey = (e) => { if (e.key === 'Escape' && state.interactive) leave(); };
  const onCanvasDown = () => { if (state.interactive) leave(); };
  window.addEventListener('keydown', onKey);
  ws.renderer.domElement.addEventListener('pointerdown', onCanvasDown);

  /* ---- settings / api ---- */
  function counts() {
    let pages = 0, eligibleCount = 0; for (const n of world.nodes) if (n.typeId === 'hub-page') { pages++; if (eligible(n)) eligibleCount++; }
    let occluded = 0; for (const e of entries.values()) if (e.live && e.occluded) occluded++;
    return { pages, eligible: eligibleCount, live: state.liveCount, occluded, loaded: entries.size, budget: state.budget, enabled: state.enabled, interactive: state.interactive?.uid || null, occlusionMs: +perf.lastMs.toFixed(2), occlusionMaxMs: +perf.maxMs.toFixed(2) };
  }
  function setBudget(n) { state.budget = Math.max(0, Math.min(BUDGET_MAX, Math.round(+n) || 0)); state.rankAt = -1; onChange?.(counts()); return state.budget; }
  function setEnabled(on) { state.enabled = !!on; if (!on) { leave({ quiet: true }); for (const e of entries.values()) e.live = false; } state.rankAt = -1; onChange?.(counts()); return state.enabled; }
  /** Drop every element (a world load / example / clear): they are rebuilt for the nodes that are still there. */
  function reset() { leave({ quiet: true }); for (const e of [...entries.values()]) dispose(e); state.rankAt = -1; state.liveCount = 0; onChange?.(counts()); }
  function destroy() {
    stop(); reset(); window.removeEventListener('resize', resize); ro?.disconnect(); offSwap?.();
    window.removeEventListener('keydown', onKey); ws.renderer.domElement.removeEventListener('pointerdown', onCanvasDown); root.remove();
  }

  return { root, css, scene: cssScene, entries, state, perf, occluder, occlusionPass: () => { const cam = ws.camera; cam.updateMatrixWorld(); occlusionPass(cam); for (const e of entries.values()) applyOcclusion(e); return counts(); }, BUDGET_MAX, start, stop, interact, leave, flyToFace, counts, setBudget, setEnabled, reset, destroy, resize, get interactive() { return state.interactive; }, get budget() { return state.budget; }, get enabled() { return state.enabled; } };
}
