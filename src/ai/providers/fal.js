// ai/providers/fal.js — images, video and audio through fal.ai's queue API.
//   POST https://queue.fal.run/{model}                       → { request_id, status_url, response_url, cancel_url }
//   GET  {status_url}?logs=1                                  → { status: IN_QUEUE | IN_PROGRESS | COMPLETED, queue_position?, logs: [{ message, level, timestamp }] }
//   GET  {response_url}                                       → the model's output (images[], video, audio_file / audio, seed, timings…)
//   PUT  {cancel_url}                                         → cancels a queued request
// Header: Authorization: Key <FAL_KEY>. The status / response / cancel URLs come back from the
// submit call (for a model like fal-ai/flux/schnell they live under the app alias
// https://queue.fal.run/fal-ai/flux/requests/{id}/…); when they are missing they are rebuilt
// from the first two path segments of the model id.
// The curated list below (ids, input fields, prices) is from memory of fal's public catalogue;
// the docs were not reachable from the build environment, so every entry is marked
// `unverified: true` until someone runs it — prices are approximate USD, per run unless noted.
import { registerProvider } from './base.js';
import { request, requestJSON, sleep, ProviderError } from '../http.js';

const QUEUE = 'https://queue.fal.run';
const LABEL = 'fal.ai';
const headers = (key) => ({ Authorization: `Key ${key}` });

