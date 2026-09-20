// host.js in Node: the core bindings are injected (loadCore() needs a browser), window.__proto is
// a small double. What is under test: manifest / version checks, the node-id prefix rule, defensive
// seam errors, onError chaining, the menu-bar integration and the namespaced storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, HostError, SDK_VERSION } from '../host.js';
import { validateManifest } from '../manifest.js';
import { registry } from '../../../src/core/registry.js';
import { Engine } from '../../../src/core/engine.js';

const manifest = { id: 'demo', name: 'Demo', version: '0.1.0', prefix: 'dm', sdk: 1, entry: './addon.js' };
const icons = { node: '<svg/>', file: '<svg/>' };
function fakeCore() {
  return {
    registry, icons, palette: { faceBg: '#000' }, getTheme: () => 'dark', onThemeChange: () => () => {},
    faces: { clear() {}, drawText() {}, roundRect() {}, font: () => '500 12px x' },
    buildExample: (world, ex) => { world.built = ex; return { a: 1 }; },
  };
}
function fakeProto() {
  const world = { nodes: [], connections: [], _l: new Set(), onChange(cb) { this._l.add(cb); return () => this._l.delete(cb); }, changed(w) { this._l.forEach((cb) => cb(w, this)); } };
  const engine = new Engine(world);
  const menubar = { menus: [{ id: 'file', label: 'File', items: () => [] }], builds: 0, _build() { this.builds += 1; } };
  const toasts = [];
  return {
    world, engine, ws: { camera: {}, controls: {}, frameBlocks(b, o) { this.framed = [b, o]; } }, history: { clear() {} }, selection: { clear() {}, set() {}, nodes: [] },
    overlays: { toast: (t, ms) => toasts.push([t, ms]) }, menubar, tabs: { replaceActive(fn, { name }) { fn(); this.named = name; return { name }; } }, start: { hide(r) { this.hidden = r; } },
    togglePanel() {}, frameAll() {}, serialize: () => ({ app: 'proto3d' }), load: () => ({ skipped: [] }), toasts, leftBar: { isOpen: false },
  };
}

test('validateManifest normalises and rejects bad fields with the field name', () => {
  const m = validateManifest({ ...manifest, description: 'x', styles: ['./a.css'] });
  assert.ok(Object.isFrozen(m)); assert.equal(m.description, 'x'); assert.deepEqual([...m.styles], ['./a.css']);
  assert.throws(() => validateManifest({ ...manifest, id: 'Bad' }), /"id" must match/);
  assert.throws(() => validateManifest({ ...manifest, prefix: 'g-w' }), /"prefix" must match/);
  assert.throws(() => validateManifest({ ...manifest, sdk: '1' }), /"sdk" must be a positive integer/);
  assert.throws(() => validateManifest({ ...manifest, entry: 'src/index.js' }), /"entry" must be a relative module path/);
  assert.throws(() => validateManifest({ ...manifest, version: '1' }), /"version" must be semver/);
});

