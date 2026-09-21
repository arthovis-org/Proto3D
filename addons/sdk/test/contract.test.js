// SDK contract test — every core seam the SDK depends on, checked against the core sources.
// When the core moves under the SDK this test fails FIRST, with a message that names the seam
// and the SDK version, instead of an add-on breaking at runtime with a stray TypeError.
// Node-safe core modules (registry, component, engine, types) are imported and probed for real;
// browser-only modules (faces, theme, examples, menubar, main.js, panel.js, index.html) are
// checked by source, with the exact text the SDK relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDK_VERSION } from '../manifest.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const seam = (name, extra = '') => `[SDK ${SDK_VERSION}] core seam "${name}" changed${extra ? ` — ${extra}` : ''}. Update addons/sdk/host.js (and this test) before shipping the core change.`;
const has = (rel, needle, name) => assert.ok(src(rel).includes(needle), seam(name, `expected ${rel} to contain ${JSON.stringify(needle)}`));
const matches = (rel, re, name) => assert.match(src(rel), re, seam(name, `expected ${rel} to match ${re}`));

test('core/registry.js: register/get/has/ids/all/onRegister with the expected arity', async () => {
  const { registry } = await import('../../../src/core/registry.js');
  for (const [k, n] of [['register', 1], ['get', 1], ['has', 1], ['ids', 0], ['all', 0], ['categories', 0], ['onRegister', 1]]) {
    assert.equal(typeof registry[k], 'function', seam(`registry.${k}`));
    assert.equal(registry[k].length, n, seam(`registry.${k}`, `arity ${registry[k].length}, expected ${n}`));
  }
  assert.equal(typeof registry.unregister, 'undefined', 'registry.unregister appeared: host.nodes.unregisterAll can now be implemented (see README "Proposed core seams")');
  // duplicate ids throw (the add-on prefix rule relies on the registry refusing collisions)
  assert.throws(() => { registry.register({ id: 'contract-dup', category: 'x', label: 'x', evaluate: () => ({}) }); registry.register({ id: 'contract-dup', category: 'x', label: 'x', evaluate: () => ({}) }); }, /duplicate/, seam('registry.register duplicate check'));
});

test('core/component.js: id rule and required fields the prefix convention builds on', async () => {
  const { defineComponent } = await import('../../../src/core/component.js');
  assert.equal(typeof defineComponent, 'function', seam('defineComponent'));
  assert.throws(() => defineComponent({ id: 'Bad_Id', category: 'c', label: 'l', evaluate() {} }), /bad id/, seam('component id rule', 'ids must stay ^[a-z][a-z0-9-]*$ so "<prefix>-name" is valid'));
  const d = defineComponent({ id: 'ok-id', category: 'c', label: 'l', evaluate() { return {}; }, footer() {}, panel() {} });
  assert.ok(Object.isFrozen(d), seam('definitions are frozen', 'the SDK documents that core defs cannot be wrapped'));
  assert.equal(typeof d.footer, 'function', seam('def.footer passthrough'));
  assert.equal(typeof d.panel, 'function', seam('def.panel passthrough'));
});

test('core/engine.js: Engine surface, the onError hook and the ctx shape nodes receive', async () => {
  const { Engine } = await import('../../../src/core/engine.js');
  for (const [k, n] of [['tick', 1], ['evaluate', 0], ['order', 0], ['emit', 3], ['trigger', 3], ['isActive', 1]]) {
    assert.equal(typeof Engine.prototype[k], 'function', seam(`Engine.prototype.${k}`));
    assert.equal(Engine.prototype[k].length, n, seam(`Engine.prototype.${k}`, `arity ${Engine.prototype[k].length}, expected ${n}`));
  }
  const world = { nodes: [], connections: [] };
  const e = new Engine(world);
  assert.equal(e.onError, null, seam('engine.onError', 'must start null so host.engine.onError can chain'));
  assert.equal(world.engine, e, seam('world.engine back-reference'));
  has('src/core/engine.js', 'this.onError?.(node, e)', 'engine.onError call site');
  has('src/core/engine.js', 'node.afterEvaluate?.(ctx, t)', 'node.afterEvaluate hook');
  matches('src/core/engine.js', /inputs, params: node\.params, state: node\.state, time: t, dt: this\.dt, instance: node, engine: this/, 'evaluate ctx shape');
  has('src/core/engine.js', 'n.setDerivedState(s)', 'node.setDerivedState');
  has('src/core/engine.js', 'c.setDerivedState(s)', 'connection.setDerivedState');
  assert.ok(!/engine\.hooks|beforeNode|afterNode/.test(src('src/core/engine.js')), 'engine hooks appeared in core: wire host.engine.beforeNode/afterNode (README "Proposed core seams" (a))');
});

