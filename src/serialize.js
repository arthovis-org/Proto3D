// serialize.js — the world as JSON: components (type id, params, serializable state, transform),
// connections (node uid + port key), groups (member uids, collapsed) and the camera. Also the
// debounced localStorage autosave and download / file-picker helpers for the File menu.
import { registry } from './core/registry.js';
import { createInstance } from './instance.js';
import { Group3D } from './groups.js';
import { bumpUidCounter } from './block3d.js';

export const FORMAT_VERSION = 2;
export const AUTOSAVE_KEY = 'proto3d.world.v2';

export function serializeWorld(world, { camera, controls, name = 'untitled' } = {}) {
  return {
    app: 'proto3d', version: FORMAT_VERSION, name, savedAt: new Date().toISOString(),
    nodes: world.nodes.map((n) => n.serialize()),
    connections: world.connections.filter((c) => c.to).map((c) => c.serialize()),
    groups: world.groups.map((g) => g.serialize()),
    camera: camera && controls ? { position: camera.position.toArray().map((v) => +v.toFixed(2)), target: controls.target.toArray().map((v) => +v.toFixed(2)) } : undefined,
  };
}

/** Replace the world's content with a saved document. Unknown types are skipped and reported. */
export function loadWorld(world, doc, { camera, controls } = {}) {
  if (!doc || doc.app !== 'proto3d' || !Array.isArray(doc.nodes)) throw new Error('Not a Proto3D document');
  world.clear();
  const skipped = [];
  const byUid = new Map();
  let maxSeq = 0;
  for (const n of doc.nodes) {
    const def = registry.get(n.type);
    if (!def) { skipped.push(n.type); continue; }
    const inst = createInstance(def, { uid: n.uid, title: n.title, params: n.params, state: n.state, enabled: n.enabled });
    inst.rotation.y = n.rotationY || 0;
    inst.scale.setScalar(n.scale || 1);
    world.addNode(inst, n.position || [0, 1.6, 0]);
    byUid.set(inst.uid, inst);
    const m = /^b([0-9a-z]+)/.exec(inst.uid); if (m) maxSeq = Math.max(maxSeq, parseInt(m[1].slice(0, -3) || '0', 36) || 0);
  }
  bumpUidCounter(maxSeq);
  for (const c of doc.connections || []) {
    const a = byUid.get(c.from?.node), b = byUid.get(c.to?.node);
    if (!a || !b) continue;
    const from = a.getPort(c.from.port, 'out'), to = b.getPort(c.to.port, 'in');
    if (from && to) world.addConnection(from, to, { uid: c.uid });
  }
  for (const g of doc.groups || []) {
    const members = (g.members || []).map((uid) => byUid.get(uid)).filter(Boolean);
    if (!members.length) continue;
    const grp = new Group3D({ uid: g.uid, title: g.title, members });
    world.addGroup(grp);
    if (g.collapsed) grp.setCollapsed(true, world);
  }
  if (doc.camera && camera && controls) {
    camera.position.fromArray(doc.camera.position); controls.target.fromArray(doc.camera.target); controls.update();
  }
  world.changed('load');
  return { skipped, nodes: world.nodes.length, connections: world.connections.length, groups: world.groups.length };
}

export function downloadJSON(obj, filename = 'proto3d-world.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Open the file picker and resolve with the parsed JSON (rejects on cancel / parse error). */
export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return reject(new Error('cancelled'));
      f.text().then((t) => resolve(JSON.parse(t))).catch(reject);
    });
    input.click();
  });
}

/** Debounced autosave into localStorage on every world change. */
export class AutoSave {
  constructor(world, { key = AUTOSAVE_KEY, delay = 600, extras = () => ({}) } = {}) {
    this.world = world; this.key = key; this.delay = delay; this.extras = extras;
    this._t = null; this.enabled = true; this.lastSavedAt = null;
    world.onChange(() => this.schedule());
  }
  schedule() {
    if (!this.enabled) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.save(), this.delay);
  }
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(serializeWorld(this.world, this.extras()))); this.lastSavedAt = Date.now(); return true; }
    catch (_) { return false; }
  }
  load() { try { const s = localStorage.getItem(this.key); return s ? JSON.parse(s) : null; } catch (_) { return null; } }
  clear() { try { localStorage.removeItem(this.key); } catch (_) { /* ignore */ } }
}
