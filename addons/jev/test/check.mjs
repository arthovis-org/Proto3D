#!/usr/bin/env node
// addons/jev/test/check.mjs — headless checks for the Jev add-on (Playwright + Chromium).
//
//   node addons/jev/test/check.mjs                 run every check, PASS / FAIL per line, exit 1 on any failure
//   node addons/jev/test/check.mjs --shots <dir>   also save a dark + light screenshot of each demo and one of the tutorial mid-drag
//   node addons/jev/test/check.mjs --video <dir>   also record jev-walkthrough.webm (~55 s, real latencies): route, guard, triage, Smart Add, dragging the card
//   --port <n>           static server port (default 8123)
//   --three <dir>        serve three r160 from a local copy (dir holds build/ and examples/jsm/) instead of unpkg
//   --chromium <path>    Chromium executable (default: playwright's, or /opt/pw-browsers/chromium-*/chrome-linux/chrome)
//
// `playwright` is resolved from the working directory, then from the global npm root; the repo
// itself has no dependencies. The static server is `python3 -m http.server` at the repo root.
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = +opt('--port', 8123);
const SHOTS = opt('--shots'), VIDEO = opt('--video'), THREE_DIR = opt('--three');
const BASE = `http://127.0.0.1:${PORT}`;

/* ---------- playwright + chromium ---------- */
function loadPlaywright() {
  const req = createRequire(path.join(process.cwd(), 'noop.js'));
  try { return req('playwright'); } catch (_) { /* not local */ }
  try { return createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright'); } catch (_) { /* not global */ }
  throw new Error('playwright not found: npm install playwright (outside the repo) or npm i -g playwright');
}
function chromiumPath() {
  const given = opt('--chromium') || process.env.JEV_CHROMIUM; if (given) return given;
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) { const d = fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().pop(); if (d && fs.existsSync(`${base}/${d}/chrome-linux/chrome`)) return `${base}/${d}/chrome-linux/chrome`; }
  return undefined;
}

/** ffmpeg for trimming the walkthrough: Playwright's bundled build, else one on PATH; null when neither exists. */
function ffmpegPath() {
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) { const d = fs.readdirSync(base).filter((n) => /^ffmpeg-\d+$/.test(n)).sort().pop(); if (d && fs.existsSync(`${base}/${d}/ffmpeg-linux`)) return `${base}/${d}/ffmpeg-linux`; }
  try { const p = execSync('which ffmpeg').toString().trim(); if (p) return p; } catch (_) { /* none */ }
  return null;
}

/* ---------- report ---------- */
const results = [];
let pageErrors = [];
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); console.log(`FAIL  ${name} — ${e.message}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolve once `locator`'s bounding box has not changed for `still` ms (polled every 50 ms, capped at `cap` ms); returns the settled box. */
async function settled(locator, { still = 500, cap = 5000 } = {}) {
  const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
  const t0 = Date.now(); let last = await locator.boundingBox(), since = Date.now();
  while (Date.now() - t0 < cap) {
    await sleep(50);
    const b = await locator.boundingBox();
    if (same(b, last)) { if (Date.now() - since >= still) return b; } else { last = b; since = Date.now(); }
  }
  return last;
}

/* ---------- page plumbing ---------- */
function watch(page, tag) {
  const ignore = (m) => /favicon\.ico/.test(m.location?.()?.url || '') || /favicon/.test(m.text());
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m)) pageErrors.push(`[${tag} console] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag} pageerror] ${e.message}`));
}
async function offline(page) {
  if (THREE_DIR) {
    await page.route(/^https:\/\/unpkg\.com\/three@0\.160\.0\/(.+)$/, (route) => {
      const rel = route.request().url().replace(/^https:\/\/unpkg\.com\/three@0\.160\.0\//, ''); const f = path.join(THREE_DIR, rel);
      if (fs.existsSync(f)) route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }); else route.abort();
    });
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  }
}
async function openAddon(page, { fast = true } = {}) {
  await offline(page);
  if (fast) await page.addInitScript(() => { window.__jevFast = true; });
  await page.goto(`${BASE}/addons/jev/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__jev && !!window.__proto, null, { timeout: 30000 });
  await page.waitForTimeout(400);
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
/** Load a demo and wait until every jev node in it has decided once. */
async function loadDemo(page, id) {
  await ev(page, (d) => { window.__jev.loadDemo(d); }, id);
  await waitFor(page, () => window.__proto.world.nodes.filter((n) => n.typeId.startsWith('jev-')).every((n) => n.state.last || !n.rt?.inputs || (n.typeId === 'jev-rank' ? !(n.rt.inputs.items || []).length : !((n.rt.inputs.state || []).length || n.params.state))), null, 10000);
  await page.waitForTimeout(150);
}
const setParam = (page, title, key, value) => ev(page, ([t, k, v]) => { const p = window.__proto; const n = p.world.nodes.find((x) => x.title === t); if (!n) throw new Error(`no block ${t}`); p.history.execute(p.cmd.setParam(p.world, n, k, v)); p.engine.evaluate(); }, [title, key, value]);

