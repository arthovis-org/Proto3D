// Browser tests (Playwright, hermetic: repo served from node:http, three from node_modules). One
// browser context is shared, so the core page and the add-on page see the same origin storage —
// which is exactly what the isolation assertions need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../../../sdk/testing/browser.js';

const RAW_PREFIX = 'addon.gateway-credits:';
const rawKeys = () => { const raw = window.__protoStorageIsolation?.raw.localStorage || localStorage; const ks = []; for (let i = 0; i < raw.length; i++) ks.push(raw.key(i)); return ks.sort(); };
const coreSnapshot = async () => {
  const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  const core = Object.fromEntries(keys.filter((k) => !k.startsWith('addon.')).sort().map((k) => [k, localStorage.getItem(k)]));
  const dbs = (await indexedDB.databases()).map((d) => d.name).sort();
  const count = await new Promise((res) => { const r = indexedDB.open('proto3d-projects'); r.onsuccess = () => { const db = r.result; try { const tx = db.transaction('projects'); const c = tx.objectStore('projects').count(); c.onsuccess = () => { res(c.result); db.close(); }; c.onerror = () => { res(-1); db.close(); }; } catch (_) { res(-1); db.close(); } }; r.onerror = () => res(-2); });
  return { core, dbs, projects: count, types: window.__proto.registry.ids() };
};

