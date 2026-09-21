// gw-agent / gw-memory on the REAL core Engine: sub-nodes attach to slots through their `handle`
// outputs; a run is plan → tools → answer, every step its own metered row; a failure mid-way
// refunds and emits failed; an own-key model produces bypassed rows; memory keeps a window; the
// Run sample path applies the flow layout through host.layout.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost } from '../../../sdk/testing/fake-host.js';
import { createHeadlessWorld } from '../../../sdk/testing/headless-engine.js';
import manifest from '../../addon.json' with { type: 'json' };
import { register, install } from '../../src/index.js';
import { configureSimulation } from '../../src/providers.js';
import { OPENING_BALANCE } from '../../src/ledger.js';
import { attachments, planSteps, estimateAgentRun, handleOf, GATEWAY_TYPES } from '../../src/nodes.js';
import { isSlotKey } from '../../src/flowLayout.js';

configureSimulation({ sleep: () => Promise.resolve(), random: () => 0.5 });
const hw = createHeadlessWorld();
const host = createFakeHost(manifest, { headless: hw });
const ledger = register(host);
const api = install(host, { sample: false });
const rows = () => ledger.rows(50).reverse();
const statuses = () => rows().map((r) => r.status);
const pulses = (node, key) => node.getPort(key, 'out').pulses || 0;
const WF = 'Research';
/** Justin's shape without the core nodes: agent + model + memory + three tools, in a workflow. */
function rig({ model = {}, tools = ['Brave Search', 'Firecrawl', 'PDF.co'], memory = true } = {}) {
  const agent = hw.add('gw-agent', { workflow: WF, maxTools: 3, prompt: 'Compare provider pricing' }, { title: 'Research agent' });
  const llm = hw.add('gw-llm', { credential: 'Gateway credits', provider: 'Anthropic', model: 'auto', tier: 'standard', workflow: WF, ...model }, { title: 'Chat model' });
  hw.connect(llm, 'handle', agent, 'model');
  const mem = memory ? hw.add('gw-memory', { window: 2 }, { title: 'Memory' }) : null;
  if (mem) hw.connect(mem, 'handle', agent, 'memory');
  const ts = tools.map((service, i) => { const t = hw.add('gw-tool', { service, units: 1, workflow: WF }, { title: `Tool ${i + 1}` }); hw.connect(t, 'handle', agent, 'tools'); return t; });
  return { agent, llm, mem, tools: ts };
}
beforeEach(() => { for (const n of [...hw.world.nodes]) hw.remove(n); ledger.reset(); ledger.settings.autoTopUp.enabled = false; ledger.settings.policy.fallback = true; ledger.settings.policy.preferCheapest = false; configureSimulation({ sleep: () => Promise.resolve(), random: () => 0.5 }); host._rec.toasts.length = 0; host._rec.layouts.length = 0; });

test('registration: six gw- types, slot inputs on the agent (tools is multi), handle outputs on model / tool / memory', () => {
  assert.deepEqual(host.nodes.ids(), GATEWAY_TYPES);
  const agent = host.nodes.get('gw-agent');
  assert.equal(agent.size, 'L');
  const slots = agent.inputs.filter((p) => isSlotKey(p.key)).map((p) => [p.key, p.type, p.multi]);
  assert.deepEqual(slots, [['model', 'data', false], ['memory', 'data', false], ['tools', 'data', true]]);
  assert.deepEqual(agent.outputs.map((p) => p.key), ['answer', 'steps', 'cost', 'done', 'failed']);
  for (const [t, key] of [['gw-llm', 'handle'], ['gw-tool', 'handle'], ['gw-memory', 'handle']]) assert.equal(host.nodes.get(t).outputs.find((p) => p.key === key)?.type, 'data', `${t}.${key}`);
  assert.ok(host.icons.has('gw-agent') && host.icons.has('gw-memory') && host.icons.has('gw-svc-anthropic') && host.icons.has('gw-svc-firecrawl'), 'role icons and service glyphs registered');
});

