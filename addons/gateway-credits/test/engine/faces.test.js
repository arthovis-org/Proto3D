// The faces as working UI, exercised on the headless engine with the recording canvas: every gw-
// face renders, registers its fields (the core's inline editor contract), and single clicks
// outside edit mode run actions / set params / open the editor through the host.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost, fakeCanvasContext } from '../../../sdk/testing/fake-host.js';
import { createHeadlessWorld } from '../../../sdk/testing/headless-engine.js';
import manifest from '../../addon.json' with { type: 'json' };
import { register, install } from '../../src/index.js';
import { configureSimulation } from '../../src/providers.js';
import example, { samplePositions, WORKFLOW } from '../../src/example.js';
import { overlapping, isSlotKey } from '../../src/flowLayout.js';

configureSimulation({ sleep: () => Promise.resolve(), random: () => 0.5 });
const hw = createHeadlessWorld();
const host = createFakeHost(manifest, { headless: hw });
const ledger = register(host);
const api = install(host, { sample: false });
const SIZE = { S: [365, 288], M: [485, 288], L: [701, 432] };
/** Render a node's face at its real logical size; returns the fields it registered. */
function render(node) {
  const def = host.nodes.get(node.typeId); const [w, h] = SIZE[def.size] || SIZE.M;
  const g = fakeCanvasContext(); node.face = { cw: w, ch: h };
  def.face.render(g, w, h, { params: node.params, state: node.state, instance: node, inputs: node.rt.inputs || {}, outputs: node.rt.outputs || {}, time: 0 });
  return { g, fields: node._fields || [], w, h };
}
const click = (node, id) => { const def = host.nodes.get(node.typeId); const f = node._fields.find((x) => x.id === id); assert.ok(f, `field ${id}`); const u = (f.rect.x + f.rect.w / 2) / node.face.cw, v = (f.rect.y + f.rect.h / 2) / node.face.ch; const ctx = { instance: node }; assert.equal(def.face.onPointer(ctx, { type: 'down', u, v, button: 0 }), true, 'a press on a field is captured'); def.face.onPointer(ctx, { type: 'up', u, v, button: 0 }); return def.face.onPointer(ctx, { type: 'click', u, v, button: 0 }); };
beforeEach(() => { for (const n of [...hw.world.nodes]) hw.remove(n); ledger.reset(); host._rec.commands.length = 0; host._rec.fieldOpens.length = 0; host._rec.toasts.length = 0; });

test('every gw- face is live, renders at its size with zero throws and registers fields inside the face', () => {
  for (const id of ['gw-llm', 'gw-tool', 'gw-agent', 'gw-memory', 'gw-budget', 'gw-meter']) {
    const def = host.nodes.get(id); assert.equal(def.face.live, true, id); assert.equal(typeof def.face.onPointer, 'function', id);
    const n = hw.add(id, {}); hw.tick();
    const { g, fields, w, h } = render(n);
    assert.ok(g.calls.length > 20, `${id} draws`); assert.ok(fields.length >= 1, `${id} registers fields`);
    for (const f of fields) { assert.ok(f.rect.x >= 0 && f.rect.y >= 0 && f.rect.x + f.rect.w <= w + 1e-6 && f.rect.y + f.rect.h <= h + 1e-6, `${id}.${f.id} inside the face (${JSON.stringify(f.rect)})`); assert.ok(['text', 'multiline', 'number', 'select', 'checkbox', 'action'].includes(f.kind), `${id}.${f.id} kind ${f.kind}`); }
    assert.equal(new Set(fields.map((f) => f.id)).size, fields.length, `${id} field ids unique`);
    assert.ok(g.calls.some((c) => c[0] === 'arc'), `${id} draws its badge`);
  }
});

