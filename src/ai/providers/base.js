// ai/providers/base.js — the adapter interface every provider implements, and the provider
// registry. A provider is a plain object:
//
//   {
//     id, label, description, url (site), keyUrl (where to get a key), glyph (inline SVG),
//     capabilities: ['text' | 'vision' | 'json' | 'image' | 'video' | 'audio'],
//     keyHint: 'sk-or-v1-…',            // what a key looks like (Connections placeholder)
//     needsKey: true,                    // false for Demo
//     corsNote: '…',                     // when a proxy is needed, in one sentence
//     async testKey({ key, proxy, signal }) → { ok, latencyMs, balance?, label?, message? }
//     async listModels({ key, proxy, kind, signal }) → [ModelInfo]
//     estimateCost(spec, model) → USD | null
//     async run(spec, job, { key, proxy, signal }) → result   // reports through job.update(...)
//   }
//   ModelInfo = { id, label, kind: 'text'|'image'|'video'|'audio', provider, pricing: {…},
//                 context?, vision?, json?, recommended?, params?: [{ key, label, type, options?, default, min?, max?, step? }],
//                 price?: 'per image' text, note? }
//
// `createJob(spec)` is what components call: it checks the key, creates a Job in the global
// queue and returns it. `spec` is provider-specific but always carries `model`, `prompt` and
// `kind`; the components build it from their params (see components/generate/common.js).
import { vault } from '../vault.js';
import { jobs } from '../jobs.js';
import { ProviderError } from '../http.js';

const providers = new Map();
export const CAPABILITIES = ['text', 'vision', 'json', 'image', 'video', 'audio'];

export function registerProvider(p) {
  if (!p || !p.id) throw new Error('registerProvider: id required');
  const def = {
    label: p.id, description: '', url: '', keyUrl: '', glyph: '', capabilities: [], keyHint: '', needsKey: true, corsNote: '',
    async testKey() { return { ok: true }; }, async listModels() { return []; }, estimateCost() { return null; },
    ...p,
  };
  providers.set(def.id, def);
  return def;
}
export const providerRegistry = {
  get: (id) => providers.get(id) || null,
  all: () => [...providers.values()],
  ids: () => [...providers.keys()],
  /** Providers able to do a kind of generation ('text', 'image', …). */
  forKind: (kind) => [...providers.values()].filter((p) => p.capabilities.includes(kind)),
};

/** Connection status of a provider: 'demo' | 'connected' | 'missing' | 'locked'. */
export function providerStatus(id) {
  const p = providers.get(id);
  if (!p) return 'missing';
  if (!p.needsKey) return 'demo';
  if (vault.locked) return 'locked';
  return vault.has(id) ? 'connected' : 'missing';
}
/** Credentials for a provider or a ProviderError('no-key') the caller shows with its fix action. */
export function credentialsFor(id) {
  const p = providers.get(id);
  if (!p) throw new ProviderError('bad-request', `Unknown provider "${id}"`);
  if (!p.needsKey) return { key: null, proxy: vault.proxyFor(id) };
  if (vault.locked) throw new ProviderError('no-key', 'The key vault is locked — enter your passphrase in Connections', { fix: 'connections' });
  const key = vault.keyFor(id);
  if (!key) throw new ProviderError('no-key', `No ${p.label} key yet — add one in Connections`, { fix: 'connections' });
  return { key, proxy: vault.proxyFor(id) };
}

/**
 * Create a job for `spec` on provider `providerId`. Throws a ProviderError synchronously when
 * there is no key, so a component can show the fix before anything is queued.
 * @returns {Job}
 */
export function createJob(providerId, spec, { owner = null, title = '', estimate = null } = {}) {
  const p = providers.get(providerId);
  if (!p) throw new ProviderError('bad-request', `Unknown provider "${providerId}"`);
  if (!p.capabilities.includes(spec.kind)) throw new ProviderError('bad-request', `${p.label} cannot generate ${spec.kind}`);
  const creds = credentialsFor(providerId);
  return jobs.create({
    provider: providerId, kind: spec.kind, spec, owner, title,
    estimate: estimate ?? p.estimateCost(spec),
    run: (job, signal) => p.run(spec, job, { ...creds, signal }),
  });
}
export { ProviderError };
