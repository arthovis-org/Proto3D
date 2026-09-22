// tabs.js — the open projects. One World renders at a time; every other tab keeps its scene
// objects detached (`World.detach`, no disposal, no render cost), its undo / redo stacks, its
// camera pose, 2D mode, selection and wiring setting, so switching swaps them back in without a
// reload. The manager also owns persistence: the active tab is autosaved into IndexedDB (a
// debounce after the last change, `project-store.js`) with an autosave status the strip shows,
// a version snapshot is taken when the content changed and the last one is older than
// `snapshotInterval` (plus one on every manual save and before a restore), the open tab set lives
// in localStorage so a reload restores every tab and the active one. main.js hands it hooks for
// what only it can do (serialize the world, load a document, capture / apply the camera and 2D
// mode, take a thumbnail, show the themed close dialog, download JSON, toast).
//
//   dirty    the document differs from the one last saved (Save / Save as…) or opened — the dot on
//            the tab and what the close dialog asks about; autosave to the browser is separate
//   untouched empty  a new, unnamed, never edited tab: Open / Open recent / Examples load into it
//            instead of opening another tab
//   preview  a read-only tab showing an old version (history locked, never persisted)
//   meta     the project's metadata (key, status, colour, tags, members, dates — project-store.js
//            `normalizeMeta`): stored on the record, written into the document as `project`,
//            edited through `setMeta` / `patchProject` (the Home page and the project dialog)
import { World } from './core/world.js';
import { FORMAT_VERSION } from './serialize.js';
import { isWiringOn, setWiring } from './wiring.js';
import { projectStore as defaultStore, makeRecord, docHash, docBytes, summarizeDiff, newId, normalizeMeta, indexDoc, uniqueKey, TABS_KEY, AUTOSAVE_ON_KEY, AUTO_SNAPSHOT_LIMIT, LEGACY_KEYS } from './project-store.js';

export const TAB_LIMIT = 8;
export const AUTOSAVE_DELAY = 1500;
export const SNAPSHOT_INTERVAL = 2 * 60 * 1000;

export const emptyDoc = (name = null) => ({ app: 'proto3d', version: FORMAT_VERSION, name: name || 'untitled', savedAt: new Date().toISOString(), nodes: [], connections: [], groups: [] });
const EMPTY_HASH = docHash(emptyDoc());
const uidOf = (item) => item?.uid || null;

export class Tabs {
  constructor({ world, history, selection, store = defaultStore, hooks = {}, limit = TAB_LIMIT, autosaveDelay = AUTOSAVE_DELAY, snapshotInterval = SNAPSHOT_INTERVAL } = {}) {
    Object.assign(this, { world, history, selection, store, hooks, limit, autosaveDelay, snapshotInterval });
    this.tabs = [];
    this.activeId = null;
    this._suspend = 0;
    this._t = 0;
    this._seq = 0;                // bumps on every change (a save that finished late must not report "saved")
    this._listeners = new Set(); this._statusListeners = new Set(); this._versionListeners = new Set();
    this.status = { state: 'saved', at: 0 };
    this.autosaveOn = true;
    try { this.autosaveOn = localStorage.getItem(AUTOSAVE_ON_KEY) !== '0'; } catch (_) { /* ignore */ }
    world.onChange((what) => this._onWorldChange(what));
    window.addEventListener('pagehide', () => { if (this._t) this.saveNow({ reason: 'auto' }); });
  }

  /* ---------- listeners ---------- */
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  onStatus(cb) { this._statusListeners.add(cb); return () => this._statusListeners.delete(cb); }
  onVersions(cb) { this._versionListeners.add(cb); return () => this._versionListeners.delete(cb); }
  _notify() { this._listeners.forEach((cb) => cb(this)); }
  _setStatus(state, extra = {}) { this.status = { state, at: this.active?.autosavedAt || 0, ...extra }; this._statusListeners.forEach((cb) => cb(this.status, this)); }
  _notifyVersions() { this._versionListeners.forEach((cb) => cb(this)); }

