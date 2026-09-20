import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel, fallbackFor } from '../../src/routing.js';
import { MODELS, estimateModel } from '../../src/rates.js';

test('fixed tier pins the model (or the provider default) and is never swapped', () => {
  const r = resolveModel({ provider: 'OpenAI', model: 'gpt5-mini', tier: 'fixed' }, { preferCheapest: true });
  assert.equal(r.model.id, 'gpt5-mini'); assert.equal(r.swapped, false); assert.equal(r.reason, 'fixed model, never swapped');
  assert.equal(resolveModel({ provider: 'Anthropic', model: 'auto', tier: 'fixed' }).model.id, 'claude-sonnet', 'auto = the provider\'s standard model');
  assert.equal(resolveModel({ provider: 'Anthropic', model: 'auto' }).model.id, 'claude-sonnet', 'no tier behaves as fixed');
  const none = resolveModel({ provider: 'Brave Search', tier: 'fixed' }); assert.equal(none.model, null); assert.match(none.reason, /no model on the rate card/);
});

test('capability tiers: the node\'s own provider at that tier or above, unless it has none', () => {
  const std = resolveModel({ provider: 'Anthropic', tier: 'standard' }, {});
  assert.equal(std.model.id, 'claude-sonnet'); assert.match(std.reason, /tier standard → Anthropic's standard model/);
  const prem = resolveModel({ provider: 'Anthropic', tier: 'premium' }, {}); assert.equal(prem.model.id, 'claude-opus');
  const eco = resolveModel({ provider: 'Alibaba Qwen', tier: 'economy' }, {});
  assert.equal(eco.model.id, 'qwen-plus', 'no economy model: the nearest tier above'); assert.equal(eco.model.tier, 'standard');
  const kimiPrem = resolveModel({ provider: 'Moonshot Kimi', tier: 'premium' }, {});
  assert.equal(kimiPrem.swapped, true); assert.match(kimiPrem.reason, /Moonshot Kimi has no tier-premium model; routed to/);
  assert.equal(kimiPrem.model.id, Object.values(MODELS).filter((m) => m.tier === 'premium').sort((a, b) => estimateModel(a) - estimateModel(b))[0].id);
});

test('prefer cheapest capable: the lowest estimate at the tier or above, across providers, with the beaten home model named', () => {
  const r = resolveModel({ provider: 'Anthropic', tier: 'standard' }, { preferCheapest: true });
  const cheapest = Object.values(MODELS).filter((m) => m.tier !== 'economy').sort((a, b) => estimateModel(a) - estimateModel(b))[0];
  assert.equal(r.model.id, cheapest.id); assert.equal(r.swapped, true); assert.equal(r.preferred.id, 'claude-sonnet');
  assert.equal(r.reason, 'cheapest capable for tier standard; beat Claude Sonnet 4.5');
  const own = resolveModel({ provider: 'OpenAI', tier: 'standard' }, { preferCheapest: true });
  assert.equal(own.swapped, own.model.id !== 'gpt5-mini');
  const eco = resolveModel({ provider: 'Anthropic', tier: 'economy' }, { preferCheapest: true }); assert.equal(eco.model.id, 'gpt5-nano');
});

test('fallbackFor picks the cheapest model of the same tier or better on another provider', () => {
  const fb = fallbackFor(MODELS['claude-sonnet']);
  assert.notEqual(fb.provider, 'anthropic'); assert.ok(['standard', 'premium'].includes(fb.tier));
  const cands = Object.values(MODELS).filter((m) => m.provider !== 'anthropic' && m.tier !== 'economy').sort((a, b) => estimateModel(a) - estimateModel(b));
  assert.equal(fb.id, cands[0].id);
  assert.equal(fallbackFor(MODELS['gpt5-nano']).provider !== 'openai', true);
  assert.equal(fallbackFor(MODELS['claude-opus']).tier, 'premium');
});