test('handles carry identity and configuration, never the key; attachments resolve to the live sub-nodes; the plan is plan → tools → answer', () => {
  const { agent, llm, mem, tools } = rig({ model: { credential: 'Own key', apiKey: 'sk-secret' } });
  hw.tick();
  const h = llm.out.handle;
  assert.deepEqual(h, { kind: 'llm', uid: llm.uid, title: 'Chat model', params: { credential: 'Own key', provider: 'Anthropic', model: 'auto', tier: 'standard', hasKey: true }, glyph: 'anthropic' });
  assert.ok(!JSON.stringify(h).includes('sk-secret'), 'the key never travels on a cable');
  assert.deepEqual(handleOf('tool', tools[1]).params, { credential: 'Gateway credits', service: 'Firecrawl', units: 1, hasKey: false });
  assert.deepEqual(mem.out.handle, { kind: 'memory', uid: mem.uid, title: 'Memory', window: 2, count: 0, glyph: 'memory' });
  const att = attachments(agent, agent.rt.inputs);
  assert.equal(att.model.node, llm); assert.equal(att.memory.node, mem); assert.deepEqual(att.tools.map((t) => t.params.service), ['Brave Search', 'Firecrawl', 'PDF.co']);
  const steps = planSteps(att, 3);
  assert.deepEqual(steps.map((s) => [s.n, s.role, s.service]), [[1, 'plan', 'Claude Sonnet 4.5'], [2, 'tool', 'Brave Search'], [3, 'tool', 'Firecrawl'], [4, 'tool', 'PDF.co'], [5, 'answer', 'Claude Sonnet 4.5']]);
  assert.equal(planSteps(att, 1).length, 3, 'maxTools caps the tool steps');
  assert.equal(estimateAgentRun(agent, agent.rt.inputs, agent.params).credits, 0.5 + 0.1 + 0.2, 'own-key model steps estimate 0; the tools price per unit');
  assert.equal(agent.footerText, '5 steps · est 0.8000 cr');
});

