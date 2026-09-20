// routing.js — the routing policy: which model a gw-llm node actually runs, and where it falls
// back after a provider error. Pure functions over the rate card, so the policy is unit-tested
// without the engine or a page.
import { MODELS, PROVIDERS, TIERS, providerByLabel, modelsFor, estimateModel } from './rates.js';

/**
 * Resolve which model a gw-llm node will actually run, given its params and the routing policy.
 *  - tier 'fixed': the `model` param (or the provider's standard model when 'auto'); never swapped.
 *  - tier economy/standard/premium: candidates are every model at that tier or above; with
 *    `preferCheapest` on, the cheapest estimate wins across providers; otherwise the node's own
 *    provider at that tier (nearest tier above it if it has none).
 * Returns { model, reason, swapped, preferred } or { model: null, reason }.
 */
export function resolveModel(params, policy = {}) {
  const prov = providerByLabel(params.provider);
  const own = prov ? modelsFor(prov.id) : [];
  const preferred = params.model && params.model !== 'auto' && MODELS[params.model] ? MODELS[params.model]
    : own.find((m) => m.tier === 'standard') || own[0] || null;
  if (!params.tier || params.tier === 'fixed') {
    if (!preferred) return { model: null, reason: `no model on the rate card for ${params.provider || 'this provider'}` };
    return { model: preferred, reason: 'fixed model, never swapped', swapped: false, preferred };
  }
  const rank = TIERS[params.tier] || TIERS.standard;
  const capable = Object.values(MODELS).filter((m) => TIERS[m.tier] >= rank);
  if (!capable.length) return { model: null, reason: `no model meets tier ${params.tier}` };
  const ownCapable = own.filter((m) => TIERS[m.tier] >= rank).sort((a, b) => TIERS[a.tier] - TIERS[b.tier] || estimateModel(a) - estimateModel(b));
  const home = ownCapable[0] || null;
  if (policy.preferCheapest) {
    const best = capable.slice().sort((a, b) => estimateModel(a) - estimateModel(b))[0];
    const swapped = home && best.id !== home.id;
    return { model: best, preferred: home, swapped, reason: swapped ? `cheapest capable for tier ${params.tier}; beat ${home.label}` : `cheapest capable for tier ${params.tier}` };
  }
  if (home) return { model: home, preferred: home, swapped: false, reason: `tier ${params.tier} → ${PROVIDERS[home.provider].label}'s ${home.tier} model` };
  const best = capable.slice().sort((a, b) => estimateModel(a) - estimateModel(b))[0];
  return { model: best, preferred: null, swapped: true, reason: `${params.provider} has no tier-${params.tier} model; routed to ${best.label}` };
}

/** Fallback after a provider error: the cheapest model of the same tier or better on a different provider. */
export function fallbackFor(model) {
  const rank = TIERS[model.tier];
  const cands = Object.values(MODELS).filter((m) => m.provider !== model.provider && TIERS[m.tier] >= rank).sort((a, b) => estimateModel(a) - estimateModel(b));
  return cands[0] || null;
}
