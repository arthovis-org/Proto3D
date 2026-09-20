// ai/providers/openrouter.js — text (and vision) through OpenRouter's OpenAI-compatible API.
//   POST https://openrouter.ai/api/v1/chat/completions   streaming SSE (`data: {...}`, `: OPENROUTER PROCESSING`
//                                                        comment lines, `data: [DONE]`), usage in the last chunk
//                                                        when `usage: { include: true }` is sent
//   GET  https://openrouter.ai/api/v1/models             every model with pricing (USD per token, strings),
//                                                        context_length, architecture.input_modalities
//   GET  https://openrouter.ai/api/v1/auth/key           the key's label, usage, limit, limit_remaining
//   GET  https://openrouter.ai/api/v1/credits            total_credits / total_usage (newer accounts)
// Headers: Authorization: Bearer <key>, HTTP-Referer (this page), X-Title (Proto3D) — OpenRouter
// uses them for attribution. Vision inputs are `image_url` content parts; JSON mode is
// `response_format: { type: 'json_object' }`.
// The endpoint shapes above follow OpenRouter's public docs as of this writing; the docs were
// not reachable from the build environment, so treat field names as "verified by use", not by
// re-reading the docs (see docs/AI-GENERATION.md).
import { registerProvider } from './base.js';
import { request, requestJSON, readSSE, ProviderError } from '../http.js';
import { textCost, estimateTokens } from '../pricing.js';

const BASE = 'https://openrouter.ai/api/v1';
const LABEL = 'OpenRouter';
const headers = (key) => ({
  Authorization: `Bearer ${key}`,
  'HTTP-Referer': typeof location !== 'undefined' ? location.origin + location.pathname : 'https://arthovis-org.github.io/Proto3D/',
  'X-Title': 'Proto3D',
});

/** A few good defaults that get a "recommended" badge in the model browser. */
export const RECOMMENDED = new Set(['anthropic/claude-sonnet-4', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'openai/gpt-4.1-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat-v3-0324', 'mistralai/mistral-small-3.2-24b-instruct']);
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';
let modelCache = { at: 0, list: null };

function toModelInfo(m) {
  const inMods = m.architecture?.input_modalities || (m.architecture?.modality || 'text').split('->')[0].split('+');
  return {
    id: m.id, label: m.name || m.id, kind: 'text', provider: 'openrouter',
    pricing: { prompt: +m.pricing?.prompt || 0, completion: +m.pricing?.completion || 0, image: +m.pricing?.image || 0 },
    context: m.context_length || m.top_provider?.context_length || 0,
    vision: inMods.includes('image'), json: true,   // every chat model takes response_format; models that ignore it still answer and the parser has a {…} fallback
    recommended: RECOMMENDED.has(m.id), created: m.created || 0, description: m.description || '',
  };
}

