// The template's tests run in plain Node: the fake host stands in for the browser host, the
// headless world runs the node definitions on the REAL core Engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost, fakeCanvasContext } from '../../sdk/testing/fake-host.js';
import { createHeadlessWorld } from '../../sdk/testing/headless-engine.js';
import { scanAddons } from '../../sdk/testing/drift-guard.js';
import manifest from '../addon.json' with { type: 'json' };
import { register, install } from '../addon.js';

const hw = createHeadlessWorld();
const host = createFakeHost(manifest, { headless: hw });
register(host);
const api = install(host);

test('register() adds exactly the prefixed node type and its icons', () => {
  assert.deepEqual(host.nodes.ids(), ['tpl-counter']);
  assert.ok(host.nodes.get('tpl-counter'));
  assert.ok(host.icons.has('template') && host.icons.has('tpl-counter'));
});

test('the counter runs on the real engine: pulses count, reset clears, changed fires', async () => {
  const c = hw.add('tpl-counter', { label: 'Hits' });
  hw.tick();
  assert.equal(c.out.count, 0); assert.equal(c.footerText, 'Hits: 0');
  hw.trigger(c, 'tick'); hw.tick();
  hw.trigger(c, 'tick'); hw.tick();
  assert.equal(c.out.count, 2);
  assert.ok(c.getPort('changed', 'out').pulses >= 2, 'changed pulsed');
  hw.trigger(c, 'reset'); hw.tick();
  assert.equal(c.out.count, 0);
  assert.equal(c.derivedState, 'active');
});

test('settings live in the add-on storage namespace and drive the step', () => {
  const c = hw.add('tpl-counter');
  const step = host._rec.menus[0].items()[2]; step.action();       // 1 → 2
  assert.deepEqual(host.storage.get('settings.v1'), { step: 2 });
  assert.deepEqual([...host.storage.raw.keys()], ['proto3d.addon.template.settings.v1']);
  hw.trigger(c, 'tick'); hw.tick();
  assert.equal(c.out.count, 2);
  host.storage.set('settings.v1', { step: 1 });
});

test('install() registered a menu, a panel section and hooks', () => {
  assert.equal(host._rec.menus.length, 1); assert.equal(host._rec.menus[0].label, 'Template add-on');
  const items = host._rec.menus[0].items();
  assert.equal(items[0].label, 'Pulse every counter'); assert.ok(items[1].separator);
  items[0].action(); hw.tick();
  assert.equal(api.runs, 1); assert.ok(host._rec.toasts.some((t) => /Pulsed 2 counter/.test(t.text)));
  assert.equal(host._rec.sections[0].title, 'Template add-on');
  assert.equal(host._rec.errorHandlers.length, 1); assert.equal(host._rec.worldListeners.length, 1);
  hw.remove(hw.world.nodes[0]); assert.ok(api.lastRemoveAt > 0);
});

test('face renders against a fake canvas without touching the real palette', () => {
  const def = host.nodes.get('tpl-counter'); const g = fakeCanvasContext();
  def.face.render(g, 240, 160, { params: { label: 'X' }, state: { count: 3 } });
  assert.ok(true, 'no throw');
});

test('this add-on imports nothing from the core', () => {
  const v = scanAddons(new URL('../', import.meta.url).pathname);
  assert.deepEqual(v, []);
});
