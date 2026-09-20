// The gw- nodes on the REAL core Engine (src/core/engine.js) in Node: the fake host stands in
// for the page, the headless world for Block3D / World. Provider calls are made deterministic
// through the adapters' `sim` knobs; frames are stepped with `await hw.run()` so resolved calls
// are drained on the following evaluation exactly as in the browser.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost, fakeCanvasContext } from '../../../sdk/testing/fake-host.js';
import { createHeadlessWorld } from '../../../sdk/testing/headless-engine.js';
import manifest from '../../addon.json' with { type: 'json' };
import { register, install } from '../../src/index.js';
import { configureSimulation } from '../../src/providers.js';
import { OPENING_BALANCE, fmt } from '../../src/ledger.js';
import { eligibility, estimateRun, workflowOf, budgetFor, GATEWAY_TYPES } from '../../src/nodes.js';

configureSimulation({ sleep: () => Promise.resolve(), random: () => 0.5 });
const hw = createHeadlessWorld();
const host = createFakeHost(manifest, { headless: hw });
const ledger = register(host);
const api = install(host, { sample: false });
const statuses = () => ledger.rows(50).reverse().map((r) => r.status);
const pulses = (node, key) => node.getPort(key, 'out').pulses || 0;
const llmParams = (over = {}) => ({ credential: 'Gateway credits', provider: 'Anthropic', model: 'auto', tier: 'standard', workflow: 'Support inbox triage', ...over });
// every test starts from an empty world, a fresh ledger and the deterministic simulation
beforeEach(() => { for (const n of [...hw.world.nodes]) hw.remove(n); ledger.reset(); ledger.settings.autoTopUp.enabled = false; ledger.settings.policy.fallback = true; configureSimulation({ sleep: () => Promise.resolve(), random: () => 0.5 }); host._rec.toasts.length = 0; });

test('register() put the four gw- types into the registry through the host, with icons', () => {
  assert.deepEqual(host.nodes.ids(), GATEWAY_TYPES);
  assert.deepEqual(host.nodes.get('gw-llm').params.map((p) => p.key), ['credential', 'provider', 'model', 'tier', 'apiKey', 'prompt', 'workflow']);
  assert.ok(host.icons.has('gateway') && host.icons.has('gw-meter'));
  assert.equal(api.ledger, ledger); assert.equal(host._rec.errorHandlers.length, 1); assert.equal(host._rec.worldListeners.length, 1);
});

test('hold → settle flow: a metered model call holds the estimate, settles the actual cost, emits done and lowers the balance', async () => {
  ledger.reset();
  const llm = hw.add('gw-llm', llmParams(), { title: 'Summarize' });
  const tool = hw.add('gw-tool', { credential: 'Gateway credits', service: 'Brave Search', units: 1, workflow: 'Support inbox triage' }, { title: 'Web search' });
  hw.connect(llm, 'done', tool, 'trigger'); hw.connect(llm, 'result', tool, 'query');
  hw.tick(); assert.deepEqual(statuses(), []); assert.equal(llm.footerText, `Claude Sonnet 4.5 · idle · est ${fmt(estimateRun('llm', llm.params).credits)} cr`);
  hw.trigger(llm, 'trigger', 'ticket'); hw.tick();
  assert.deepEqual(statuses(), ['held']); assert.equal(llm.state.gw.status, 'held'); assert.ok(ledger.held() > 0); assert.equal(ledger.available(), OPENING_BALANCE - ledger.held());
  await hw.run(1);   // the resolved call is drained on this frame: settle + emit('done') → the tool holds in the same pass
  assert.equal(llm.state.gw.status, 'settled'); assert.equal(pulses(llm, 'done'), 1); assert.ok(llm.out.result.startsWith('[Claude Sonnet 4.5] '));
  assert.deepEqual(statuses(), ['settled', 'held']);
  await hw.run(1);
  assert.deepEqual(statuses(), ['settled', 'settled']); assert.equal(tool.state.gw.status, 'settled'); assert.match(tool.out.result, /^\[Brave Search\] 1 request for/);
  assert.equal(ledger.held(), 0); assert.ok(ledger.available() < OPENING_BALANCE); assert.equal(+ledger.spend().toFixed(6), +(llm.out.cost + tool.out.cost).toFixed(6));
  assert.equal(ledger.rows()[1].nodeTitle, 'Summarize'); assert.match(ledger.rows()[1].note, /tier standard/);
  assert.equal(llm.footerText, `Claude Sonnet 4.5 · settled · ${fmt(llm.out.cost)} cr`);
  // idempotency at node level: one pulse, more frames, still one request
  await hw.run(3); assert.equal(statuses().length, 2);
  assert.ok(host._rec.toasts.some((t) => /^Held /.test(t.text)) && host._rec.toasts.some((t) => /^Settled /.test(t.text)));
  hw.remove(llm); hw.remove(tool);
});

