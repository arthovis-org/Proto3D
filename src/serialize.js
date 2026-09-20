// serialize.js — the world as JSON: components (type id, params, serializable state, transform),
// connections (node uid + port key), groups (member uids, collapsed) and the camera. Also a
// selection-only document (copy / export selection), an undoable import that merges a document
// into the current world (paste / File → Import), the debounced localStorage autosave, the recent
// projects list behind File → Open recent, and download / file-picker helpers for the menus.
import { registry } from './core/registry.js';
import { createInstance } from './instance.js';
import { Group3D } from './groups.js';
import { bumpUidCounter } from './block3d.js';
import { isWiringOn, setWiring } from './wiring.js';

export const FORMAT_VERSION = 2;
export const AUTOSAVE_KEY = 'proto3d.world.v2';
export const RECENT_KEY = 'proto3d.recent.v1';
/** Port keys renamed when the project ports got plain names; older documents still reconnect. */
const LEGACY_PORTS = {
  'kanban-board': { in: { addCard: 'addTask', move: 'moveTask' }, out: { cardMoved: 'moved', stats: 'progress', cards: 'tasks' } },
  person: { in: { cards: 'tasks' } },
  'project-dashboard': { in: { stats: 'progress' } },
};
const portKey = (typeId, dir, key) => LEGACY_PORTS[typeId]?.[dir]?.[key] || key;

/** `pose` = { position, target } replaces the live camera (the remembered 3D pose while the 2D editing mode is on — the mode itself is never saved). */
export function serializeWorld(world, { camera, controls, pose = null, name = 'untitled' } = {}) {
  const cam = pose ? { position: pose.position, target: pose.target } : camera && controls ? { position: camera.position, target: controls.target } : null;
  return {
    app: 'proto3d', version: FORMAT_VERSION, name, savedAt: new Date().toISOString(),
    nodes: world.nodes.map((n) => n.serialize()),
    connections: world.connections.filter((c) => c.to).map((c) => c.serialize()),
    groups: world.groups.map((g) => g.serialize()),
    wiring: isWiringOn(),
    camera: cam ? { position: cam.position.toArray().map((v) => +v.toFixed(2)), target: cam.target.toArray().map((v) => +v.toFixed(2)) } : undefined,
  };
}

/** A document holding only `nodes` plus the connections and groups entirely among them (copy, Export → Selection). */
export function serializeSelection(world, nodes, { name = 'selection' } = {}) {
  const set = new Set(nodes.filter((n) => n && n.kind !== 'connection' && n.kind !== 'group'));
  return {
    app: 'proto3d', version: FORMAT_VERSION, name, savedAt: new Date().toISOString(),
    nodes: [...set].map((n) => n.serialize()),
    connections: world.connections.filter((c) => c.to && set.has(c.from.owner) && set.has(c.to.owner)).map((c) => c.serialize()),
    groups: world.groups.filter((g) => g.members.length && g.members.every((m) => set.has(m))).map((g) => g.serialize()),
    wiring: isWiringOn(),
  };
}

/**
 * An undoable command that merges `doc` into the world: fresh instances (new uids, so a document
 * may be imported twice or pasted next to its source), their internal connections and groups.
 * `place: 'beside'` shifts everything to the right of the existing scene; `'keep'` uses the saved
 * positions. Returns null when the document holds nothing the registry knows.
 */
