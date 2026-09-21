// The hub- nodes on the REAL core Engine in Node: the fake host stands in for the page, the
// headless world for Block3D / World. Faces render on a stub 2D context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost, fakeCanvasContext } from '../../../sdk/testing/fake-host.js';
import { createHeadlessWorld } from '../../../sdk/testing/headless-engine.js';
import { scanAddons } from '../../../sdk/testing/drift-guard.js';
import manifest from '../../addon.json' with { type: 'json' };
import { register, install, HUB_TYPES } from '../../src/index.js';
import { blueprintLayout, routeLabel, rgba, hooks } from '../../src/nodes.js';
import { faceLayout, cardDims, faceSize, setEmbedHeight, embedHeight, pageWidthOf, PX, CARD, DEFAULT_EMBED_HEIGHT } from '../../src/sizing.js';
import { blueprintParams } from '../../src/clients.js';
import { makeExamples } from '../../src/examples.js';

const hw = createHeadlessWorld();
const host = createFakeHost(manifest, { headless: hw });
register(host);
const api = await install(host, { sample: false });
const pulses = (node, key) => node.getPort(key, 'out').pulses || 0;
const ctxFor = (n) => ({ params: n.params, state: n.state, instance: n, palette: host.theme.palette, inputs: {}, outputs: {} });

test('register() put the three hub- types into the registry with icons; install() returned the api and hooked the world', () => {
  assert.deepEqual(host.nodes.ids(), HUB_TYPES);
  assert.ok(host.icons.has('hubs') && host.icons.has('hub-page') && host.icons.has('hub-blueprint'));
  assert.ok(host.nodes.get('hub-page').body3d, 'hub-page is a body3d card sized per instance'); assert.deepEqual(host.nodes.get('hub-page').body3d.dims(host.nodes.get('hub-page')), { width: 8.6, height: DEFAULT_EMBED_HEIGHT, depth: 0.16, kind: 'desktop', pageW: 1280 }); assert.equal(host.nodes.get('hub-section').size, 'M');
  assert.deepEqual(host.nodes.get('hub-page').params.map((p) => p.key), ['url', 'title', 'section', 'audience', 'role', 'device', 'status', 'live', 'client', 'order', 'height', 'aspect', 'pageWidth']);
  assert.equal(host.nodes.get('hub-blueprint').outputs.find((o) => o.key === 'tasks').subtype, 'tasks');
  assert.equal(api.examples.length, 6); assert.equal(api.live, null); assert.equal(host._rec.worldListeners.length, 1); assert.equal(host._rec.errorHandlers.length, 1);
  assert.equal(hooks.open, null); assert.equal(hooks.generate, null);
  assert.deepEqual(scanAddons(new URL('../../..', import.meta.url).pathname).filter((v) => v.file.includes('/hubs/')), [], 'drift guard: no core imports from the add-on');
});

test('hub-blueprint evaluates count / pages / tasks for a known client and for a template client; footer reads them', () => {
  const bp = hw.add('hub-blueprint', blueprintParams('cal-tenant-law'), { title: 'CTL OS' });
  hw.tick();
  assert.equal(bp.out.count, 21); assert.equal(bp.out.pages.length, 21); assert.equal(bp.out.tasks.length, 11);
  assert.equal(bp.out.pages[3].url, 'https://imagine-os.github.io/cal-tenant-law/#/app'); assert.equal(bp.out.pages[3].device, 'phone');
  assert.equal(bp.out.tasks[0].title, 'Testing hub for CTL OS'); assert.equal(bp.out.tasks[0].column, 'Done');
  assert.equal(bp.footerText, '21 pages · 11 sections · live');
  const same = bp.out.pages; hw.tick(); assert.equal(bp.out.pages, same, 'cached between frames while params are unchanged');
  const acme = hw.add('hub-blueprint', { client: 'Acme', baseUrl: 'https://x.test/acme/', sections: ['hub', 'site', 'app'] });
  hw.tick();
  assert.equal(acme.out.count, 4); assert.ok(acme.out.pages.every((p) => p.status === 'planned' && p.client === 'acme')); assert.equal(acme.out.tasks.length, 3);
  assert.equal(acme.footerText, '4 pages · 3 sections · planned');
  hw.remove(bp); hw.remove(acme);
});