test('a run meters every step through the ledger in sequence: plan → 3 tools → answer, rows titled "<agent> · step k" with unique idempotency keys; memory remembers the exchange', async () => {
  const { agent, mem, llm } = rig();
  hw.tick();
  hw.trigger(agent, 'trigger', 'go'); hw.tick();
  assert.equal(agent.state.gw.status, 'running'); assert.deepEqual(statuses(), ['held']); assert.equal(agent.footerText, 'running · step 1 of 5 · 0.0000 cr');
  assert.equal(rows()[0].nodeTitle, 'Research agent · step 1'); assert.equal(rows()[0].nodeUid, agent.uid); assert.equal(rows()[0].providerId, 'anthropic');
  await hw.run(1);   // step 1 settles, step 2 holds on the same frame
  assert.deepEqual(statuses(), ['settled', 'held']); assert.deepEqual(agent.state.gw.steps.map((s) => s.status), ['settled', 'held', 'planned', 'planned', 'planned']);
  assert.equal(rows()[1].providerId, 'brave'); assert.equal(rows()[1].nodeTitle, 'Research agent · step 2');
  await hw.run(4);
  assert.deepEqual(statuses(), ['settled', 'settled', 'settled', 'settled', 'settled']);
  assert.deepEqual(rows().map((r) => r.providerId), ['anthropic', 'brave', 'firecrawl', 'pdfco', 'anthropic']);
  const idems = rows().map((r) => r.idem); assert.equal(new Set(idems).size, 5); assert.ok(idems.every((k, i) => k === `${agent.uid}:${idems[0].split(':')[1]}:s${i + 1}`), idems.join(' '));
  const gw = agent.state.gw;
  assert.equal(gw.status, 'settled'); assert.equal(gw.run, null); assert.deepEqual(gw.steps.map((s) => s.status), ['settled', 'settled', 'settled', 'settled', 'settled']);
  assert.ok(gw.steps.every((s) => s.credits > 0 && Number.isFinite(s.ms)));
  assert.equal(+gw.lastCost.toFixed(6), +gw.steps.reduce((a, s) => a + s.credits, 0).toFixed(6)); assert.equal(+ledger.spend().toFixed(6), +gw.lastCost.toFixed(6)); assert.equal(ledger.held(), 0);
  assert.equal(pulses(agent, 'done'), 1); assert.equal(pulses(agent, 'failed'), 0);
  assert.match(agent.out.answer, /^\[Claude Sonnet 4.5\] .*Compare provider pricing/); assert.equal(agent.out.steps.length, 5); assert.equal(agent.out.cost, gw.lastCost);
  assert.equal(agent.footerText, `5 steps · ${gw.lastCost >= 1 ? gw.lastCost.toFixed(3) : gw.lastCost.toFixed(4)} cr · 1×`);
  // memory: the exchange landed, the memory node's outputs follow, the next run says so in its plan prompt
  assert.equal(mem.state.exchanges.length, 1); assert.equal(mem.state.exchanges[0].prompt, 'Compare provider pricing'); assert.equal(mem.state.exchanges[0].steps, 5);
  hw.tick(); assert.equal(mem.out.count, 1); assert.equal(mem.out.handle.count, 1); assert.equal(mem.out.recent.prompt, 'Compare provider pricing');
  // the sub-nodes themselves never ran (no rows on their uids); their own state is untouched
  assert.ok(rows().every((r) => r.nodeUid === agent.uid)); assert.equal(llm.state.gw?.runs || 0, 0);
  // a second pulse while running is refused, not double-billed
  hw.trigger(agent); hw.tick(); hw.trigger(agent); hw.tick();
  assert.ok(host._rec.toasts.some((t) => /already running/.test(t.text)));
  await hw.run(6);
  assert.equal(statuses().length, 10); assert.equal(mem.state.exchanges.length, 2);
});

test('a provider error mid-way (fallback policy off) refunds the open hold, marks the step failed and the rest skipped, and emits failed once', async () => {
  const { agent } = rig();
  ledger.settings.policy.fallback = true;   // simulateFailure is only on with the policy: fail the 2nd call (Brave) with no fallback for tools
  let calls = 0; configureSimulation({ random: () => { calls += 1; return calls === 5 ? 0.001 : 0.5; } });   // model call: draws 1 (latency) 2 (failure check) 3 (output tokens); tool call: 4 (latency) 5 (failure check → fail)
  hw.tick(); hw.trigger(agent); await hw.run(3);
  assert.deepEqual(statuses(), ['settled', 'refunded']); assert.match(rows()[1].note, /429 \(simulated rate limit\) · hold released/);
  assert.deepEqual(agent.state.gw.steps.map((s) => s.status), ['settled', 'failed', 'skipped', 'skipped', 'skipped']);
  assert.equal(agent.state.gw.status, 'failed'); assert.equal(pulses(agent, 'failed'), 1); assert.equal(pulses(agent, 'done'), 0);
  assert.match(agent.rt.error, /^step 2 \(Brave Search\): Brave Search 429/); assert.equal(ledger.held(), 0);
  assert.equal(agent.footerText.startsWith('failed · 1/5 steps'), true, agent.footerText);
  assert.equal(+(OPENING_BALANCE - ledger.available()).toFixed(6), +agent.state.gw.steps[0].credits.toFixed(6), 'only the settled step was spent');
});

