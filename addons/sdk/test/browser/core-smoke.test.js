// core-smoke: the untouched core page boots with zero page errors and has no add-on types. Runs
// in the "core-smoke" CI job and locally with `npm run test:browser`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../../testing/browser.js';

test('core page boots headless with zero errors, no add-on node types and no add-on storage', async () => {
  const h = await createHarness();
  try {
    const { page, errors } = await h.open('/');
    await h.waitForCore(page);
    await page.waitForTimeout(800);
    const info = await page.evaluate(async () => {
      const p = window.__proto;
      const t0 = p.engine.evaluations; await new Promise((r) => setTimeout(r, 400));
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      return { types: p.registry.ids(), tabs: p.tabs.tabs.length, ticking: p.engine.evaluations > t0, isolated: !!window.__protoStorageIsolation, addon: !!window.__addon, keys, dbs: (await indexedDB.databases()).map((d) => d.name) };
    });
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.ok(info.types.length >= 30, `core registered ${info.types.length} types`);
    assert.deepEqual(info.types.filter((id) => /^(gw|tpl)-/.test(id)), [], 'no add-on types on the core page');
    assert.equal(info.tabs >= 1, true); assert.equal(info.ticking, true);
    assert.equal(info.isolated, false, 'the core page runs without the storage shim'); assert.equal(info.addon, false);
    assert.deepEqual(info.keys.filter((k) => k.startsWith('proto3d.addon.') || k.startsWith('proto3d.gateway.')), [], 'no add-on keys in the core page\'s storage');
    assert.ok(info.keys.every((k) => k.startsWith('proto3d.')), `core keys: ${info.keys.join(', ')}`);
    assert.ok(info.dbs.every((n) => !n.startsWith('addon.')), `core page sees no add-on databases in a fresh context: ${info.dbs.join(', ')}`);
  } finally { await h.close(); }
});