test('generate event → the blueprint pulses `generated` with the page count (no browser hook in Node)', () => {
  const bp = hw.add('hub-blueprint', blueprintParams('petrock'));
  hw.tick();
  hw.trigger(bp, 'generate', 'test'); hw.tick();   // the trigger lands → onEvent queues `generated`
  assert.equal(bp.state.generateRequests, 1); assert.equal(pulses(bp, 'generated'), 0);
  hw.tick();                                          // an external emit is applied on the next pass, like a face click in the browser
  assert.equal(pulses(bp, 'generated'), 1); assert.equal(bp.state.generateRequests, 1); assert.equal(bp.state.generatedCount, 15);
  const pulse = bp.getPort('generated', 'out').pulse; assert.equal(pulse.payload.slug, 'petrock'); assert.equal(pulse.payload.count, 15);
  hw.remove(bp);
});

test('hub-page: `page` output describes the page; the `open` event and a face click emit `opened`', () => {
  const pg = hw.add('hub-page', { url: 'https://imagine-os.github.io/hoy/#/app', title: 'App de clientes', section: 'app', audience: 'customers', device: 'phone', status: 'live', client: 'hoy', order: 3 });
  const log = hw.add('hub-page', { title: 'sink' });   // any event input to receive the pulse
  hw.connect(pg, 'opened', log, 'open');
  hw.tick();
  assert.deepEqual(pg.out.page, { url: 'https://imagine-os.github.io/hoy/#/app', title: 'App de clientes', section: 'app', audience: 'customers', role: '', device: 'phone', status: 'live', live: true, client: 'hoy', order: 3 });
  assert.equal(pg.footerText, 'App · live · phone');
  hw.trigger(pg, 'open'); hw.tick(); hw.tick();   // trigger lands, then the queued `opened` emit is applied
  assert.equal(pulses(pg, 'opened'), 1); assert.equal(pg.state.opens, 1); assert.equal(pg.state.lastOpen, 'event');
  assert.equal(log.state.opens, 1, 'the downstream page received the opened pulse on its open input in the same pass');
  const def = host.nodes.get('hub-page');
  assert.equal(def.face.onPointer(ctxFor(pg), { type: 'down', u: 0.5, v: 0.5, button: 0 }), false, 'a press drags the block');
  assert.equal(def.face.onPointer(ctxFor(pg), { type: 'click', u: 0.5, v: 0.5, button: 0 }), true);
  hw.tick(); assert.equal(pulses(pg, 'opened'), 2); assert.equal(pg.state.lastOpen, 'face');
  hw.remove(pg); hw.remove(log);
});

