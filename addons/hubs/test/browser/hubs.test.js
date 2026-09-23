// The Client Hubs page on the real core in Chromium: boots through the shell with zero errors,
// the CTL OS demo creates the page nodes, the CSS3D live layer sits in #viewport with
// pointer-events: none and loads iframes (imagine-os.github.io is stubbed so the test is hermetic),
// a face click / the api make one frame interactive and Escape clears it, a flow change moves
// blocks, and the add-on's storage stays under its own prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../../../sdk/testing/browser.js';

const STUB = '<!doctype html><html><head><meta charset="utf-8"><title>stub</title></head><body style="margin:0;background:#1f4e79;color:#fff;font:600 32px/1.2 system-ui;padding:24px">stub page</body></html>';
const positions = () => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => [n.uid, +n.position.x.toFixed(2), +n.position.y.toFixed(2), +n.position.z.toFixed(2), +n.rotation.y.toFixed(3)]).sort((a, b) => a[0].localeCompare(b[0]));
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
    assert.ok(live.frames.length > 0 && live.frames.length <= 16, `frames within the budget: ${live.frames.length}`);
    assert.ok(live.frames.every((s) => s.startsWith('https://imagine-os.github.io/cal-tenant-law/')), live.frames.join('\n'));
    assert.ok(live.wrappers.every((pe) => pe === 'none'), 'no frame is interactive before a click');
    assert.equal(live.counts.pages, 21); assert.equal(live.counts.eligible, 21); assert.ok(live.counts.live > 0 && live.counts.live <= 16); assert.equal(live.counts.budget, 16);
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
    assert.ok(new Set(lanes.map(([, , y]) => y)).size >= 5, 'audience: several floors (distinct y)');
    assert.ok(lanes.every(([, , , , ry]) => ry === 0), 'audience rows face the camera');
    await page.click('#hub-flowbar .hub-flow[data-flow="compare"]');
    await page.waitForTimeout(1200);
    const after = await page.evaluate(positions);
    assert.notDeepEqual(after, lanes, 'compare moved the pages again');
    assert.equal(new Set(after.map(([, x, y, z]) => `${x}|${y}|${z}`)).size, after.length, 'no two pages share a position');
    assert.ok(new Set(after.map(([, , y]) => y)).size <= 3, 'compare with one client: one level (back banks sit 2 units up each)');
    assert.ok(before.some(([, , , , ry]) => Math.abs(ry) > 0.2), 'the delivery arc rotated cards toward its centre');
    const flowState = await page.evaluate(() => ({ active: document.querySelector('#hub-flowbar .hub-flow.is-active')?.dataset.flow, canUndo: window.__proto.history.canUndo, labels: window.__proto.history.undoStack.map((c) => c.label), saved: JSON.parse(localStorage.getItem('proto3d.addon.hubs.settings.v1')).flow }));
    assert.equal(flowState.active, 'compare'); assert.equal(flowState.canUndo, true); assert.match(flowState.labels.at(-1), /^Arrange · Compare/); assert.match(flowState.labels.at(-2), /^Arrange · Audience/); assert.equal(flowState.saved, 'compare');
    await page.evaluate(() => { window.__proto.history.undo(); window.__proto.history.undo(); }); await page.waitForTimeout(1200);
    assert.deepEqual(await page.evaluate(positions), before, 'two undos put every page back');

    /* ---- 5b. the embed height: the flow bar slider resizes every card live, the CSS3D frames follow ---- */
    const sizes0 = await page.evaluate(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => [n.params.device, +n.width.toFixed(2), +n.height.toFixed(2), n.face.cw, n.face.ch]));
    assert.ok(sizes0.every(([, , h]) => h === 8), 'default height 8'); assert.ok(sizes0.some(([d, w]) => d === 'phone' && w === 3.4) && sizes0.some(([d, w]) => d === 'desktop' && w === 8.6));
    await page.evaluate(() => { const r = document.querySelector('#hub-flowbar .hub-height input[type="range"]'); r.value = '11'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').every((n) => Math.abs(n.height - 11) < 1e-6));
    await page.waitForTimeout(500);
    const sizes1 = await page.evaluate(() => ({
      cards: window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => [+n.width.toFixed(2), +n.height.toFixed(2), n.face.ch, +n.getAABB().getSize(new window.__proto.THREE.Vector3()).y.toFixed(2)]),
      stored: JSON.parse(localStorage.getItem('proto3d.addon.hubs.settings.v1')).embedHeight, value: document.querySelector('#hub-flowbar .hub-height output').textContent, panel: document.querySelector('#hub-embed-height').value,
      elements: [...document.querySelectorAll('.hub-live')].map((w) => { const n = window.__proto.world.nodes.find((x) => x.uid === w.dataset.uid); return [parseFloat(w.style.height), n.face.ch]; }),
      undo: window.__proto.history.undoStack.map((c) => c.label),
    }));
    assert.ok(sizes1.cards.every(([, h, ch, aabb]) => h === 11 && ch === Math.round((11 - 0.46 - 0.2) * 120) && aabb === 11), `cards re-baked at 11: ${JSON.stringify(sizes1.cards.slice(0, 2))}`);
    assert.equal(sizes1.stored, 11); assert.equal(sizes1.value, '11.0'); assert.equal(sizes1.panel, '11');
    assert.ok(sizes1.elements.length > 0 && sizes1.elements.every(([eh, ch]) => eh < ch && eh > ch * 0.8), 'the live elements were rebuilt for the taller faces');
    assert.ok(!sizes1.undo.some((l) => /height/i.test(l)), 'the slider does not write history');
    // a card's own height wins over the global one
    await page.evaluate(() => { const n = window.__proto.world.nodes.find((x) => x.typeId === 'hub-page'); n.params.height = 5; n.faceDirty = true; });
    await page.waitForFunction(() => Math.abs(window.__proto.world.nodes.find((x) => x.typeId === 'hub-page').height - 5) < 1e-6);
    await page.evaluate(() => { window.__addon.api.setEmbedHeight(8); const n = window.__proto.world.nodes.find((x) => x.typeId === 'hub-page'); n.params.height = 0; n.faceDirty = true; });
    await page.waitForFunction(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').every((n) => Math.abs(n.height - 8) < 1e-6));
    // serialize → load keeps the size and the rotation
    const round = await page.evaluate(() => { const doc = window.__proto.serialize(); const n = doc.nodes.find((x) => x.type === 'hub-page' && x.params.device === 'phone'); return { params: n.params, rotationY: n.rotationY }; });
    assert.equal(round.params.aspect, 'device'); assert.equal(round.params.height, 0); assert.equal(typeof round.rotationY, 'number');

    /* ---- 6. a blueprint regenerates its pages through the face button (undoable) ---- */
    const gen = await page.evaluate(() => {
      const P = window.__proto; const bp = P.world.nodes.find((n) => n.typeId === 'hub-blueprint');
      const pagesBefore = P.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => n.uid);
      const res = window.__addon.api.generate(bp.uid);
      const pagesAfter = P.world.nodes.filter((n) => n.typeId === 'hub-page').map((n) => n.uid);
      return { before: pagesBefore.length, after: pagesAfter.length, created: res.nodes.length, removed: res.plan.remove.length, fresh: pagesAfter.filter((u) => !pagesBefore.includes(u)).length, label: P.history.undoStack.at(-1)?.label };
    });
    assert.deepEqual(gen, { before: 21, after: 21, created: 21, removed: 21, fresh: 21, label: 'Regenerate 21 pages' });
    assert.ok(await page.evaluate(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').some((n) => Math.abs(n.rotation.y) > 0.2 && n.position.y > 6)), 'generated pages sit on the arc, rotated and climbing');
    await page.evaluate(() => window.__proto.history.undo());
    assert.equal(await page.evaluate(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').length), 21);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.hub-live')].every((w) => window.__proto.world.nodes.some((n) => n.uid === w.dataset.uid))), true, 'no element for a removed node lingers');

    /* ---- 6b. previews, budget "All", facing: the screen always shows page content ---- */
    await page.evaluate(() => window.__addon.api.frame('delivery')); await page.waitForTimeout(1500);
    await page.evaluate(() => { const P = window.__proto; const t = P.ws.controls.target.clone(); const dir = P.ws.camera.position.clone().sub(t).normalize(); P.ws.flyTo(t.clone().addScaledVector(dir, 180), t, 0); });   // far out: 180 units
    await page.waitForFunction(() => window.__proto.world.nodes.filter((n) => n.typeId === 'hub-page').every((n) => n.lod === 0), null, { timeout: 5000 });
    await page.waitForTimeout(2500);   // previews load (served locally by the harness), faces repaint
    const far = await page.evaluate(() => {
      const P = window.__proto; const cam = P.ws.camera;
      const pages = P.world.nodes.filter((n) => n.typeId === 'hub-page');
      const sample = (n) => { const f = n.face; const g = f.canvas.getContext('2d'); const s = f.scale; const cw = f.canvas.width, ch = f.canvas.height; const pts = [[0.3, 0.45], [0.5, 0.5], [0.7, 0.6], [0.5, 0.75]].map(([u, v]) => g.getImageData(Math.floor(cw * u), Math.floor(ch * v), 1, 1).data); const colours = new Set(pts.map((d) => `${d[0]},${d[1]},${d[2]}`)); return { colours: colours.size, white: pts.every((d) => d[0] > 245 && d[1] > 245 && d[2] > 245), s }; };
      return { dist: +cam.position.distanceTo(P.ws.controls.target).toFixed(0), lod: pages.map((n) => n.lod), samples: pages.slice(0, 6).map(sample), states: pages.map((n) => window.__addon.api.previewState(n.params)) };
    });
    assert.ok(far.dist >= 170, `camera far out (${far.dist})`); assert.ok(far.lod.every((l) => l === 0), 'hub-page faces are never at far LOD');
    assert.ok(far.states.filter((st) => st === 'ready').length >= 15, `previews loaded: ${JSON.stringify(far.states)}`);
    assert.ok(far.samples.every((sm) => sm.colours >= 2 && !sm.white), `far faces show page imagery, not a blank frame: ${JSON.stringify(far.samples)}`);
    // budget "All": more than 8 frames live at once
    await page.evaluate(() => window.__addon.api.setBudget(40)); await page.waitForTimeout(900);
    const all = await page.evaluate(() => window.__addon.api.counts());
    assert.ok(all.live > 8, `All: ${all.live} live frames`); assert.equal(all.budget, 40);
    // facing: a back-facing card hides its frame, a 70° oblique one keeps it
    const facing = await page.evaluate(async () => {
      const P = window.__proto; const live = window.__addon.api.live;
      const pick = P.world.nodes.filter((n) => n.typeId === 'hub-page' && live.entries.get(n)?.live).slice(0, 2);
      const yaw = (n, deg) => { const t = P.ws.camera.position.clone().sub(n.position); n.rotation.y = Math.atan2(t.x, t.z) + deg * Math.PI / 180; };
      yaw(pick[0], 180); yaw(pick[1], 70);
      await new Promise((r) => setTimeout(r, 500));
      return { back: live.entries.get(pick[0]).obj.visible, oblique: live.entries.get(pick[1]).obj.visible, backEl: live.entries.get(pick[0]).el.style.display, obliqueEl: live.entries.get(pick[1]).el.style.display };
    });
    assert.equal(facing.back, false); assert.equal(facing.backEl, 'none'); assert.equal(facing.oblique, true); assert.notEqual(facing.obliqueEl, 'none');
    await page.evaluate(() => window.__addon.api.setBudget(16));

    /* ---- 6c. occlusion: a block between the camera and a live frame hides the frame (the preview shows); moving it away brings the frame back ---- */
    await page.evaluate(() => window.__addon.api.loadDemo('hub-cal-tenant-law')); await page.waitForTimeout(1500);
    const occ = await page.evaluate(async () => {
      const P = window.__proto, api = window.__addon.api, live = api.live, T = P.THREE;
      const target = P.world.nodes.find((n) => n.typeId === 'hub-page' && n.params.section === 'site');
      api.interact(target.uid); await new Promise((r) => setTimeout(r, 900)); api.leaveInteract();   // the camera faces the card squarely
      await new Promise((r) => setTimeout(r, 600));
      const before = live.occlusionPass();
      const e = live.entries.get(target);
      const visBefore = e.el.style.visibility;
      // a second card standing 40 % of the way from the card to the camera, facing the camera
      const cam = P.ws.camera.position.clone(), c = target.position.clone();
      const mid = c.clone().lerp(cam, 0.4);
      const blocker = P.createInstance('hub-page', { title: 'blocker', params: { title: 'Blocker', status: 'planned', device: 'desktop' } });
      blocker.rotation.y = Math.atan2(cam.x - mid.x, cam.z - mid.z);
      P.world.addNode(blocker, [mid.x, mid.y, mid.z]);
      const passes = []; for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 350)); passes.push(live.occlusionPass().occluded); }
      const hidden = { vis: e.el.style.visibility, occluded: e.occluded, display: e.el.style.display, ms: live.perf.lastMs };
      blocker.position.x += 80; blocker.updateMatrixWorld(true);
      await new Promise((r) => setTimeout(r, 350)); live.occlusionPass(); await new Promise((r) => setTimeout(r, 350));
      const shown = { vis: e.el.style.visibility, occluded: e.occluded };
      P.world.removeNode(blocker);
      return { before: before.occluded, visBefore, passes, hidden, shown, liveBefore: before.live };
    });
    assert.equal(occ.visBefore, 'visible', 'a clear line of sight: the frame shows');
    assert.equal(occ.hidden.occluded, true, `a card in front hides the frame (passes: ${occ.passes})`); assert.equal(occ.hidden.vis, 'hidden'); assert.notEqual(occ.hidden.display, 'none', 'the iframe stays loaded');
    assert.equal(occ.shown.occluded, false, 'blocker moved away: the frame shows again'); assert.equal(occ.shown.vis, 'visible');
    // performance with the compare demo (89 cards), budget All
    await page.evaluate(() => { window.__addon.api.loadDemo('hub-compare'); window.__addon.api.setBudget(40); }); await page.waitForTimeout(1500);
    const perf = await page.evaluate(() => { const live = window.__addon.api.live; const ms = []; for (let i = 0; i < 5; i++) { live.occlusionPass(); ms.push(live.perf.lastMs); } return { ms, live: live.counts().live, pages: live.counts().pages }; });
    assert.equal(perf.pages, 89); assert.ok(Math.min(...perf.ms) < 12, `occlusion pass with ${perf.live} live frames of ${perf.pages} cards: ${perf.ms.map((m) => m.toFixed(1)).join(' / ')} ms (headless swiftshader)`);
    console.log(`occlusion pass: ${perf.ms.map((m) => m.toFixed(2)).join(' / ')} ms for ${perf.live} live frames of ${perf.pages} cards`);
    await page.evaluate(() => window.__addon.api.setBudget(16));
    // File → New: nothing of the live layer stays visible once the world is gone
    await page.evaluate(() => window.__proto.newProject()); await page.waitForTimeout(700);
    const afterNew = await page.evaluate(() => ({ nodes: window.__proto.world.nodes.length, visible: [...document.querySelectorAll('.hub-live')].filter((w) => w.style.display !== 'none' && w.style.visibility !== 'hidden').length, entries: window.__addon.api.live.entries.size }));
    assert.equal(afterNew.nodes, 0); assert.equal(afterNew.visible, 0, 'no live element visible after File → New'); assert.equal(afterNew.entries, 0);
    await page.evaluate(() => window.__addon.api.loadDemo('hub-cal-tenant-law')); await page.waitForTimeout(1200);

    /* ---- 7. storage: everything the page wrote is under the add-on prefix (the theme passes through) ---- */
    const rawKeys = await page.evaluate(() => { const raw = window.__protoStorageIsolation.raw.localStorage; const ks = []; for (let i = 0; i < raw.length; i++) ks.push(raw.key(i)); return ks; });
    assert.ok(rawKeys.length > 0 && rawKeys.every((k) => k.startsWith('addon.hubs:') || k === 'proto3d.theme'), `raw keys: ${rawKeys.join(', ')}`);
    assert.ok(rawKeys.includes('addon.hubs:proto3d.addon.hubs.settings.v1'));
    assert.deepEqual(errors, [], errors.join('\n'));
  } finally { await h.close(); }
});
