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

test('gateway-credits page: boots with zero errors, faces expose fields, Run sample meters every agent step and lays the flow out, declines at 0.5 cr, auto tops up; the core page and its storage stay untouched', async () => {
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
    assert.deepEqual(boot.types, ['gw-llm', 'gw-tool', 'gw-budget', 'gw-meter', 'gw-memory', 'gw-agent']);
    assert.deepEqual(boot.nodes, ['gw-agent', 'gw-budget', 'gw-llm', 'gw-llm', 'gw-memory', 'gw-meter', 'gw-tool', 'gw-tool', 'gw-tool', 'input', 'log'], 'the sample graph (agent + sub-nodes) loaded into a fresh page');
    assert.equal(boot.menu, true, 'Credits menu is in the core menu bar'); assert.equal(boot.admin, true, 'admin section sits in #panel outside #panel-body'); assert.equal(boot.railHasGateway, true, 'Gateway category in the Add rail');
    assert.equal(boot.rows, 0); assert.equal(boot.balance, 2300); assert.match(boot.badge, /Add-on: Gateway Credits · SDK 1/); assert.equal(boot.tabName, 'Gateway credits · Research desk'); assert.equal(boot.startOpen, false);

    /* ---- 2b. the faces are working UIs: a gw-llm face exposes fields (model select, Run action…), sub-nodes hang under the agent, slot cables carry the data hue ---- */
    const faces = await page.evaluate(() => {
      const W = window.__proto.world; const byTitle = (t) => W.nodes.find((n) => n.title === t);
      const llm = byTitle('Chat model'), agent = byTitle('Research agent');
      const fields = llm.fields().map((f) => ({ id: f.id, kind: f.kind, param: f.param || null }));
      const slotCables = W.connections.filter((c) => /^(model|memory|tools)$/.test(c.to.key));
      return {
        fields, llmSize: llm.def.size, face: [llm.face.cw, llm.face.ch], agentFace: [agent.face.cw, agent.face.ch],
        agentFields: agent.fields().map((f) => f.id), editable: window.__proto.fieldEditor.editable(llm),
        under: ['Chat model', 'Memory', 'Web search', 'Crawl pages', 'Parse PDFs'].map((t) => byTitle(t).position.z > agent.position.z),
        chain: [byTitle('New research request').position.x < agent.position.x, agent.position.x < byTitle('Draft summary').position.x, byTitle('Draft summary').position.x < byTitle('Report').position.x],
        top: [byTitle('Research budget').position.z < agent.position.z, byTitle('Credits meter').position.z < agent.position.z],
        slotCables: slotCables.length, slotHue: [...new Set(slotCables.map((c) => c.color.getHexString()))], eventHue: W.connections.find((c) => c.to.key === 'trigger').color.getHexString(),
        glyphIcons: Object.keys(window.__proto.icons).filter((k) => k.startsWith('gw-svc-')).length,
      };
    });
    assert.ok(faces.fields.some((f) => f.id === 'model' && f.kind === 'select' && f.param === 'model'), JSON.stringify(faces.fields));
    assert.ok(faces.fields.some((f) => f.id === 'run' && f.kind === 'action')); assert.ok(faces.fields.some((f) => f.id === 'prompt' && f.kind === 'multiline'));
    assert.ok(faces.fields.some((f) => f.id === 'tier:premium' && f.kind === 'action') && faces.fields.some((f) => f.id === 'credential'));
    assert.equal(faces.llmSize, 'M'); assert.deepEqual(faces.face, [485, 288]); assert.deepEqual(faces.agentFace, [701, 432]); assert.equal(faces.editable, true, 'the core field editor sees the face fields');
    assert.ok(faces.agentFields.includes('run') && faces.agentFields.includes('prompt'));
    assert.deepEqual(faces.under, [true, true, true, true, true], 'slot sub-nodes hang below the agent (larger z)'); assert.deepEqual(faces.chain, [true, true, true]); assert.deepEqual(faces.top, [true, true]);
    assert.equal(faces.slotCables, 5); assert.equal(faces.slotHue.length, 1); assert.notEqual(faces.slotHue[0], faces.eventHue, 'slot cables (data) read differently from the event chain');
    assert.equal(faces.glyphIcons, 18);

    /* ---- 3. Credits → Run sample: every agent step settles, the own-key draft bypasses, the flow layout runs ---- */
    const beforeLayout = await page.evaluate(() => Object.fromEntries(window.__proto.world.nodes.map((n) => [n.title, [n.position.x, n.position.z]])));
    await page.evaluate(() => window.__proto.history.execute(window.__proto.cmd.transform(window.__proto.world, window.__proto.world.nodes.slice(0, 3), window.__proto.world.nodes.slice(0, 3).map(window.__proto.cmd.snapshot), window.__proto.world.nodes.slice(0, 3).map((n) => ({ p: [n.position.x + 7, n.position.y, n.position.z + 5], r: 0, s: 1 })))));   // scramble three blocks so the layout has something to fix
    await page.click('#menubar .mnu-title[data-menu="gateway-credits:credits"]');
    await page.waitForSelector('.mnu-menu .mnu-item');
    const heading = await page.$eval('.mnu-menu .mnu-heading', (e) => e.textContent); assert.match(heading, /^Balance 2,300\.00 cr/);
    assert.ok(await page.$('.mnu-menu .mnu-item:has-text("Flow layout")'), 'Credits → Flow layout exists');
    await page.click('.mnu-menu .mnu-item:has-text("Run sample")');
    await page.waitForFunction(() => window.__gateway.ledger.rows(50).filter((r) => r.status === 'settled').length >= 5 && window.__gateway.ledger.rows(50).some((r) => r.status === 'bypassed'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#gw-ledger tbody tr[data-status="settled"]').length >= 5);
    const run = await page.evaluate(() => {
      const L = window.__gateway.ledger; const rows = L.rows(50).reverse(); const W = window.__proto.world; const agent = W.nodes.find((n) => n.typeId === 'gw-agent');
      return { statuses: rows.map((r) => r.status), titles: rows.map((r) => r.nodeTitle), providers: rows.map((r) => r.providerId), balance: L.available(), held: L.held(), spend: L.spend(), domRows: document.querySelectorAll('#gw-ledger tbody tr[data-status]').length, tile: document.querySelector('#gw-admin .gw-tile.hero .val').textContent,
        log: W.nodes.find((n) => n.typeId === 'log')?.state, steps: agent.state.gw.steps.map((s) => s.status), answer: agent.state.gw.answer, memory: W.nodes.find((n) => n.typeId === 'gw-memory').state.exchanges.length,
        positions: Object.fromEntries(W.nodes.map((n) => [n.title, [n.position.x, n.position.z]])), undo: window.__proto.history.undoStack.at(-1)?.label,
        expected: (() => { const g = window.__gateway.host.layout.graph(); const m = window.__gateway.flowLayout(g.nodes, g.connections); return Object.fromEntries(W.nodes.map((n) => [n.title, m.get(n.uid)])); })() };
    });
    assert.ok(run.balance < 2300, `balance dropped: ${run.balance}`); assert.equal(run.held, 0); assert.ok(run.spend > 0);
    assert.deepEqual(run.statuses, ['settled', 'settled', 'settled', 'settled', 'settled', 'bypassed'], run.statuses.join(','));
    assert.deepEqual(run.titles, ['Research agent · step 1', 'Research agent · step 2', 'Research agent · step 3', 'Research agent · step 4', 'Research agent · step 5', 'Draft summary']);
    assert.deepEqual(run.providers, ['anthropic', 'brave', 'firecrawl', 'pdfco', 'anthropic', 'openai']);
    assert.deepEqual(run.steps, ['settled', 'settled', 'settled', 'settled', 'settled']); assert.match(run.answer, /^\[Claude Sonnet 4.5\]/); assert.equal(run.memory, 1);
    assert.equal(run.log.total, 1); assert.match(run.log.entries[0].text, /via own key/);
    assert.equal(run.domRows, run.statuses.length); assert.match(run.tile, /cr$/); assert.notEqual(run.tile, '2,300.00 cr');
    // the flow layout ran after the sample: every block sits where the pure flowLayout of the live graph (measured footprints) puts it, as one undoable command; the scrambled three moved
    for (const t of Object.keys(run.expected)) assert.deepEqual(run.positions[t], run.expected[t], `${t} at its flow position`);
    assert.ok(Object.keys(beforeLayout).some((t) => run.positions[t][0] !== beforeLayout[t][0] + 7 || run.positions[t][1] !== beforeLayout[t][1] + 5), 'the scramble was undone by the layout');
    assert.equal(run.undo, 'Flow layout');

    /* ---- 3b. the face Run field runs the node (the field mechanism the core's editor uses); a tier chip sets the param undoably ---- */
    await page.evaluate(() => { const n = window.__proto.world.nodes.find((x) => x.title === 'Web search'); n.fields().find((f) => f.id === 'run').run(n); });
    await page.waitForFunction(() => window.__gateway.ledger.rows(50).filter((r) => r.status === 'settled' && r.nodeTitle === 'Web search').length === 1, null, { timeout: 10000 });
    const chip = await page.evaluate(() => {
      const n = window.__proto.world.nodes.find((x) => x.title === 'Chat model'); const f = n.fields().find((x) => x.id === 'tier:premium'); f.run(n);
      const undo = window.__proto.history.undoStack.at(-1)?.label; window.__proto.history.undo();
      return { after: f && n.params.tier, undo, restored: n.params.tier };
    });
    assert.equal(chip.undo, 'Set tier'); assert.equal(chip.restored, 'standard');
    // a single click on the face's Run button (outside edit mode) goes through def.face.onPointer
    const clicked = await page.evaluate(() => { const n = window.__proto.world.nodes.find((x) => x.title === 'Parse PDFs'); const f = n.fields().find((x) => x.id === 'run'); const u = (f.rect.x + f.rect.w / 2) / n.face.cw, v = (f.rect.y + f.rect.h / 2) / n.face.ch; const down = n.onFacePointer({ type: 'down', u, v, button: 0 }); n.onFacePointer({ type: 'up', u, v, button: 0 }); const click = n.onFacePointer({ type: 'click', u, v, button: 0 }); return { down, click }; });
    assert.deepEqual(clicked, { down: true, click: true });
    await page.waitForFunction(() => window.__gateway.ledger.rows(50).filter((r) => r.status === 'settled' && r.nodeTitle === 'Parse PDFs').length === 1, null, { timeout: 10000 });

    /* ---- 4. decline at 0.5 cr, then auto top-up ---- */
    await page.click('#menubar .mnu-title[data-menu="gateway-credits:credits"]'); await page.click('.mnu-menu .mnu-item:has-text("Set balance to 0.5 cr")');
    await page.waitForFunction(() => Math.abs(window.__gateway.ledger.available() - 0.5) < 1e-3);   // adjustTo rounds the adjustment to 4 decimals
    await page.click('#gw-run');
    await page.waitForFunction(() => window.__gateway.ledger.rows().some((r) => r.status === 'decline'), null, { timeout: 10000 });
    const declined = await page.evaluate(() => { const r = window.__gateway.ledger.rows()[0]; const n = window.__proto.world.nodes.find((x) => x.title === 'Research agent'); return { status: r.status, note: r.note, error: n.rt.error, state: n.derivedState, balance: window.__gateway.ledger.available(), steps: n.state.gw.steps.map((s) => s.status) }; });
    assert.equal(declined.status, 'decline'); assert.match(declined.note, /insufficient balance/); assert.match(declined.error, /declined/); assert.equal(declined.state, 'error'); assert.ok(Math.abs(declined.balance - 0.5) < 1e-3, `balance ${declined.balance}`);
    assert.deepEqual(declined.steps, ['failed', 'skipped', 'skipped', 'skipped', 'skipped'], 'the agent declines at step 1 and skips the rest');
    await page.check('#gw-at-enabled');
    await page.waitForFunction(() => window.__gateway.ledger.rows().some((r) => r.status === 'topup'), null, { timeout: 10000 });
    await page.click('#gw-run');
    await page.waitForFunction(() => window.__gateway.ledger.rows(50).filter((r) => r.status === 'settled').length >= 12, null, { timeout: 30000 });   // 5 agent steps + 2 face runs, then 5 more
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
