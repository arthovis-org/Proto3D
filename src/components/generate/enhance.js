// Enhance — finishing passes on an image: upscale ×2 / ×4, remove the background, restore faces.
// The browser does the upscale itself (two Canvas drawImage steps with high-quality smoothing —
// free, instant); the other tasks, or a model upscale, run as jobs on fal (Clarity, AuraSR,
// BiRefNet, CodeFormer — curated, unverified), kie (which refuses them in plain words) or the
// offline Demo (a browser upscale behind a short fake progress, a checkerboard cut-out). The
// job lifecycle, the face (before / after body, status ring, Run / Stop, history, ↓) and the
// stored results are the Generate components' own (common.js).
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { isMedia } from '../../core/types.js';
import { drawMedia, drawCaps, drawText } from '../../faces.js';
import { store } from '../../ai/store.js';
import { providerRegistry, providerStatus } from '../../ai/providers/index.js';
import { fmtUSD } from '../../ai/pricing.js';
import { fmtElapsed } from '../../ai/jobs.js';
import { ui } from '../../ai/ui-hooks.js';
import { drawGenerateFace, facePointer, startRun, cancelRun, retryRun, approveRun, usageOf, hydrateState, generateAnchors, HISTORY_MAX } from './common.js';

export const TASKS = ['upscale', 'remove background', 'restore faces'];
const PROVIDERS = ['browser', 'fal', 'kie', 'demo'];
const KIND = 'image';
let seq = 0;
const toBlob = (c) => new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
const loadImage = (src) => new Promise((resolve) => { const im = new Image(); if (!/^(blob|data):/.test(src)) im.crossOrigin = 'anonymous'; im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });

/** Curated tool rows of a provider for a task (fal has them; kie has none). */
export function toolModels(providerId, task) { return (providerRegistry.get(providerId)?.models || []).filter((m) => m.tool === 'enhance' && m.task === task); }
/** The model a spec uses: the chosen one when it fits the task, else the provider's first row for it. */
function modelFor(params) {
  if (params.provider === 'browser') return 'canvas';
  if (params.provider === 'demo') return `demo/${params.task.replace(/\s+/g, '-')}`;
  const rows = toolModels(params.provider, params.task);
  return rows.some((m) => m.id === params.model) ? params.model : rows[0]?.id || '';
}
const buildSpec = ({ inputs, params }) => {
  const reference = isMedia(inputs.image) && inputs.image.kind === 'image' ? inputs.image : undefined;
  return { kind: KIND, task: params.task, model: modelFor(params), reference, scale: params.task === 'upscale' ? (+params.scale === 4 ? 4 : 2) : 1, prompt: '' };
};
/** Browser upscale: two smoothing steps, stored like any generated media, then `when done`. */
async function browserUpscale(inst, spec) {
  if (!spec.reference) { inst._err = { message: 'Connect an image to enhance', fix: null }; inst.faceDirty = true; return; }
  if (spec.task !== 'upscale') { inst._err = { message: `The browser can only upscale — pick fal or Demo for "${spec.task}"`, fix: null }; inst.faceDirty = true; return; }
  inst._finishing = true; inst._err = null; inst.faceDirty = true; inst._lastSpec = spec;
  const t0 = performance.now();
  try {
    const im = await loadImage(spec.reference.src);
    if (!im) throw new Error('The image could not be read');
    const k = spec.scale, mid = document.createElement('canvas'), out = document.createElement('canvas');
    mid.width = Math.round(im.naturalWidth * Math.sqrt(k)); mid.height = Math.round(im.naturalHeight * Math.sqrt(k));
    out.width = Math.round(im.naturalWidth * k); out.height = Math.round(im.naturalHeight * k);
    const mg = mid.getContext('2d'); mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high'; mg.drawImage(im, 0, 0, mid.width, mid.height);
    const og = out.getContext('2d'); og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high'; og.drawImage(mid, 0, 0, out.width, out.height);
    const id = `enh-${Date.now().toString(36)}${(++seq).toString(36)}`;
    const media = await store.putMedia(id, await toBlob(out), { kind: 'image', title: `${spec.reference.title || 'image'} · ×${k}`, w: out.width, h: out.height, provider: 'browser', model: 'canvas', createdAt: new Date().toISOString(), cost: 0 });
    const rec = { id, kind: KIND, provider: 'browser', model: 'canvas', createdAt: media.createdAt, elapsed: +((performance.now() - t0) / 1000).toFixed(2), cost: 0, prompt: `${spec.task} ×${k}`, media: [media] };
    inst.state.current = rec;
    inst.state.history = [rec, ...(inst.state.history || []).filter((h) => h.id !== rec.id)].slice(0, HISTORY_MAX);
    inst._pendingDone = rec;
    inst.world?.changed?.('generate');
  } catch (e) { inst._err = { message: e?.message || String(e), fix: null }; }
  finally { inst._finishing = false; inst.faceDirty = true; }
}
function run(inst, spec) {
  if (inst._finishing || inst._job?.active) return false;
  if (!spec.reference) { inst._err = { message: 'Connect an image to enhance', fix: null }; inst.faceDirty = true; return false; }
  if (inst.params.provider === 'browser') { browserUpscale(inst, spec); return true; }
  if (!spec.model) { inst._err = { message: `${providerRegistry.get(inst.params.provider)?.label || inst.params.provider} has no curated model for "${spec.task}" — use fal, the browser or Demo`, fix: null }; inst.faceDirty = true; return false; }
  return startRun(inst, spec, { kind: KIND });
}
/** Before / after body: the input image left, the result right (a batch never happens here). */
function drawEnhanceBody(g, x, y, w, h, rec, inst) {
  const A = inst.rt?.inputs?.image, out = rec?.media?.[0];
  const gap = 16, bw = (w - gap) / 2, bh = h - 18;
  if (!isMedia(A)) { drawText(g, 'Connect an image, then press Run', x, y, w, h, { size: 16, color: palette.faceDim }); return; }
  drawMedia(g, A, x, y, bw, bh, { fit: 'contain', radius: 12, caption: false });
  drawCaps(g, `before · ${A.w || '?'}×${A.h || '?'}`, x, y + bh + 10, { size: 9 });
  if (out) { drawMedia(g, out, x + bw + gap, y, bw, bh, { fit: 'contain', radius: 12, caption: false }); drawCaps(g, `after · ${out.w}×${out.h}`, x + bw + gap, y + bh + 10, { size: 9 }); }
  else drawText(g, `Run → ${inst.params.task}${inst.params.task === 'upscale' ? ` ×${inst.params.scale}` : ''}`, x + bw + gap, y, bw, bh, { size: 14, color: palette.faceDim });
}