/* ---------- main ---------- */
const pw = loadPlaywright();
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await sleep(600);
const browser = await pw.chromium.launch({ executablePath: chromiumPath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch(page, 'addon');
  await openAddon(page);
  const lsBefore = await ev(page, () => Object.keys(localStorage));   // what the first boot wrote (the add-on's own keys)

  await check('boots with zero console errors and zero uncaught exceptions', async () => { assert(pageErrors.length === 0, pageErrors.join(' | ')); return 'clean boot'; });
  await check('category jev has 5 components', async () => {
    const ids = await ev(page, () => window.__proto.registry.categories().find((c) => c.id === 'jev')?.components.map((d) => d.id) || []);
    assert(ids.length === 5, `got ${ids.join(',')}`); return ids.join(', ');
  });
  await check('jev provider has a Connections card and no Generate picker lists it', async () => {
    const r = await ev(page, () => { const p = window.__proto; p.ai.connections.open('jev'); const card = !!document.querySelector('#connections [data-provider="jev"]'); p.ai.connections.close(); return { card, kinds: ['text', 'image', 'video', 'audio'].filter((k) => p.ai.providers.forKind(k).some((x) => x.id === 'jev')) }; });
    assert(r.card, 'no card in Connections'); assert(r.kinds.length === 0, `listed for ${r.kinds}`); return 'card present, capabilities empty';
  });
  for (const id of ['route-message', 'guard-generation', 'triage-board', 'smart-build']) {
    await check(`demo ${id} loads and frames`, async () => {
      const before = await ev(page, () => window.__proto.ws.camera.position.toArray());
      await loadDemo(page, id);
      const r = await ev(page, (d) => { const p = window.__proto, j = window.__jev; const n = j.named(); return { current: j.current(), nodes: p.world.nodes.length, missing: Object.entries(n).filter(([k, v]) => k !== 'media' && !v).map(([k]) => k), cam: p.ws.camera.position.toArray(), errs: p.world.nodes.filter((x) => x.rt?.error).map((x) => `${x.title}: ${x.rt.error}`) }; }, id);
      assert(r.current === id, `current is ${r.current}`); assert(r.nodes > 3, `only ${r.nodes} nodes`); assert(!r.missing.length, `named blocks missing: ${r.missing}`); assert(!r.errs.length, `node errors: ${r.errs}`);
      return `${r.nodes} blocks`;
    });
  }

  /* demo 1: routing */
  await check('demo 1 routes the four sample messages (returns, shipping, billing, unsure)', async () => {
    await loadDemo(page, 'route-message');
    const { SAMPLE_MESSAGES, EXPECTED_LANES } = await import(`${ROOT}/addons/jev/scenes/route-message.js`);
    const got = [];
    for (let i = 0; i < SAMPLE_MESSAGES.length; i++) {
      await setParam(page, 'Customer message', 'text', SAMPLE_MESSAGES[i]);
      await waitFor(page, (m) => { const n = window.__proto.world.nodes.find((x) => x.typeId === 'jev-route'); return !!n?.state.last && n._jevView?.text === m && !n._jevView.busy && n.rt.outputs.choice !== undefined; }, SAMPLE_MESSAGES[i]);
      await page.waitForTimeout(120);
      const r = await ev(page, () => { const p = window.__proto; const n = p.world.nodes.find((x) => x.typeId === 'jev-route'); const desks = ['Returns desk', 'Shipping desk', 'Billing desk'].map((t) => p.world.nodes.find((x) => x.title === t)?.rt.inputs.screen); const human = p.world.nodes.find((x) => x.title === 'Ask a human')?.rt.inputs.in; return { choice: n.rt.outputs.choice, conf: n.rt.outputs.confidence, desks, human }; });
      got.push(r.choice);
      assert(r.choice === EXPECTED_LANES[i], `"${SAMPLE_MESSAGES[i]}" → ${r.choice} (${r.conf}), expected ${EXPECTED_LANES[i]}`);
      if (i < 3) assert(r.desks[i] === SAMPLE_MESSAGES[i], `desk ${i} shows ${JSON.stringify(r.desks[i])}`); else assert(r.human === SAMPLE_MESSAGES[i], `Ask a human shows ${JSON.stringify(r.human)}`);
    }
    return got.join(' · ');
  });

  /* demo 2: guard */
  await check('demo 2 pass prompt runs a Demo generation, fail prompt does not', async () => {
    await loadDemo(page, 'guard-generation');
    const { PASS_PROMPT, FAIL_PROMPT } = await import(`${ROOT}/addons/jev/scenes/guard-generation.js`);
    const jobsOf = () => ev(page, () => window.__proto.ai.jobs.jobs.filter((j) => j.provider === 'demo').length);
    await waitFor(page, () => window.__proto.ai.jobs.jobs.some((j) => j.provider === 'demo'), null, 8000).catch(() => {});   // the initial (clean) request generates once
    await waitFor(page, () => window.__proto.ai.jobs.jobs.every((j) => j.done), null, 15000);
    const n0 = await jobsOf();
    await setParam(page, 'Request', 'template', FAIL_PROMPT);
    await waitFor(page, () => { const c = window.__proto.world.nodes.find((x) => x.typeId === 'jev-check'); return c?.rt.outputs.yes === false; });
    await page.waitForTimeout(600);
    const afterFail = await ev(page, () => { const p = window.__proto; return { jobs: p.ai.jobs.jobs.filter((j) => j.provider === 'demo').length, blocked: p.world.nodes.find((x) => x.title === 'Blocked')?.rt.inputs.in, prob: p.world.nodes.find((x) => x.typeId === 'jev-check')?.rt.outputs.probability }; });
    assert(afterFail.jobs === n0, `fail prompt started a generation (${n0} → ${afterFail.jobs})`);
    assert(afterFail.blocked === 'Blocked before spending', `Blocked display shows ${JSON.stringify(afterFail.blocked)}`);
    await setParam(page, 'Request', 'template', PASS_PROMPT);
    await waitFor(page, (n) => window.__proto.ai.jobs.jobs.filter((j) => j.provider === 'demo').length > n, n0, 8000);
    await waitFor(page, () => window.__proto.ai.jobs.jobs.every((j) => j.done), null, 15000);
    const afterPass = await ev(page, () => { const p = window.__proto; return { jobs: p.ai.jobs.jobs.filter((j) => j.provider === 'demo').length, draft: p.world.nodes.find((x) => x.title === 'Draft')?.rt.inputs.in, prob: p.world.nodes.find((x) => x.typeId === 'jev-check')?.rt.outputs.probability }; });
    assert(afterPass.jobs === n0 + 1, `pass prompt: jobs ${n0} → ${afterPass.jobs}`);
    assert(typeof afterPass.draft === 'string' && afterPass.draft.length > 10, 'no draft text on the Display');
    return `fail p=${afterFail.prob} blocked · pass p=${afterPass.prob} generated`;
  });

  /* demo 3: triage */
  await check('demo 3 ranks the board\'s cards with the crash / data-loss bug on top', async () => {
    await loadDemo(page, 'triage-board');
    await waitFor(page, () => { const n = window.__proto.world.nodes.find((x) => x.typeId === 'jev-rank'); return Array.isArray(n?.rt.outputs.ranked) && n.rt.outputs.ranked.length; });
    const r = await ev(page, () => { const p = window.__proto; const n = p.world.nodes.find((x) => x.typeId === 'jev-rank'); const s = p.world.nodes.find((x) => x.typeId === 'jev-score'); return { ranked: n.rt.outputs.ranked.map((x) => x.text), top: n.rt.outputs.top, order: p.world.nodes.find((x) => x.title === 'Triage order')?.rt.inputs.in, note: p.world.nodes.find((x) => x.title === 'Top priority')?.rt.outputs.text, score: s?.rt.outputs.level }; });
    assert(r.ranked.length === 8, `ranked ${r.ranked.length} of 8`);
    assert(/crash|data loss/i.test(r.top), `top is "${r.top}"`);
    assert(typeof r.order === 'string' && r.order.startsWith('1. '), 'Display lacks the numbered list');
    assert(r.note === r.top, 'sticky note does not carry the top item');
    return `top: ${r.top.slice(0, 48)}… · one card scored ${r.score}`;
  });

  /* smart add */
  await check('Smart Add "put these images on a wall" adds a media-grid linked to the 4 pictures', async () => {
    await loadDemo(page, 'smart-build');
    const r = await ev(page, async () => { const p = window.__proto, j = window.__jev; const media = p.world.nodes.filter((n) => n.typeId === 'media'); p.selection.set(media); const res = await j.smartAdd.run('put these images on a wall'); const node = res?.node; return { type: node?.typeId, links: res?.links.length, cables: node ? p.world.connectionsOfNode(node).filter((c) => c.to?.owner === node && c.from.owner.typeId === 'media').length : 0, picks: res?.picks.slice(0, 3).map((x) => `${x.id} ${Math.round(x.p * 100)}%`), chips: document.querySelectorAll('#jev-ask .ja-chip').length, undo: p.history.canUndo }; });
    assert(r.type === 'media-grid', `added ${r.type} (${r.picks})`); assert(r.cables === 4, `${r.cables} cables from the pictures`); assert(r.chips >= 1, 'no alternative chips'); assert(r.undo, 'not on the undo stack');
    return `${r.picks.join(', ')} · ${r.cables} cables · ${r.chips} alternatives`;
  });
  await check('Smart Add "show the person\'s tasks on a board" adds a kanban-board with the person plugged in', async () => {
    const r = await ev(page, async () => { const p = window.__proto, j = window.__jev; const maya = p.world.nodes.find((n) => n.typeId === 'person'); p.selection.set([maya]); const res = await j.smartAdd.run("show the person's tasks on a board"); const node = res?.node; return { type: node?.typeId, linked: node ? p.world.connections.some((c) => c.from.owner === maya && c.to?.owner === node && c.to.key === 'people') : false, picks: res?.picks.slice(0, 3).map((x) => `${x.id} ${Math.round(x.p * 100)}%`) }; });
    assert(r.type === 'kanban-board', `added ${r.type} (${r.picks})`); assert(r.linked, 'person not plugged into the board\'s people slot');
    return r.picks.join(', ');
  });

  /* tutorial drag */
  await check('tutorial card drags, stays inside the viewport and keeps its position across a reload', async () => {
    await ev(page, () => { const t = window.__jev.tutorial; t.open(); t.setCollapsed(false); t.dock('right'); });
    const head = page.locator('#jev-tutorial .jt-head');
    const r0 = await settled(page.locator('#jev-tutorial'));   // the docked card re-seats when the jobs tray under it shrinks
    const hb = await head.boundingBox();
    const sx = hb.x + hb.width * 0.45, sy = hb.y + hb.height / 2;
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx + 3, sy + 2);                  // inside the dead zone: no move yet
    const rDead = await page.locator('#jev-tutorial').boundingBox();
    assert(Math.abs(rDead.x - r0.x) < 1 && Math.abs(rDead.y - r0.y) < 1, 'moved inside the 6 px dead zone');
    await page.mouse.move(sx - 300, sy - 250, { steps: 12 });
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'tutorial-drag.png') }); }
    await page.mouse.move(sx - 5000, sy - 5000, { steps: 4 });   // far past the edge: must clamp
    await page.mouse.up();
    const r1 = await page.locator('#jev-tutorial').boundingBox();
    const vp = page.viewportSize();
    assert(r1.x !== r0.x || r1.y !== r0.y, 'the card did not move');
    assert(r1.x >= 0 && r1.y >= 0 && r1.x + r1.width <= vp.width && r1.y + r1.height <= vp.height, `card left the viewport: ${JSON.stringify(r1)}`);
    assert(r1.x <= 9 && r1.y <= 70, `expected the card clamped to the top-left margin, got ${r1.x},${r1.y}`);
    await page.mouse.move(r1.x + 80, r1.y + 16); await page.mouse.down(); await page.mouse.move(r1.x + 80 + 220, r1.y + 16 + 160, { steps: 10 }); await page.mouse.up();
    const r2 = await page.locator('#jev-tutorial').boundingBox();
    await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!window.__jev, null, { timeout: 30000 }); await page.waitForTimeout(300);
    const r3 = await page.locator('#jev-tutorial').boundingBox();
    assert(Math.abs(r3.x - r2.x) < 2 && Math.abs(r3.y - r2.y) < 2, `position not restored: ${r2.x},${r2.y} → ${r3.x},${r3.y}`);
    const collapsed = await ev(page, () => { const t = window.__jev.tutorial; t.setCollapsed(true); const c = document.getElementById('jev-tutorial').classList.contains('collapsed'); t.setCollapsed(false); return c; });
    assert(collapsed, 'collapse did not apply');
    return `moved to ${Math.round(r2.x)},${Math.round(r2.y)} and restored`;
  });

  /* save / load round trip */
  await check('save / load round-trip restores jev-* nodes with their state.last', async () => {
    await loadDemo(page, 'route-message');
    const doc = await ev(page, () => window.__proto.serialize());
    const jev = doc.nodes.filter((n) => n.type.startsWith('jev-'));
    assert(jev.length && jev.every((n) => n.state?.last?.answers), 'serialized jev nodes lack state.last');
    await ev(page, () => window.__jev.saveNow());
    await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!window.__jev, null, { timeout: 30000 }); await page.waitForTimeout(300);
    const back = await ev(page, (d) => d.nodes.filter((n) => n.type.startsWith('jev-')).map((n) => { const live = window.__proto.world.nodeByUid(n.uid); return { uid: n.uid, ok: !!live && live.typeId === n.type && live.state.last?.stateHash === n.state.last.stateHash }; }), doc);
    assert(back.every((b) => b.ok), `not restored: ${back.filter((b) => !b.ok).map((b) => b.uid)}`);
    const viaLoad = await ev(page, (d) => { const p = window.__proto; p.load(d); return p.world.nodes.filter((n) => n.typeId.startsWith('jev-')).every((n) => n.state.last?.answers); }, doc);
    assert(viaLoad, '__proto.load(doc) dropped state.last');
    return `${jev.length} jev node(s) with their last answer`;
  });

  /* screenshots */
  if (SHOTS) {
    await check(`screenshots of each demo (dark + light) in ${SHOTS}`, async () => {
      fs.mkdirSync(SHOTS, { recursive: true });
      await ev(page, () => { window.__jev.tutorial.dock('right'); window.__jev.tutorial.open(); });
      for (const id of ['route-message', 'guard-generation', 'triage-board', 'smart-build']) {
        await loadDemo(page, id);
        if (id === 'smart-build') await ev(page, async () => { const p = window.__proto, j = window.__jev; p.selection.set(p.world.nodes.filter((n) => n.typeId === 'media')); await j.smartAdd.run('put these images on a wall'); p.selection.clear(); });
        for (const theme of ['dark', 'light']) {
          await ev(page, (t) => window.__proto.setTheme(t), theme);
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(SHOTS, `${id}-${theme}.png`) });
        }
        await ev(page, () => window.__proto.setTheme('dark'));
      }
      await ev(page, () => window.__jev.smartAdd.close());
      return fs.readdirSync(SHOTS).length + ' files';
    });
  }

  /* isolation */
  await check('core isolation: no proto3d.tabs.* / proto3d.autosave.* / proto3d.tour.v1 writes, own keys only', async () => {
    const r = await ev(page, async () => { const p = window.__proto; let projects = null; try { projects = (await p.projectStore.listProjects()).length; } catch (_) { projects = 'n/a'; } return { keys: Object.keys(localStorage), projects, autosaveOn: p.tabs.autosaveOn, status: p.tabs.status.state }; });
    const bad = r.keys.filter((k) => /^proto3d\.(tabs|autosave)\./.test(k) || k === 'proto3d.tour.v1' || k === 'proto3d.start.v1');
    assert(!bad.length, `core keys written: ${bad}`);
    const foreign = r.keys.filter((k) => !/^proto3d\.jev\./.test(k) && k !== 'proto3d.theme');
    assert(!foreign.length, `unexpected keys: ${foreign}`);
    assert(r.projects === 0 || r.projects === 'n/a', `${r.projects} project record(s) in IndexedDB proto3d-projects`);
    assert(!r.autosaveOn && r.status === 'off', 'core autosave is not off');
    return `${r.keys.length} keys (${r.keys.join(', ')}) · ${r.projects} core project records · first boot wrote ${lsBefore.length}`;
  });
  await check('root / page still boots with zero errors', async () => {
    const root = await context.newPage(); const before = pageErrors.length; watch(root, 'root'); await offline(root);
    await root.goto(`${BASE}/`, { waitUntil: 'load' });
    await root.waitForFunction(() => !!window.__proto, null, { timeout: 30000 }); await root.waitForTimeout(800);
    const n = await root.evaluate(() => window.__proto.world.nodes.length + (document.getElementById('start')?.hidden ? 0 : 0));
    await root.close();
    assert(pageErrors.length === before, pageErrors.slice(before).join(' | '));
    return `booted (${n} blocks in its own world)`;
  });
  await check('zero console errors / exceptions during the whole run', async () => { assert(pageErrors.length === 0, pageErrors.join(' | ')); return 'clean'; });

  /* video: open → route two samples → guard fail / pass → triage ranking → Smart Add a media grid → drag the tutorial (real latencies, ~55 s) */
  if (VIDEO) {
    await check(`walkthrough video in ${VIDEO}`, async () => {
      fs.mkdirSync(VIDEO, { recursive: true });
      const t0 = Date.now();
      const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO, size: { width: 1440, height: 900 } } });
      const v = await vctx.newPage(); watch(v, 'video'); await offline(v);
      await v.goto(`${BASE}/addons/jev/`, { waitUntil: 'load' });
      await v.waitForFunction(() => !!window.__jev, null, { timeout: 30000 });
      await v.evaluate(() => { localStorage.removeItem('proto3d.jev.tutorial.v1'); const j = window.__jev; j.tutorial.state.pos = null; j.loadDemo('route-message'); j.tutorial.setDemo('route-message'); j.tutorial.open(); j.tutorial.dock('right'); });
      await v.waitForTimeout(300);
      const ready = (Date.now() - t0) / 1000;   // the boot is cut off the front of the recording
      const go = async (i, ms = 500) => { await v.evaluate((k) => window.__jev.tutorial.go(k), i); await v.waitForTimeout(ms); };
      const click = async (sel, ms = 500) => { const el = v.locator(sel).first(); if (await el.count() && await el.isVisible() && await el.isEnabled()) await el.click(); await v.waitForTimeout(ms); };
      const demo = async (id) => { await click(`#jev-tutorial .jt-demo[data-demo="${id}"]`, 1200); };
      await v.waitForTimeout(1200);
      await go(2, 1000);                                                     // the router, framed and ringed
      await go(3, 600); await click('#jev-tutorial .jt-extra >> nth=1', 2200); await click('#jev-tutorial .jt-extra >> nth=2', 2200);   // two sample messages → desks
      await go(4, 500); await click('#jev-tutorial .jt-doit', 2000);          // "hello??" → unsure → Ask a human
      await demo('guard-generation');
      await go(3, 500); await click('#jev-tutorial .jt-doit', 2400);          // the risky request fails: Blocked
      await go(2, 500); await click('#jev-tutorial .jt-doit', 3000);          // the clean request passes: a draft is generated
      await demo('triage-board');
      await go(1, 500); await click('#jev-tutorial .jt-doit', 2400);          // rank again: eight cards in one request
      await go(2, 1400);                                                     // the ranked Display and the top item
      await demo('smart-build');
      await go(1, 500); await click('#jev-tutorial .jt-doit', 2800);          // Smart Add: "put these images on a wall" → Media Grid
      const hb = await v.locator('#jev-tutorial .jt-head').boundingBox();   // drag the card across the view
      const sx = hb.x + hb.width * 0.4, sy = hb.y + hb.height / 2;
      await v.mouse.move(sx, sy); await v.mouse.down(); await v.mouse.move(sx - 380, sy - 420, { steps: 24 }); await v.waitForTimeout(300); await v.mouse.move(sx - 120, sy - 300, { steps: 16 }); await v.mouse.up();
      await v.waitForTimeout(1200);
      const raw = await v.video().path();
      await vctx.close();
      const out = path.join(VIDEO, 'jev-walkthrough.webm');
      const ffmpeg = ffmpegPath();
      if (ffmpeg) {
        try { execSync(`"${ffmpeg}" -y -loglevel error -ss ${ready.toFixed(2)} -i "${raw}" -c copy "${out}"`, { stdio: 'ignore' }); fs.unlinkSync(raw); return `${path.basename(out)} (boot trimmed, ${ready.toFixed(1)} s)`; }
        catch (_) { /* keep the raw recording */ }
      }
      fs.renameSync(raw, out);
      return path.basename(out);
    });
  }
} finally {
  await browser.close(); server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
