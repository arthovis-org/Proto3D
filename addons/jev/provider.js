// provider.js — registers TypeSafe Jev with the core's provider registry so the Connections page
// shows a card (key field, Test, optional proxy) with nothing changed in the core. `capabilities`
// is empty on purpose: Jev generates nothing, so no Generate component ever lists it
// (`providerRegistry.forKind(kind)` filters on capabilities). The jev-* components read the key
// through the vault like any adapter would.
import { registerProvider } from '../../src/ai/providers/base.js';
import { callSystemOne, PRICE_PER_M, PROVIDER_ID } from './jev-client.js';

export const JEV_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h5"/><path d="M9 12c3 0 3-6 6-6h5"/><path d="M9 12c3 0 3 6 6 6h5"/><circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="18" r="1.6" fill="currentColor" stroke="none" opacity=".45"/></svg>';

export default registerProvider({
  id: PROVIDER_ID,
  label: 'TypeSafe Jev',
  description: 'System One decision model: typed answers with probabilities, no text generation. Routes, gates, scores and ranks in 70–500 ms for $0.042 per million input tokens.',
  url: 'https://typesafe.ai',
  keyUrl: 'https://console.typesafe.ai/keys',
  glyph: JEV_GLYPH,
  capabilities: [],
  needsKey: true,
  keyHint: 'ts-…',
  corsNote: 'If the browser blocks the call (CORS), set a proxy URL; the repo ships proxy/cloudflare-worker.js.',
  async testKey({ key, proxy, signal }) {
    const t0 = performance.now();
    const r = await callSystemOne({ state: 'ping', model: 'jev-latest', questions: { ok: { type: 'noul', instructions: 'Is this a ping?' } } }, { key, proxy, signal });
    const ms = Math.round(performance.now() - t0);
    return { ok: true, latencyMs: ms, message: `${r.model || 'jev'} answered in ${ms} ms` };
  },
  async listModels() { return []; },
  /** Cost of a decision spec { state, questions }: ~4 characters per input token, output free. */
  estimateCost(spec) { const chars = JSON.stringify({ state: spec?.state ?? '', questions: spec?.questions ?? {} }).length; return (chars / 4) / 1e6 * PRICE_PER_M; },
});