export default registry.register({
  id: 'enhance', category: 'generate', label: 'Enhance', icon: icons.enhance, size: 'L',
  description: 'Upscale ×2 / ×4 (in the browser or on a model), remove the background or restore faces',
  inputs: [
    { key: 'image', label: 'image', type: 'media' },
    { key: 'run', label: 'run', type: 'event', optional: true },
  ],
  outputs: [
    { key: 'media', label: 'image', type: 'media' },
    { key: 'done', label: 'when done', type: 'event' },
    { key: 'usage', label: 'usage', type: 'data' },
  ],
  params: [
    { key: 'task', label: 'task', type: 'select', options: TASKS, default: 'upscale', hidden: true },
    { key: 'scale', label: 'scale', type: 'select', options: ['2', '4'], default: '2', hidden: true },
    { key: 'provider', label: 'provider', type: 'select', options: PROVIDERS, default: 'browser', hidden: true },
    { key: 'model', label: 'model', type: 'text', default: '', hidden: true },
    { key: 'autoRun', label: 'auto-run on input change', type: 'boolean', default: false, hidden: true },
    { key: 'approveAbove', label: 'approve above $', type: 'number', default: 0.05, min: 0, max: 100, step: 0.01, hidden: true },
  ],
  describeLink(from, toDef, to, n) {
    if (from.key === 'media') return toDef.id === 'media-grid' ? `${n.fromPoss} enhanced image joins the ${n.to} gallery` : toDef.id === 'kanban-board' && to.key === 'cover' ? `${n.fromPoss} enhanced image becomes a card cover on ${n.to}` : toDef.id === 'image-edit' ? `${n.to} edits ${n.fromPoss} enhanced image` : to.key === 'reference' ? `${n.fromPoss} enhanced image is the reference for ${n.to}` : `${n.fromPoss} enhanced image shows on ${n.to}`;
    if (from.key === 'done') return `When ${n.from} finishes, ${n.to} runs`;
    if (from.key === 'usage') return `${n.fromPoss} cost goes to ${n.to}`;
    return null;
  },
  onCreate(inst) { hydrateState(inst); },
  evaluate(ctx) {
    const { inputs, params, state, instance: inst, time, emit } = ctx;
    state.history = state.history || [];
    if (!PROVIDERS.includes(params.provider)) params.provider = 'browser';
    inst._buildSpec = () => buildSpec(ctx);
    if (inputs.run) run(inst, buildSpec(ctx));
    if (params.autoRun && !inst._job?.active && !inst._finishing && !inst._approval) {
      const src = isMedia(inputs.image) ? `${inputs.image.src}|${params.task}|${params.scale}|${params.provider}` : '';
      if (src && src !== state.lastAuto) { if (inst._autoKey !== src) { inst._autoKey = src; inst._autoAt = time + 0.9; } else if (time >= inst._autoAt) { state.lastAuto = src; run(inst, buildSpec(ctx)); } }
    }
    if (inst._pendingDone) { const rec = inst._pendingDone; inst._pendingDone = null; emit('done', rec.media?.[0]); }
    const rec = state.current;
    return { media: rec?.media?.[0], usage: usageOf(rec) };
  },
  footer: ({ instance, params, outputs }) => (instance._job?.active ? `${instance._job.stage}…` : instance._finishing ? 'working…' : outputs.media ? `${params.task} · ${outputs.media.w}×${outputs.media.h}` : `${params.task}${params.task === 'upscale' ? ` ×${params.scale}` : ''} · ${params.provider}`),
  face: {
    live: true, fps: 6,
    portAnchors: generateAnchors,
    render(g, w, h, ctx) { drawGenerateFace(g, w, h, ctx, { kind: KIND, body: drawEnhanceBody, promptText: `${ctx.params.task}${ctx.params.task === 'upscale' ? ` ×${ctx.params.scale}` : ''} · ${ctx.params.provider === 'browser' ? 'in the browser, free' : ctx.params.provider}`, noPrompt: true }); },
    onPointer(ctx, ev) { return facePointer(ctx, ev, KIND, { run: (inst, spec) => run(inst, spec) }); },
  },
  panel(api, b) {
    const s = api.section('Enhance');
    api.select(s, 'task', TASKS, () => b.params.task, (v) => { api.setParam('task', v); if (b.params.provider === 'browser' && v !== 'upscale') api.setParam('provider', 'demo'); api.rebuild(); }, 'task');
    if (b.params.task === 'upscale') api.buttons(s, 'scale', [['2', '×2', 'double the size'], ['4', '×4', 'four times the size']], () => String(b.params.scale), (v) => api.setParam('scale', v));
    const sel = api.select(s, 'provider', PROVIDERS, () => b.params.provider, (v) => { api.setParam('provider', v); api.setParam('model', modelFor({ ...b.params, provider: v })); api.rebuild(); }, 'provider');
    sel.querySelectorAll('option').forEach((o) => { const st = providerStatus(o.value); o.textContent = o.value === 'browser' ? 'browser · free, instant (upscale only)' : `${providerRegistry.get(o.value)?.label || o.value}${st === 'demo' ? ' · offline, free' : st === 'connected' ? ' · connected' : st === 'locked' ? ' · vault locked' : ' · no key'}`; });
    if (b.params.provider === 'fal' || b.params.provider === 'kie') {
      const rows = toolModels(b.params.provider, b.params.task);
      if (rows.length) { const ms = api.select(s, 'model', rows.map((m) => m.id), () => modelFor(b.params), (v) => api.setParam('model', v), 'model'); ms.querySelectorAll('option').forEach((o) => { const m = rows.find((r) => r.id === o.value); o.textContent = `${m.label} · ${m.priceText}${m.unverified ? ' · unverified' : ''}`; }); }
      else s.appendChild(api.h('div', 'pm-hint bad', `${providerRegistry.get(b.params.provider)?.label || b.params.provider} has no curated model for "${b.params.task}" — not offered; use fal, the browser or Demo.`));
      const st = providerStatus(b.params.provider);
      if (st === 'missing' || st === 'locked') api.action(s, 'Open Connections', () => ui.openConnections(b.params.provider), 'gen-open-connections');
    }
    api.check(s, 'auto-run on input change', () => !!b.params.autoRun, (v) => api.setParam('autoRun', v), 'autoRun');
    api.num(s, 'approve above $', () => b.params.approveAbove ?? 0.05, (v) => api.setParam('approveAbove', Math.max(0, v)), { step: 0.01, min: 0, max: 100, attr: 'approveAbove' });
    s.appendChild(api.h('div', 'panel-note', 'The browser upscale is two high-quality Canvas resamples — no service, no cost. Model tasks are curated fal rows (unverified until run); Demo fakes them offline.'));
    const runS = api.section('Run');
    api.readonly(runS, 'status', () => { const j = b._job; if (j?.active) return `${j.stage} · ${fmtElapsed(j.elapsed)} · ${Math.round(j.progress * 100)}%`; if (b._finishing) return 'working'; if (b._err) return `failed · ${b._err.message}`; if (b._approval) return `waiting for approval (${fmtUSD(b._approval.estimate)})`; const c = b.state.current; return c ? `done · ${fmtElapsed(c.elapsed)} · ${c.cost ? fmtUSD(c.cost) : 'free'}` : 'idle'; });
    const btns = api.h('div', 'btn-group'); runS.appendChild(btns);
    const mk = (text, fn, id) => { const x = api.h('button', null, text); x.type = 'button'; x.id = id; x.addEventListener('click', fn); btns.appendChild(x); return x; };
    const bRun = mk('Run', () => run(b, buildSpec({ inputs: b.rt?.inputs || {}, params: b.params })), 'gen-run');
    const bStop = mk('Stop', () => cancelRun(b), 'gen-stop');
    const bRetry = mk('Retry', () => { b._err = null; if (b.params.provider === 'browser') run(b, b._lastSpec || buildSpec({ inputs: b.rt?.inputs || {}, params: b.params })); else retryRun(b, KIND); }, 'gen-retry');
    api.live(() => { const active = !!b._job?.active || !!b._finishing; bRun.disabled = active || !!b._approval; bStop.disabled = !b._job?.active && !b._approval; bRetry.disabled = active || !b._lastSpec; });
    if (b._approval) api.action(runS, `Approve · run for ${fmtUSD(b._approval.estimate)}`, () => { approveRun(b); api.rebuild(); }, 'gen-approve');
  },
});