test('gateway-credits page: boots with zero errors, Credits menu runs the sample, declines at 0.5 cr, auto tops up; the core page and its storage stay untouched', async () => {
  const h = await createHarness();
  try {
    /* ---- 1. core page first: a baseline of its storage ---- */
    const core1 = await h.open('/');
    await h.waitForCore(core1.page); await core1.page.waitForTimeout(2500);   // autosave debounce → the tab set and the project exist
    const before = await core1.page.evaluate(coreSnapshot);
    assert.deepEqual(core1.errors, []); assert.ok(!before.types.some((t) => t.startsWith('gw-')));
    assert.ok(before.dbs.includes('proto3d-projects'), `core dbs: ${before.dbs.join(', ')}`); assert.ok(before.projects >= 1, `core projects: ${before.projects}`);
    await core1.page.close();

    /* ---- 2. the add-on page ---- */
    const { page, errors } = await h.open('/addons/gateway-credits/');
    await h.waitForAddon(page);
    await page.waitForFunction(() => window.__gateway && window.__proto.world.nodes.length > 0);
    // deterministic providers: no simulated 503s (fallback is covered by the engine tests), short latency
    await page.evaluate(() => window.__gateway.configureSimulation({ random: () => 0.5, latency: [40, 120], toolLatency: [40, 120] }));
    const boot = await page.evaluate(() => ({
      title: document.title, importMap: window.__addon.importMap, isolated: window.__protoStorageIsolation.isolated,
      types: window.__proto.registry.ids().filter((id) => id.startsWith('gw-')), nodes: window.__proto.world.nodes.map((n) => n.typeId).sort(),
      menu: !!document.querySelector('#menubar .mnu-title[data-menu="gateway-credits:credits"]'), admin: !!document.querySelector('#panel > #gw-admin'), rows: document.querySelectorAll('#gw-ledger tbody tr[data-status]').length,
      balance: window.__gateway.ledger.available(), badge: document.querySelector('#addon-badge')?.textContent, tabName: window.__proto.tabs.active?.name, startOpen: window.__proto.start.isOpen,
      railHasGateway: !!document.querySelector('#left-bar .rail-btn[data-cat="gateway"]'),
    }));
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.match(boot.title, /Gateway Credits/); assert.equal(boot.importMap, 'injected'); assert.equal(boot.isolated, true);
    assert.deepEqual(boot.types, ['gw-llm', 'gw-tool', 'gw-budget', 'gw-meter']);
    assert.deepEqual(boot.nodes, ['gw-budget', 'gw-llm', 'gw-llm', 'gw-meter', 'gw-tool', 'input', 'log', 'text'], 'the sample graph loaded into a fresh page');
    assert.equal(boot.menu, true, 'Credits menu is in the core menu bar'); assert.equal(boot.admin, true, 'admin section sits in #panel outside #panel-body'); assert.equal(boot.railHasGateway, true, 'Gateway category in the Add rail');
    assert.equal(boot.rows, 0); assert.equal(boot.balance, 2300); assert.match(boot.badge, /Add-on: Gateway Credits · SDK 1/); assert.equal(boot.tabName, 'Gateway credits · Support inbox triage'); assert.equal(boot.startOpen, false);

    /* ---- 3. Credits → Run sample: ledger rows appear, the balance drops, one bypassed row ---- */
    await page.click('#menubar .mnu-title[data-menu="gateway-credits:credits"]');
    await page.waitForSelector('.mnu-menu .mnu-item');
    const heading = await page.$eval('.mnu-menu .mnu-heading', (e) => e.textContent); assert.match(heading, /^Balance 2,300\.00 cr/);
    await page.click('.mnu-menu .mnu-item:has-text("Run sample")');
    await page.waitForFunction(() => window.__gateway.ledger.rows().filter((r) => r.status === 'settled').length >= 2 && window.__gateway.ledger.rows().some((r) => r.status === 'bypassed'), null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#gw-ledger tbody tr[data-status="settled"]').length >= 2);
    const run = await page.evaluate(() => {
      const L = window.__gateway.ledger; const rows = L.rows();
      return { statuses: rows.map((r) => r.status), balance: L.available(), held: L.held(), spend: L.spend(), domRows: document.querySelectorAll('#gw-ledger tbody tr[data-status]').length, tile: document.querySelector('#gw-admin .gw-tile.hero .val').textContent, log: window.__proto.world.nodes.find((n) => n.typeId === 'log')?.state };
    });
    assert.ok(run.balance < 2300, `balance dropped: ${run.balance}`); assert.equal(run.held, 0); assert.ok(run.spend > 0);
    assert.ok(run.statuses.includes('bypassed'), run.statuses.join(',')); assert.equal(run.statuses.filter((s) => s === 'settled').length, 2); assert.equal(run.domRows, run.statuses.length);
    assert.match(run.tile, /cr$/); assert.notEqual(run.tile, '2,300.00 cr');

    /* ---- 4. decline at 0.5 cr, then auto top-up ---- */
    await page.click('#menubar .mnu-title[data-menu="gateway-credits:credits"]'); await page.click('.mnu-menu .mnu-item:has-text("Set balance to 0.5 cr")');
    await page.waitForFunction(() => Math.abs(window.__gateway.ledger.available() - 0.5) < 1e-3);   // adjustTo rounds the adjustment to 4 decimals
    await page.click('#gw-run');
    await page.waitForFunction(() => window.__gateway.ledger.rows().some((r) => r.status === 'decline'), null, { timeout: 10000 });
    const declined = await page.evaluate(() => { const r = window.__gateway.ledger.rows()[0]; const n = window.__proto.world.nodes.find((x) => x.title === 'Summarize'); return { status: r.status, note: r.note, error: n.rt.error, state: n.derivedState, balance: window.__gateway.ledger.available() }; });
    assert.equal(declined.status, 'decline'); assert.match(declined.note, /insufficient balance/); assert.match(declined.error, /declined/); assert.equal(declined.state, 'error'); assert.ok(Math.abs(declined.balance - 0.5) < 1e-3, `balance ${declined.balance}`);
    await page.check('#gw-at-enabled');
    await page.waitForFunction(() => window.__gateway.ledger.rows().some((r) => r.status === 'topup'), null, { timeout: 10000 });
    await page.click('#gw-run');
    await page.waitForFunction(() => window.__gateway.ledger.rows(50).filter((r) => r.status === 'settled').length >= 4, null, { timeout: 20000 });
    const topped = await page.evaluate(() => ({ balance: window.__gateway.ledger.available(), topups: window.__gateway.ledger.rows(50).filter((r) => r.status === 'topup').length, settings: JSON.parse(window.__protoStorageIsolation.raw.localStorage.getItem('addon.gateway-credits:proto3d.addon.gateway-credits.settings.v1')) }));
    assert.ok(topped.balance > 900, `refilled: ${topped.balance}`); assert.equal(topped.topups, 1); assert.equal(topped.settings.autoTopUp.enabled, true, 'settings persisted through host.storage under the isolated prefix');

    /* ---- 5. storage isolation from the raw storage's point of view ---- */
    await page.waitForTimeout(2500);   // let the core autosave this page's project
    const iso = await page.evaluate(async () => {
      const raw = window.__protoStorageIsolation.raw.localStorage; const keys = []; for (let i = 0; i < raw.length; i++) keys.push(raw.key(i));
      const own = []; for (let i = 0; i < localStorage.length; i++) own.push(localStorage.key(i));
      const dbs = (await indexedDB.databases()).map((d) => d.name);   // scoped view: unprefixed
      return { keys: keys.sort(), own: own.sort(), dbs: dbs.sort(), tabs: localStorage.getItem('proto3d.tabs.v1'), theme: raw.getItem('proto3d.theme') };
    });
    const addonKeys = iso.keys.filter((k) => k.startsWith(RAW_PREFIX));
    assert.ok(addonKeys.length >= 3, `add-on keys: ${addonKeys.join(', ')}`);
    assert.ok(addonKeys.includes(`${RAW_PREFIX}proto3d.addon.gateway-credits.ledger.v1`) && addonKeys.includes(`${RAW_PREFIX}proto3d.tabs.v1`), addonKeys.join(', '));
    assert.ok(iso.keys.every((k) => k.startsWith(RAW_PREFIX) || k.startsWith('proto3d.')), `every raw key is either the add-on's or a core key from step 1: ${iso.keys.join(', ')}`);
    assert.ok(!iso.keys.some((k) => k.startsWith('proto3d.addon.') || k.startsWith('proto3d.gateway.')), 'no add-on key leaked unprefixed');
    assert.ok(iso.own.every((k) => !k.startsWith(RAW_PREFIX)), 'the page sees its keys unprefixed'); assert.ok(iso.tabs, 'the add-on page has its own tab set');
    assert.ok(iso.dbs.includes('proto3d-projects'), `scoped dbs: ${iso.dbs.join(', ')}`);
    assert.deepEqual(errors, [], errors.join('\n'));
    await page.close();

    /* ---- 6. core page again: identical core storage, no gw- types, add-on data only under the prefix ---- */
    const core2 = await h.open('/');
    await h.waitForCore(core2.page); await core2.page.waitForTimeout(1500);
    const after = await core2.page.evaluate(coreSnapshot);
    assert.deepEqual(core2.errors, []);
    assert.deepEqual(after.core, before.core, 'the core page\'s own localStorage entries are unchanged by the add-on session');
    assert.equal(after.projects, before.projects, 'the core project store gained nothing');
    assert.ok(!after.types.some((t) => t.startsWith('gw-')), 'no gw- types on the core page');
    const rawAll = await core2.page.evaluate(rawKeys);
    assert.ok(rawAll.some((k) => k.startsWith(RAW_PREFIX)) && rawAll.every((k) => k.startsWith(RAW_PREFIX) || k.startsWith('proto3d.')), rawAll.join(', '));
    assert.ok(after.dbs.every((n) => n.startsWith('addon.gateway-credits.') || before.dbs.includes(n)), `dbs after: ${after.dbs.join(', ')}`);
    assert.ok(after.dbs.includes('addon.gateway-credits.proto3d-projects'), 'the add-on page autosaved into its own, prefixed IndexedDB');
  } finally { await h.close(); }
});