test('faces.js / theme.js / icons.js: drawing helpers, live palette, mutable icons', () => {
  matches('src/faces.js', /export function clear\(g, w, h/, 'faces.clear');
  matches('src/faces.js', /export function drawText\(g, text, x, y, w, h/, 'faces.drawText');
  matches('src/faces.js', /export function roundRect\(g, x, y, w, h, r\)/, 'faces.roundRect');
  matches('src/faces.js', /export const font = \(px, weight = 500, mono = false\)/, 'faces.font');
  // the optional draw helpers host.draw passes through (SDK 1.1): faces built on them are the add-on's app-like node faces
  matches('src/faces.js', /export function beginFields\(instance\)/, 'faces.beginFields');
  has('src/faces.js', "if (instance) instance._fields = list;", 'beginFields writes instance._fields (Block3D.fields / fieldAt read it)');
  matches('src/faces.js', /spec\.editing = cur === spec\.id/, 'beginFields marks spec.editing from instance._editing');
  for (const fn of ['drawCaps(g, text, x, y', 'drawDivider(g, x, y, w', 'drawTile(g, x, y, w, h', 'drawChip(g, text, x, y', 'drawBar(g, x, y, w, h, ratio', 'drawStat(g, x, y, w, h, label, value', 'drawAvatar(g, text, cx, cy, r', 'fitLine(g, text, maxW)', 'wrapLines(g, text, maxW', 'jsonLines(v'])
    has('src/faces.js', `export function ${fn}`, `faces.${fn.split('(')[0]}`);
  has('src/faces.js', 'export const tabular = (g)', 'faces.tabular');
  for (const c of ['PAD = 24', 'GRID = 8', 'RADIUS = 18']) has('src/faces.js', `export const ${c}`, `faces.${c.split(' ')[0]}`);
  // the field kinds and the field editor contract add-on faces rely on
  has('src/ui/field-editor.js', "const KINDS = new Set(['text', 'multiline', 'number', 'select', 'date', 'checkbox', 'action']);", 'field kinds');
  has('src/ui/field-editor.js', "if (kind === 'action') { field.run?.(block, api); return true; }", 'action fields run(block, api)');
  has('src/ui/field-editor.js', 'if (f.set) f.set(v, this._api(block));', 'field set(value, api)');
  matches('src/ui/field-editor.js', /\n  open\(block, field\)/, 'fieldEditor.open(block, field)');
  matches('src/block3d.js', /\n  fields\(\) \{/, 'Block3D.fields()');
  matches('src/block3d.js', /\n  fieldAt\(\{ uv = null, point = null \} = \{\}\)/, 'Block3D.fieldAt');
  has('src/block3d.js', "if (F?.onPointer) this._cursor('pointer')".replace("if (F?.onPointer) this._cursor('pointer')", 'const handled = F.onPointer(this._faceCtx(this.rt.ctx), ev);'), 'def.face.onPointer(ctx, ev)');
  has('src/interaction.js', "if (block.onFacePointer({ type: 'down', ...uv, button: 0 })) {", 'a truthy face pointer-down captures the press (no block drag)');
  has('src/interaction.js', "if (!moved) this.faceDrag.block.onFacePointer({ type: 'click', u: uv.u, v: uv.v, button: 0 });", 'face pointer click after an unmoved press');
  has('src/theme.js', 'export const palette = {}', 'theme.palette (live object)');
  matches('src/theme.js', /export function getTheme\(\)/, 'theme.getTheme');
  matches('src/theme.js', /export function onThemeChange\(cb\)/, 'theme.onThemeChange');
  has('src/theme.js', "const STORAGE_KEY = 'proto3d.theme'", 'theme storage key (passthrough in storage isolation)');
  has('src/icons.js', 'export const icons = {', 'icons (mutable object)');
});

test('examples/index.js and serialize.js: builder + persistence used by host.examples / host.persist', () => {
  matches('src/examples/index.js', /export function buildExample\(world, example, \{ camera, controls \} = \{\}\)/, 'buildExample signature');
  matches('src/examples/index.js', /add\(typeId, pos, \{ title, params, state \} = \{\}\)/, 'example builder api.add');
  matches('src/examples/index.js', /connect\(a, outKey, b, inKey\)/, 'example builder api.connect');
  matches('src/examples/index.js', /group\(title, members\)/, 'example builder api.group');
  matches('src/serialize.js', /export function serializeWorld\(world, \{ camera, controls, pose = null, name = 'untitled' \} = \{\}\)/, 'serializeWorld');
  matches('src/serialize.js', /export function loadWorld\(world, doc, \{ camera, controls \} = \{\}\)/, 'loadWorld');
  has('src/serialize.js', 'if (!def) { skipped.push(n.type); continue; }', 'loadWorld skips unknown types (add-on nodes opened in the core page drop out, never crash)');
});

test('ui/menubar.js: declarative menus array rebuilt by _build() — host.ui.menu pushes into it', () => {
  matches('src/ui/menubar.js', /constructor\(\{ el, menus, brand = 'Proto3D', tools = null/, 'MenuBar constructor');
  has('src/ui/menubar.js', 'Object.assign(this, { el, menus, brand, tools', 'menubar.menus is an instance field');
  matches('src/ui/menubar.js', /\n  _build\(\) \{\n    this\.el\.innerHTML = '';/, 'MenuBar._build() re-renders from this.menus');
  has('src/ui/menubar.js', 'for (const m of this.menus) {', 'menubar iterates this.menus at build');
  has('src/ui/menubar.js', 'const items = id === \'all\' ? this.menus.map', 'collapsed ☰ menu lists this.menus');
  matches('src/ui/menubar.js', /Item:\s+\{ label, hint\?, shortcut\?, icon\?, checked\?, radio\?, disabled\?, run\?\(\) \}/, 'menu item shape');
  assert.ok(!/addMenu\(/.test(src('src/ui/menubar.js')), 'menubar.addMenu appeared: switch host.ui.menu to it (README "Proposed core seams" (d))');
});

test('panel.js and index.html: panel.build() clears only #panel-body; the skeleton ids the shell copies exist', () => {
  has('src/panel.js', "this.body.innerHTML = '';", 'panel.build clears this.body');
  matches('src/panel.js', /this\.body = .*panel-body/, 'panel.body is #panel-body');
  has('src/panel.js', 'if (def.panel) { try { def.panel(this._api(b), b); }', 'def.panel(api, block) call');
  for (const k of ['section:', 'readonly:', 'action:', 'live:', 'h:']) has('src/panel.js', k, `panel api.${k.slice(0, -1)}`);
  const html = src('index.html');
  for (const id of ['viewport', 'menubar', 'tabstrip', 'left-bar', 'panel', 'panel-body', 'help', 'toast', 'start']) assert.ok(html.includes(`id="${id}"`), seam(`index.html #${id}`, 'the shell copies the core body skeleton; main.js requires these ids'));
  assert.ok(/<aside id="panel">\s*<div id="panel-body"><\/div>\s*<details id="help">/.test(html), seam('#panel-body then #help inside #panel', 'host.ui.panelSection inserts before #help'));
  assert.match(html, /<script type="importmap">/, seam('import map'));
  assert.match(html, /"three": "https:\/\/unpkg\.com\/three@0\.160\.0\/build\/three\.module\.js"/, seam('import map three entry', 'testing/browser.js routes this exact URL to node_modules/three'));
  assert.match(html, /<script type="module" src="\.\/src\/main\.js"><\/script>/, seam('core module entry', 'shell.js imports ../../src/main.js'));
});

test('main.js: window.__proto exposes every member the host uses', () => {
  const main = src('src/main.js');
  const block = main.slice(main.indexOf('window.__proto = {'));
  assert.ok(block.length > 100, seam('window.__proto'));
  for (const k of ['ws', 'world', 'engine', 'history', 'selection', 'overlays', 'menubar', 'tabs', 'start', 'leftBar', 'registry', 'togglePanel', 'frameAll', 'serialize:', 'load:'])
    assert.ok(new RegExp(`[\\s{,]${k.replace('.', '\\.')}[,:\\s]`).test(block), seam(`window.__proto.${k.replace(':', '')}`));
  for (const k of ['cmd', 'fieldEditor', 'createInstance', 'wiring']) assert.ok(new RegExp(`[\\s{,]${k}[,:\\s]`).test(block), seam(`window.__proto.${k}`));
  has('src/main.js', 'wiring: { isOn: isWiringOn, set: setWiring, toggle: toggleWiring }', 'window.__proto.wiring shape (host.ui.wiring)');
  matches('src/core/commands.js', /export function transform\(world, nodes, before, after(, routes = null)?\)/, 'cmd.transform(world, nodes, before, after[, routes]) (host.layout.apply)');
  has('src/core/commands.js', 'export const snapshot = (n) => ({ p: n.position.toArray(), r: n.rotation.y, s: n.scale.x });', 'cmd.snapshot shape');
  matches('src/core/commands.js', /export function setParam\(world, node, key, value\)/, 'cmd.setParam');
  matches('src/core/history.js', /\n  execute\(cmd\) \{/, 'history.execute(cmd)');
  matches('src/core/world.js', /nodeByUid\(uid\)/, 'world.nodeByUid');
  matches('src/tabs.js', /replaceActive\(fn, \{ name = null \} = \{\}\)/, 'tabs.replaceActive(fn, { name })');
  matches('src/ui/start-panel.js', /\n  hide\(reason = 'close'\)/, 'start.hide(reason)');
  matches('src/ui/overlays.js', /\n  toast\(text, ms = 1600\)/, 'overlays.toast(text, ms)');
  matches('src/core/world.js', /\n  onChange\(cb\) \{ this\._listeners\.add\(cb\); return \(\) => this\._listeners\.delete\(cb\); \}/, 'world.onChange returns unsubscribe');
  matches('src/core/world.js', /changed\(what = 'change'\)/, 'world.changed(what)');
  for (const what of ["'add-node'", "'remove-node'", "'clear'"]) has('src/core/world.js', `this.changed(${what})`, `world change kind ${what}`);
  has('src/serialize.js', "world.changed('load')", "world change kind 'load'");
  has('src/examples/index.js', "world.changed('example')", "world change kind 'example'");
});

test('storage: the core keys the isolation shim must redirect all live under proto3d.* / proto3d-projects', () => {
  has('src/project-store.js', "export const DB_NAME = 'proto3d-projects'", 'project store DB name');
  matches('src/project-store.js', /indexedDB\.open\(DB_NAME, DB_VERSION\)/, 'project store opens through the global indexedDB');
  has('src/ai/store.js', 'indexedDB.open(', 'media store opens through the global indexedDB');
  const files = ['src/tabs.js', 'src/project-store.js', 'src/theme.js', 'src/wiring.js', 'src/ui/tour.js', 'src/ui/stats.js', 'src/ai/vault.js', 'src/ui/start-panel.js', 'src/ui/command-palette.js', 'src/ui/model-browser.js'];
  for (const f of files) assert.ok(/localStorage\.(getItem|setItem|removeItem|key|length)/.test(src(f)), seam(`${f} uses the global localStorage`, 'storage isolation redefines window.localStorage; a module caching a Storage reference before the shell runs would escape it'));
  assert.ok(!/window\.__protoConfig|storageNamespace/.test(src('src/main.js')), 'main.js reads a storage namespace config: the shim can retire (README "Proposed core seams" (b))');
});
