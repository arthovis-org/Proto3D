import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../../../sdk/testing/browser.js';

test('template page boots through the shell with zero errors, isolated storage and its menu', async () => {
  const h = await createHarness();
  try {
    const { page, errors } = await h.open('/addons/_template/');
    await h.waitForAddon(page);
    const info = await page.evaluate(() => ({
      title: document.title, types: window.__proto.registry.ids().filter((id) => id.startsWith('tpl-')), importMap: window.__addon.importMap,
      isolated: window.__protoStorageIsolation.isolated, menu: !!document.querySelector('#menubar .mnu-title[data-menu="template:main"]'), section: !!document.querySelector('#panel > #tpl-section'),
      badge: document.querySelector('#addon-badge')?.textContent, rawKeys: (() => { const raw = window.__protoStorageIsolation.raw.localStorage; const ks = []; for (let i = 0; i < raw.length; i++) ks.push(raw.key(i)); return ks; })(),
    }));
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.match(info.title, /Template add-on/); assert.deepEqual(info.types, ['tpl-counter']); assert.equal(info.importMap, 'injected');
    assert.equal(info.isolated, true); assert.equal(info.menu, true); assert.equal(info.section, true); assert.match(info.badge, /Add-on: Template add-on · SDK 1/);
    assert.ok(info.rawKeys.length > 0 && info.rawKeys.every((k) => k.startsWith('addon.template:') || k === 'proto3d.theme'), `raw keys: ${info.rawKeys.join(', ')}`);
    // the menu opens and its item runs
    await page.click('#menubar .mnu-title[data-menu="template:main"]');
    await page.waitForSelector('.mnu-menu .mnu-item');
    const labels = await page.$$eval('.mnu-menu .mnu-item .mnu-label', (els) => els.map((e) => e.firstChild.textContent));
    assert.deepEqual(labels.slice(0, 1), ['Pulse every counter']);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally { await h.close(); }
});
