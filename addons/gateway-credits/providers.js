// providers.js — provider adapters behind the gateway. Interface:
//   { id, label, kind: 'model' | 'tool', models: [modelId], estimate(params, prompt, route) → { credits, units },
//     call(params, prompt, route, opts) → Promise<{ result, usage, credits, units }> }
// Every adapter here is SIMULATED: random latency (300–1500 ms), token counts derived from the
// prompt length, and an optional 10% failure when the fallback policy is on. Nothing in this
// file performs network I/O and no key is ever read or embedded. `params.apiKey` in 'Own key'
// mode is only checked for presence; it is never sent anywhere.
import { MODELS, TOOLS, PROVIDERS, estimateModel, estimateTool, TYPICAL } from './rates.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const approxTokens = (text) => Math.max(8, Math.ceil(String(text || '').length / 4));

/* ------------------------------------------------------------------------------------------
 * REAL GATEWAY SEAM — where the simulated adapters would be replaced.
 * A production add-on would post to your own gateway service, which holds the vaulted
 * provider keys, applies the rate card, writes the ledger and forwards to the provider:
 *
 *   async function gatewayCall(route, body, { idempotencyKey, gatewayToken }) {
 *     const res = await fetch(`${GATEWAY_URL}/v1/call`, {
 *       method: 'POST',
 *       headers: { 'content-type': 'application/json', authorization: `Bearer ${gatewayToken}`, 'idempotency-key': idempotencyKey },
 *       body: JSON.stringify({ provider: route.provider, model: route.model, input: body }),
 *     });
 *     if (!res.ok) throw Object.assign(new Error(`gateway ${res.status}`), { status: res.status });
 *     return res.json();   // { result, usage: { inputTokens, outputTokens } | { units }, credits }
 *   }
 *
 * The gateway token is scoped to this workspace's balance; provider keys never reach the page.
 * This demo never calls it. `REAL_GATEWAY_URL` stays null on purpose.
 * ---------------------------------------------------------------------------------------- */
export const REAL_GATEWAY_URL = null;

function simulatedModelAdapter(providerId) {
  const p = PROVIDERS[providerId];
  return {
    id: providerId, label: p.label, kind: 'model', simulated: true,
    models: Object.values(MODELS).filter((m) => m.provider === providerId).map((m) => m.id),
    estimate(params, prompt, route) {
      const m = route?.model; if (!m) return { credits: 0, units: '—' };
      const tin = prompt ? approxTokens(prompt) + 120 : TYPICAL.inputTokens;
      return { credits: estimateModel(m, tin, TYPICAL.outputTokens), units: `est. ${tin.toLocaleString()} in / ${TYPICAL.outputTokens} out` };
    },
    async call(params, prompt, route, opts = {}) {
      const m = route.model;
      await sleep(rnd(300, 1500));
      if (opts.simulateFailure && Math.random() < 0.10) throw Object.assign(new Error(`${p.label} 503 (simulated provider error)`), { status: 503, retryable: true });
      const tin = (prompt ? approxTokens(prompt) + 120 : rndi(400, 2500));
      const tout = rndi(120, 800);
      const credits = estimateModel(m, tin, tout);
      const src = String(prompt || '').trim();
      const result = opts.mode === 'own-key'
        ? `[${m.label} via own key] ${summarise(src, params)}`
        : `[${m.label}] ${summarise(src, params)}`;
      return { result, usage: { inputTokens: tin, outputTokens: tout }, units: `${tin.toLocaleString()} in / ${tout.toLocaleString()} out`, credits };
    },
  };
}
function summarise(src, params) {
  const seed = src ? src.slice(0, 80).replace(/\s+/g, ' ') : 'the incoming ticket';
  const verbs = ['Summary', 'Draft reply', 'Key points', 'Suggested answer'];
  const v = verbs[Math.abs(hash(seed + (params?.tier || ''))) % verbs.length];
  return `${v}: ${seed}${src.length > 80 ? '…' : ''} — simulated output, no real provider was called.`;
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function simulatedToolAdapter(toolId) {
  const t = TOOLS[toolId], p = PROVIDERS[toolId];
  return {
    id: toolId, label: p.label, kind: 'tool', simulated: true, models: [], unit: t.unit,
    estimate(params) { const units = Math.max(1, Math.round(Number(params.units) || 1)); return { credits: estimateTool(t, units), units: `${units} ${t.unit}${units > 1 ? 's' : ''}` }; },
    async call(params, query, route, opts = {}) {
      await sleep(rnd(300, 1200));
      if (opts.simulateFailure && Math.random() < 0.05) throw Object.assign(new Error(`${p.label} 429 (simulated rate limit)`), { status: 429, retryable: true });
      const units = Math.max(1, Math.round(Number(params.units) || 1));
      const q = String(query || '').trim().slice(0, 60) || 'ticket keywords';
      const result = `[${p.label}] ${units} ${t.unit}${units > 1 ? 's' : ''} for "${q}": 3 simulated results (no network call was made).`;
      return { result, usage: { units }, units: `${units} ${t.unit}${units > 1 ? 's' : ''}`, credits: estimateTool(t, units) };
    },
  };
}

/** Registry of adapters by provider / service id. Missing entries make a node ineligible. */
export const adapters = new Map();
for (const p of Object.values(PROVIDERS)) adapters.set(p.id, p.kind === 'model' ? simulatedModelAdapter(p.id) : simulatedToolAdapter(p.id));

export const adapterFor = (providerId) => adapters.get(providerId) || null;