test('faces render on a stub 2D context for every device / status without throwing; the blueprint button and checklist are clickable', () => {
  const def = host.nodes.get('hub-page'); const bdef = host.nodes.get('hub-blueprint'); const sdef = host.nodes.get('hub-section');
  for (const device of ['desktop', 'tablet', 'phone', 'none']) for (const status of ['planned', 'building', 'live']) {
    const n = hw.add('hub-page', { url: 'https://imagine-os.github.io/petrock/#/desk', title: 'Front desk', section: 'staff', role: 'front desk', device, status, client: 'petrock' });
    const d = cardDims(n.params), f = faceSize(d);
    const g = fakeCanvasContext(); def.face.render(g, Math.round(f.w * PX), Math.round(f.h * PX), ctxFor(n));
    assert.ok(g.calls.some((c) => c[0] === 'fillText'), `${device}/${status} drew text`);
    hw.remove(n);
  }
  const bp = hw.add('hub-blueprint', blueprintParams('hoy'));
  bp.face = { cw: 1013, ch: 552 };
  const g = fakeCanvasContext(); bdef.face.render(g, 1013, 552, ctxFor(bp));
  assert.ok(g.calls.filter((c) => c[0] === 'fillText').length > 20);
  const L = blueprintLayout(1013, 552);
  assert.equal(L.rows.length, 11); assert.ok(L.button.x + L.button.w <= 1013 - 28 && L.button.y + L.button.h <= 552);
  const click = (r) => bdef.face.onPointer(ctxFor(bp), { type: 'click', u: (r.x + r.w / 2) / 1013, v: (r.y + r.h / 2) / 552, button: 0 });
  assert.equal(click(L.button), true); assert.equal(bp.state.generateRequests, 1);
  assert.equal(click(L.rows[2]), true); assert.deepEqual(bp.params.sections.includes('app'), false, 'row 3 (app) toggled off');
  assert.equal(click(L.rows[2]), true); assert.equal(bp.params.sections.includes('app'), true);
  assert.equal(bdef.face.onPointer(ctxFor(bp), { type: 'click', u: 0.02, v: 0.98, button: 0 }), false, 'a click elsewhere does nothing');
  const s = hw.add('hub-section', { section: 'manual', client: 'hoy' });
  const g2 = fakeCanvasContext(); sdef.face.render(g2, 485, 288, ctxFor(s)); hw.tick();
  assert.equal(s.out.section.label, 'Ops manual'); assert.equal(s.footerText, 'staff');
  const lbl = hw.add('hub-section', { section: 'hub', client: 'petrock', label: 'Petrock' });
  const g3 = fakeCanvasContext(); sdef.face.render(g3, 485, 288, ctxFor(lbl)); hw.tick();
  assert.equal(lbl.out.section.label, 'Petrock'); assert.equal(lbl.out.section.level, true); assert.equal(lbl.footerText, 'petrock'); assert.ok(g3.calls.some((c) => c[0] === 'fillText' && c[1] === 'petrock'), 'the client chip is drawn (drawText is a no-op in the fake host)');
  hw.remove(lbl);
  hw.remove(bp); hw.remove(s);
});

test('sizing: the card is the width of the page, the iframe fills the frame at that scale, the global height resizes every card without its own', () => {
  assert.equal(embedHeight(), DEFAULT_EMBED_HEIGHT);
  assert.deepEqual(cardDims({ device: 'desktop' }), { width: 8.6, height: 8, depth: 0.16, kind: 'desktop', pageW: 1280 });
  assert.deepEqual(cardDims({ device: 'tablet' }), { width: 7, height: 8, depth: 0.16, kind: 'tablet', pageW: 1024 });
  assert.deepEqual(cardDims({ device: 'phone' }), { width: 3.4, height: 8, depth: 0.16, kind: 'phone', pageW: 390 });
  assert.equal(cardDims({ device: 'phone', aspect: 'desktop' }).width, 8.6, 'the aspect preset wins over the device');
  assert.deepEqual(cardDims({ aspect: 'custom', pageWidth: 1920 }), { width: 12.6, height: 8, depth: 0.16, kind: 'desktop', pageW: 1920 });
  assert.equal(cardDims({ device: 'desktop', height: 5.5 }).height, 5.5, 'a card with its own height keeps it');
  assert.equal(cardDims({ device: 'desktop' }, 11).height, 11);
  assert.equal(setEmbedHeight(30), 14); assert.equal(setEmbedHeight('x'), DEFAULT_EMBED_HEIGHT); assert.equal(setEmbedHeight(6), 6);
  assert.equal(cardDims({ device: 'desktop' }).height, 6); assert.equal(cardDims({ device: 'desktop', height: 9 }).height, 9);
  setEmbedHeight(DEFAULT_EMBED_HEIGHT);
  assert.equal(pageWidthOf({ aspect: 'custom', pageWidth: 100 }), 240, 'custom widths are clamped');
  for (const params of [{ device: 'desktop' }, { device: 'tablet' }, { device: 'phone' }, { device: 'none' }, { aspect: 'custom', pageWidth: 800 }]) {
    const d = cardDims(params), f = faceSize(d), cw = Math.round(f.w * PX), ch = Math.round(f.h * PX);
    const L = faceLayout(params, cw, ch);
    const inside = (a, b) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
    assert.ok(inside(L.frame, { x: 0, y: L.strip.h, w: cw, h: ch - L.strip.h }), `${d.kind}: frame under the strip`); assert.ok(inside(L.screen, L.frame), `${d.kind}: screen inside frame`);
    assert.equal(L.element, L.screen);
    assert.ok(Math.abs(L.iframe.w * L.scale - L.screen.w) < 1e-6, `${d.kind}: the page width fills the screen exactly`);
    assert.ok(Math.abs(L.iframe.h * L.scale - L.screen.h) < 1, `${d.kind}: the iframe height equals the screen height at that scale (no letterbox)`);
    assert.equal(L.iframe.w, d.pageW);
    assert.ok(cw <= 4096 / 4 * 1.05 && ch <= 4096 / 4 * 1.05, `${d.kind}: ${cw}×${ch} logical px stays under maxSide at the 4× tier`);
  }
  const P = faceLayout({ device: 'phone' }, Math.round(faceSize(cardDims({ device: 'phone' })).w * PX), Math.round(faceSize(cardDims({ device: 'phone' })).h * PX));
  assert.ok(P.bezel && P.iframe.h >= 844, `a default phone card shows the whole 390 × 844 page (${P.iframe.h})`);
  const D = faceLayout({ device: 'desktop' }, Math.round(faceSize(cardDims({ device: 'desktop' })).w * PX), Math.round(faceSize(cardDims({ device: 'desktop' })).h * PX));
  assert.equal(D.bezel, null); assert.ok(D.iframe.h > 1000 && D.iframe.h < 1200, `a default desktop card shows 1280 × ~1100 px (${D.iframe.h})`);
  assert.equal(routeLabel('https://imagine-os.github.io/petrock/#/desk'), '#/desk'); assert.equal(routeLabel('https://imagine-os.github.io/dorum-lifestyle/docs/plan.html'), 'docs/plan.html');
  assert.equal(rgba('#1F4E79', 0.5), 'rgba(31,78,121,0.5)');
  assert.equal(CARD.header, 0.46);
});