test('decline at 0.5 cr: the node fails up front with a decline row, a failed pulse and a visible error; nothing downstream fires', async () => {
  ledger.reset(); ledger.settings.autoTopUp.enabled = false;
  const llm = hw.add('gw-llm', llmParams(), { title: 'Summarize' });
  const tool = hw.add('gw-tool', { service: 'Brave Search' }); hw.connect(llm, 'done', tool, 'trigger');
  ledger.adjustTo(0.5);
  hw.trigger(llm); await hw.run(2);
  assert.deepEqual(statuses(), ['adjust', 'decline']);
  assert.equal(pulses(llm, 'failed'), 1); assert.equal(pulses(llm, 'done'), 0); assert.equal(tool.state.gw?.status ?? 'idle', 'idle');
  assert.match(llm.rt.error, /declined: insufficient balance: est .* available 0\.5000 cr \(auto top-up is off\)/); assert.equal(llm.derivedState, 'error');
  assert.equal(+ledger.available().toFixed(4), 0.5); assert.ok(host._rec.toasts.some((t) => /^Declined/.test(t.text)));
  hw.remove(llm); hw.remove(tool);
});

test('auto top-up: with the rule on, the same 0.5 cr balance refills and the call succeeds', async () => {
  ledger.reset(); ledger.adjustTo(0.5);
  ledger.settings.autoTopUp = { enabled: true, threshold: 100, target: 1000, monthlyCap: 5000 }; ledger.saveSettings();
  const llm = hw.add('gw-llm', llmParams(), { title: 'Summarize' });
  hw.trigger(llm); await hw.run(2);
  assert.deepEqual(statuses(), ['adjust', 'topup', 'settled']);
  assert.match(ledger.rows()[1].note, /auto top-up fired: balance fell below 100 cr/);
  assert.equal(pulses(llm, 'done'), 1); assert.ok(ledger.available() > 990 && ledger.available() < 1000);
  assert.ok(host._rec.toasts.some((t) => /^Auto top-up fired/.test(t.text)));
  ledger.settings.autoTopUp.enabled = false; ledger.saveSettings(); hw.remove(llm);
});

test('refund on error via engine.onError: a node that throws while it holds credits gets its hold released', async () => {
  ledger.reset();
  configureSimulation({ sleep: () => new Promise(() => {}) });   // the provider never answers: the hold stays open
  const llm = hw.add('gw-llm', llmParams(), { title: 'Summarize' });
  hw.trigger(llm); hw.tick();
  assert.deepEqual(statuses(), ['held']); assert.equal(ledger.holdsFor(llm.uid).length, 1);
  const good = llm.state;
  llm.state = new Proxy(good, { get() { throw new Error('boom in evaluate'); } });   // the next evaluate throws inside the node (state.gw is its first read)
  hw.tick();
  assert.equal(llm.rt.error, 'boom in evaluate'); assert.deepEqual(statuses(), ['refunded']); assert.equal(ledger.holdsFor(llm.uid).length, 0); assert.equal(ledger.available(), OPENING_BALANCE);
  assert.match(ledger.rows()[0].note, /engine error: boom in evaluate · hold released/);
  assert.ok(host._rec.toasts.some((t) => /1 hold released after an error/.test(t.text)));
  llm.state = good; configureSimulation({ sleep: () => Promise.resolve() });
  hw.remove(llm);
});

test('removing a node (world change) refunds its open holds; a late provider answer cannot re-charge a closed hold', async () => {
  ledger.reset();
  let release; configureSimulation({ sleep: () => new Promise((r) => { release = r; }) });
  const llm = hw.add('gw-llm', llmParams()); hw.trigger(llm); hw.tick();
  assert.equal(ledger.held() > 0, true);
  hw.remove(llm);
  assert.deepEqual(statuses(), ['refunded']); assert.equal(ledger.held(), 0);
  release(); await hw.run(2);
  assert.deepEqual(statuses(), ['refunded'], 'the drained answer finds the hold closed and does nothing');
  configureSimulation({ sleep: () => Promise.resolve() });
});

