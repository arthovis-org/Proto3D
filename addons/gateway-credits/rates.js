// rates.js — the ILLUSTRATIVE rate card for the Gateway Credits add-on.
// Credits per 1M tokens for models (input / output), credits per unit for tool services.
// 1 credit = $0.01 at the demo rate. Figures approximate published list prices as of the
// syncedAt date and exist only so the metering flow has something to multiply by. A real
// gateway service would serve this table (versioned) and the add-on would cache it.

export const RATE_USD_PER_CREDIT = 0.01;

export const RATE_CARD = Object.freeze({
  illustrative: true,
  syncedAt: '2026-09-18',
  source: 'provider list prices, hand-copied for the demo',
});

/** Tier rank: a node that asks for `standard` may run on standard or premium, never economy. */
export const TIERS = Object.freeze({ economy: 1, standard: 2, premium: 3 });
export const TIER_OPTIONS = ['fixed', 'economy', 'standard', 'premium'];

/** Providers: model vendors and tool services. `label` is what the select param shows. */
export const PROVIDERS = Object.freeze({
  openai:      { id: 'openai',      label: 'OpenAI',        kind: 'model', color: '#1baf7a' },
  anthropic:   { id: 'anthropic',   label: 'Anthropic',     kind: 'model', color: '#eb6834' },
  gemini:      { id: 'gemini',      label: 'Google Gemini', kind: 'model', color: '#2a78d6' },
  qwen:        { id: 'qwen',        label: 'Alibaba Qwen',  kind: 'model', color: '#7b6cd6' },
  minimax:     { id: 'minimax',     label: 'MiniMax',       kind: 'model', color: '#e87ba4' },
  kimi:        { id: 'kimi',        label: 'Moonshot Kimi', kind: 'model', color: '#3fae4a' },
  brave:       { id: 'brave',       label: 'Brave Search',  kind: 'tool',  color: '#eda100' },
  firecrawl:   { id: 'firecrawl',   label: 'Firecrawl',     kind: 'tool',  color: '#d9633b' },
  browserbase: { id: 'browserbase', label: 'Browserbase',   kind: 'tool',  color: '#6b7280' },
  llamaparse:  { id: 'llamaparse',  label: 'LlamaParse',    kind: 'tool',  color: '#e34948' },
  pdfco:       { id: 'pdfco',       label: 'PDF.co',        kind: 'tool',  color: '#8a90a0' },
});
export const MODEL_PROVIDER_LABELS = Object.values(PROVIDERS).filter((p) => p.kind === 'model').map((p) => p.label);
export const TOOL_SERVICE_LABELS = Object.values(PROVIDERS).filter((p) => p.kind === 'tool').map((p) => p.label);
export const providerByLabel = (label) => Object.values(PROVIDERS).find((p) => p.label === label) || null;

/** Models: credits per 1M input / output tokens (illustrative). */
export const MODELS = Object.freeze({
  'claude-sonnet': { id: 'claude-sonnet', label: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'standard', in: 300, out: 1500 },
  'claude-haiku':  { id: 'claude-haiku',  label: 'Claude Haiku 4.5',  provider: 'anthropic', tier: 'economy',  in: 100, out: 500 },
  'claude-opus':   { id: 'claude-opus',   label: 'Claude Opus 4.1',   provider: 'anthropic', tier: 'premium',  in: 1500, out: 7500 },
  'gpt5':          { id: 'gpt5',          label: 'GPT-5',             provider: 'openai',    tier: 'premium',  in: 125, out: 1000 },
  'gpt5-mini':     { id: 'gpt5-mini',     label: 'GPT-5 mini',        provider: 'openai',    tier: 'standard', in: 25,  out: 200 },
  'gpt5-nano':     { id: 'gpt5-nano',     label: 'GPT-5 nano',        provider: 'openai',    tier: 'economy',  in: 5,   out: 40 },
  'gemini-pro':    { id: 'gemini-pro',    label: 'Gemini 2.5 Pro',    provider: 'gemini',    tier: 'premium',  in: 125, out: 1000 },
  'gemini-flash':  { id: 'gemini-flash',  label: 'Gemini 2.5 Flash',  provider: 'gemini',    tier: 'economy',  in: 30,  out: 250 },
  'qwen-plus':     { id: 'qwen-plus',     label: 'Qwen3 Plus',        provider: 'qwen',      tier: 'standard', in: 40,  out: 120 },
  'qwen-max':      { id: 'qwen-max',      label: 'Qwen3 Max',         provider: 'qwen',      tier: 'premium',  in: 120, out: 600 },
  'minimax-m2':    { id: 'minimax-m2',    label: 'MiniMax M2',        provider: 'minimax',   tier: 'standard', in: 30,  out: 120 },
  'kimi-k2':       { id: 'kimi-k2',       label: 'Kimi K2',           provider: 'kimi',      tier: 'standard', in: 60,  out: 250 },
});
export const MODEL_OPTIONS = ['auto', ...Object.keys(MODELS)];

/** Tool services: credits per unit (illustrative). */
export const TOOLS = Object.freeze({
  brave:       { id: 'brave',       label: 'Brave Search', unit: 'request', price: 0.5 },
  firecrawl:   { id: 'firecrawl',   label: 'Firecrawl',    unit: 'page',    price: 0.1 },
  browserbase: { id: 'browserbase', label: 'Browserbase',  unit: 'minute',  price: 1.0 },
  llamaparse:  { id: 'llamaparse',  label: 'LlamaParse',   unit: 'page',    price: 0.3 },
  pdfco:       { id: 'pdfco',       label: 'PDF.co',       unit: 'request', price: 0.2 },
});

/** Typical token volume used for estimates before a call is made. */
export const TYPICAL = Object.freeze({ inputTokens: 1400, outputTokens: 450 });

export const estimateModel = (m, tin = TYPICAL.inputTokens, tout = TYPICAL.outputTokens) => (tin * m.in + tout * m.out) / 1e6;
export const estimateTool = (t, units = 1) => t.price * Math.max(0, units);
export const modelsFor = (providerId) => Object.values(MODELS).filter((m) => m.provider === providerId);
export const toolByLabel = (label) => Object.values(TOOLS).find((t) => t.label === label) || null;
export const creditsToUsd = (c) => c * RATE_USD_PER_CREDIT;

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
