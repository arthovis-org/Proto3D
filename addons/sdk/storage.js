// sdk/storage.js — page-level storage isolation for add-on pages, installed by shell.js BEFORE
// the core boots. The core reads and writes `localStorage` / `sessionStorage` / `indexedDB`
// under its own keys (proto3d.tabs.v1, proto3d-projects…). On an add-on page those calls are
// redirected: every Storage key is prefixed `addon.<id>:`, every IndexedDB database name is
// prefixed `addon.<id>.`, so the add-on page owns its own tabs, autosave, projects, vault and
// settings and never writes the core page's data. The theme preference (`proto3d.theme`) is
// passed through unprefixed so light / dark stays shared, exactly as a user expects.
//
// Zero core edits: `window.localStorage` is an own, configurable accessor on the global object,
// so it can be redefined; the IDBFactory methods are patched on the prototype. When either step
// is impossible (a locked-down browser) isolation is skipped with a console warning and the page
// still runs, sharing storage with the core — never a crash.
import { pagePrefix, pageDbPrefix } from './manifest.js';

const STATE_KEY = '__protoStorageIsolation';

/** A Storage-compatible view of `raw` that only sees keys under `prefix` (plus the passthrough keys). */
export function createScopedStorage(raw, prefix, passthrough = []) {
  const pass = new Set(passthrough);
  const wrap = (k) => (pass.has(k) ? k : prefix + String(k));
  const own = () => { const out = []; for (let i = 0; i < raw.length; i++) { const k = raw.key(i); if (k !== null && k.startsWith(prefix)) out.push(k.slice(prefix.length)); } return out; };
  const scoped = {
    getItem(k) { return raw.getItem(wrap(k)); },
    setItem(k, v) { raw.setItem(wrap(k), String(v)); },
    removeItem(k) { raw.removeItem(wrap(k)); },
    key(i) { const keys = own(); return i >= 0 && i < keys.length ? keys[i] : null; },
    clear() { for (const k of own()) raw.removeItem(prefix + k); },
    get length() { return own().length; },
    /** Not part of Storage: the keys this view sees, unprefixed. */
    keys() { return own(); },
  };
  Object.defineProperty(scoped, Symbol.toStringTag, { value: 'Storage' });
  return scoped;
}

/** Wrap an IDBFactory so `open`, `deleteDatabase` and `databases` see prefixed names. Patches the prototype the factory was built from. */
export function scopeIndexedDB(idb, dbPrefix) {
  if (!idb) return { ok: false, why: 'indexedDB unavailable' };
  const proto = Object.getPrototypeOf(idb);
  if (!proto || typeof proto.open !== 'function') return { ok: false, why: 'IDBFactory prototype not patchable' };
  if (proto.__protoScoped) return { ok: true, already: true };
  const orig = { open: proto.open, deleteDatabase: proto.deleteDatabase, databases: proto.databases };
  const p = (name) => dbPrefix + String(name);
  try {
    proto.open = function open(name, version) { return version === undefined ? orig.open.call(this, p(name)) : orig.open.call(this, p(name), version); };
    proto.deleteDatabase = function deleteDatabase(name) { return orig.deleteDatabase.call(this, p(name)); };
    if (typeof orig.databases === 'function') {
      proto.databases = async function databases() {
        const all = await orig.databases.call(this);
        return all.filter((d) => typeof d.name === 'string' && d.name.startsWith(dbPrefix)).map((d) => ({ ...d, name: d.name.slice(dbPrefix.length) }));
      };
    }
    Object.defineProperty(proto, '__protoScoped', { value: dbPrefix, configurable: true });
    return { ok: true, restore() { Object.assign(proto, orig); delete proto.__protoScoped; } };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

/**
 * Install isolation on `win` (default: the global object). Returns the state record, also kept on
 * `win.__protoStorageIsolation` so tests can reach the raw storage:
 *   { id, prefix, dbPrefix, isolated, local: bool, session: bool, idb: bool, raw: { localStorage, sessionStorage }, warnings[] }
 */
export function installStorageIsolation(id, { passthrough = ['proto3d.theme'], win = globalThis } = {}) {
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`installStorageIsolation: bad add-on id ${JSON.stringify(id)}`);
  if (win[STATE_KEY]) return win[STATE_KEY];   // installed once per page
  const prefix = pagePrefix(id), dbPrefix = pageDbPrefix(id);
  const state = { id, prefix, dbPrefix, passthrough: [...passthrough], isolated: false, local: false, session: false, idb: false, raw: {}, warnings: [] };
  const warn = (m) => { state.warnings.push(m); try { console.warn(`[addon storage] ${m}`); } catch (_) { /* no console */ } };

  const redefine = (name) => {
    let raw = null;
    try { raw = win[name]; } catch (e) { warn(`${name} not readable (${e.message}); not isolated`); return false; }
    if (!raw || typeof raw.getItem !== 'function') { warn(`${name} unavailable; not isolated`); return false; }
    const scoped = createScopedStorage(raw, prefix, passthrough);
    try {
      Object.defineProperty(win, name, { get: () => scoped, configurable: true, enumerable: true });
      if (win[name] !== scoped) throw new Error('accessor did not take');
    } catch (e) { warn(`${name} cannot be redefined (${e.message}); not isolated`); return false; }
    state.raw[name] = raw;
    return true;
  };
  state.local = redefine('localStorage');
  state.session = redefine('sessionStorage');
  let idb = null;
  try { idb = win.indexedDB; } catch (_) { idb = null; }
  const r = scopeIndexedDB(idb, dbPrefix);
  if (r.ok) state.idb = true; else warn(`indexedDB not isolated: ${r.why}`);
  state.isolated = state.local && state.idb;
  try { Object.defineProperty(win, STATE_KEY, { value: state, configurable: true }); } catch (_) { /* ignore */ }
  return state;
}

/** True when this page's storage is isolated (localStorage AND IndexedDB redirected). */
export function isIsolated(win = globalThis) { return !!win[STATE_KEY]?.isolated; }

/** The isolation record for this page, or null on a page without the shell (the core page). */
export function isolationState(win = globalThis) { return win[STATE_KEY] || null; }
