// project-store.js — every project this browser knows, in IndexedDB: the `projects` store holds
// one record per project (its latest document, the document it was last saved / opened as, the
// tab's view, a small thumbnail, its metadata `meta` — key, status, colour, tags, members, dates —
// and a task `index` computed from the document so the Home page lists tasks without loading
// documents), the `snapshots` store its version history (automatic on autosave, one per manual
// save, one before a restore, named ones kept for good) and the `people` store the browser's
// people directory (pm/people.js). The open tab set (ids + the active one) is small and stays in
// localStorage, as do all other settings. The
// round-5 localStorage documents (`proto3d.world.v2` autosave, `proto3d.recent.v1` recents) are
// migrated once into the store and removed. Also here: the canonical hash of a document (what
// "unsaved changes" and "changed materially" compare) and the one-line diff summary between two
// documents that the version history shows. Every call is best effort: without IndexedDB
// (private mode, blocked storage) the app runs in memory and the indicator says so.

export const DB_NAME = 'proto3d-projects', DB_VERSION = 2;
export const PROJECTS = 'projects', SNAPSHOTS = 'snapshots', PEOPLE = 'people';
export const TABS_KEY = 'proto3d.tabs.v1';
export const AUTOSAVE_ON_KEY = 'proto3d.autosave.v1';
export const LEGACY_KEYS = { world: 'proto3d.world.v2', recent: 'proto3d.recent.v1' };
/** Automatic snapshots kept per project (named ones are never dropped). */
export const AUTO_SNAPSHOT_LIMIT = 50;

export const newId = (prefix = 'p') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ---------- project metadata ---------- */
export const PROJECT_STATUSES = ['planning', 'active', 'on hold', 'done', 'archived'];
export const MEMBER_ROLES = ['owner', 'manager', 'member', 'viewer'];
/** The eight swatches the project dialog offers (a custom colour is allowed too). */
export const PROJECT_COLOURS = ['#5aa9ff', '#2dd4bf', '#34c99a', '#f5b942', '#ff7a45', '#ff4d5e', '#e25aa6', '#8b7cf6'];
/** A stable colour for an id (records that predate metadata). */
export const colourFor = (id) => PROJECT_COLOURS[parseInt(hashString(String(id || '')).slice(0, 4), 16) % PROJECT_COLOURS.length];
/** 2–6 uppercase letters / digits from a name: "Website relaunch" → "WR", "Q3 launch" → "Q3L", one word → its first letters. */
export function deriveKey(name) {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'PR';
  const key = words.length >= 2 ? words.map((w) => w[0]).join('').slice(0, 6) : words[0].slice(0, 3);
  return key.length < 2 ? `${key}X` : key;
}
/** `key`, or `key2`, `key3`… when another project already has it. */
export function uniqueKey(key, taken) {
  const used = new Set([...taken].map((k) => String(k || '').toUpperCase()));
  key = String(key || 'PR').toUpperCase();
  if (!used.has(key)) return key;
  for (let i = 2; i < 100; i++) { const k = `${key.slice(0, 5)}${i}`; if (!used.has(k)) return k; }
  return key;
}
/** A complete `meta` from a partial one (a record from DB v1, a document's `project`, a dialog's fields). */
export function normalizeMeta(m = {}, { id = '', name = '' } = {}) {
  const status = PROJECT_STATUSES.includes(m.status) ? m.status : 'active';
  return {
    key: String(m.key || deriveKey(name) || 'PR').toUpperCase().slice(0, 6),
    description: String(m.description || ''),
    status,
    colour: /^#[0-9a-f]{6}$/i.test(m.colour || '') ? m.colour : colourFor(id),
    tags: Array.isArray(m.tags) ? [...new Set(m.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 24) : [],
    members: Array.isArray(m.members) ? m.members.filter((x) => x && x.personId).map((x) => ({ personId: String(x.personId), role: MEMBER_ROLES.includes(x.role) ? x.role : 'member' })) : [],
    start: /^\d{4}-\d{2}-\d{2}$/.test(m.start || '') ? m.start : '',
    due: /^\d{4}-\d{2}-\d{2}$/.test(m.due || '') ? m.due : '',
    owner: m.owner ? String(m.owner) : '',
  };
}
export const isoToday = () => new Date().toISOString().slice(0, 10);
/**
 * The task index of a document (pure): every card of every Kanban board (done = in the last
 * column), a Timeline's own tasks, and the milestones. What the Home page lists and counts
 * without opening the document.
 */
export function indexDoc(doc) {
  const tasks = [], milestones = [];
  for (const n of doc?.nodes || []) {
    if (!n || !n.type) continue;
    if (n.type === 'kanban-board') {
      const cols = Array.isArray(n.params?.board?.columns) ? n.params.board.columns : [];
      cols.forEach((col, ci) => { for (const c of col?.cards || []) if (c && c.id) tasks.push({ id: c.id, title: String(c.title || ''), boardUid: n.uid, board: n.title || 'Board', column: col.title || '', columnIndex: ci, done: ci === cols.length - 1, assignee: c.assignee || '', due: c.due || '', start: c.start || '', priority: c.priority || 'medium', estimate: Number.isFinite(+c.estimate) ? +c.estimate : 1 }); });
    } else if (n.type === 'timeline') {
      for (const t of Array.isArray(n.params?.tasks) ? n.params.tasks : []) if (t && t.id) tasks.push({ id: t.id, title: String(t.title || ''), boardUid: n.uid, board: n.title || 'Timeline', column: t.done ? 'Done' : 'Planned', columnIndex: t.done ? 1 : 0, done: !!t.done, assignee: t.assignee || '', due: t.due || t.end || '', start: t.start || '', priority: t.priority || 'medium', estimate: Number.isFinite(+t.estimate) ? +t.estimate : 1, kind: 'task' });
    } else if (n.type === 'milestone') milestones.push({ uid: n.uid, title: n.title || 'Milestone', date: n.params?.date || '' });
  }
  return { tasks, milestones, updatedAt: Date.now() };
}
/** Counts for a card: total, done, doneRatio, overdue, the next due date and the people assigned — from `rec.index` (computed on the fly when missing). */
export function projectStats(rec, today = isoToday()) {
  const idx = rec?.index || indexDoc(rec?.doc);
  const tasks = idx.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const upcoming = open.filter((t) => t.due && t.due >= today).map((t) => t.due).sort();
  const dated = open.filter((t) => t.due).map((t) => t.due).sort();
  const people = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))];
  return { total: tasks.length, done, doneRatio: tasks.length ? done / tasks.length : 0, overdue, nextDue: upcoming[0] || dated[0] || null, people, milestones: idx.milestones || [] };
}
/** A stored record with `meta` and `index` filled in (records written before DB v2 have neither). */
export function withMeta(rec) {
  if (!rec) return rec;
  if (!rec.meta || !rec.meta.key) rec.meta = normalizeMeta({ ...(rec.doc?.project || {}), ...(rec.meta || {}) }, { id: rec.id, name: rec.name });
  if (!rec.index) rec.index = indexDoc(rec.doc);
  return rec;
}