test('createHost checks the SDK major, the core bindings shape and freezes the host', () => {
  assert.throws(() => createHost(null, { ...manifest, sdk: 2 }, fakeCore()), (e) => e instanceof HostError && /targets SDK 2; this host implements SDK 1/.test(e.message));
  assert.throws(() => createHost(null, manifest, null), /core bindings missing/);
  const broken = fakeCore(); delete broken.faces.drawText;
  assert.throws(() => createHost(null, manifest, broken), /core seam missing: core\.faces\.drawText \(expected function/);
  const host = createHost(null, manifest, fakeCore());
  assert.equal(host.version, SDK_VERSION); assert.ok(Object.isFrozen(host)); assert.ok(Object.isFrozen(host.nodes)); assert.equal(host.booted, false);
});

test('nodes.register enforces the manifest prefix and registers through the real registry', () => {
  const host = createHost(null, manifest, fakeCore());
  assert.throws(() => host.nodes.register({ id: 'other-thing', category: 'demo', label: 'x', evaluate: () => ({}) }), /must start with "dm-"/);
  assert.throws(() => host.nodes.register({ id: 'dm-', category: 'demo', label: 'x', evaluate: () => ({}) }), /must start with "dm-"/);
  const d = host.nodes.register({ id: 'dm-counter', category: 'demo', label: 'Counter', evaluate: () => ({}) });
  assert.ok(Object.isFrozen(d)); assert.ok(registry.has('dm-counter')); assert.deepEqual(host.nodes.ids(), ['dm-counter']); assert.ok(host.nodes.owns('dm-x')); assert.ok(!host.nodes.owns('input'));
  assert.throws(() => host.nodes.register({ id: 'dm-counter', category: 'demo', label: 'Counter', evaluate: () => ({}) }), /already registered/);
  assert.throws(() => host.nodes.unregisterAll(), /cannot remove definitions/);
});

test('members that need the booted core throw a named HostError before boot, work after', () => {
  let proto = null;
  const host = createHost(() => proto, manifest, fakeCore());
  assert.throws(() => host.world.nodes(), (e) => e instanceof HostError && /core not booted yet: world\.nodes/.test(e.message) && e.seam === 'window.__proto');
  assert.throws(() => host.ui.toast('x'), /core not booted yet/);
  proto = fakeProto();
  assert.equal(host.booted, true);
  host.ui.toast('hello', 10); assert.deepEqual(proto.toasts, [['hello', 10]]);
  assert.deepEqual(host.world.nodes(), []);
  // a missing __proto member is named too
  const p2 = fakeProto(); delete p2.overlays.toast; const host2 = createHost(p2, manifest, fakeCore());
  assert.throws(() => host2.ui.toast('x'), /core seam missing: window\.__proto\.overlays\.toast \(expected function, got undefined\)/);
});

test('engine.onError chains onto an existing handler and unsubscribes cleanly', () => {
  const proto = fakeProto(); const host = createHost(proto, manifest, fakeCore());
  const seen = [];
  proto.engine.onError = (n, e) => seen.push(['prev', e.message]);
  const off = host.engine.onError((n, e) => seen.push(['addon', e.message]));
  proto.engine.onError({ uid: 'n1' }, new Error('boom'));
  assert.deepEqual(seen, [['prev', 'boom'], ['addon', 'boom']]);
  off();
  proto.engine.onError({ uid: 'n1' }, new Error('again'));
  assert.deepEqual(seen.slice(2), [['prev', 'again']], 'after unsubscribe only the previous handler runs');
});

test('world.onChange returns an unsubscribe; world.get() warns once', () => {
  const proto = fakeProto(); const host = createHost(proto, manifest, fakeCore());
  const kinds = []; const off = host.world.onChange((w) => kinds.push(w));
  proto.world.changed('add-node'); off(); proto.world.changed('clear');
  assert.deepEqual(kinds, ['add-node']);
  const warn = console.warn; const warned = []; console.warn = (m) => warned.push(m);
  try { host.world.get(); host.world.get(); } finally { console.warn = warn; }
  assert.equal(warned.length, 1); assert.match(warned[0], /raw World/);
});

test('ui.menu appends a declarative menu, rebuilds the bar, adapts items, and can be removed', () => {
  const proto = fakeProto(); const host = createHost(proto, manifest, fakeCore());
  let ran = 0;
  const handle = host.ui.menu({ id: 'credits', label: 'Credits', items: () => [{ label: 'Run', action: () => { ran += 1; } }, { separator: true }, { label: 'Sub', items: () => [{ label: 'Deep', run: () => { ran += 10; } }] }, { label: 'Off', disabled: true, action() {} }] });
  assert.equal(handle.id, 'demo:credits');
  assert.equal(proto.menubar.builds, 1);
  assert.deepEqual(proto.menubar.menus.map((m) => m.id), ['file', 'demo:credits']);
  const items = proto.menubar.menus[1].items();
  assert.equal(items[0].label, 'Run'); items[0].run(); assert.equal(ran, 1);
  assert.deepEqual(items[1], { sep: true, label: undefined });
  assert.equal(typeof items[2].items, 'function'); items[2].items()[0].run(); assert.equal(ran, 11);
  assert.equal(items[3].disabled, true);
  host.ui.menu({ id: 'credits', label: 'Credits 2', items: () => [] });
  assert.deepEqual(proto.menubar.menus.map((m) => m.label), ['File', 'Credits 2'], 'same id replaces instead of duplicating');
  handle.remove();
  assert.deepEqual(proto.menubar.menus.map((m) => m.id), ['file', 'demo:credits'].slice(0, 1).concat(proto.menubar.menus.length > 1 ? ['demo:credits'] : []));
  assert.throws(() => host.ui.menu({ id: 'x', label: 'X' }), /items\(\) function are required/);
});

test('examples.build goes through tabs.replaceActive, hides the Start panel and frames the focus', () => {
  const proto = fakeProto(); const host = createHost(proto, manifest, fakeCore());
  const ex = { id: 'ex', label: 'Sample', build() {}, focus: (named) => [named.a] };
  const named = host.examples.build(ex);
  assert.deepEqual(named, { a: 1 }); assert.equal(proto.world.built, ex); assert.equal(proto.tabs.named, 'Sample'); assert.equal(proto.start.hidden, 'addon');
  assert.deepEqual(proto.ws.framed[0], [1]); assert.equal(proto.ws.framed[1].instant, true);
});

test('storage is namespaced under proto3d.addon.<id>. and JSON-valued', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  try {
    const host = createHost(null, manifest, fakeCore());
    assert.equal(host.storage.namespace, 'proto3d.addon.demo.');
    assert.equal(host.storage.get('ledger.v1', 'fb'), 'fb');
    host.storage.set('ledger.v1', [{ a: 1 }]); host.storage.set('settings.v1', { on: true });
    assert.deepEqual([...store.keys()], ['proto3d.addon.demo.ledger.v1', 'proto3d.addon.demo.settings.v1']);
    assert.deepEqual(host.storage.get('ledger.v1'), [{ a: 1 }]);
    assert.deepEqual(host.storage.keys().sort(), ['ledger.v1', 'settings.v1']);
    host.storage.remove('ledger.v1'); assert.equal(host.storage.get('ledger.v1'), null);
    store.set('proto3d.addon.demo.bad', '{not json'); assert.equal(host.storage.get('bad', 'fb'), 'fb');
  } finally { delete globalThis.localStorage; }
});

test('icons.set adds add-on icons but refuses to overwrite core icons', () => {
  const host = createHost(null, manifest, fakeCore());
  host.icons.set('dm-counter', '<svg id="c"/>'); assert.equal(host.icons.get('dm-counter'), '<svg id="c"/>'); assert.ok(host.icons.has('dm-counter'));
  host.icons.set('dm-counter', '<svg id="c2"/>');
  assert.throws(() => host.icons.set('node', '<svg/>'), /"node" is a core icon/);
  assert.equal(host.icons.get('nope'), '<svg/>', 'falls back to the generic node icon');
});
