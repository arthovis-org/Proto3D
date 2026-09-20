import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedStorage, scopeIndexedDB, installStorageIsolation, isIsolated, isolationState } from '../storage.js';

/** A Storage look-alike over a Map (what the browser gives us, minus the DOM). */
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); },
    key: (i) => [...m.keys()][i] ?? null, clear: () => m.clear(), get length() { return m.size; }, _map: m,
  };
}
function fakeIndexedDB() {
  const calls = [];
  class Factory { open(name, version) { calls.push(['open', name, version]); return { name, version }; } deleteDatabase(name) { calls.push(['delete', name]); return { name }; } async databases() { return [{ name: 'proto3d-projects', version: 1 }, { name: 'addon.x.proto3d-projects', version: 1 }, { name: 'addon.x.media', version: 2 }]; } }
  return { idb: new Factory(), calls, Factory };
}
function fakeWindow() {
  const win = {}; const local = memoryStorage({ 'proto3d.theme': 'light', 'proto3d.tabs.v1': '["core"]' }); const session = memoryStorage(); const { idb } = fakeIndexedDB();
  Object.defineProperty(win, 'localStorage', { get: () => local, configurable: true, enumerable: true });
  Object.defineProperty(win, 'sessionStorage', { get: () => session, configurable: true, enumerable: true });
  Object.defineProperty(win, 'indexedDB', { get: () => idb, configurable: true, enumerable: true });
  return { win, local, session, idb };
}

test('createScopedStorage prefixes every key and scopes length / key / clear to the prefix', () => {
  const raw = memoryStorage({ 'other:zzz': '1' });
  const s = createScopedStorage(raw, 'addon.x:', ['proto3d.theme']);
  s.setItem('proto3d.tabs.v1', '["a"]'); s.setItem('n', 5);
  assert.equal(raw.getItem('addon.x:proto3d.tabs.v1'), '["a"]');
  assert.equal(raw.getItem('addon.x:n'), '5', 'values are stringified like Storage does');
  assert.equal(s.getItem('proto3d.tabs.v1'), '["a"]');
  assert.equal(s.getItem('missing'), null);
  assert.equal(s.length, 2, 'the unrelated raw key is invisible');
  assert.deepEqual([s.key(0), s.key(1), s.key(2)], ['proto3d.tabs.v1', 'n', null]);
  assert.deepEqual(s.keys().sort(), ['n', 'proto3d.tabs.v1']);
  s.removeItem('n'); assert.equal(raw.getItem('addon.x:n'), null);
  s.clear(); assert.equal(s.length, 0); assert.equal(raw.getItem('other:zzz'), '1', 'clear() never touches keys outside the prefix');
  assert.equal(Object.prototype.toString.call(s), '[object Storage]');
});

test('passthrough keys are read and written unprefixed (theme stays shared with the core page)', () => {
  const raw = memoryStorage({ 'proto3d.theme': 'light' });
  const s = createScopedStorage(raw, 'addon.x:', ['proto3d.theme']);
  assert.equal(s.getItem('proto3d.theme'), 'light');
  s.setItem('proto3d.theme', 'dark');
  assert.equal(raw.getItem('proto3d.theme'), 'dark');
  assert.equal(raw.getItem('addon.x:proto3d.theme'), null);
  assert.equal(s.length, 0, 'a passthrough key is not counted as the add-on\'s own');
});

test('scopeIndexedDB prefixes open / deleteDatabase and filters + unprefixes databases()', async () => {
  const { idb, calls } = fakeIndexedDB();
  const r = scopeIndexedDB(idb, 'addon.x.');
  assert.ok(r.ok);
  idb.open('proto3d-projects', 1); idb.open('media'); idb.deleteDatabase('proto3d-projects');
  assert.deepEqual(calls, [['open', 'addon.x.proto3d-projects', 1], ['open', 'addon.x.media', undefined], ['delete', 'addon.x.proto3d-projects']]);
  assert.deepEqual(await idb.databases(), [{ name: 'proto3d-projects', version: 1 }, { name: 'media', version: 2 }]);
  assert.deepEqual(scopeIndexedDB(idb, 'addon.x.'), { ok: true, already: true }, 'patching twice is a no-op');
  r.restore();
  idb.open('plain'); assert.deepEqual(calls.at(-1), ['open', 'plain', undefined]);
});

test('installStorageIsolation redefines window.localStorage / sessionStorage / indexedDB once and records the raw storage', () => {
  const { win, local, session } = fakeWindow();
  const state = installStorageIsolation('gateway-credits', { win });
  assert.equal(state.isolated, true); assert.equal(state.local, true); assert.equal(state.session, true); assert.equal(state.idb, true);
  assert.equal(state.prefix, 'addon.gateway-credits:'); assert.equal(state.dbPrefix, 'addon.gateway-credits.');
  assert.equal(isIsolated(win), true); assert.equal(isolationState(win), state);
  win.localStorage.setItem('proto3d.tabs.v1', '["addon"]');
  assert.equal(local.getItem('addon.gateway-credits:proto3d.tabs.v1'), '["addon"]', 'the page writes land prefixed in the raw storage');
  assert.equal(local.getItem('proto3d.tabs.v1'), '["core"]', 'the core page\'s own key is untouched');
  assert.equal(win.localStorage.getItem('proto3d.tabs.v1'), '["addon"]', 'and the page reads its own value back');
  assert.equal(win.localStorage.getItem('proto3d.theme'), 'light', 'theme passes through');
  win.sessionStorage.setItem('proto3d.ai.spend.v1', '{}'); assert.equal(session.getItem('addon.gateway-credits:proto3d.ai.spend.v1'), '{}');
  assert.equal(state.raw.localStorage, local);
  assert.equal(installStorageIsolation('other', { win }), state, 'a second install on the same window returns the first record');
  const opened = win.indexedDB.open('proto3d-projects', 1); assert.equal(opened.name, 'addon.gateway-credits.proto3d-projects');
});

test('when localStorage cannot be redefined, isolation is skipped with a warning instead of throwing', () => {
  const win = {}; const local = memoryStorage(); const { idb } = fakeIndexedDB();
  Object.defineProperty(win, 'localStorage', { value: local, configurable: false, writable: false });
  Object.defineProperty(win, 'sessionStorage', { get: () => memoryStorage(), configurable: true });
  Object.defineProperty(win, 'indexedDB', { get: () => idb, configurable: true });
  const warn = console.warn; const warned = []; console.warn = (m) => warned.push(m);
  try {
    const state = installStorageIsolation('x', { win });
    assert.equal(state.local, false); assert.equal(state.isolated, false); assert.equal(state.session, true);
    assert.ok(warned.some((m) => /localStorage cannot be redefined/.test(m)), warned.join('\n'));
    assert.ok(state.warnings.length >= 1);
  } finally { console.warn = warn; }
});

test('bad ids are rejected', () => {
  assert.throws(() => installStorageIsolation('Bad Id', { win: {} }), /bad add-on id/);
});