/* ---------- document identity ---------- */
/** The part of a document that is content: nodes, connections (with their routes), shared route nodes and groups (not the camera, the name, the time or the wiring switch). */
export function canonical(doc) {
  if (!doc) return '';
  return JSON.stringify({ n: doc.nodes || [], c: doc.connections || [], g: doc.groups || [], ...(doc.routeNodes?.length ? { r: doc.routeNodes } : {}) });
}
/** FNV-1a over a string, as 8 hex digits. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const docHash = (doc) => hashString(canonical(doc));
/** Bytes a document takes as JSON text (UTF-8). */
export function docBytes(doc) {
  const s = JSON.stringify(doc || null);
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdfff ? 2 : 3; }
  return n;
}
export function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ---------- diff summary ---------- */
const connKey = (c) => `${c.from?.node}:${c.from?.port}>${c.to?.node}:${c.to?.port}${c.route ? `|${JSON.stringify(c.route)}` : ''}`;
/**
 * What changed from `prev` to `next`: counts and a one-line text such as
 * "+2 components · −1 · 1 renamed · 3 cables · 4 params". `prev` null means the first version.
 */
export function summarizeDiff(prev, next) {
  const out = { added: 0, removed: 0, renamed: 0, connections: 0, params: 0, moved: 0, groups: 0, first: !prev, text: '' };
  const a = new Map((prev?.nodes || []).map((n) => [n.uid, n])), b = new Map((next?.nodes || []).map((n) => [n.uid, n]));
  for (const [uid, n] of b) {
    const o = a.get(uid);
    if (!o) { out.added++; continue; }
    if ((o.title || '') !== (n.title || '')) out.renamed++;
    if (JSON.stringify(o.params || {}) !== JSON.stringify(n.params || {}) || JSON.stringify(o.state ?? null) !== JSON.stringify(n.state ?? null) || !!o.enabled !== !!n.enabled) out.params++;
    const p = o.position || [], q = n.position || [];
    if (p.some((v, i) => Math.abs(v - (q[i] ?? 0)) > 0.01) || Math.abs((o.rotationY || 0) - (n.rotationY || 0)) > 1e-3 || Math.abs((o.scale || 1) - (n.scale || 1)) > 1e-3) out.moved++;
  }
  for (const uid of a.keys()) if (!b.has(uid)) out.removed++;
  const ca = new Set((prev?.connections || []).map(connKey)), cb = new Set((next?.connections || []).map(connKey));
  for (const k of cb) if (!ca.has(k)) out.connections++;
  for (const k of ca) if (!cb.has(k)) out.connections++;
  const ga = JSON.stringify((prev?.groups || []).map((g) => [g.uid, g.title, g.members, !!g.collapsed]).sort()), gb = JSON.stringify((next?.groups || []).map((g) => [g.uid, g.title, g.members, !!g.collapsed]).sort());
  if (ga !== gb) out.groups = Math.abs((prev?.groups || []).length - (next?.groups || []).length) || 1;
  const parts = [];
  if (out.first) parts.push(`${(next?.nodes || []).length} component${(next?.nodes || []).length === 1 ? '' : 's'}`);
  else {
    if (out.added) parts.push(`+${out.added} component${out.added > 1 ? 's' : ''}`);
    if (out.removed) parts.push(`−${out.removed} component${out.removed > 1 ? 's' : ''}`);
    if (out.renamed) parts.push(`${out.renamed} renamed`);
    if (out.connections) parts.push(`${out.connections} cable${out.connections > 1 ? 's' : ''} changed`);
    if (out.params) parts.push(`${out.params} param${out.params > 1 ? 's' : ''} changed`);
    if (out.groups) parts.push(`${out.groups} group${out.groups > 1 ? 's' : ''} changed`);
    if (!parts.length && out.moved) parts.push(`${out.moved} moved`);
  }
  out.text = out.first ? `First version · ${parts[0]}` : parts.length ? parts.join(' · ') : 'No content change';
  out.material = out.first || out.added + out.removed + out.renamed + out.connections + out.params + out.groups > 0;
  return out;
}

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) { const s = db.createObjectStore(PROJECTS, { keyPath: 'id' }); s.createIndex('openedAt', 'openedAt'); }
      if (!db.objectStoreNames.contains(SNAPSHOTS)) { const s = db.createObjectStore(SNAPSHOTS, { keyPath: 'id' }); s.createIndex('project', 'projectId'); }
      if (!db.objectStoreNames.contains(PEOPLE)) db.createObjectStore(PEOPLE, { keyPath: 'id' });   // v2: the people directory
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}
const reqResult = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** Strip what a listing does not need (the documents and the thumbnail are the bulk). */
export const projectMeta = ({ doc, baseDoc, ...meta }) => ({ ...meta, nodes: meta.nodes ?? doc?.nodes?.length ?? 0, connections: meta.connections ?? doc?.connections?.length ?? 0 });

