// The Client Hubs page on the real core in Chromium: boots through the shell with zero errors,
// the CTL OS demo creates the page nodes, the CSS3D live layer sits in #viewport with
// pointer-events: none and loads iframes (imagine-os.github.io is stubbed so the test is hermetic),
// a face click / the api make one frame interactive and Escape clears it, a flow change moves
// blocks, and the add-on's storage stays under its own prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../../../sdk/testing/browser.js';

const STUB = '<!doctype html><html><head><meta charset="utf-8"><title>stub</title></head><body style="margin:0;background:#1f4e79;color:#fff;font:600 32px/1.2 system-ui;padding:24px">stub page</body></html>';
const positions = () => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => [n.uid, +n.position.x.toFixed(2), +n.position.z.toFixed(2)]).sort((a, b) => a[0].localeCompare(b[0]));
const faceCentre = (uid) => {
  const P = window.__proto, n = P.world.nodes.find((x) => x.uid === uid), T = P.THREE;
  const v = new T.Vector3(); n.face.mesh.updateWorldMatrix(true, false); n.face.mesh.getWorldPosition(v); v.project(P.ws.camera);
  const r = P.ws.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z };
};

test('hubs page: boots with zero errors, CTL OS demo, CSS3D live layer with stubbed iframes, interact mode, flows, isolated storage', async () => {
  const h = await createHarness();
  try {
    const { page, errors } = await h.open('/addons/hubs/');
    let stubbed = 0;
    await page.route('https://imagine-os.github.io/**', (route) => { stubbed++; route.fulfill({ status: 200, contentType: 'text/html', body: STUB }); });
    await h.waitForAddon(page);
    await page.waitForFunction(() => window.__proto.world.nodes.some((n) => n.typeId === 'hub-page'));

    /* ---- 1. boot, registration, UI ---- */
    const info = await page.evaluate(() => ({
      title: document.title, types: window.__proto.registry.ids().filter((id) => id.startsWith('hub-')).sort(), importMap: window.__addon.importMap, isolated: window.__protoStorageIsolation.isolated,
      menu: !!document.querySelector('#menubar .mnu-title[data-menu="hubs:hubs"]'), section: !!document.querySelector('#panel > #hubs-section'), flowbar: document.querySelectorAll('#hub-flowbar .hub-flow').length,
      badge: document.querySelector('#addon-badge')?.textContent, category: !!document.querySelector('#left-bar [data-cat="hubs"]'),
      pages: window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').length, blueprints: window.__proto.world.nodes.filter((n) => n.typeId === 'hub-blueprint').length,
      groups: window.__proto.world.groups.length, timeline: window.__proto.world.nodes.some((n) => n.typeId === 'timeline'), board: window.__proto.world.nodes.some((n) => n.typeId === 'kanban-board'),
      layer: (() => { const l = document.querySelector('#viewport > #hub-live-layer'); return l ? { pe: getComputedStyle(l).pointerEvents, pos: getComputedStyle(l).position, w: l.clientWidth } : null; })(),
    }));
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.match(info.title, /Client Hubs/); assert.deepEqual(info.types, ['hub-blueprint', 'hub-page', 'hub-section']); assert.equal(info.importMap, 'injected'); assert.equal(info.isolated, true);
    assert.equal(info.menu, true); assert.equal(info.section, true); assert.equal(info.flowbar, 5); assert.match(info.badge, /Add-on: Client Hubs · SDK 1/); assert.equal(info.category, true);
    assert.equal(info.pages, 21); assert.equal(info.blueprints, 1); assert.equal(info.groups, 11); assert.equal(info.timeline, true); assert.equal(info.board, true);
    assert.deepEqual(info.layer, { pe: 'none', pos: 'absolute', w: info.layer.w }); assert.ok(info.layer.w > 100);

    /* ---- 2. live frames: iframes on imagine-os.github.io, within the budget, stubbed ---- */
    await page.waitForFunction(() => document.querySelectorAll('.hub-live iframe[src*="imagine-os.github.io/cal-tenant-law/"]').length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const live = await page.evaluate(() => ({ frames: [...document.querySelectorAll('.hub-live iframe')].map((f) => f.src), counts: window.__addon.api.counts(), wrappers: [...document.querySelectorAll('.hub-live')].map((w) => getComputedStyle(w).pointerEvents) }));
    assert.ok(live.frames.length > 0 && live.frames.length <= 8, `frames within the budget: ${live.frames.length}`);
    assert.ok(live.frames.every((s) => s.startsWith('https://imagine-os.github.io/cal-tenant-law/')), live.frames.join('\n'));
    assert.ok(live.wrappers.every((pe) => pe === 'none'), 'no frame is interactive before a click');
    assert.equal(live.counts.pages, 21); assert.equal(live.counts.eligible, 21); assert.ok(live.counts.live > 0 && live.counts.live <= 8); assert.equal(live.counts.budget, 8);
    assert.ok(stubbed > 0, 'the stub served the iframes');

    /* ---- 3. interact mode through the api, Escape leaves ---- */
    const phone = await page.evaluate(() => window.__proto.world.nodes.find((n) => n.typeId === 'hub-page' && n.params.device === 'phone').uid);
    assert.equal(await page.evaluate((uid) => window.__addon.api.interact(uid), phone), true);
    await page.waitForFunction((uid) => document.querySelector(`.hub-live[data-uid="${uid}"].is-interactive`), phone);
    const inter = await page.evaluate((uid) => { const w = document.querySelector(`.hub-live[data-uid="${uid}"]`); return { pe: getComputedStyle(w).pointerEvents, done: getComputedStyle(w.querySelector('.hub-live-done')).display, device: w.dataset.device, src: w.querySelector('iframe').src, interactive: window.__addon.api.counts().interactive, selected: window.__proto.selection.nodes.map((n) => n.uid) }; }, phone);
    assert.equal(inter.pe, 'auto'); assert.notEqual(inter.done, 'none'); assert.equal(inter.device, 'phone'); assert.match(inter.src, /#\/app$/); assert.equal(inter.interactive, phone); assert.deepEqual(inter.selected, [phone]);
    await page.waitForTimeout(700);   // the camera glide lands
    await page.keyboard.press('Escape');
    await page.waitForFunction((uid) => !document.querySelector(`.hub-live[data-uid="${uid}"]`).classList.contains('is-interactive'), phone);
    assert.equal(await page.evaluate((uid) => getComputedStyle(document.querySelector(`.hub-live[data-uid="${uid}"]`)).pointerEvents, phone), 'none');
    assert.equal(await page.evaluate(() => window.__addon.api.counts().interactive), null);

    /* ---- 4. a real click on the face (core raycast → face.onPointer → interact) ---- */
    const c = await page.evaluate(faceCentre, phone);
    assert.ok(c.z < 1 && c.x > 0 && c.y > 0, `face centre on screen: ${JSON.stringify(c)}`);
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction((uid) => document.querySelector(`.hub-live[data-uid="${uid}"].is-interactive`), phone, { timeout: 5000 });
    assert.equal(await page.evaluate((uid) => window.__proto.world.nodes.find((n) => n.uid === uid).state.lastOpen, phone), 'face');
    // the Done button leaves too
    await page.evaluate((uid) => document.querySelector(`.hub-live[data-uid="${uid}"] .hub-live-done`).click(), phone);
    assert.equal(await page.evaluate(() => window.__addon.api.counts().interactive), null);

    /* ---- 5. flows: Audience (swimlanes) and Compare move the blocks, undoably, with zero errors ---- */
    const before = await page.evaluate(positions);
    await page.click('#hub-flowbar .hub-flow[data-flow="audience"]');
    await page.waitForTimeout(1200);
    const lanes = await page.evaluate(positions);
    assert.notDeepEqual(lanes, before, 'positions changed');
    assert.ok(new Set(lanes.map(([, , z]) => z)).size >= 5, 'audience: several swimlanes');
    await page.click('#hub-flowbar .hub-flow[data-flow="compare"]');
    await page.waitForTimeout(1200);
    const after = await page.evaluate(positions);
    assert.notDeepEqual(after, lanes, 'compare moved the pages again');
    assert.equal(new Set(after.map(([, x, z]) => `${x}|${z}`)).size, after.length, 'no two pages share a position');
    assert.equal(new Set(after.map(([, , z]) => z)).size, 1, 'compare with one client: one row');
    const flowState = await page.evaluate(() => ({ active: document.querySelector('#hub-flowbar .hub-flow.is-active')?.dataset.flow, canUndo: window.__proto.history.canUndo, labels: window.__proto.history.undoStack.map((c) => c.label), saved: JSON.parse(localStorage.getItem('proto3d.addon.hubs.settings.v1')).flow }));
    assert.equal(flowState.active, 'compare'); assert.equal(flowState.canUndo, true); assert.match(flowState.labels.at(-1), /^Arrange · Compare/); assert.match(flowState.labels.at(-2), /^Arrange · Audience/); assert.equal(flowState.saved, 'compare');
    await page.evaluate(() => { window.__proto.history.undo(); window.__proto.history.undo(); }); await page.waitForTimeout(1200);
    assert.deepEqual(await page.evaluate(positions), before, 'two undos put every page back');

    /* ---- 6. a blueprint regenerates its pages through the face button (undoable) ---- */
    const gen = await page.evaluate(() => {
      const P = window.__proto; const bp = P.world.nodes.find((n) => n.typeId === 'hub-blueprint');
      const pagesBefore = P.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => n.uid);
      const res = window.__addon.api.generate(bp.uid);
      const pagesAfter = P.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => n.uid);
      return { before: pagesBefore.length, after: pagesAfter.length, created: res.nodes.length, removed: res.plan.remove.length, fresh: pagesAfter.filter((u) => !pagesBefore.includes(u)).length, label: P.history.undoStack.at(-1)?.label };
    });
    assert.deepEqual(gen, { before: 21, after: 21, created: 21, removed: 21, fresh: 21, label: 'Regenerate 21 pages' });
    await page.evaluate(() => window.__proto.history.undo());
    assert.equal(await page.evaluate(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').length), 21);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.hub-live')].every((w) => window.__proto.world.nodes.some((n) => n.uid === w.dataset.uid))), true, 'no element for a removed node lingers');

    /* ---- 7. storage: everything the page wrote is under the add-on prefix (the theme passes through) ---- */
    const rawKeys = await page.evaluate(() => { const raw = window.__protoStorageIsolation.raw.localStorage; const ks = []; for (let i = 0; i < raw.length; i++) ks.push(raw.key(i)); return ks; });
    assert.ok(rawKeys.length > 0 && rawKeys.every((k) => k.startsWith('addon.hubs:') || k === 'proto3d.theme'), `raw keys: ${rawKeys.join(', ')}`);
    assert.ok(rawKeys.includes('addon.hubs:proto3d.addon.hubs.settings.v1'));
    assert.deepEqual(errors, [], errors.join('\n'));
  } finally { await h.close(); }
});