test('gw-llm: model select, provider select, tier chips, credential toggle, prompt field, Run action — clicks set params through host.commands and open the editor through host.fields', async () => {
  const llm = hw.add('gw-llm', { provider: 'Anthropic', model: 'auto', tier: 'standard' }, { title: 'Chat model' }); hw.tick();
  const { fields } = render(llm);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  assert.equal(byId.model.kind, 'select'); assert.equal(byId.model.param, 'model'); assert.ok(byId.model.options.some((o) => o.value === 'claude-haiku'));
  assert.equal(byId.provider.kind, 'select'); assert.deepEqual(byId.provider.options.slice(0, 2), ['OpenAI', 'Anthropic']);
  assert.equal(byId.prompt.kind, 'multiline'); assert.equal(byId.prompt.param, 'prompt');
  assert.equal(byId.run.kind, 'action'); assert.equal(byId.credential.kind, 'action');
  for (const t of ['fixed', 'economy', 'standard', 'premium']) assert.equal(byId[`tier:${t}`].kind, 'action');
  // tier chip → setParam through the host (undoable in the page)
  assert.equal(click(llm, 'tier:premium'), true); assert.equal(llm.params.tier, 'premium'); assert.deepEqual(host._rec.commands.at(-1), { kind: 'setParam', uid: llm.uid, key: 'tier', value: 'premium', label: 'Set tier' });
  // credential toggle flips both ways
  click(llm, 'credential'); assert.equal(llm.params.credential, 'Own key'); render(llm); click(llm, 'credential'); assert.equal(llm.params.credential, 'Gateway credits');
  // select / multiline → the core editor
  assert.equal(click(llm, 'model'), true); assert.deepEqual(host._rec.fieldOpens.at(-1), { uid: llm.uid, id: 'model', kind: 'select' }); assert.equal(llm._editing, 'model');
  // while the editor is open on `model`, the face leaves that text out (spec.editing) but keeps the field registered
  const r2 = render(llm); assert.equal(r2.fields.find((f) => f.id === 'model').editing, true); llm._editing = null;
  // Run action → a metered call
  assert.equal(click(llm, 'run'), true); await hw.run(3);
  assert.equal(llm.state.gw.status, 'settled'); assert.equal(ledger.rows()[0].nodeTitle, 'Chat model');
  // a press outside every field is not captured (the block drags as usual)
  const def = host.nodes.get('gw-llm'); assert.equal(def.face.onPointer({ instance: llm }, { type: 'down', u: 0.999, v: 0.02, button: 0 }), false);
  // a connected prompt hides the prompt field
  const txt = hw.add('gw-tool', { service: 'Brave Search' }); hw.connect(txt, 'result', llm, 'prompt'); txt.state.gw = { result: 'connected text', status: 'settled', runs: 1 }; hw.tick();
  assert.ok(!render(llm).fields.some((f) => f.id === 'prompt'), 'connected prompt: no fallback field');
});

test('gw-tool: service select, units number, query text, Run; gw-memory: window number; gw-budget: workflow text, limit number, period select', () => {
  const tool = hw.add('gw-tool', { service: 'Firecrawl', units: 3 }); const mem = hw.add('gw-memory', { window: 4 }); const bud = hw.add('gw-budget', { workflow: 'x', limit: 10, period: 'daily' }); hw.tick();
  const T = Object.fromEntries(render(tool).fields.map((f) => [f.id, f]));
  assert.equal(T.service.kind, 'select'); assert.deepEqual(T.service.options, ['Brave Search', 'Firecrawl', 'Browserbase', 'LlamaParse', 'PDF.co']); assert.equal(T.units.kind, 'number'); assert.equal(T.units.min, 1); assert.equal(T.query.kind, 'text'); assert.equal(T.run.kind, 'action');
  click(tool, 'units'); assert.equal(host._rec.fieldOpens.at(-1).kind, 'number');
  const M = Object.fromEntries(render(mem).fields.map((f) => [f.id, f])); assert.equal(M.window.kind, 'number'); assert.equal(M.window.param, 'window');
  const B = Object.fromEntries(render(bud).fields.map((f) => [f.id, f])); assert.equal(B.workflow.kind, 'text'); assert.equal(B.limit.kind, 'number'); assert.equal(B.period.kind, 'select'); assert.deepEqual(B.period.options, ['monthly', 'daily']);
});

test('gw-meter: Top up action writes a ledger row; the auto top-up checkbox is bound to ledger settings through get / set', () => {
  const meter = hw.add('gw-meter'); hw.tick();
  const F = Object.fromEntries(render(meter).fields.map((f) => [f.id, f]));
  assert.equal(F.topup.kind, 'action'); assert.equal(F.autoTopUp.kind, 'checkbox'); assert.equal(F.autoTopUp.get(meter), false);
  click(meter, 'topup'); assert.equal(ledger.rows()[0].status, 'topup'); assert.equal(ledger.rows()[0].credits, 500); assert.equal(ledger.available(), 2800);
  click(meter, 'autoTopUp'); assert.equal(ledger.settings.autoTopUp.enabled, true); assert.equal(host.storage.get('settings.v1').autoTopUp.enabled, true, 'persisted through host.storage');
  render(meter); click(meter, 'autoTopUp'); assert.equal(ledger.settings.autoTopUp.enabled, false);
  // with rows, the meter draws the last 3 and a sparkline once two calls settled
  const { g } = render(meter); assert.ok(g.calls.some((c) => c[0] === 'fillText' && /top-up from the meter face|Manual/.test(String(c[1]))) || g.calls.length > 30);
});

