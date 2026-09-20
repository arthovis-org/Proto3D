import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters, adapterFor, sim, configureSimulation, REAL_GATEWAY_URL } from '../../src/providers.js';
import { MODELS, TOOLS, PROVIDERS, estimateModel, estimateTool, TYPICAL } from '../../src/rates.js';

// deterministic: no latency, no randomness
configureSimulation({ sleep: () => Promise.resolve(), random: () => 0.5 });

test('one simulated adapter per provider / service; nothing points at a real gateway', () => {
  assert.equal(adapters.size, Object.keys(PROVIDERS).length);
  for (const p of Object.values(PROVIDERS)) { const a = adapterFor(p.id); assert.ok(a, p.id); assert.equal(a.kind, p.kind); assert.equal(a.simulated, true); }
  assert.equal(adapterFor('nope'), null); assert.equal(REAL_GATEWAY_URL, null);
  assert.deepEqual(adapterFor('anthropic').models.sort(), ['claude-haiku', 'claude-opus', 'claude-sonnet']);
});

test('estimates are deterministic functions of the prompt / units and the rate card', () => {
  const a = adapterFor('anthropic'); const m = MODELS['claude-sonnet'];
  const e1 = a.estimate({}, 'x'.repeat(400), { model: m }), e2 = a.estimate({}, 'x'.repeat(400), { model: m });
  assert.deepEqual(e1, e2);
  assert.equal(e1.credits, estimateModel(m, 100 + 120, TYPICAL.outputTokens)); assert.equal(e1.units, 'est. 220 in / 450 out');
  assert.equal(a.estimate({}, '', { model: m }).credits, estimateModel(m), 'no prompt → typical volume');
  assert.deepEqual(a.estimate({}, 'p', {}), { credits: 0, units: '—' }, 'no model → nothing to estimate');
  const t = adapterFor('brave');
  assert.deepEqual(t.estimate({ units: 3 }), { credits: estimateTool(TOOLS.brave, 3), units: '3 requests' });
  assert.deepEqual(t.estimate({ units: 0 }), { credits: 0.5, units: '1 request' }, 'units clamp to at least 1');
});

test('calls resolve with a result, usage, units and credits; own-key mode is marked in the result', async () => {
  const a = adapterFor('openai'); const m = MODELS['gpt5-mini'];
  const r = await a.call({ tier: 'standard' }, 'Customer cannot log in', { model: m }, {});
  assert.match(r.result, /^\[GPT-5 mini\] .*simulated output/); assert.equal(r.usage.inputTokens, Math.max(8, Math.ceil('Customer cannot log in'.length / 4)) + 120, 'at least 8 prompt tokens + 120 of system prompt');
  assert.equal(r.credits, estimateModel(m, r.usage.inputTokens, r.usage.outputTokens)); assert.match(r.units, /in \/ .* out$/);
  const own = await a.call({}, 'hello', { model: m }, { mode: 'own-key' }); assert.match(own.result, /^\[GPT-5 mini via own key\]/);
  const tool = await adapterFor('firecrawl').call({ units: 2 }, 'docs', {}, {});
  assert.match(tool.result, /^\[Firecrawl\] 2 pages for "docs"/); assert.equal(tool.credits, 0.2); assert.deepEqual(tool.usage, { units: 2 });
});

test('simulated failures only when asked for and only under the configured rate; the error is retryable', async () => {
  const a = adapterFor('anthropic'); const m = MODELS['claude-sonnet'];
  configureSimulation({ random: () => 0.05 });
  await assert.rejects(a.call({}, 'p', { model: m }, { simulateFailure: true }), (e) => e.status === 503 && e.retryable === true && /simulated provider error/.test(e.message));
  await assert.doesNotReject(a.call({}, 'p', { model: m }, { simulateFailure: false }), 'no failure when the fallback policy is off');
  configureSimulation({ random: () => 0.5 });
  await assert.doesNotReject(a.call({}, 'p', { model: m }, { simulateFailure: true }));
  configureSimulation({ random: () => 0.01 });
  await assert.rejects(adapterFor('brave').call({ units: 1 }, 'q', {}, { simulateFailure: true }), /429/);
  configureSimulation({ random: () => 0.5 });
  assert.equal(sim.modelFailureRate, 0.1); assert.equal(sim.toolFailureRate, 0.05);
});
