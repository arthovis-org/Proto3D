// ai/providers/kie.js — a second media adapter: kie.ai's task API (create a task, poll it).
//   POST https://api.kie.ai/api/v1/jobs/createTask          { model, input: {...}, callBackUrl? } → { code: 200, msg, data: { taskId } }
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=  → { code, data: { taskId, model, state: waiting | queuing | generating | success | fail,
//                                                                resultJson: '{"resultUrls":[…]}', failMsg, costTime, createTime } }
//   GET  https://api.kie.ai/api/v1/chat/credit               → { code, data: <credits left> }
// Header: Authorization: Bearer <key>. kie.ai's older per-product endpoints (…/veo/generate +
// …/veo/record-info, …/gpt4o-image/generate, …/flux/kontext/generate, …/generate for Suno) share the
// same create → poll rhythm; the unified "jobs" market API above is what this adapter speaks.
// The docs were not reachable from the build environment: paths, field names and prices are from
// memory of kie.ai's public docs and are marked `unverified` until run against the live API.
import { registerProvider } from './base.js';
import { requestJSON, sleep, ProviderError } from '../http.js';

const BASE = 'https://api.kie.ai/api/v1';
const LABEL = 'kie.ai';
const headers = (key) => ({ Authorization: `Bearer ${key}` });

const ASPECT = { key: 'aspect_ratio', label: 'aspect', type: 'select', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], default: '16:9' };
export const KIE_MODELS = [
  { id: 'google/nano-banana', label: 'Nano Banana (Gemini image)', kind: 'image', price: 0.02, priceText: '≈ $0.02 / image', recommended: true, unverified: true, params: [{ key: 'output_format', label: 'format', type: 'select', options: ['png', 'jpeg'], default: 'png' }, { key: 'image_size', label: 'size', type: 'select', options: ['1:1', '16:9', '9:16', '4:3', '3:4', 'auto'], default: '16:9' }] },
  { id: 'flux-2/pro-text-to-image', label: 'FLUX 2 pro', kind: 'image', price: 0.04, priceText: '≈ $0.04 / image', unverified: true, params: [ASPECT, { key: 'resolution', label: 'resolution', type: 'select', options: ['1K', '2K'], default: '1K' }] },
  { id: 'gpt-4o-image', label: 'GPT-4o image', kind: 'image', price: 0.05, priceText: '≈ $0.05 / image', unverified: true, params: [{ key: 'size', label: 'size', type: 'select', options: ['1:1', '3:2', '2:3'], default: '3:2' }] },
  { id: 'qwen/image', label: 'Qwen Image', kind: 'image', price: 0.02, priceText: '≈ $0.02 / image', unverified: true, params: [{ key: 'image_size', label: 'size', type: 'select', options: ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3'], default: 'landscape_16_9' }] },

  { id: 'google/veo3-fast', label: 'Veo 3 fast', kind: 'video', price: 0.4, priceText: '≈ $0.40 / clip (8 s)', recommended: true, unverified: true, seconds: 8, params: [{ key: 'aspect_ratio', label: 'aspect', type: 'select', options: ['16:9', '9:16'], default: '16:9' }, { key: 'generate_audio', label: 'with audio', type: 'boolean', default: true }] },
  { id: 'google/veo3', label: 'Veo 3', kind: 'video', price: 2.0, priceText: '≈ $2.00 / clip (8 s)', unverified: true, seconds: 8, params: [{ key: 'aspect_ratio', label: 'aspect', type: 'select', options: ['16:9', '9:16'], default: '16:9' }] },
  { id: 'kling/v2-1-text-to-video', label: 'Kling 2.1', kind: 'video', price: 0.35, priceText: '≈ $0.35 / clip', unverified: true, seconds: 5, params: [{ key: 'duration', label: 'duration (s)', type: 'select', options: ['5', '10'], default: '5' }, ASPECT] },
  { id: 'runway/gen-4-turbo', label: 'Runway Gen-4 turbo', kind: 'video', price: 0.25, priceText: '≈ $0.25 / clip', unverified: true, seconds: 5, params: [{ key: 'duration', label: 'duration (s)', type: 'select', options: ['5', '10'], default: '5' }, ASPECT] },
  { id: 'bytedance/seedance-v1-pro', label: 'Seedance 1 pro', kind: 'video', price: 0.3, priceText: '≈ $0.30 / clip', unverified: true, seconds: 5, params: [ASPECT, { key: 'resolution', label: 'resolution', type: 'select', options: ['480p', '720p', '1080p'], default: '720p' }] },

  { id: 'suno/v4-5', label: 'Suno v4.5 (music)', kind: 'audio', price: 0.08, priceText: '≈ $0.08 / song', recommended: true, unverified: true, params: [{ key: 'instrumental', label: 'instrumental', type: 'boolean', default: false }, { key: 'style', label: 'style', type: 'text', default: '' }, { key: 'title', label: 'title', type: 'text', default: '' }] },
  { id: 'elevenlabs/text-to-speech', label: 'ElevenLabs TTS', kind: 'audio', price: 0.03, priceText: '≈ $0.03 / run', unverified: true, promptField: 'text', params: [{ key: 'voice', label: 'voice', type: 'text', default: 'Rachel' }, { key: 'model_id', label: 'model', type: 'select', options: ['eleven_multilingual_v2', 'eleven_turbo_v2_5'], default: 'eleven_multilingual_v2' }] },
];
const byId = new Map(KIE_MODELS.map((m) => [m.id, m]));
const toInfo = (m) => ({ id: m.id, label: m.label, kind: m.kind, provider: 'kie', pricing: { run: m.price, text: m.priceText }, params: m.params, recommended: !!m.recommended, note: m.note || '', unverified: !!m.unverified, needsReference: !!m.needsReference });

function buildInput(spec) {
  const m = byId.get(spec.model) || {};
  const input = { [m.promptField || 'prompt']: spec.prompt || '' };
  for (const p of m.params || []) { const v = spec.options?.[p.key]; if (v !== undefined && v !== null && v !== '') input[p.key] = p.type === 'number' ? +v : v; }
  if (spec.reference?.src) input.image_urls = [spec.reference.src];
  if (spec.seed !== undefined && spec.seed !== null && spec.seed !== '') input.seed = +spec.seed;
  return input;
}
const check = (r) => { if (r && typeof r.code === 'number' && r.code !== 200) { const msg = r.msg || r.message || `code ${r.code}`; if (r.code === 401 || r.code === 403) throw new ProviderError('auth', `kie.ai rejected the key (${msg})`, { fix: 'connections' }); if (r.code === 402) throw new ProviderError('auth', `kie.ai: not enough credits (${msg})`, { fix: 'connections' }); if (r.code === 429) throw new ProviderError('rate', `kie.ai is rate-limiting (${msg})`, { fix: 'retry' }); throw new ProviderError('bad-request', `kie.ai: ${msg}`); } return r; };

export const kie = registerProvider({
  id: 'kie', label: LABEL, url: 'https://kie.ai', keyUrl: 'https://kie.ai/api-key',
  description: 'Prepaid credits for image, video and music models (Veo, Kling, Nano Banana, Suno…) through a create-task / poll API.',
  glyph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v16M5 12l8-8M5 12l8 8"/><circle cx="18" cy="12" r="2.4"/></svg>',
  capabilities: ['image', 'video', 'audio'], keyHint: 'kie key', needsKey: true,
  corsNote: 'kie.ai may not send CORS headers for browser callers; if the Test button reports a blocked request, deploy the proxy worker and put its URL here.',
  models: KIE_MODELS,
  defaultModel: { image: 'google/nano-banana', video: 'google/veo3-fast', audio: 'suno/v4-5' },

  async testKey({ key, proxy, signal }) {
    const t0 = performance.now();
    const r = check(await requestJSON(`${BASE}/chat/credit`, { headers: headers(key), proxy, signal, label: LABEL, timeout: 15000 }));
    const credits = typeof r.data === 'number' ? r.data : typeof r.data?.credits === 'number' ? r.data.credits : null;
    return { ok: true, latencyMs: Math.round(performance.now() - t0), balance: credits, balanceUnit: 'credits', message: credits !== null ? `${credits} credits left` : 'key accepted' };
  },
  async listModels({ kind } = {}) { return KIE_MODELS.filter((m) => !kind || m.kind === kind).map(toInfo); },
  modelInfo(id) { const m = byId.get(id); return m ? toInfo(m) : null; },
  estimateCost(spec) { const m = byId.get(spec.model); return m ? m.price * (m.kind === 'image' ? Math.max(1, spec.count || 1) : 1) : null; },

  async run(spec, job, { key, proxy, signal }) {
    const model = spec.model;
    job.update({ stage: 'submitting', log: `POST jobs/createTask · ${model}` });
    const r = check(await requestJSON(`${BASE}/jobs/createTask`, { method: 'POST', headers: headers(key), body: { model, input: buildInput(spec) }, proxy, signal, label: LABEL, timeout: 30000 }));
    const taskId = r.data?.taskId || r.data?.task_id || r.taskId;
    if (!taskId) throw new ProviderError('parse', 'kie.ai did not return a task id');
    job.requestId = taskId;
    job.update({ stage: 'queued', progress: 0.05, log: `task ${taskId}` });
    let delay = 1500; const t0 = Date.now(); const expect = (byId.get(model)?.kind === 'image' ? 20 : 120) * 1000;
    for (;;) {
      await sleep(delay, signal);
      const st = check(await requestJSON(`${BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: headers(key), proxy, signal, label: LABEL, timeout: 20000 }));
      const d = st.data || {};
      const state = String(d.state || d.status || '').toLowerCase();
      if (state === 'waiting' || state === 'queuing' || state === 'pending') job.update({ stage: 'queued', progress: 0.08 });
      else if (state === 'generating' || state === 'processing' || state === 'running') job.update({ stage: 'generating', progress: Math.min(0.9, 0.1 + 0.8 * (Date.now() - t0) / expect) });
      else if (state === 'success' || state === 'completed' || d.successFlag === 1) {
        let res = d.resultJson || d.response || d.result || {};
        if (typeof res === 'string') { try { res = JSON.parse(res); } catch (_) { res = { resultUrls: [res] }; } }
        const urls = res.resultUrls || res.result_urls || res.urls || (res.url ? [res.url] : []) || [];
        const kind = byId.get(model)?.kind || spec.kind;
        const media = urls.filter((u) => typeof u === 'string').map((u) => ({ kind, src: u }));
        if (!media.length) throw new ProviderError('parse', `kie.ai finished without a result URL`);
        return { media, raw: d, cost: this.estimateCost(spec) };
      } else if (state === 'fail' || state === 'failed' || d.successFlag === 2 || d.successFlag === 3) throw new ProviderError('server', `kie.ai failed the task${d.failMsg ? `: ${d.failMsg}` : ''}`, { fix: 'retry' });
      delay = Math.min(5000, delay * 1.2);
    }
  },
});
export default kie;