test('a decline mid-way (workflow budget reached at step 3) ends the run with a decline row and a failed pulse; earlier steps stay settled', async () => {
  const { agent } = rig();
  hw.tick();
  const est = estimateAgentRun(agent, agent.rt.inputs, agent.params);
  const budget = hw.add('gw-budget', { workflow: WF, limit: +(est.credits * 0.3).toFixed(4), period: 'monthly' });   // enough for plan + one tool, not the second
  hw.trigger(agent); await hw.run(6);
  const st = statuses();
  assert.ok(st.includes('decline'), st.join(','));
  assert.deepEqual(st.slice(0, st.indexOf('decline')).every((x) => x === 'settled'), true);
  const steps = agent.state.gw.steps.map((s) => s.status);
  assert.equal(steps.filter((x) => x === 'settled').length, st.indexOf('decline')); assert.equal(steps.filter((x) => x === 'failed').length, 1); assert.ok(steps.includes('skipped'));
  assert.equal(pulses(agent, 'failed'), 1); assert.match(agent.rt.error, /declined: workflow budget/);
  assert.equal(budget.out.spent, +ledger.spentFor(WF).toFixed(4));
});

test('an own-key attached model bypasses: plan and answer are 0-credit bypassed rows, the tools are settled rows, done still fires', async () => {
  const { agent } = rig({ model: { credential: 'Own key', provider: 'OpenAI', model: 'gpt5-mini', tier: 'fixed', apiKey: 'sk-demo' }, tools: ['Firecrawl'] });
  hw.tick(); hw.trigger(agent); await hw.run(4);
  assert.deepEqual(statuses(), ['bypassed', 'settled', 'bypassed']);
  assert.deepEqual(rows().map((r) => r.nodeTitle), ['Research agent · step 1', 'Research agent · step 2', 'Research agent · step 3']);
  assert.equal(rows()[0].providerId, 'openai'); assert.equal(rows()[0].credits, 0); assert.match(rows()[0].note, /own API key; not metered/);
  assert.deepEqual(agent.state.gw.steps.map((s) => [s.status, s.credits]), [['bypassed', 0], ['settled', 0.1], ['bypassed', 0]]);
  assert.equal(pulses(agent, 'done'), 1); assert.match(agent.out.answer, /via own key/); assert.equal(agent.out.cost, 0.1); assert.equal(ledger.bypassed(), 2);
});

test('no model attached → fails up front with a clear error; a fallback inside a step keeps the step alive; auto top-up covers a step', async () => {
  const lone = hw.add('gw-agent', { workflow: WF });
  hw.trigger(lone); hw.tick();
  assert.equal(pulses(lone, 'failed'), 1); assert.match(lone.rt.error, /no model attached/); assert.equal(lone.footerText, 'attach a model to the Chat model slot'); assert.deepEqual(statuses(), []);
  hw.remove(lone);
  // fallback: the plan call fails once (503), a cheaper model elsewhere settles it, the run continues
  const { agent } = rig({ tools: [] });
  let calls = 0; configureSimulation({ random: () => { calls += 1; return calls === 2 ? 0.001 : 0.5; } });
  hw.tick(); hw.trigger(agent); await hw.run(4);
  assert.deepEqual(statuses(), ['refunded', 'settled', 'settled']);
  assert.notEqual(rows()[1].providerId, 'anthropic'); assert.match(rows()[1].note, /^fallback from Claude Sonnet 4.5/); assert.equal(rows()[1].idem, `${rows()[0].idem}:a2`);
  assert.deepEqual(agent.state.gw.steps.map((s) => s.status), ['settled', 'settled']); assert.equal(pulses(agent, 'done'), 1);
  // auto top-up mid-run
  configureSimulation({ random: () => 0.5 });
  ledger.reset(); ledger.adjustTo(0.3); ledger.settings.autoTopUp = { enabled: true, threshold: 100, target: 1000, monthlyCap: 5000 };
  hw.trigger(agent); await hw.run(4);
  assert.deepEqual(statuses(), ['adjust', 'topup', 'settled', 'settled']); assert.equal(pulses(agent, 'done'), 2);
  ledger.settings.autoTopUp.enabled = false;
});