test('own-key bypass: logged as a 0-credit bypassed row, never metered, result marked as own key', async () => {
  ledger.reset();
  const draft = hw.add('gw-llm', llmParams({ credential: 'Own key', provider: 'OpenAI', model: 'gpt5-mini', tier: 'fixed', apiKey: 'sk-demo' }), { title: 'Draft reply' });
  const el = eligibility('llm', draft.params); assert.equal(el.bypass, true); assert.match(el.why, /own API key: routed straight to OpenAI, not metered/);
  assert.equal(estimateRun('llm', draft.params).credits, 0);
  hw.trigger(draft); await hw.run(2);
  assert.deepEqual(statuses(), ['bypassed']); assert.equal(ledger.available(), OPENING_BALANCE); assert.equal(ledger.bypassed(), 1);
  assert.match(draft.out.result, /via own key/); assert.equal(draft.out.cost, 0); assert.equal(draft.footerText, 'GPT-5 mini · own key · not metered · 1×');
  hw.remove(draft);
});

test('budgets: a gw-budget node for the workflow caps holds; the budget outputs spent / remaining', async () => {
  ledger.reset();
  const budget = hw.add('gw-budget', { workflow: 'Tiny', limit: 0.001, period: 'monthly' });
  const llm = hw.add('gw-llm', llmParams({ workflow: 'Tiny' }));
  assert.equal(workflowOf(llm), 'Tiny'); assert.deepEqual(budgetFor(llm, 'Tiny'), { limit: 0.001, period: 'monthly', node: budget });
  hw.trigger(llm); await hw.run(2);
  assert.deepEqual(statuses(), ['decline']); assert.match(llm.rt.error, /workflow budget 0\.0010 cr \(monthly\) reached/);
  assert.deepEqual(budget.out, { spent: 0, remaining: 0.001 });
  hw.remove(budget); hw.remove(llm);
  // workflow falls back to the group title, then 'default'
  const g = hw.add('gw-llm', llmParams({ workflow: '' })); assert.equal(workflowOf(g), 'default'); hw.group('Grouped', [g]); assert.equal(workflowOf(g), 'Grouped'); hw.remove(g);
});

test('fallback on provider error: the hold is refunded and the call is retried once on another provider', async () => {
  ledger.reset();
  let draws = 0; configureSimulation({ random: () => (++draws <= 2 ? 0.01 : 0.5) });   // the first call fails (draw 1 = latency, draw 2 = failure check), the rest succeed
  const llm = hw.add('gw-llm', llmParams(), { title: 'Summarize' });
  hw.trigger(llm); await hw.run(3);
  assert.deepEqual(statuses(), ['refunded', 'settled']);
  const rows = ledger.rows(); assert.match(rows[1].note, /503 \(simulated provider error\) · hold released/); assert.match(rows[0].note, /^fallback from Claude Sonnet 4.5 after/);
  assert.notEqual(rows[0].providerId, 'anthropic'); assert.equal(rows[0].idem, `${llm.uid}:${rows[1].idem.split(':')[1]}:a2`);
  assert.equal(pulses(llm, 'done'), 1); assert.ok(host._rec.toasts.some((t) => /failed, falling back to/.test(t.text)));
  // with the policy off the node fails visibly instead
  ledger.settings.policy.fallback = false; configureSimulation({ random: () => 0.01 });
  hw.trigger(llm); await hw.run(3);
  assert.equal(statuses().at(-1), 'settled', 'simulateFailure is off when the fallback policy is off, so the call cannot fail');
  ledger.settings.policy.fallback = true; configureSimulation({ random: () => 0.5 }); hw.remove(llm);
});

test('meter and budget faces render against a fake canvas; the meter outputs follow the ledger', () => {
  ledger.reset();
  const meter = hw.add('gw-meter'); hw.tick();
  assert.deepEqual(meter.out, { balance: OPENING_BALANCE, spend: 0 }); assert.equal(meter.footerText, '2,300.00 cr · $23.00');
  const g = fakeCanvasContext();
  host.nodes.get('gw-meter').face.render(g, 400, 300, { params: {}, state: {} });
  host.nodes.get('gw-budget').face.render(g, 400, 300, { params: { workflow: 'x', limit: 10, period: 'monthly' }, state: {} });
  assert.ok(g.calls.length > 0);
  hw.remove(meter);
});

test('the Run sample path kicks the first gateway node when no Input feeds it', async () => {
  ledger.reset();
  const llm = hw.add('gw-llm', llmParams());
  assert.equal(api.runSample(), true);
  await hw.run(2);
  assert.deepEqual(statuses(), ['settled']);
  hw.remove(llm);
  assert.equal(api.runSample(), false); assert.ok(host._rec.toasts.at(-1).text.startsWith('No gateway node'));
});