  /* ---------- lookups ---------- */
  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }
  byId(id) { return this.tabs.find((t) => t.id === id) || null; }
  indexOf(id) { return this.tabs.findIndex((t) => t.id === id); }
  get canOpenMore() { return this.tabs.length < this.limit; }
  /** A new, unnamed, never edited tab: documents open into it rather than beside it. */
  isUntouchedEmpty(tab) {
    if (!tab || tab.preview || tab.name || tab.dirty || tab.savedAt) return false;
    if (tab.history?.undo?.length || (tab === this.active && this.history.canUndo)) return false;
    return tab === this.active ? this.world.nodes.length === 0 : !(tab.doc?.nodes?.length);
  }
  displayName(tab) { return tab?.name || 'Untitled'; }

  /* ---------- boot ---------- */
  /**
   * Open the store, migrate the round-5 localStorage documents once, then restore the saved tab
   * set (each tab's document from IndexedDB) and the active tab. Resolves true when a tab was
   * restored; the caller opens its default scene otherwise.
   */
  async init() {
    await this.store.ready;
    if (!this.store.available) { this._setStatus('off', { reason: 'no-storage' }); return false; }
    let legacy = false;
    try { legacy = !!(localStorage.getItem(LEGACY_KEYS.world) || localStorage.getItem(LEGACY_KEYS.recent)); } catch (_) { /* ignore */ }
    let key = this._readKey();
    if (legacy) {
      const { active, projects } = this.store.readLegacy();
      try {
        for (const p of projects) await this.store.putProject(p);
        if (active && !key.open.includes(active.id)) { key.open.unshift(active.id); key.active = active.id; }
        this.store.forgetLegacy();
      } catch (_) { /* keep the legacy keys for the next try */ }
    }
    for (const id of key.open.slice(0, this.limit)) {
      const rec = await this.store.getProject(id);
      if (rec && rec.doc) this.tabs.push(this._fromRecord(rec));
    }
    if (!this.tabs.length) return false;
    this.activate(this.byId(key.active) ? key.active : this.tabs[0].id, { initial: true });
    return true;
  }
  _readKey() { try { const k = JSON.parse(localStorage.getItem(TABS_KEY) || 'null'); if (k && Array.isArray(k.open)) return { open: k.open.filter((x) => typeof x === 'string'), active: k.active || null }; } catch (_) { /* ignore */ } return { open: [], active: null }; }
  _writeKey() { try { localStorage.setItem(TABS_KEY, JSON.stringify({ open: this.tabs.filter((t) => !t.preview).map((t) => t.id), active: this.active?.preview ? (this.active.sourceId || null) : this.activeId })); } catch (_) { /* ignore */ } }

  /* ---------- tab records ---------- */
  _fromRecord(rec) {
    const baseDoc = rec.baseDoc || null;
    return {
      id: rec.id, name: rec.name || null, doc: rec.doc, baseDoc, baseHash: baseDoc ? docHash(baseDoc) : EMPTY_HASH, dirty: !!rec.dirty,
      live: null, history: null, view: rec.view || null, wiring: typeof rec.doc?.wiring === 'boolean' ? rec.doc.wiring : null, selectionUids: [], preview: false,
      savedAt: rec.savedAt || 0, autosavedAt: rec.autosavedAt || 0, openedAt: rec.openedAt || Date.now(), createdAt: rec.createdAt || Date.now(),
      lastSnapshotAt: rec.lastSnapshotAt || 0, lastSnapshotHash: rec.lastSnapshotHash || '', lastSnapshotDoc: undefined, thumb: rec.thumb || null, thumbAt: 0, bytes: rec.bytes || docBytes(rec.doc),
      meta: normalizeMeta(rec.meta || rec.doc?.project || {}, { id: rec.id, name: rec.name }),
    };
  }
  _record(tab) {
    if (tab === this.active) { tab.view = this.hooks.captureView?.() || tab.view; }
    const rec = makeRecord({ id: tab.id, name: tab.name, doc: tab.doc, baseDoc: tab.baseDoc, dirty: tab.dirty, view: tab.view, savedAt: tab.savedAt, openedAt: tab.openedAt, createdAt: tab.createdAt, thumb: tab.thumb, lastSnapshotAt: tab.lastSnapshotAt, lastSnapshotHash: tab.lastSnapshotHash, meta: tab.meta, index: indexDoc(tab.doc) });
    rec.autosavedAt = tab.autosavedAt;
    return rec;
  }
  async _persist(tab) {
    if (tab.preview) return true;
    if (!this.store.available) return false;
    try { await this.store.putProject(this._record(tab)); return true; } catch (_) { return false; }
  }
  _makeTab({ id = newId(), name = null, doc = null, baseDoc = undefined, view = null, preview = false, sourceId = null, snapshotId = null } = {}) {
    doc = doc || emptyDoc(name);
    const base = baseDoc === undefined ? doc : baseDoc;
    const baseHash = base ? docHash(base) : EMPTY_HASH;
    return {
      id, name, doc, baseDoc: base, baseHash, dirty: docHash(doc) !== baseHash, live: null, history: null, view, wiring: typeof doc.wiring === 'boolean' ? doc.wiring : isWiringOn(), selectionUids: [], preview, sourceId, snapshotId,
      savedAt: 0, autosavedAt: 0, openedAt: Date.now(), createdAt: Date.now(), lastSnapshotAt: 0, lastSnapshotHash: '', lastSnapshotDoc: null, thumb: null, thumbAt: 0, bytes: docBytes(doc),
      meta: normalizeMeta(doc.project || {}, { id, name }),   // a file saved with metadata brings it along
    };
  }

  /* ---------- open / new ---------- */
  /** Open a fresh tab (File → New): empty unless `doc` is given. Returns the tab, or null at the limit. */
  newTab(opts = {}) {
    if (!this.canOpenMore) { this.hooks.toast?.(`Up to ${this.limit} files can be open at once · close one first`, 2600); return null; }
    const tab = this._makeTab(opts);
    const i = this.indexOf(this.activeId);
    this.tabs.splice(i >= 0 ? i + 1 : this.tabs.length, 0, tab);
    if (opts.activate !== false) this.activate(tab.id); else { this._writeKey(); this._notify(); }
    if (!tab.preview) this._persist(tab).then((ok) => { if (ok && !tab.autosavedAt) { tab.autosavedAt = Date.now(); if (tab === this.active) this._setStatus(this.status.state); } });   // a record from the start, so a reload keeps even an empty tab
    return tab;
  }
  /**
   * Open a document (Open…, a dropped file, Open recent): into the active tab when it is an
   * untouched empty project, else in a new tab; a project already open just comes to the front.
   */
  openDoc(doc, { name = null, id = null, baseDoc = undefined, view = null, record = null } = {}) {
    if (id && this.byId(id)) { this.activate(id); return this.byId(id); }
    const cur = this.active;
    if (cur && this.isUntouchedEmpty(cur)) {
      const fresh = record ? this._fromRecord(record) : this._makeTab({ id: id || cur.id, name, doc, baseDoc, view });
      if (fresh.id !== cur.id) this.store.removeProject(cur.id);
      const idx = this.indexOf(cur.id);
      this._suspend++;
      World.disposeDetached(this.world.detach()); this.history.swap({ undo: [], redo: [] });
      this._suspend--;
      this.tabs[idx] = fresh;
      this.activeId = null;
      this.activate(fresh.id);
      return fresh;
    }
    if (!this.canOpenMore) { this.hooks.toast?.(`Up to ${this.limit} files can be open at once · close one first`, 2600); return null; }
    if (record) {
      const tab = this._fromRecord(record);
      const i = this.indexOf(this.activeId);
      this.tabs.splice(i >= 0 ? i + 1 : this.tabs.length, 0, tab);
      this.activate(tab.id);
      return tab;
    }
    return this.newTab({ id: id || undefined, name, doc, baseDoc, view });
  }
  /** Open a stored project (File → Open recent). */
  openRecord(rec) { return this.openDoc(rec.doc, { id: rec.id, record: rec }); }
  /**
   * Rebuild the active tab's content in place (an example scene): `fn` fills the world; the result
   * becomes the tab's document and its saved base. Untouched empty tabs are reused, others get a new tab.
   */
  replaceActive(fn, { name = null } = {}) {
    let tab = this.active;
    if (!tab || !this.isUntouchedEmpty(tab)) { tab = this.newTab({ name }); if (!tab) return null; }
    this._suspend++;
    this.hooks.beforeSwitch?.();
    this.selection.clear(); this.history.swap({ undo: [], redo: [] });
    fn(tab);
    this._suspend--;
    tab.name = name;
    const doc = this.hooks.serialize(tab.name);
    tab.doc = doc; tab.baseDoc = doc; tab.baseHash = docHash(doc); tab.dirty = false; tab.bytes = docBytes(doc);
    tab.lastSnapshotAt = 0; tab.lastSnapshotHash = ''; tab.lastSnapshotDoc = null; tab.wiring = isWiringOn();
    this.hooks.afterSwitch?.(tab);
    this._notify();
    this.saveNow({ reason: 'auto' });
    return tab;
  }

  /* ---------- switching ---------- */
  activate(id, { initial = false } = {}) {
    const tab = this.byId(id);
    if (!tab || (tab.id === this.activeId && !initial)) return false;
    const prev = this.active;
    if (prev) this._park(prev);
    this._show(tab);
    this._writeKey();
    this._notify();
    this._setStatus(tab.preview ? 'preview' : !this.store.available ? 'off' : !this.autosaveOn ? 'off' : this._t ? 'unsaved' : 'saved');
    return true;
  }
  /** Active → background: keep the scene, the stacks and the view, write the record. */
  _park(tab) {
    this.hooks.beforeSwitch?.();
    tab.view = this.hooks.captureView?.() || tab.view;
    tab.wiring = isWiringOn();
    tab.selectionUids = this.selection.items.map(uidOf).filter(Boolean);
    const pending = !!this._t; clearTimeout(this._t); this._t = 0;
    this._suspend++;
    if (!tab.preview) { tab.doc = this.hooks.serialize(tab.name); tab.bytes = docBytes(tab.doc); if (pending) tab.dirty = docHash(tab.doc) !== tab.baseHash; }
    tab.live = this.world.detach();
    tab.history = this.history.swap({ undo: [], redo: [] });
    this._suspend--;
    if (pending) { this._persist(tab).then(() => { tab.autosavedAt = Date.now(); }); }
  }
  /** Background → active: the kept scene, or the document when the tab was restored from storage. */
  _show(tab) {
    this._suspend++;
    if (tab.live) { this.world.attach(tab.live); tab.live = null; }
    else if (tab.doc) { try { this.hooks.load(tab.doc); } catch (e) { console.warn('tab load failed:', e.message); this.world.clear(); } }
    this.history.swap(tab.history || { undo: [], redo: [] }); tab.history = null;
    this.history.locked = !!tab.preview;
    if (typeof tab.wiring === 'boolean') setWiring(tab.wiring);
    this.hooks.applyView?.(tab.view, tab.doc);
    if (tab.selectionUids?.length) {
      const items = tab.selectionUids.map((u) => this.world.nodeByUid(u) || this.world.groupByUid(u) || this.world.connectionByUid(u)).filter(Boolean);
      if (items.length) this.selection.set(items);
    }
    this._suspend--;
    this.activeId = tab.id; tab.openedAt = Date.now();
    this.hooks.afterSwitch?.(tab);
  }
  cycle(dir = 1) {
    if (this.tabs.length < 2) return false;
    const i = this.indexOf(this.activeId);
    return this.activate(this.tabs[((i + dir) % this.tabs.length + this.tabs.length) % this.tabs.length].id);
  }
  move(id, toIndex) {
    const from = this.indexOf(id); if (from < 0) return false;
    const to = Math.max(0, Math.min(this.tabs.length - 1, toIndex));
    if (from === to) return false;
    const [t] = this.tabs.splice(from, 1); this.tabs.splice(to, 0, t);
    this._writeKey(); this._notify();
    return true;
  }
  rename(id, name) {
    const tab = this.byId(id); if (!tab) return false;
    tab.name = name ? String(name).trim() || null : null;
    if (tab === this.active) this.hooks.afterSwitch?.(tab);
    this._persist(tab); this._notify();
    return true;
  }

  /* ---------- project metadata (Home page, project dialog) ---------- */
  /** Merge `patch` into an open tab's metadata (`patch.name` renames it too); persists and notifies. */
  setMeta(id, patch = {}) {
    const tab = this.byId(id); if (!tab || tab.preview) return false;
    const { name, ...meta } = patch;
    if (name !== undefined) { tab.name = name ? String(name).trim() || null : null; if (tab === this.active) this.hooks.afterSwitch?.(tab); }
    tab.meta = normalizeMeta({ ...tab.meta, ...meta }, { id: tab.id, name: tab.name });
    if (tab.doc) tab.doc = { ...tab.doc, name: tab.name || tab.doc.name, project: tab.meta };
    this._persist(tab); this._notify();
    return true;
  }
  /** Metadata of any project: an open tab through `setMeta`, a closed one straight in the store. Resolves true when something was written. */
  async patchProject(id, patch = {}) {
    if (this.byId(id)) return this.setMeta(id, patch);
    const rec = await this.store.patchProject(id, patch);
    this._notify();
    return !!rec;
  }
  /**
   * Home's Tasks view edits a board that is not in the world: a background tab's detached node
   * gets the params in place (and its document, so a reload agrees), a closed project's stored
   * document is patched and reindexed. The active tab goes through commands instead (main.js).
   * Resolves 'background' | 'closed' | null.
   */
  async patchNodeParams(projectId, uid, params) {
    const tab = this.byId(projectId);
    if (tab) {
      if (tab === this.active || tab.preview) return null;
      const live = tab.live?.nodes?.find((n) => n.uid === uid);
      if (live) { Object.assign(live.params, params); live.faceDirty = true; }
      const rec = (tab.doc?.nodes || []).find((n) => n.uid === uid);
      if (rec) rec.params = { ...rec.params, ...params };
      if (!live && !rec) return null;
      tab.doc = { ...tab.doc }; tab.bytes = docBytes(tab.doc); tab.dirty = docHash(tab.doc) !== tab.baseHash;
      await this._persist(tab); this._notify();
      return 'background';
    }
    const rec = await this.store.patchNodeParams(projectId, uid, params);
    this._notify();
    return rec ? 'closed' : null;
  }
  /** Every project key in the browser (uniqueness in the dialog), except `exceptId`'s. */
  async projectKeys(exceptId = null) { const list = await this.store.listProjects(); return list.filter((p) => p.id !== exceptId).map((p) => p.meta?.key).filter(Boolean); }
  /** A stored copy of a project (open or closed) under "<name> (copy)" with a fresh key; not opened. Resolves the new record, or null. */
  async duplicateProject(id) {
    const tab = this.byId(id);
    const rec = tab ? this._record(tab) : await this.store.getProject(id);
    if (!rec || !rec.doc) return null;
    if (tab === this.active) rec.doc = this.hooks.serialize(tab.name);
    const name = `${rec.name || 'Untitled'} (copy)`;
    const keys = await this.projectKeys();
    const copy = makeRecord({ id: newId(), name, doc: { ...rec.doc, name }, baseDoc: null, dirty: true, view: rec.view, thumb: rec.thumb, meta: { ...rec.meta, key: uniqueKey(rec.meta?.key, keys) } });
    copy.doc.project = copy.meta;
    try { await this.store.putProject(copy); } catch (_) { return null; }
    this._notify();
    return copy;
  }
  /** Remove a project from the browser: its tab (without asking) and its record with every version. */
  async deleteProject(id) {
    if (this.byId(id)) await this.close(id, { force: true });
    const ok = await this.store.removeProject(id);
    this._notify();
    return ok;
  }

  /* ---------- close ---------- */
  /** Close a tab; a dirty one asks (hooks.confirmClose → 'save' | 'discard' | 'cancel'). Resolves true when closed. */
  async close(id, { force = false } = {}) {
    const tab = this.byId(id); if (!tab) return false;
    if (tab.preview) { /* nothing to keep */ }
    else if (tab.dirty && !force) {
      const choice = await this.hooks.confirmClose?.(tab);
      if (!this.byId(id)) return false;
      if (choice === 'save') {
        const doc = tab === this.active ? this.hooks.serialize(tab.name) : tab.doc;
        const name = tab.name || this.hooks.defaultName?.() || 'proto3d';
        this.hooks.download?.(doc, name);
        tab.name = name; tab.doc = doc; tab.baseDoc = doc; tab.baseHash = docHash(doc); tab.dirty = false; tab.savedAt = Date.now();
        await this._snapshot(tab, doc, 'manual');
        await this._persist(tab);
      } else if (choice === 'discard') {
        if (tab.baseDoc && tab.baseDoc.nodes?.length) { tab.doc = tab.baseDoc; tab.dirty = false; tab.view = null; tab.bytes = docBytes(tab.doc); await this._persist(tab); }
        else await this.store.removeProject(tab.id);
      } else return false;
    } else {
      if (tab === this.active) await this.saveNow({ reason: 'auto', force: true, quiet: true }); else await this._persist(tab);
    }
    if (!this.byId(id)) return false;
    const idx = this.indexOf(id), wasActive = tab.id === this.activeId;
    if (wasActive) {
      clearTimeout(this._t); this._t = 0;
      this.hooks.beforeSwitch?.();
      this._suspend++;
      World.disposeDetached(this.world.detach()); this.history.swap({ undo: [], redo: [] }); this.history.locked = false;
      this._suspend--;
      this.activeId = null;
    } else World.disposeDetached(tab.live);
    tab.live = null;
    this.tabs.splice(idx, 1);
    if (!this.tabs.length) this.newTab();
    else if (wasActive) this.activate(this.tabs[Math.min(idx, this.tabs.length - 1)].id);
    else { this._writeKey(); this._notify(); }
    return true;
  }

  /* ---------- autosave ---------- */
  _onWorldChange(what) {
    if (this._suspend || what === 'detach' || what === 'attach') return;
    const tab = this.active; if (!tab || tab.preview) return;
    this._seq++;
    if (!tab.dirty) { tab.dirty = true; this._notify(); }
    if (!this.autosaveOn || !this.store.available) { this._setStatus('off'); return; }
    this._setStatus('unsaved');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.saveNow({ reason: 'auto' }), this.autosaveDelay);
  }
  setAutosave(on) {
    this.autosaveOn = !!on;
    try { localStorage.setItem(AUTOSAVE_ON_KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
    if (on) this.saveNow({ reason: 'auto' }); else { clearTimeout(this._t); this._t = 0; this._setStatus('off'); }
  }
  /**
   * Write the active tab now: its document, dirty state, view and (when due) a snapshot and a
   * thumbnail. `reason` 'manual' / 'before' always snapshots; 'auto' respects the interval.
   */
  async saveNow({ reason = 'auto', force = false, quiet = false } = {}) {
    const tab = this.active;
    clearTimeout(this._t); this._t = 0;
    if (!tab || tab.preview) return false;
    if (!this.store.available) { this._setStatus('off', { reason: 'no-storage' }); return false; }
    if (!this.autosaveOn && !force) { this._setStatus('off'); return false; }
    const seq = this._seq;
    if (!quiet) this._setStatus('saving');
    const doc = this.hooks.serialize(tab.name);
    tab.doc = doc; tab.bytes = docBytes(doc);
    const h = docHash(doc), wasDirty = tab.dirty;
    tab.dirty = h !== tab.baseHash;
    if (wasDirty !== tab.dirty) this._notify();
    const now = Date.now();
    if (h !== tab.lastSnapshotHash && (reason !== 'auto' || now - tab.lastSnapshotAt >= this.snapshotInterval)) await this._snapshot(tab, doc, reason);
    if (this.hooks.thumbnail && now - tab.thumbAt > 10000) { try { const t = await this.hooks.thumbnail(); if (t) tab.thumb = t; } catch (_) { /* skip */ } tab.thumbAt = now; }
    const ok = await this._persist(tab);
    if (ok) tab.autosavedAt = Date.now();
    if (seq === this._seq && tab === this.active) this._setStatus(ok ? 'saved' : 'error');
    else if (!ok && tab === this.active) this._setStatus('error');
    return ok;
  }
  /** Save / Save as… just downloaded `doc` under `name`: it becomes the tab's saved base, a manual snapshot is taken. */
  async markSaved(name, doc = null) {
    const tab = this.active; if (!tab || tab.preview) return false;
    tab.name = name || tab.name;
    doc = doc || this.hooks.serialize(tab.name);
    tab.baseDoc = doc; tab.baseHash = docHash(doc); tab.savedAt = Date.now();
    if (tab.dirty) { tab.dirty = false; this._notify(); }
    this.hooks.afterSwitch?.(tab);
    return this.saveNow({ reason: 'manual', force: true });
  }

  /* ---------- versions ---------- */
  async _snapshot(tab, doc, kind = 'auto', label = '') {
    if (!this.store.available || tab.preview) return null;
    if (tab.lastSnapshotDoc === undefined) { const list = await this.store.listSnapshots(tab.id, { withDocs: true }); tab.lastSnapshotDoc = list[0]?.doc || null; if (list[0]) { tab.lastSnapshotAt = tab.lastSnapshotAt || list[0].at; tab.lastSnapshotHash = tab.lastSnapshotHash || docHash(list[0].doc); } }
    const h = docHash(doc);
    if (h === tab.lastSnapshotHash && kind === 'auto') return null;
    const summary = summarizeDiff(tab.lastSnapshotDoc, doc);
    const rec = { id: newId('s'), projectId: tab.id, at: Date.now(), kind, label, doc, bytes: docBytes(doc), summary, name: tab.name, nodes: doc.nodes.length, connections: (doc.connections || []).length };
    try { await this.store.addSnapshot(rec); } catch (_) { return null; }
    tab.lastSnapshotAt = rec.at; tab.lastSnapshotHash = h; tab.lastSnapshotDoc = doc;
    await this.store.pruneSnapshots(tab.id, AUTO_SNAPSHOT_LIMIT);
    this._notifyVersions();
    return rec;
  }
  /** Take a named snapshot of the active tab now (Version history → "Snapshot now"). */
  async snapshotNow(label = '') {
    const tab = this.active; if (!tab || tab.preview) return null;
    const doc = this.hooks.serialize(tab.name); tab.doc = doc;
    tab.lastSnapshotHash = '';   // a manual snapshot is always taken, even of an unchanged scene
    return this._snapshot(tab, doc, 'manual', label);
  }
  /** The project whose history is shown: the active tab, or a preview's source. */
  get historyTab() { const t = this.active; if (!t) return null; return t.preview ? this.byId(t.sourceId) || t : t; }
  async listVersions(tab = this.historyTab) { return tab ? this.store.listSnapshots(tab.id) : []; }
  async setLabel(snapshotId, label) { const r = await this.store.updateSnapshot(snapshotId, { label: String(label || '').trim() }).catch(() => null); this._notifyVersions(); return r; }
  async deleteVersion(snapshotId) { const ok = await this.store.removeSnapshot(snapshotId); const t = this.historyTab; if (t) t.lastSnapshotDoc = undefined; this._notifyVersions(); return ok; }
  async clearOlder(ms, tab = this.historyTab) { if (!tab) return 0; const n = await this.store.clearSnapshots(tab.id, ms); tab.lastSnapshotDoc = undefined; this._notifyVersions(); return n; }
  /** Replace the active project's content with a snapshot as one undoable step; a 'before' snapshot is taken first. */
  async restore(snapshotId) {
    let tab = this.active; if (!tab) return false;
    if (tab.preview) { const src = this.byId(tab.sourceId); if (!src) return false; await this.close(tab.id); this.activate(src.id); tab = src; }
    const snap = await this.store.getSnapshot(snapshotId); if (!snap?.doc) return false;
    const before = this.hooks.serialize(tab.name);
    await this._snapshot(tab, before, 'before');
    const keepCamera = (d) => ({ ...d, camera: undefined, wiring: undefined });
    const target = keepCamera(snap.doc), previous = keepCamera(before);
    this.history.execute({ label: 'Restore version', do: () => { this.hooks.load(target); this.hooks.afterSwitch?.(tab); }, undo: () => { this.hooks.load(previous); this.hooks.afterSwitch?.(tab); } });
    await this.saveNow({ reason: 'auto', force: true });
    return true;
  }
  /** Show a snapshot read-only in a temporary tab beside the project. */
  async preview(snapshotId) {
    const tab = this.historyTab; if (!tab) return null;
    const snap = await this.store.getSnapshot(snapshotId); if (!snap?.doc) return null;
    const existing = this.tabs.find((t) => t.preview && t.snapshotId === snapshotId);
    if (existing) { this.activate(existing.id); return existing; }
    const old = this.tabs.find((t) => t.preview && t.sourceId === tab.id);
    if (old) await this.close(old.id);
    const when = new Date(snap.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return this.newTab({ name: `${this.displayName(tab)} · ${when}`, doc: snap.doc, preview: true, sourceId: tab.id, snapshotId });
  }
  /** Open a snapshot as a new, separate project. */
  async duplicate(snapshotId) {
    const tab = this.historyTab; if (!tab) return null;
    const snap = await this.store.getSnapshot(snapshotId); if (!snap?.doc) return null;
    const name = `${this.displayName(tab)} (copy)`;
    return this.newTab({ name, doc: { ...snap.doc, name }, baseDoc: null });
  }
  /** Bytes held by the store and the browser's estimate (for the version history footer). */
  async storageInfo() { const [bytes, estimate] = await Promise.all([this.store.bytes(), this.store.estimate()]); return { bytes, estimate }; }

  /* ---------- recent projects (File → Open recent) ---------- */
  async recent() { const list = await this.store.listProjects(); return list.map((p) => ({ ...p, open: !!this.byId(p.id), active: p.id === this.activeId })); }
  /** Remove every closed project (and its versions) from the browser. */
  async forgetClosed() { const list = await this.store.listProjects(); let n = 0; for (const p of list) if (!this.byId(p.id)) { await this.store.removeProject(p.id); n++; } return n; }
  async forget(id) { if (this.byId(id)) return false; return this.store.removeProject(id); }
}