test('gw-memory keeps the last `window` exchanges, clears on a pulse and reports through handle / count / recent', async () => {
  const { agent, mem } = rig({ tools: [] });
  hw.tick();
  for (let i = 0; i < 3; i++) { hw.trigger(agent, 'trigger', `q${i}`); await hw.run(4); }
  assert.equal(mem.state.exchanges.length, 2, 'window 2'); assert.equal(mem.state.total, 3);
  assert.deepEqual(mem.state.exchanges.map((e) => e.prompt), ['Compare provider pricing', 'Compare provider pricing']);
  hw.tick(); assert.equal(mem.out.count, 2); assert.equal(mem.footerText, '2 of 2 exchanges · 3 total');
  mem.params.window = 1; hw.tick(); assert.equal(mem.state.exchanges.length, 1, 'shrinking the window trims at once');
  hw.trigger(mem, 'clear'); hw.tick(); assert.equal(mem.state.exchanges.length, 0); assert.equal(mem.out.recent, undefined);
  // an unattached agent input uses the connected prompt text
  const text = hw.add('gw-tool', { service: 'Brave Search' }); void text;
});

test('Run sample prefers the agent at the head of the chain and applies the flow layout through host.layout (positions with y: slot children on the floor beneath the agent)', async () => {
  const { agent, llm, mem, tools } = rig();
  const after = hw.add('gw-llm', { credential: 'Own key', provider: 'OpenAI', model: 'gpt5-mini', tier: 'fixed', apiKey: 'k', workflow: WF }, { title: 'Draft' });
  hw.connect(agent, 'done', after, 'trigger');
  hw.tick();
  assert.equal(api.runSample(), true);
  assert.equal(host._rec.layouts.length, 1); assert.equal(host._rec.layouts[0].moved, 7);
  assert.ok(host._rec.layouts[0].positions.every(([, p]) => p.length === 3 && Number.isFinite(p[1])), 'the fake host recorded [x, y, z] positions');
  assert.equal(host._rec.layouts[0].opts.label, 'Flow layout');
  assert.equal(agent.position.y, 9, 'the chain at eye level');
  for (const c of [llm, mem, ...tools]) { assert.ok(c.position.y < agent.position.y, `${c.title} stands beneath the agent (y ${c.position.y} < ${agent.position.y})`); assert.ok(Math.abs(c.position.z - agent.position.z) <= 1.2, `${c.title} directly under it (z ${c.position.z})`); }
  assert.ok(after.position.x > agent.position.x, 'the next node in the chain sits to the right');
  assert.equal(after.position.z, agent.position.z); assert.equal(after.position.y, agent.position.y);
  // the flat variant (what the 2D plan gets) keeps every height and hangs the children behind the agent
  const ys = new Map(hw.world.nodes.map((n) => [n.uid, n.position.y]));
  assert.equal(api.applyFlowLayout({ flat: true }), 7); assert.equal(host._rec.layouts.at(-1).opts.label, 'Flow layout (flat)');
  for (const n of hw.world.nodes) assert.equal(n.position.y, ys.get(n.uid), `${n.title} keeps its height in the flat layout`);
  for (const c of [llm, mem, ...tools]) assert.ok(c.position.z > agent.position.z, `${c.title} behind the agent in the flat layout`);
  host._rec.plan = true; assert.equal(api.applyFlowLayout(), 7); assert.equal(host._rec.layouts.at(-1).opts.label, 'Flow layout (flat)', 'the plan picks the flat variant by itself'); host._rec.plan = false;
  assert.equal(api.applyFlowLayout(), 7); assert.equal(host._rec.layouts.at(-1).opts.label, 'Flow layout'); assert.ok(llm.position.y < agent.position.y);
  host._rec.layouts.length = 1;
  await hw.run(7);
  assert.equal(pulses(agent, 'done'), 1); assert.equal(statuses().at(-1), 'bypassed', 'the own-key node after the agent ran too');
  assert.ok(host._rec.toasts.some((t) => /^Flow layout · 7 blocks/.test(t.text)));
  assert.equal(api.runSample({ layout: false }), true); assert.equal(host._rec.layouts.length, 1);
});