test('demo scenes build in the headless world (hub part only: no PM components registered here)', () => {
  const examples = makeExamples(host);
  assert.deepEqual(examples.map((e) => e.id), ['hub-cal-tenant-law', 'hub-petrock', 'hub-hoy', 'hub-dorum-lifestyle', 'hub-compare', 'hub-new-client']);
  const named = hw.buildExample(examples[0]);
  assert.equal(named.pages.length, 21); assert.equal(named.bp.typeId, 'hub-blueprint'); assert.equal(hw.world.groups.length, 11); assert.equal(named.timeline, undefined);
  hw.tick(); assert.equal(named.bp.out.count, 21);
  assert.equal(api.counts().pages, 21); assert.equal(api.counts().eligible, 21);
  const cmp = hw.buildExample(examples[4]);
  assert.equal(cmp.bps.length, 4); assert.equal(cmp.pages.length, 65);
  const nc = hw.buildExample(examples[5]);
  assert.equal(nc.bp.params.client, 'New client'); hw.tick(); assert.equal(nc.bp.out.count, 13);
  assert.equal(api.loadDemo('hub-petrock').pages.length, 15); assert.equal(host._rec.examples.length, 1);
  hw.world.clear();
});

test('settings persist under the add-on namespace', () => {
  api.setBudget(12); api.setLive(false);
  assert.deepEqual(host.storage.keys(), ['settings.v1']);
  assert.deepEqual(host.storage.get('settings.v1'), { budget: 12, live: false, flow: 'delivery', client: null, embedHeight: DEFAULT_EMBED_HEIGHT });
  assert.equal(api.setEmbedHeight(10), 10); assert.equal(embedHeight(), 10); assert.equal(host.storage.get('settings.v1').embedHeight, 10); api.setEmbedHeight(DEFAULT_EMBED_HEIGHT);
  assert.ok([...host.storage.raw.keys()].every((k) => k.startsWith('proto3d.addon.hubs.')));
  api.setBudget(8); api.setLive(true);
});