export function importCommand(world, doc, { place = 'beside', label } = {}) {
  if (!doc || doc.app !== 'proto3d' || !Array.isArray(doc.nodes)) throw new Error('Not a Proto3D document');
  const byUid = new Map(); const entries = []; const skipped = [];
  for (const n of doc.nodes) {
    const def = registry.get(n.type);
    if (!def) { skipped.push(n.type); continue; }
    const inst = createInstance(def, { title: n.title, params: n.params, state: n.state, enabled: n.enabled, showPorts: n.showPorts });
    inst.rotation.y = n.rotationY || 0; inst.scale.setScalar(n.scale || 1);
    byUid.set(n.uid, inst);
    entries.push({ inst, pos: [...(n.position || [0, 1.6, 0])] });
  }
  if (!entries.length) return null;
  if (place === 'beside' && world.nodes.length) {
    let maxX = -Infinity, minX = Infinity;
    for (const n of world.nodes) maxX = Math.max(maxX, n.position.x + n.footprint().w / 2);
    for (const e of entries) minX = Math.min(minX, e.pos[0] - e.inst.footprint().w / 2);
    const dx = maxX + 4 - minX;
    for (const e of entries) e.pos[0] += dx;
  }
  const links = [];
  for (const c of doc.connections || []) {
    const a = byUid.get(c.from?.node), b = byUid.get(c.to?.node);
    if (a && b) links.push({ a, ak: portKey(a.typeId, 'out', c.from.port), b, bk: portKey(b.typeId, 'in', c.to.port) });
  }
  const groups = (doc.groups || []).map((g) => {
    const members = (g.members || []).map((u) => byUid.get(u)).filter(Boolean);
    return members.length ? { group: new Group3D({ title: g.title, members }), collapsed: !!g.collapsed } : null;
  }).filter(Boolean);
  const nodes = entries.map((e) => e.inst);
  return {
    label: label || `Import ${nodes.length} component${nodes.length > 1 ? 's' : ''}`, nodes, skipped,
    do() {
      entries.forEach(({ inst, pos }) => world.addNode(inst, pos));
      for (const l of links) { const from = l.a.getPort(l.ak, 'out'), to = l.b.getPort(l.bk, 'in'); if (from && to && world.canConnect(from, to)) world.addConnection(from, to); }
      groups.forEach((g) => { world.addGroup(g.group); if (g.collapsed) g.group.setCollapsed(true, world); });
    },
    undo() {
      groups.forEach((g) => world.removeGroup(g.group));
      entries.forEach(({ inst }) => world.removeNode(inst));   // takes the attached connections with it
    },
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
    const inst = createInstance(def, { uid: n.uid, title: n.title, params: n.params, state: n.state, enabled: n.enabled, showPorts: n.showPorts });
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
    const from = a.getPort(portKey(a.typeId, 'out', c.from.port), 'out'), to = b.getPort(portKey(b.typeId, 'in', c.to.port), 'in');
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
  if (typeof doc.wiring === 'boolean') setWiring(doc.wiring);   // a saved world keeps its wiring setting
  world.changed('load');
  return { skipped, nodes: world.nodes.length, connections: world.connections.length, groups: world.groups.length };
}

export function downloadJSON(obj, filename = 'proto3d-world.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/**
 * Open the file picker and resolve with the parsed JSON (rejects on cancel / parse error).
 * With `{ withName: true }` it resolves `{ doc, name }`, the name being the file name without `.json`.
 */
export function pickJSONFile({ withName = false } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return reject(new Error('cancelled'));
      f.text().then((t) => { const doc = JSON.parse(t); resolve(withName ? { doc, name: f.name.replace(/\.json$/i, '') } : doc); }).catch(reject);
    });
    input.click();
  });
}
/** A file name the OS accepts, from a project name. */
export function safeFileName(name, ext = '.json') {
  const base = String(name || 'proto3d').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'proto3d';
  return base.toLowerCase().endsWith(ext) ? base : base + ext;
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

/**
 * The projects behind File → Open recent: the last few documents saved, opened or replaced,
 * newest first, each with its full JSON so it can be reopened without a file. A project is keyed
 * by name (saving it again replaces its entry); untitled scenes carry the time in their name.
 * Everything lives in one localStorage key; when the quota is hit the oldest entries are dropped.
 */
export class RecentProjects {
  constructor({ key = RECENT_KEY, limit = 8, maxBytes = 3 * 1024 * 1024 } = {}) {
    this.key = key; this.limit = limit; this.maxBytes = maxBytes;
    this._listeners = new Set();
    this.entries = [];
    try { const s = localStorage.getItem(key); const arr = s ? JSON.parse(s) : []; if (Array.isArray(arr)) this.entries = arr.filter((e) => e && e.id && e.doc); } catch (_) { this.entries = []; }
  }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _notify() { this._listeners.forEach((cb) => cb(this)); }
  /** Newest first: [{ id, name, savedAt, nodes, connections }] (without the documents). */
  list() { return this.entries.map(({ doc, ...meta }) => meta); }
  get(id) { return this.entries.find((e) => e.id === id) || null; }
  /** Store `doc` under `name`, replacing an entry of the same name. Returns false when it is too large to keep. */
  remember(name, doc) {
    if (!doc || !Array.isArray(doc.nodes) || !doc.nodes.length) return false;
    const json = JSON.stringify(doc);
    if (json.length > this.maxBytes) return false;
    const top = this.entries[0];
    if (top && top.name === name && JSON.stringify({ ...top.doc, savedAt: 0 }) === JSON.stringify({ ...doc, savedAt: 0 })) return true;   // unchanged since last time
    this.entries = this.entries.filter((e) => e.name !== name);
    this.entries.unshift({ id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, savedAt: doc.savedAt || new Date().toISOString(), nodes: doc.nodes.length, connections: (doc.connections || []).length, doc });
    this.entries = this.entries.slice(0, this.limit);
    this._persist();
    this._notify();
    return true;
  }
  remove(id) { const n = this.entries.length; this.entries = this.entries.filter((e) => e.id !== id); if (this.entries.length !== n) { this._persist(); this._notify(); } }
  clear() { this.entries = []; this._persist(); this._notify(); }
  _persist() {
    for (;;) {
      try { localStorage.setItem(this.key, JSON.stringify(this.entries)); return true; }
      catch (_) { if (!this.entries.length) return false; this.entries.pop(); }   // quota: drop the oldest and try again
    }
  }
}