export const openrouter = registerProvider({
  id: 'openrouter', label: LABEL, url: 'https://openrouter.ai', keyUrl: 'https://openrouter.ai/settings/keys',
  description: 'One key for hundreds of language models (OpenAI, Anthropic, Google, Meta, Mistral…) with live per-token pricing and streaming.',
  glyph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4c3 0 3-5 6-5h2M3 12h4c3 0 3 5 6 5h2"/><path d="M15 4l4 3-4 3M15 14l4 3-4 3"/></svg>',
  capabilities: ['text', 'vision', 'json'], keyHint: 'sk-or-v1-…', needsKey: true,
  corsNote: 'OpenRouter answers browser requests directly (CORS enabled); a proxy is only needed on a locked-down network.',
  defaultModel: DEFAULT_MODEL,

  async testKey({ key, proxy, signal }) {
    const t0 = performance.now();
    const r = await requestJSON(`${BASE}/auth/key`, { headers: headers(key), proxy, signal, label: LABEL, timeout: 15000 });
    const d = r.data || r;
    const latencyMs = Math.round(performance.now() - t0);
    let balance = null;
    if (typeof d.limit_remaining === 'number') balance = d.limit_remaining;
    else if (typeof d.limit === 'number' && typeof d.usage === 'number') balance = d.limit - d.usage;
    if (balance === null) {
      try { const c = await requestJSON(`${BASE}/credits`, { headers: headers(key), proxy, signal, label: LABEL, timeout: 15000 }); const cd = c.data || c; if (typeof cd.total_credits === 'number') balance = cd.total_credits - (cd.total_usage || 0); } catch (_) { /* optional */ }
    }
    return { ok: true, latencyMs, balance, label: d.label || '', message: `${d.label ? d.label + ' · ' : ''}${typeof d.usage === 'number' ? `used $${d.usage.toFixed(2)}` : ''}${d.is_free_tier ? ' · free tier' : ''}`.trim() };
  },

  async listModels({ key, proxy, signal, force = false } = {}) {
    if (!force && modelCache.list && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.list;
    const r = await requestJSON(`${BASE}/models`, { headers: key ? headers(key) : {}, proxy, signal, label: LABEL, timeout: 20000 });
    const list = (r.data || []).filter((m) => (m.architecture?.output_modalities || ['text']).includes('text')).map(toModelInfo);
    modelCache = { at: Date.now(), list };
    return list;
  },
  /** Cached list (may be null before the first fetch). */
  cachedModels() { return modelCache.list; },
  modelInfo(id) { return modelCache.list?.find((m) => m.id === id) || null; },

  estimateCost(spec) {
    const m = this.modelInfo(spec.model);
    if (!m) return null;
    const inTok = estimateTokens((spec.system || '') + (spec.prompt || '') + (spec.context || '')) + (spec.images?.length || 0) * 1000;
    const outTok = Math.min(spec.maxTokens || 1024, 1024);
    return inTok * m.pricing.prompt + outTok * m.pricing.completion;
  },

  /**
   * spec = { kind: 'text', model, prompt, system?, context?, images?: [url], temperature?, maxTokens?, json? }
   * → { text, data?, usage: { prompt_tokens, completion_tokens, total_tokens }, cost, model, finish }
   */
  async run(spec, job, { key, proxy, signal }) {
    const content = spec.images?.length
      ? [{ type: 'text', text: spec.prompt || '' }, ...spec.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : spec.prompt || '';
    const messages = [];
    const sys = [spec.system, spec.context ? `Context:\n${spec.context}` : ''].filter(Boolean).join('\n\n');
    if (sys) messages.push({ role: 'system', content: sys });
    messages.push({ role: 'user', content });
    const body = { model: spec.model, messages, stream: true, usage: { include: true }, stream_options: { include_usage: true } };
    if (spec.temperature !== undefined) body.temperature = spec.temperature;
    if (spec.maxTokens) body.max_tokens = spec.maxTokens;
    if (spec.json) body.response_format = { type: 'json_object' };
    job.update({ stage: 'connecting', log: `POST chat/completions · ${spec.model}` });
    const res = await request(`${BASE}/chat/completions`, { method: 'POST', headers: { ...headers(key), 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), proxy, signal, label: LABEL, timeout: 0 });
    let text = '', usage = null, finish = null, model = spec.model, first = true;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('event-stream')) {
      // some proxies / models answer without streaming: read the whole JSON
      const j = await res.json();
      if (j.error) throw new ProviderError('bad-request', j.error.message || 'OpenRouter returned an error');
      text = j.choices?.[0]?.message?.content || ''; usage = j.usage || null; finish = j.choices?.[0]?.finish_reason || null; model = j.model || model;
    } else {
      await readSSE(res, (data) => {
        let j; try { j = JSON.parse(data); } catch (_) { return; }
        if (j.error) throw new ProviderError('bad-request', j.error.message || 'OpenRouter returned an error in the stream');
        if (first) { first = false; job.update({ stage: 'streaming', progress: 0.1 }); }
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { text += delta; job.update({ partial: text, progress: Math.min(0.9, 0.1 + text.length / Math.max(400, (spec.maxTokens || 512) * 3)) }); }
        if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
        if (j.usage) usage = j.usage;
        if (j.model) model = j.model;
      }, signal);
    }
    const info = this.modelInfo(model) || this.modelInfo(spec.model);
    const cost = typeof usage?.cost === 'number' ? usage.cost : textCost(usage, info?.pricing);
    let data;
    if (spec.json) { try { data = JSON.parse(text); } catch (_) { const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (m) { try { data = JSON.parse(m[0]); } catch (_) { /* leave undefined */ } } } }
    job.update({ tokens: usage ? { in: usage.prompt_tokens || 0, out: usage.completion_tokens || 0 } : null, cost: cost ?? null, log: usage ? `${usage.prompt_tokens} in · ${usage.completion_tokens} out` : 'done' });
    return { text, data, usage, cost: cost ?? null, model, finish };
  },
});
export default openrouter;