export class ProjectStore {
  constructor() {
    this.available = false;
    this.error = null;
    this._db = null;
    this.ready = openDB().then((db) => { this._db = db; this.available = true; db.onversionchange = () => { db.close(); this._db = null; this.available = false; }; return true; })
      .catch((e) => { this.error = e; this.available = false; return false; });
  }
  async _tx(stores, mode, fn) {
    await this.ready;
    if (!this._db) throw this.error || new Error('IndexedDB unavailable');
    return new Promise((resolve, reject) => {
      const t = this._db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((r) => { out = r; }).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  }

  /* projects */
  async putProject(rec) { return this._tx(PROJECTS, 'readwrite', (t) => { t.objectStore(PROJECTS).put(rec); return rec.id; }); }
  async getProject(id) { try { return withMeta(await this._tx(PROJECTS, 'readonly', (t) => reqResult(t.objectStore(PROJECTS).get(id)))) || null; } catch (_) { return null; } }
  /** Every project, most recently opened first; `withDocs` keeps the documents (default: metadata, index and thumbnail only). */
  async listProjects({ withDocs = false } = {}) {
    try {
      const all = await this._tx(PROJECTS, 'readonly', (t) => reqResult(t.objectStore(PROJECTS).getAll()));
      const list = (all || []).filter((r) => r && r.id).map(withMeta).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
      return withDocs ? list : list.map(projectMeta);
    } catch (_) { return []; }
  }
  /** Merge `patch` into a stored record's `meta` (and `name` when given) without touching its document. Returns the record, or null. */
  async patchProject(id, { name, ...meta } = {}) {
    try {
      return await this._tx(PROJECTS, 'readwrite', async (t) => {
        const s = t.objectStore(PROJECTS); const rec = withMeta(await reqResult(s.get(id))); if (!rec) return null;
        rec.meta = normalizeMeta({ ...rec.meta, ...meta }, { id: rec.id, name: name ?? rec.name });
        if (name !== undefined) rec.name = name || null;
        if (rec.doc) rec.doc = { ...rec.doc, name: rec.name || rec.doc.name, project: rec.meta };
        s.put(rec); return rec;
      });
    } catch (_) { return null; }
  }

  /* people (the directory) */
  async putPerson(p) { return this._tx(PEOPLE, 'readwrite', (t) => { t.objectStore(PEOPLE).put(p); return p.id; }); }
  async getPerson(id) { try { return (await this._tx(PEOPLE, 'readonly', (t) => reqResult(t.objectStore(PEOPLE).get(id)))) || null; } catch (_) { return null; } }
  async listPeople() { try { return ((await this._tx(PEOPLE, 'readonly', (t) => reqResult(t.objectStore(PEOPLE).getAll()))) || []).filter((p) => p && p.id).sort((a, b) => String(a.name).localeCompare(String(b.name))); } catch (_) { return []; } }
  async removePerson(id) { try { await this._tx(PEOPLE, 'readwrite', (t) => { t.objectStore(PEOPLE).delete(id); }); return true; } catch (_) { return false; } }
  async removeProject(id) {
    try {
      await this._tx([PROJECTS, SNAPSHOTS], 'readwrite', async (t) => {
        t.objectStore(PROJECTS).delete(id);
        const keys = await reqResult(t.objectStore(SNAPSHOTS).index('project').getAllKeys(id));
        for (const k of keys) t.objectStore(SNAPSHOTS).delete(k);
      });
      return true;
    } catch (_) { return false; }
  }

  /* snapshots */
  async addSnapshot(rec) { return this._tx(SNAPSHOTS, 'readwrite', (t) => { t.objectStore(SNAPSHOTS).put(rec); return rec.id; }); }
  /** A project's snapshots, newest first, without their documents unless asked. */
  async listSnapshots(projectId, { withDocs = false } = {}) {
    try {
      const all = await this._tx(SNAPSHOTS, 'readonly', (t) => reqResult(t.objectStore(SNAPSHOTS).index('project').getAll(projectId)));
      const list = (all || []).sort((a, b) => b.at - a.at);
      return withDocs ? list : list.map(({ doc, ...m }) => m);
    } catch (_) { return []; }
  }
  async getSnapshot(id) { try { return (await this._tx(SNAPSHOTS, 'readonly', (t) => reqResult(t.objectStore(SNAPSHOTS).get(id)))) || null; } catch (_) { return null; } }
  async updateSnapshot(id, patch) {
    return this._tx(SNAPSHOTS, 'readwrite', async (t) => { const s = t.objectStore(SNAPSHOTS); const rec = await reqResult(s.get(id)); if (!rec) return null; Object.assign(rec, patch); s.put(rec); return rec; });
  }
  async removeSnapshot(id) { try { await this._tx(SNAPSHOTS, 'readwrite', (t) => { t.objectStore(SNAPSHOTS).delete(id); }); return true; } catch (_) { return false; } }
  /** Drop the oldest unnamed snapshots beyond `keep`; returns how many went. */
  async pruneSnapshots(projectId, keep = AUTO_SNAPSHOT_LIMIT) {
    try {
      return await this._tx(SNAPSHOTS, 'readwrite', async (t) => {
        const s = t.objectStore(SNAPSHOTS);
        const all = (await reqResult(s.index('project').getAll(projectId))).filter((r) => !r.label).sort((a, b) => b.at - a.at);
        const extra = all.slice(keep);
        extra.forEach((r) => s.delete(r.id));
        return extra.length;
      });
    } catch (_) { return 0; }
  }
  /** Remove a project's unnamed snapshots older than `olderThanMs` (0 = all of them); named ones stay. */
  async clearSnapshots(projectId, olderThanMs = 0) {
    try {
      const cutoff = Date.now() - olderThanMs;
      return await this._tx(SNAPSHOTS, 'readwrite', async (t) => {
        const s = t.objectStore(SNAPSHOTS);
        const all = await reqResult(s.index('project').getAll(projectId));
        let n = 0;
        for (const r of all) if (!r.label && r.at <= cutoff) { s.delete(r.id); n++; }
        return n;
      });
    } catch (_) { return 0; }
  }

  /* size */
  /** Bytes held: per project (documents + snapshots) and overall. */
  async bytes() {
    try {
      return await this._tx([PROJECTS, SNAPSHOTS], 'readonly', async (t) => {
        const projects = await reqResult(t.objectStore(PROJECTS).getAll()), snaps = await reqResult(t.objectStore(SNAPSHOTS).getAll());
        const per = new Map();
        for (const p of projects) per.set(p.id, { project: (p.bytes || docBytes(p.doc)) + (p.baseDoc ? docBytes(p.baseDoc) : 0) + (p.thumb?.length || 0), snapshots: 0, count: 0 });
        for (const s of snaps) { const e = per.get(s.projectId) || { project: 0, snapshots: 0, count: 0 }; e.snapshots += s.bytes || docBytes(s.doc); e.count++; per.set(s.projectId, e); }
        let total = 0; for (const e of per.values()) total += e.project + e.snapshots;
        return { per, total, projects: projects.length, snapshots: snaps.length };
      });
    } catch (_) { return { per: new Map(), total: 0, projects: 0, snapshots: 0 }; }
  }
  /** navigator.storage.estimate(), or null. */
  async estimate() {
    try { if (!navigator.storage?.estimate) return null; const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch (_) { return null; }
  }

  /* migration */
  /**
   * Read the round-5 localStorage documents once: the autosaved world becomes the project of the
   * first tab, each recent entry a closed project. Returns { active, projects } (records ready to
   * store, `active` possibly null); `forgetLegacy()` removes the old keys once they are stored.
   */
  readLegacy() {
    const out = { active: null, projects: [] };
    const now = Date.now();
    try {
      const raw = localStorage.getItem(LEGACY_KEYS.recent);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) for (const e of arr) {
        if (!e || !e.doc || !Array.isArray(e.doc.nodes)) continue;
        const at = e.savedAt ? new Date(e.savedAt).getTime() || now : now;
        out.projects.push(makeRecord({ id: e.id || newId(), name: e.name || null, doc: e.doc, baseDoc: e.doc, savedAt: at, openedAt: at, createdAt: at }));
      }
    } catch (_) { /* ignore */ }
    try {
      const raw = localStorage.getItem(LEGACY_KEYS.world);
      const doc = raw ? JSON.parse(raw) : null;
      if (doc && Array.isArray(doc.nodes) && doc.nodes.length) {
        const name = doc.name && doc.name !== 'untitled' ? doc.name : null;
        const same = name ? out.projects.find((p) => p.name === name) : null;
        if (same) { same.doc = doc; same.dirty = docHash(doc) !== docHash(same.baseDoc); same.openedAt = now; out.active = same; }
        else out.active = makeRecord({ id: newId(), name, doc, baseDoc: null, dirty: true, openedAt: now, createdAt: now });
        if (!same) out.projects.unshift(out.active);
      }
    } catch (_) { /* ignore */ }
    return out;
  }
  forgetLegacy() { try { localStorage.removeItem(LEGACY_KEYS.world); localStorage.removeItem(LEGACY_KEYS.recent); } catch (_) { /* ignore */ } }
}

/** A project record with every field the store and the tabs expect. */
export function makeRecord({ id = newId(), name = null, doc, baseDoc = null, dirty = false, view = null, savedAt = 0, openedAt = Date.now(), createdAt = Date.now(), thumb = null, lastSnapshotAt = 0, lastSnapshotHash = '', meta = null, index = null } = {}) {
  return { id, name, doc, baseDoc, dirty, view, savedAt, autosavedAt: 0, openedAt, createdAt, thumb, lastSnapshotAt, lastSnapshotHash, bytes: docBytes(doc), nodes: doc?.nodes?.length || 0, connections: doc?.connections?.length || 0, meta: normalizeMeta(meta || doc?.project || {}, { id, name }), index: index || indexDoc(doc) };
}
export const projectStore = new ProjectStore();