const SIZE = { key: 'image_size', label: 'size', type: 'select', options: ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'], default: 'landscape_4_3' };
const ASPECT = { key: 'aspect_ratio', label: 'aspect', type: 'select', options: ['16:9', '9:16', '1:1'], default: '16:9' };
const SEED = { key: 'seed', label: 'seed (blank = random)', type: 'number', default: null, min: 0, step: 1 };
const COUNT = { key: 'num_images', label: 'count', type: 'number', default: 1, min: 1, max: 4, step: 1 };
/** Curated models: id, label, kind, schema-driven params, approximate price and the field that carries the prompt. */
export const FAL_MODELS = [
  { id: 'fal-ai/flux/schnell', label: 'FLUX.1 schnell', kind: 'image', price: 0.003, priceText: '$0.003 / image', recommended: true, unverified: true, note: 'fast, 4 steps', params: [SIZE, COUNT, SEED, { key: 'num_inference_steps', label: 'steps', type: 'number', default: 4, min: 1, max: 12, step: 1 }] },
  { id: 'fal-ai/flux/dev', label: 'FLUX.1 dev', kind: 'image', price: 0.025, priceText: '$0.025 / image', unverified: true, params: [SIZE, COUNT, SEED, { key: 'guidance_scale', label: 'guidance', type: 'number', default: 3.5, min: 1, max: 20, step: 0.5 }] },
  { id: 'fal-ai/flux-pro/v1.1', label: 'FLUX 1.1 pro', kind: 'image', price: 0.04, priceText: '$0.04 / image', recommended: true, unverified: true, params: [SIZE, COUNT, SEED, { key: 'safety_tolerance', label: 'safety tolerance', type: 'select', options: ['1', '2', '3', '4', '5'], default: '2' }] },
  { id: 'fal-ai/flux-pro/v1.1-ultra', label: 'FLUX 1.1 pro ultra', kind: 'image', price: 0.06, priceText: '$0.06 / image', unverified: true, params: [ASPECT, COUNT, SEED, { key: 'raw', label: 'raw (less processed)', type: 'boolean', default: false }] },
  { id: 'fal-ai/recraft-v3', label: 'Recraft V3', kind: 'image', price: 0.04, priceText: '$0.04 / image', unverified: true, note: 'design and vector styles', params: [SIZE, { key: 'style', label: 'style', type: 'select', options: ['realistic_image', 'digital_illustration', 'vector_illustration'], default: 'digital_illustration' }] },
  { id: 'fal-ai/ideogram/v2', label: 'Ideogram 2', kind: 'image', price: 0.08, priceText: '$0.08 / image', unverified: true, note: 'strong at text in images', params: [ASPECT, { key: 'style', label: 'style', type: 'select', options: ['auto', 'general', 'realistic', 'design', 'render_3D', 'anime'], default: 'auto' }, SEED] },
  { id: 'fal-ai/flux/dev/image-to-image', label: 'FLUX.1 dev · image to image', kind: 'image', price: 0.03, priceText: '$0.03 / image', unverified: true, needsReference: true, referenceField: 'image_url', params: [{ key: 'strength', label: 'strength', type: 'number', default: 0.85, min: 0, max: 1, step: 0.05 }, COUNT, SEED] },

  { id: 'fal-ai/minimax/video-01', label: 'MiniMax video-01', kind: 'video', price: 0.5, priceText: '≈ $0.50 / clip (6 s)', recommended: true, unverified: true, seconds: 6, params: [{ key: 'prompt_optimizer', label: 'prompt optimizer', type: 'boolean', default: true }] },
  { id: 'fal-ai/kling-video/v1.5/pro/text-to-video', label: 'Kling 1.5 pro', kind: 'video', price: 0.095, perSecond: true, priceText: '≈ $0.095 / s', unverified: true, seconds: 5, params: [{ key: 'duration', label: 'duration (s)', type: 'select', options: ['5', '10'], default: '5' }, ASPECT] },
  { id: 'fal-ai/luma-dream-machine', label: 'Luma Dream Machine', kind: 'video', price: 0.5, priceText: '≈ $0.50 / clip', unverified: true, seconds: 5, params: [ASPECT, { key: 'loop', label: 'loop', type: 'boolean', default: false }] },
  { id: 'fal-ai/hunyuan-video', label: 'Hunyuan Video', kind: 'video', price: 0.4, priceText: '≈ $0.40 / clip', unverified: true, seconds: 5, params: [ASPECT, { key: 'num_inference_steps', label: 'steps', type: 'number', default: 30, min: 10, max: 50, step: 5 }, SEED] },
  { id: 'fal-ai/wan/v2.1/1.3b/text-to-video', label: 'Wan 2.1 (1.3B)', kind: 'video', price: 0.2, priceText: '≈ $0.20 / clip', unverified: true, seconds: 5, params: [ASPECT, SEED] },
  { id: 'fal-ai/minimax/video-01/image-to-video', label: 'MiniMax · image to video', kind: 'video', price: 0.5, priceText: '≈ $0.50 / clip', unverified: true, needsReference: true, referenceField: 'image_url', seconds: 6, params: [] },

  { id: 'fal-ai/stable-audio', label: 'Stable Audio (music / sfx)', kind: 'audio', price: 0.02, priceText: '≈ $0.02 / clip', recommended: true, unverified: true, params: [{ key: 'seconds_total', label: 'length (s)', type: 'number', default: 20, min: 1, max: 47, step: 1 }, { key: 'steps', label: 'steps', type: 'number', default: 100, min: 10, max: 200, step: 10 }] },
  { id: 'fal-ai/kokoro/american-english', label: 'Kokoro TTS (en-US)', kind: 'audio', price: 0.01, priceText: '≈ $0.01 / run', unverified: true, note: 'text to speech', params: [{ key: 'voice', label: 'voice', type: 'select', options: ['af_heart', 'af_bella', 'af_nova', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'], default: 'af_heart' }, { key: 'speed', label: 'speed', type: 'number', default: 1, min: 0.5, max: 2, step: 0.1 }] },
  { id: 'fal-ai/f5-tts', label: 'F5 TTS (voice clone)', kind: 'audio', price: 0.05, priceText: '≈ $0.05 / run', unverified: true, needsReference: true, referenceField: 'ref_audio_url', promptField: 'gen_text', note: 'needs a reference voice clip', params: [{ key: 'model_type', label: 'model', type: 'select', options: ['F5-TTS', 'E2-TTS'], default: 'F5-TTS' }, { key: 'remove_silence', label: 'remove silence', type: 'boolean', default: true }] },
  { id: 'fal-ai/elevenlabs/tts/multilingual-v2', label: 'ElevenLabs multilingual v2', kind: 'audio', price: 0.1, priceText: '≈ $0.10 / run', unverified: true, promptField: 'text', params: [{ key: 'voice', label: 'voice', type: 'text', default: 'Rachel' }, { key: 'stability', label: 'stability', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 }] },
];
const byId = new Map(FAL_MODELS.map((m) => [m.id, m]));
export const falModel = (id) => byId.get(id) || null;
const toInfo = (m) => ({ id: m.id, label: m.label, kind: m.kind, provider: 'fal', pricing: { run: m.price, perSecond: !!m.perSecond, text: m.priceText }, params: m.params, recommended: !!m.recommended, note: m.note || '', unverified: !!m.unverified, needsReference: !!m.needsReference });

/** Build the request body from a spec: prompt field + schema params + optional reference URL. */
function buildInput(spec) {
  const m = byId.get(spec.model) || {};
  const input = {};
  input[m.promptField || 'prompt'] = spec.prompt || '';
  for (const p of m.params || []) {
    const v = spec.options?.[p.key];
    if (v === undefined || v === null || v === '') continue;
    input[p.key] = p.type === 'number' ? +v : p.type === 'select' && /^\d+$/.test(String(p.default ?? '')) ? String(v) : v;
  }
  if (spec.reference?.src && m.referenceField) input[m.referenceField] = spec.reference.src;
  if (spec.seed !== undefined && spec.seed !== null && spec.seed !== '') input.seed = +spec.seed;
  if (spec.count && m.kind === 'image' && !('num_images' in input)) input.num_images = spec.count;
  return input;
}
/** Normalise any fal output into `[{ kind, src, w?, h?, duration?, mime? }]`. */
function pickMedia(kind, out) {
  const list = [];
  if (!out) return list;
  const push = (f) => { if (f && typeof f.url === 'string') list.push({ kind, src: f.url, w: f.width, h: f.height, mime: f.content_type, duration: f.duration }); };
  if (kind === 'image') { (out.images || out.image ? [out.image].filter(Boolean) : []).forEach(push); (out.images || []).forEach(push); }
  if (kind === 'video') { push(out.video); (out.videos || []).forEach(push); }
  if (kind === 'audio') { push(out.audio_file); push(out.audio); push(out.audio_url && { url: out.audio_url }); (out.audios || []).forEach(push); }
  return list;
}
const appAlias = (model) => model.split('/').slice(0, 2).join('/');

export const fal = registerProvider({
  id: 'fal', label: LABEL, url: 'https://fal.ai', keyUrl: 'https://fal.ai/dashboard/keys',
  description: 'Fast hosted image, video and audio models (FLUX, Kling, MiniMax, Stable Audio…) through one queue API that reports progress and logs.',
  glyph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 16V9a3 3 0 013-3h1M6.5 12h5M14.5 16v-6l3 6v-6"/></svg>',
  capabilities: ['image', 'video', 'audio'], keyHint: 'key_id:key_secret', needsKey: true,
  corsNote: 'fal.ai accepts browser requests with the key in the Authorization header; if your network blocks queue.fal.run, set a proxy URL.',
  models: FAL_MODELS,
  defaultModel: { image: 'fal-ai/flux/schnell', video: 'fal-ai/minimax/video-01', audio: 'fal-ai/stable-audio' },

  async testKey({ key, proxy, signal }) {
    // no dedicated "who am I" endpoint in the queue API: a request for a status that does not exist
    // still proves the key (401 / 403 for a bad key; 404 / 422 for a good one)
    const t0 = performance.now();
    try {
      await requestJSON(`${QUEUE}/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status`, { headers: headers(key), proxy, signal, label: LABEL, timeout: 15000 });
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'auth') throw e;
      if (e instanceof ProviderError && (e.code === 'cors' || e.code === 'network' || e.code === 'timeout')) throw e;
      // 404 / 422 = reachable and authorised
    }
    return { ok: true, latencyMs: Math.round(performance.now() - t0), balance: null, message: 'key accepted (fal does not expose the balance to the API)' };
  },
  async listModels({ kind } = {}) { return FAL_MODELS.filter((m) => !kind || m.kind === kind).map(toInfo); },
  modelInfo(id) { const m = byId.get(id); return m ? toInfo(m) : null; },
  estimateCost(spec) {
    const m = byId.get(spec.model); if (!m) return null;
    if (m.perSecond) return m.price * (+spec.options?.duration || m.seconds || 5);
    if (m.kind === 'image') return m.price * Math.max(1, +spec.options?.num_images || spec.count || 1);
    return m.price;
  },

  /**
   * spec = { kind, model, prompt, options: { [param]: value }, reference?: media, count?, seed? }
   * → { media: [{ kind, src, w, h, duration }], raw, seed?, cost }
   */
  async run(spec, job, { key, proxy, signal }) {
    const model = spec.model;
    const input = buildInput(spec);
    job.update({ stage: 'submitting', log: `POST ${QUEUE}/${model}` });
    const sub = await requestJSON(`${QUEUE}/${model}`, { method: 'POST', headers: headers(key), body: input, proxy, signal, label: LABEL, timeout: 30000 });
    const id = sub.request_id;
    if (!id) throw new ProviderError('parse', 'fal.ai did not return a request id');
    const statusUrl = sub.status_url || `${QUEUE}/${appAlias(model)}/requests/${id}/status`;
    const responseUrl = sub.response_url || `${QUEUE}/${appAlias(model)}/requests/${id}`;
    const cancelUrl = sub.cancel_url || `${QUEUE}/${appAlias(model)}/requests/${id}/cancel`;
    job.requestId = id;
    job.update({ stage: 'queued', progress: 0.05, log: `request ${id}` });
    const onAbort = () => { request(cancelUrl, { method: 'PUT', headers: headers(key), proxy, label: LABEL, timeout: 8000 }).catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    let delay = 700, seenLogs = 0, t0 = Date.now();
    const expect = (byId.get(model)?.kind === 'image' ? 8 : byId.get(model)?.kind === 'audio' ? 25 : 90) * 1000;   // typical duration for the progress guess
    try {
      for (;;) {
        await sleep(delay, signal);
        const st = await requestJSON(`${statusUrl}${statusUrl.includes('?') ? '&' : '?'}logs=1`, { headers: headers(key), proxy, signal, label: LABEL, timeout: 20000 });
        const logs = Array.isArray(st.logs) ? st.logs : [];
        for (const l of logs.slice(seenLogs)) job.update({ log: l.message || JSON.stringify(l) });
        seenLogs = logs.length;
        if (st.status === 'IN_QUEUE') job.update({ stage: 'queued', queuePosition: typeof st.queue_position === 'number' ? st.queue_position + 1 : null, progress: 0.08 });
        else if (st.status === 'IN_PROGRESS') { const pct = logs.map((l) => /(\d{1,3})%/.exec(l.message || '')).filter(Boolean).map((m) => +m[1] / 100).pop(); job.update({ stage: 'generating', queuePosition: null, progress: pct !== undefined ? 0.1 + 0.85 * pct : Math.min(0.9, 0.1 + 0.8 * (Date.now() - t0) / expect) }); }
        else if (st.status === 'COMPLETED') break;
        else if (st.status === 'FAILED' || st.error) throw new ProviderError('server', `fal.ai failed the request${st.error ? `: ${st.error}` : ''}`, { fix: 'retry' });
        delay = Math.min(3000, delay * 1.25);
      }
      job.update({ stage: 'fetching result', progress: 0.95 });
      const out = await requestJSON(responseUrl, { headers: headers(key), proxy, signal, label: LABEL, timeout: 30000 });
      const kind = byId.get(model)?.kind || spec.kind;
      const media = pickMedia(kind, out);
      if (!media.length) throw new ProviderError('parse', `fal.ai returned no ${kind} (${Object.keys(out || {}).join(', ') || 'empty response'})`);
      return { media, raw: out, seed: out.seed, cost: this.estimateCost(spec) };
    } finally { signal.removeEventListener('abort', onAbort); }
  },
});
export default fal;
