import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, TOOLS, PROVIDERS, TIERS, TIER_OPTIONS, MODEL_OPTIONS, MODEL_PROVIDER_LABELS, TOOL_SERVICE_LABELS, TYPICAL, RATE_CARD, estimateModel, estimateTool, modelsFor, providerByLabel, toolByLabel, creditsToUsd } from '../../src/rates.js';

test('the rate card is consistent: every model has a known provider and tier, every tool a provider and a price', () => {
  assert.equal(RATE_CARD.illustrative, true);
  for (const m of Object.values(MODELS)) { assert.ok(PROVIDERS[m.provider], m.id); assert.equal(PROVIDERS[m.provider].kind, 'model'); assert.ok(TIERS[m.tier], `${m.id} tier ${m.tier}`); assert.ok(m.in > 0 && m.out >= m.in, `${m.id} out ≥ in`); }
  for (const t of Object.values(TOOLS)) { assert.ok(PROVIDERS[t.id], t.id); assert.equal(PROVIDERS[t.id].kind, 'tool'); assert.ok(t.price > 0 && t.unit); }
  assert.deepEqual(TIER_OPTIONS, ['fixed', 'economy', 'standard', 'premium']);
  assert.equal(MODEL_OPTIONS[0], 'auto'); assert.equal(MODEL_OPTIONS.length, Object.keys(MODELS).length + 1);
  assert.deepEqual(MODEL_PROVIDER_LABELS, Object.values(PROVIDERS).filter((p) => p.kind === 'model').map((p) => p.label));
  assert.deepEqual(TOOL_SERVICE_LABELS, Object.values(PROVIDERS).filter((p) => p.kind === 'tool').map((p) => p.label));
});

test('estimates: credits per million tokens, per tool unit, and the dollar conversion', () => {
  const sonnet = MODELS['claude-sonnet'];
  assert.equal(estimateModel(sonnet, 1_000_000, 0), 300); assert.equal(estimateModel(sonnet, 0, 1_000_000), 1500);
  assert.equal(estimateModel(sonnet), (TYPICAL.inputTokens * 300 + TYPICAL.outputTokens * 1500) / 1e6);
  assert.ok(estimateModel(MODELS['gpt5-nano']) < estimateModel(MODELS['gpt5-mini']) && estimateModel(MODELS['gpt5-mini']) < estimateModel(MODELS.gpt5), 'tiers order by price within a provider');
  assert.equal(estimateTool(TOOLS.brave, 3), 1.5); assert.equal(estimateTool(TOOLS.firecrawl), 0.1); assert.equal(estimateTool(TOOLS.browserbase, -2), 0, 'negative units clamp to 0');
  assert.equal(creditsToUsd(100), 1); assert.equal(creditsToUsd(2300), 23);
});

test('lookups by label and provider', () => {
  assert.equal(providerByLabel('Anthropic').id, 'anthropic'); assert.equal(providerByLabel('Brave Search').id, 'brave'); assert.equal(providerByLabel('nope'), null);
  assert.equal(toolByLabel('Firecrawl').id, 'firecrawl'); assert.equal(toolByLabel('Anthropic'), null);
  assert.deepEqual(modelsFor('anthropic').map((m) => m.id).sort(), ['claude-haiku', 'claude-opus', 'claude-sonnet']); assert.deepEqual(modelsFor('brave'), []);
});