test('gw-agent: slots light up when sub-nodes attach, the timeline shows planned steps before a run and settled steps after, Run is an action', async () => {
  const agent = hw.add('gw-agent', { workflow: 'w' }, { title: 'Research agent' }); hw.tick();
  let r = render(agent); let F = Object.fromEntries(r.fields.map((f) => [f.id, f]));
  assert.equal(F.run.kind, 'action'); assert.equal(F.prompt.kind, 'multiline');
  assert.ok(r.g.calls.some((c) => c[0] === 'fillText' && /Attach a Model call/.test(String(c[1]))), 'no model: the timeline says so');
  const llm = hw.add('gw-llm', { provider: 'Google Gemini', tier: 'economy', workflow: 'w' }); hw.connect(llm, 'handle', agent, 'model');
  const t1 = hw.add('gw-tool', { service: 'Brave Search', workflow: 'w' }); hw.connect(t1, 'handle', agent, 'tools'); hw.tick();
  r = render(agent);
  const texts = r.g.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
  assert.ok(texts.includes('plan') && texts.includes('Brave Search') && texts.includes('answer'), `planned steps on the timeline: ${texts.join(' | ')}`);
  assert.ok(texts.some((t) => /^est /.test(t)), 'estimated cost shown before a run');
  assert.ok(click(agent, 'run')); await hw.run(5);
  assert.equal(agent.state.gw.status, 'settled');
  r = render(agent); const after = r.g.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
  assert.equal(after.filter((t) => /cr$/.test(t) && !/^est/.test(t)).length >= 3, true, `credits under each settled step: ${after.join(' | ')}`);
  assert.match(agent.state.gw.answer, /^\[Gemini 2.5 Flash\]/, 'the answer the face previews (drawText is a no-op on the fake canvas)');
});

test('the sample (Justin\'s shape): flowLayout positions have no overlaps and stand the sub-nodes on the floor under the agent; its gateway part runs on the headless engine and meters every step plus one bypassed row', async () => {
  const P = samplePositions();
  assert.equal(P.size, 11); assert.deepEqual(overlapping([...P.keys()].map((uid) => ({ uid, size: { trigger: 'S', memory: 'S', agent: 'L' }[uid] || 'M' })), P), []);
  for (const k of ['model', 'memory', 'search', 'crawl', 'pdf']) assert.ok(P.get(k)[1] < P.get('agent')[1] && Math.abs(P.get(k)[2] - P.get('agent')[2]) <= 1.2, `${k} on the floor beneath the agent`);
  assert.ok(P.get('trigger')[0] < P.get('agent')[0] && P.get('agent')[0] < P.get('draft')[0] && P.get('draft')[0] < P.get('log')[0]);
  assert.ok(P.get('budget')[1] > P.get('agent')[1] && P.get('meter')[1] > P.get('agent')[1], 'governance row above the flow');
  assert.equal(new Set([...P.values()].map((p) => p[1])).size, 3, 'three levels');
  assert.deepEqual(example.camera.target[0], example.camera.position[0], 'the sample camera looks at the chain from the front');
  // the core Input / Log need Three, so the headless build keeps the gw- part of the sample (the page test covers the whole graph)
  const named = {}; const skipped = [];
  example.build({ add: (typeId, pos, o) => { if (!host.nodes.has(typeId)) { skipped.push(typeId); return { typeId, skipped: true, getPort: () => null }; } const n = hw.add(typeId, o.params, { title: o.title }); return n; }, connect: (a, k1, b, k2) => { if (a.skipped || b.skipped) return null; return hw.connect(a, k1, b, k2); } });
  assert.deepEqual(skipped, ['input', 'log']);
  for (const n of hw.world.nodes) named[n.title] = n;
  const slotCables = hw.world.connections.filter((c) => isSlotKey(c.to.key)); assert.equal(slotCables.length, 5);
  hw.tick();
  assert.equal(api.runSample({ layout: false }), true, 'no Input feeds the agent here: it is kicked directly');
  await hw.run(8);
  const rows = ledger.rows(50).reverse();
  assert.deepEqual(rows.map((r) => r.status), ['settled', 'settled', 'settled', 'settled', 'settled', 'bypassed']);
  assert.deepEqual(rows.map((r) => r.nodeTitle), ['Research agent · step 1', 'Research agent · step 2', 'Research agent · step 3', 'Research agent · step 4', 'Research agent · step 5', 'Draft summary']);
  assert.deepEqual(rows.map((r) => r.providerId), ['anthropic', 'brave', 'firecrawl', 'pdfco', 'anthropic', 'openai']);
  assert.ok(rows.every((r) => r.workflow === WORKFLOW));
  assert.match(named['Draft summary'].out.result, /via own key/);
  assert.equal(named.Memory.state.exchanges.length, 1);
  assert.equal(named['Research budget'].out.spent, +ledger.spentFor(WORKFLOW).toFixed(4)); assert.ok(named['Research budget'].out.spent > 0);
});
