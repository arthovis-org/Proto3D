// components/generate/common.js — what the four Generate components share: the job lifecycle
// (spec → approval → job → result → history → `when done`), the face (model chip, status ring,
// streaming body, Run / Stop, history strip, plain-language errors with a fix action), the
// panel section (provider, model browser, schema-driven params, history) and the media
// finishing step (blobs and hosted files into IndexedDB so reloads keep them).
//
// Per instance: `params` hold the configuration, `state` the serialisable results
// ({ current, history[≤8], lastPrompt }); live handles stay on the instance (`_job`, `_approval`,
// `_err`, `_partial`, `_pendingDone`, `_hits`) and are never written to the world JSON.
import { palette } from '../../theme.js';
import { clear, drawCaps, drawDivider, drawTile, drawChip, drawBar, drawMedia, drawMediaGrid, drawText, wrapLines, fitLine, font, roundRect, tabular, PAD } from '../../faces.js';
import { providerRegistry, providerStatus, createJob } from '../../ai/providers/index.js';
import { ProviderError, request } from '../../ai/http.js';
import { store } from '../../ai/store.js';
import { fmtUSD, fmtPerMillion, isFreeModel } from '../../ai/pricing.js';
import { vault } from '../../ai/vault.js';
import { fmtElapsed } from '../../ai/jobs.js';
import { ui } from '../../ai/ui-hooks.js';
import { asText } from '../util.js';

export const HISTORY_MAX = 8;
export const KIND_LABEL = { text: 'text', image: 'image', video: 'video', audio: 'audio' };
let idSeq = 0;
const resultId = () => `r${Date.now().toString(36).slice(-5)}${(++idSeq).toString(36)}`;

/* ------------------------------------------------------------------ */
/* providers and models                                                 */
/* ------------------------------------------------------------------ */
export const providersFor = (kind) => providerRegistry.forKind(kind);
export const providerIdsFor = (kind) => providersFor(kind).map((p) => p.id);
/**
 * The provider's default model for a kind: media providers have one per kind, OpenRouter picks a
 * free model from its fetched list at runtime (`pickDefaultModel`) and gives '' until the list is
 * there — a paid model is never chosen silently.
 */
export function defaultModelFor(providerId, kind) {
  const p = providerRegistry.get(providerId); if (!p) return '';
  if (typeof p.pickDefaultModel === 'function') return p.pickDefaultModel(kind) || '';
  const d = p.defaultModel; return typeof d === 'string' ? d : d?.[kind] || '';
}
export function modelInfo(providerId, modelId) { const p = providerRegistry.get(providerId); return p?.modelInfo?.(modelId) || null; }
export function modelLabel(providerId, modelId) { if (!modelId) return 'choose a model'; return modelInfo(providerId, modelId)?.label || String(modelId || '').split('/').pop() || '—'; }
/** True for a free hosted model (":free" id or zero prices); Demo does not count. */
export function modelIsFree(providerId, modelId) { const m = modelInfo(providerId, modelId); return m ? isFreeModel(m) : /:free$/i.test(String(modelId || '')) && providerId !== 'demo'; }
/** One-line price for a model: "$0.15 / $0.60 per 1M" or "$0.003 / image". */
export function modelPriceText(providerId, modelId) {
  if (!modelId) return providerId === 'openrouter' ? (providerStatus('openrouter') === 'connected' ? 'finding a free model…' : 'connect OpenRouter, or pick one here') : '';
  const m = modelInfo(providerId, modelId); if (!m) return providerId === 'openrouter' ? 'price after the first model fetch' : '';
  if (m.pricing?.text) return m.pricing.text;
  if (m.pricing && ('prompt' in m.pricing)) return fmtPerMillion(m.pricing.prompt, m.pricing.completion);
  return '';
}
/**
 * Ensure params.model is set (a fresh instance takes the provider's default). When the provider
 * chooses its default from a live list (OpenRouter) and the list is not fetched yet, fetch it
 * once and fill the model in when it arrives — only while the component still has none.
 */
export function ensureModel(inst, kind) {
  if (!inst.params.provider || !providerRegistry.get(inst.params.provider)) inst.params.provider = providerIdsFor(kind).includes('demo') ? (providerIdsFor(kind).find((id) => id !== 'demo' && providerStatus(id) === 'connected') || 'demo') : providerIdsFor(kind)[0];
  if (!inst.params.model) inst.params.model = defaultModelFor(inst.params.provider, kind);
  if (!inst.params.model) fetchDefaultModel(inst, kind);
}
function fetchDefaultModel(inst, kind) {
  const providerId = inst.params.provider, p = providerRegistry.get(providerId);
  if (!p || typeof p.pickDefaultModel !== 'function' || providerStatus(providerId) !== 'connected' || inst._defaultFetch) return;
  inst._defaultFetch = p.listModels({ kind, key: vault.keyFor(providerId), proxy: vault.proxyFor(providerId) })
    .then(() => { if (!inst.params.model && inst.params.provider === providerId) { inst.params.model = defaultModelFor(providerId, kind); if (inst.params.model) { inst.faceDirty = true; inst.world?.changed?.('param'); } } })
    .catch(() => {}).finally(() => { inst._defaultFetch = null; });
}
/** Switch a component to OpenRouter on a free model (fetching the list when needed). Resolves to the model id or '' when none is free. */
export async function switchToFreeOpenRouter(inst, kind) {
  const p = providerRegistry.get('openrouter'); if (!p || providerStatus('openrouter') !== 'connected') return '';
  try { if (!p.cachedModels?.()) await p.listModels({ kind, key: vault.keyFor('openrouter'), proxy: vault.proxyFor('openrouter') }); } catch (_) { /* fall through: no list, no free model */ }
  const id = p.pickDefaultModel(kind) || '';
  if (!id) return '';
  inst.params.provider = 'openrouter'; inst.params.model = id; inst._err = null; inst.faceDirty = true; inst.world?.changed?.('param');
  return id;
}

/* ------------------------------------------------------------------ */
/* job lifecycle                                                        */
/* ------------------------------------------------------------------ */
/** Start a run for `spec`; handles the approval threshold, the no-key error and the job events. */
export function startRun(inst, spec, { approved = false, kind } = {}) {
  if (inst._job?.active) return false;
  inst._err = null; inst._approval = null;
  const provider = providerRegistry.get(inst.params.provider);
  if (!provider) { inst._err = { message: `Unknown provider "${inst.params.provider}"`, fix: null }; inst.faceDirty = true; return false; }
  if (!spec.model && provider.needsKey) { inst._err = { code: 'no-model', message: providerStatus(inst.params.provider) === 'connected' ? `No model chosen yet — pick one (free models are marked) in the model browser` : `No ${provider.label} key yet — add one in Connections, then pick a model`, fix: providerStatus(inst.params.provider) === 'connected' ? 'model' : 'connections' }; inst.faceDirty = true; return false; }
  const estimate = provider.estimateCost(spec);
  const limit = +inst.params.approveAbove || 0;
  if (!approved && limit > 0 && typeof estimate === 'number' && estimate > limit) { inst._approval = { spec, estimate, kind, limit }; inst.faceDirty = true; return false; }
  let job;
  try { job = createJob(inst.params.provider, spec, { owner: inst.uid, title: inst.title, estimate }); }
  catch (e) { inst._err = errorRecord(e); inst.faceDirty = true; inst.world?.overlays?.toast?.(inst._err.message, 2600); return false; }
  inst._job = job; inst._partial = null; inst._lastSpec = spec; inst.state.lastPrompt = spec.prompt || '';
  inst.faceDirty = true;
  job.onChange((j, what) => {
    if (inst._job !== j) return;
    if (what === 'progress') { if (j.partial !== undefined && j.partial !== null) inst._partial = j.partial; inst.faceDirty = true; return; }
    if (what === 'done') { finishJob(inst, j, kind); return; }
    if (what === 'failed') { inst._err = j.error; inst._job = null; inst._partial = null; inst.faceDirty = true; return; }
    if (what === 'cancelled') { inst._job = null; inst._partial = null; inst.faceDirty = true; return; }
    inst.faceDirty = true;
  });
  return true;
}
export const errorRecord = (e) => (e instanceof ProviderError ? { code: e.code, message: e.message, fix: e.fix } : { code: 'error', message: e?.message || String(e), fix: null });

async function finishJob(inst, job, kind) {
  const r = job.result || {};
  const base = { id: resultId(), provider: job.provider, model: r.model || job.model, createdAt: new Date().toISOString(), elapsed: +job.elapsed.toFixed(1), cost: typeof job.cost === 'number' ? job.cost : null, prompt: job.spec?.prompt || '' };
  let rec;
  if (kind === 'text') {
    rec = { ...base, kind: 'text', text: r.text || '', data: r.data, usage: r.usage ? { in: r.usage.prompt_tokens || 0, out: r.usage.completion_tokens || 0 } : job.tokens || null, finish: r.finish || null };
  } else {
    inst._finishing = true; inst.faceDirty = true;
    const media = [];
    for (let i = 0; i < (r.media || []).length; i++) media.push(await finishMedia(inst, job, r.media[i], i, base));
    inst._finishing = false;
    rec = { ...base, kind, media, seed: r.seed };
  }
  if (inst._job !== job) return;   // cancelled or replaced while the media was being stored
  inst._job = null; inst._partial = null; inst._err = null;
  inst.state.current = rec;
  inst.state.history = [rec, ...(inst.state.history || []).filter((h) => h.id !== rec.id)].slice(0, HISTORY_MAX);
  inst._pendingDone = rec;
  inst.faceDirty = true;
  inst.world?.changed?.('generate');
}
/** A provider media item ({ src } hosted or { blob }) → a persisted media record. */
async function finishMedia(inst, job, item, i, base) {
  const title = item.title || (job.spec?.prompt || '').replace(/\{[^}]*\}/g, '').trim().split(/\s+/).slice(0, 4).join(' ') || 'Generated';
  const id = `${job.id}-${i}`;
  const meta = { kind: item.kind, title, provider: base.provider, model: base.model, createdAt: base.createdAt, cost: base.cost, w: item.w, h: item.h, duration: item.duration, prompt: base.prompt };
  if (item.blob) return store.putMedia(id, item.blob, meta);
  // hosted: keep the URL, and try to bring the file into the page so it survives the provider's expiry
  const rec = { ...meta, src: item.src, hosted: item.src };
  try {
    const proxy = null;   // media hosts (fal.media, kie cdn) serve with CORS; the API proxy is not used for files
    const res = await request(item.src, { timeout: 30000, proxy, label: 'The media host' });
    const blob = await res.blob();
    if (blob && blob.size > 0) { const stored = await store.putMedia(id, blob, meta); return { ...stored, hosted: item.src }; }
  } catch (_) { /* fall back to the hosted URL */ }
  return rec;
}
export function cancelRun(inst) { if (inst._job?.active) { inst._job.cancel(); return true; } if (inst._approval) { inst._approval = null; inst.faceDirty = true; return true; } return false; }
export function retryRun(inst, kind) { if (inst._lastSpec) return startRun(inst, inst._lastSpec, { approved: true, kind }); return false; }
export function approveRun(inst) { const a = inst._approval; if (!a) return false; inst._approval = null; return startRun(inst, a.spec, { approved: true, kind: a.kind }); }
/** Make a history entry the current output (its id or index). */
export function selectHistory(inst, idOrIndex) {
  const h = inst.state.history || [];
  const rec = typeof idOrIndex === 'number' ? h[idOrIndex] : h.find((x) => x.id === idOrIndex);
  if (!rec) return false;
  inst.state.current = rec; inst.faceDirty = true; inst.world?.changed?.('generate');
  return true;
}
export function clearHistory(inst) { inst.state.history = []; inst.state.current = null; inst.faceDirty = true; inst.world?.changed?.('generate'); }
/** Rehydrate blob URLs of stored media after a reload / duplicate. */
export function hydrateState(inst) {
  const all = [];
  for (const rec of [inst.state.current, ...(inst.state.history || [])]) if (rec?.media) all.push(...rec.media);
  if (!all.length) return;
  store.hydrate(all).then(() => { inst.faceDirty = true; inst._hydrated = true; inst.world?.bumpLayout?.(); });
}
/**
 * The shared part of `evaluate`: `run` pulses start a job, auto-run debounces prompt changes,
 * `when done` fires once per finished job. Returns the current result record (or null).
 */
export function evaluateCommon(ctx, kind, buildSpec) {
  const { inputs, params, state, instance: inst, time, emit } = ctx;
  ensureModel(inst, kind);
  state.history = state.history || [];
  if (inputs.run) { const spec = buildSpec(ctx); if (spec.prompt) startRun(inst, spec, { kind }); else { inst._err = { message: 'Nothing to send — connect or type a prompt', fix: null }; inst.faceDirty = true; } }
  if (params.autoRun && !inst._job?.active && !inst._approval) {
    const spec = buildSpec(ctx);
    if (spec.prompt && spec.prompt !== state.lastPrompt) {
      if (inst._autoPrompt !== spec.prompt) { inst._autoPrompt = spec.prompt; inst._autoAt = time + 0.9; }
      else if (time >= inst._autoAt) { startRun(inst, spec, { kind }); }
    }
  }
  if (inst._pendingDone) { const rec = inst._pendingDone; inst._pendingDone = null; emit('done', kind === 'text' ? rec.text : rec.media?.[0]); }
  return state.current || null;
}
export const usageOf = (rec) => (rec ? { tokens: rec.usage || null, cost: rec.cost, model: rec.model, provider: rec.provider, elapsed: rec.elapsed, createdAt: rec.createdAt } : undefined);

/* ------------------------------------------------------------------ */
/* the face                                                             */
/* ------------------------------------------------------------------ */
const BTN = { w: 118, h: 40 };
const TILE = 44, TILE_GAP = 6;
/** Provider short label for the chip. */
const providerTag = (id) => (id === 'demo' ? 'DEMO' : providerRegistry.get(id)?.label || id);

/**
 * Port anchors for a Generate face (face logical px): `prompt` beside the prompt preview line,
 * `context` / `image` / `reference` beside the result body, `run` beside the Run button; the
 * result output beside the body, `data` / `all` a little lower, `when done` and `usage` beside the
 * Run button and the cost line (alignPorts pushes them apart).
 */
export function generateAnchors({ h }) {
  const py = PAD - 4 + 44, by = py + 30, bh = h - by - BTN.h - PAD - 16, yb = h - PAD - BTN.h / 2;
  return {
    in: { prompt: py, context: by + bh * 0.3, image: by + bh * 0.6, reference: by + bh * 0.6, run: yb },
    out: { text: by + bh * 0.4, media: by + bh * 0.4, data: by + bh * 0.75, all: by + bh * 0.75, done: yb, usage: yb },
  };
}

/**
 * Draw the whole face. `body(g, x, y, w, h, rec, inst)` draws the result area for the kind.
 * Fills `inst._hits` with clickable regions.
 */
export function drawGenerateFace(g, w, h, ctx, { kind, body, promptText = '' }) {
  const { params, state, instance: inst, time } = ctx;
  clear(g, w, h);
  const hits = []; inst._hits = hits;
  const job = inst._job, running = !!job?.active, err = inst._err, appr = inst._approval;
  const rec = state.current;
  const dim = palette.faceDim, text = palette.faceText, acc = palette.faceAccent;

  /* header: provider + model chips left, status right */
  let x = PAD, y = PAD - 4;
  const isDemo = params.provider === 'demo';
  x += drawChip(g, providerTag(params.provider), x, y, { h: 26, bg: isDemo ? palette.faceCard : acc, color: isDemo ? dim : '#fff', size: 11, weight: 700, padX: 10 }) + 6;
  const ml = fitLine(g, modelLabel(params.provider, params.model), w * 0.42);
  x += drawChip(g, ml, x, y, { h: 26, bg: palette.faceCard, color: text, size: 12, weight: 600, padX: 10 }) + 6;
  if (modelIsFree(params.provider, params.model)) x += drawChip(g, 'FREE', x, y, { h: 26, bg: palette.faceCard, color: palette.faceGood, size: 10, weight: 700, padX: 8 }) + 6;
  hits.push({ x: PAD, y, w: x - PAD, h: 26, action: 'model' });
  drawStatus(g, w - PAD, y + 13, { inst, job, rec, err, running, time });

  /* prompt preview */
  const py = y + 44;
  g.font = font(14, 500); g.fillStyle = dim; g.textAlign = 'left'; g.textBaseline = 'middle';
  const pv = String(promptText || rec?.prompt || '').replace(/\s+/g, ' ').trim();
  g.fillText(pv ? fitLine(g, pv, w - 2 * PAD) : 'no prompt connected — plug a Prompt or Text in, or type one in the panel', PAD, py);
  drawDivider(g, PAD, py + 18, w - 2 * PAD);

  /* body */
  const by = py + 30, bh = h - by - BTN.h - PAD - 16;
  if (appr) drawApproval(g, PAD, by, w - 2 * PAD, bh, appr, hits);
  else if (err) drawError(g, PAD, by, w - 2 * PAD, bh, err, hits, inst);
  else if (running && (kind !== 'text' || !inst._partial)) drawProgress(g, PAD, by, w - 2 * PAD, bh, job, kind, time);
  else if (inst._finishing) drawText(g, 'saving result…', PAD, by, w - 2 * PAD, bh, { size: 16, color: dim });
  else body(g, PAD, by, w - 2 * PAD, bh, rec, inst, running);

  /* bottom bar: Run / Stop + cost · history strip */
  const yb = h - PAD - BTN.h;
  const label = running ? 'Stop' : appr ? 'Cancel' : 'Run';
  g.fillStyle = running ? palette.faceCard : acc; roundRect(g, PAD, yb, BTN.w, BTN.h, BTN.h / 2); g.fill();
  if (running) { g.fillStyle = text; roundRect(g, PAD + 18, yb + 14, 12, 12, 3); g.fill(); }
  else { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(PAD + 20, yb + 12); g.lineTo(PAD + 33, yb + 20); g.lineTo(PAD + 20, yb + 28); g.closePath(); g.fill(); }
  g.font = font(15, 600); g.fillStyle = running ? text : '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, PAD + 42, yb + BTN.h / 2 + 1);
  hits.push({ x: PAD, y: yb, w: BTN.w, h: BTN.h, action: running || appr ? 'stop' : 'run' });
  // cost / usage line
  g.font = font(13, 500); g.fillStyle = dim; tabular(g);
  const usageText = costLine(rec, job, running);
  if (usageText) g.fillText(fitLine(g, usageText, w - 2 * PAD - BTN.w - 14 - (HISTORY_MAX * (TILE + TILE_GAP))), PAD + BTN.w + 14, yb + BTN.h / 2 + 1);
  drawHistory(g, w - PAD, yb - 2, state.history || [], rec, hits, time);
}
function drawStatus(g, right, cy, { inst, job, rec, err, running, time }) {
  const dim = palette.faceDim, acc = palette.faceAccent;
  let label, color = dim, ring = null;
  if (running) {
    const q = job.queuePosition;
    label = job.status === 'queued' || job.stage === 'queued' ? `queued${q ? ` · #${q}` : ''} · ${fmtElapsed(job.elapsed)}` : `${job.stage || 'running'} · ${fmtElapsed(job.elapsed)}${job.tokens ? ` · ${job.tokens.out} tok` : ''}`;
    color = acc; ring = job.progress;
  } else if (inst._finishing) { label = 'saving…'; color = acc; ring = 0.97; }
  else if (err) { label = 'failed'; color = palette.faceBad; }
  else if (inst._approval) { label = 'needs approval'; color = palette.faceWarn; }
  else if (rec) { label = `done · ${fmtElapsed(rec.elapsed)}${rec.usage ? ` · ${rec.usage.in + rec.usage.out} tok` : ''}`; color = palette.faceGood; }
  else label = 'idle';
  g.font = font(12, 600); g.fillStyle = color; g.textAlign = 'right'; g.textBaseline = 'middle'; tabular(g);
  const tw = g.measureText(label).width;
  g.fillText(label, right, cy + 1);
  const cx = right - tw - 16;
  g.lineWidth = 3; g.strokeStyle = palette.faceLine; g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.stroke();
  if (ring !== null) {
    g.strokeStyle = color; g.beginPath();
    if (ring < 0.09) { const a = (time * 3) % (Math.PI * 2); g.arc(cx, cy, 8, a, a + Math.PI * 0.8); }   // indeterminate
    else g.arc(cx, cy, 8, -Math.PI / 2, -Math.PI / 2 + ring * Math.PI * 2);
    g.stroke();
  } else { g.fillStyle = color; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill(); }
}
function costLine(rec, job, running) {
  if (running && job) return job.estimate !== null && job.estimate !== undefined ? `est. ${fmtUSD(job.estimate)}` : '';
  if (!rec) return '';
  const parts = [];
  if (rec.cost !== null && rec.cost !== undefined) parts.push(rec.cost === 0 ? 'free' : fmtUSD(rec.cost));
  if (rec.usage) parts.push(`${rec.usage.in} in · ${rec.usage.out} out`);
  if (rec.createdAt) { const d = new Date(rec.createdAt); parts.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); }
  return parts.join(' · ');
}
function drawProgress(g, x, y, w, h, job, kind, time) {
  const dim = palette.faceDim;
  const cy = y + h / 2;
  const stage = job.stage === 'queued' ? (job.queuePosition ? `In queue · position ${job.queuePosition}` : 'In queue') : job.stage === 'starting' || job.stage === 'connecting' || job.stage === 'submitting' ? 'Sending the request…' : job.stage === 'generating' ? `Generating ${KIND_LABEL[kind]}…` : job.stage === 'fetching result' ? 'Fetching the result…' : job.stage === 'thinking' ? 'Thinking…' : `${job.stage}…`;
  drawText(g, stage, x, cy - 46, w, 30, { size: 18, weight: 600 });
  drawBar(g, x + w * 0.15, cy - 4, w * 0.7, 6, job.progress < 0.09 ? 0.5 + 0.5 * Math.sin(time * 4) * 0.5 : job.progress);
  const last = job.logs.length ? job.logs[job.logs.length - 1].text : '';
  if (last && !/^error/.test(last)) { g.font = font(13, 500); g.fillStyle = dim; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(fitLine(g, last, w * 0.8), x + w / 2, cy + 22); }
}
function drawError(g, x, y, w, h, err, hits, inst) {
  drawTile(g, x, y, w, h, { bg: palette.faceCard, r: 14 });
  g.fillStyle = palette.faceBad; roundRect(g, x, y, 5, h, 3); g.fill();
  drawCaps(g, 'could not run', x + 22, y + 22, { color: palette.faceBad, size: 11 });
  drawText(g, err.message || 'Something went wrong', x + 22, y + 38, w - 44, h - 38 - 54, { size: 17, weight: 500, align: 'left', valign: 'top', lineHeight: 1.35 });
  const label = err.fix === 'connections' ? 'Open Connections' : err.fix === 'retry' ? 'Retry' : err.fix === 'model' ? 'Choose a model' : 'Dismiss';
  g.font = font(14, 600); const bw = g.measureText(label).width + 36, bh = 34, bx = x + 22, byy = y + h - bh - 16;
  g.fillStyle = err.fix ? palette.faceAccent : palette.faceLine; roundRect(g, bx, byy, bw, bh, bh / 2); g.fill();
  g.fillStyle = err.fix ? '#fff' : palette.faceText; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, bx + bw / 2, byy + bh / 2 + 1);
  hits.push({ x: bx, y: byy, w: bw, h: bh, action: err.fix === 'connections' ? 'connections' : err.fix === 'retry' ? 'retry' : err.fix === 'model' ? 'model' : 'dismiss' });
  if (err.fix) { const l2 = 'Dismiss'; const w2 = g.measureText(l2).width + 30; g.fillStyle = palette.faceDim; g.fillText(l2, bx + bw + 12 + w2 / 2, byy + bh / 2 + 1); hits.push({ x: bx + bw + 12, y: byy, w: w2, h: bh, action: 'dismiss' }); }
}
function drawApproval(g, x, y, w, h, appr, hits) {
  drawTile(g, x, y, w, h, { bg: palette.faceCard, r: 14 });
  g.fillStyle = palette.faceWarn; roundRect(g, x, y, 5, h, 3); g.fill();
  drawCaps(g, 'approve this run', x + 22, y + 22, { color: palette.faceWarn, size: 11 });
  drawText(g, `Estimated ${fmtUSD(appr.estimate)} — above your ${fmtUSD(appr.limit)} approval limit. Run it anyway?`, x + 22, y + 38, w - 44, h - 38 - 54, { size: 17, weight: 500, align: 'left', valign: 'top' });
  const bh = 34, byy = y + h - bh - 16; let bx = x + 22;
  for (const [label, action, primary] of [[`Run for ${fmtUSD(appr.estimate)}`, 'approve', true], ['Cancel', 'stop', false]]) {
    g.font = font(14, 600); const bw = g.measureText(label).width + 36;
    g.fillStyle = primary ? palette.faceAccent : palette.faceLine; roundRect(g, bx, byy, bw, bh, bh / 2); g.fill();
    g.fillStyle = primary ? '#fff' : palette.faceText; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, bx + bw / 2, byy + bh / 2 + 1);
    hits.push({ x: bx, y: byy, w: bw, h: bh, action }); bx += bw + 10;
  }
}
function drawHistory(g, right, bottom, history, current, hits, time) {
  const n = Math.min(HISTORY_MAX, history.length);
  const total = HISTORY_MAX * TILE + (HISTORY_MAX - 1) * TILE_GAP;
  const x0 = right - total, y = bottom - TILE;
  for (let i = 0; i < HISTORY_MAX; i++) {
    const x = x0 + i * (TILE + TILE_GAP);
    const rec = history[i];
    if (!rec) { g.strokeStyle = palette.faceLine; g.lineWidth = 1; roundRect(g, x + 0.5, y + 0.5, TILE - 1, TILE - 1, 9); g.stroke(); continue; }
    const on = current && rec.id === current.id;
    if (rec.media?.[0]) drawMedia(g, rec.media[0], x, y, TILE, TILE, { radius: 9, caption: false, time });
    else {
      drawTile(g, x, y, TILE, TILE, { bg: palette.faceCard, r: 9 });
      g.font = font(10, 600); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'top';
      const lines = wrapLines(g, String(rec.text || '').slice(0, 60), TILE - 12, 3);
      lines.forEach((l, k) => g.fillText(fitLine(g, l, TILE - 12), x + 6, y + 6 + k * 11));
    }
    if (on) { g.strokeStyle = palette.faceAccent; g.lineWidth = 2.5; roundRect(g, x + 1, y + 1, TILE - 2, TILE - 2, 9); g.stroke(); }
    hits.push({ x, y, w: TILE, h: TILE, action: 'history', arg: rec.id });
  }
  if (n) { drawCaps(g, 'history', right, y - 12, { size: 10, align: 'right' }); }
}
/** Streaming / final text body (shared by Generate Text; JSON in mono). */
export function drawTextBody(g, x, y, w, h, rec, inst, running) {
  const s = running ? inst._partial : rec?.text;
  if (!s) { drawText(g, 'Press Run (or send a run event) to generate', x, y, w, h, { size: 16, color: palette.faceDim }); return; }
  const mono = !!(rec?.data && !running) || (running && /^\s*[[{]/.test(s));
  const px = mono ? 15 : 17, lh = 1.4;
  g.font = font(px, 400, mono); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'top';
  const maxLines = Math.max(1, Math.floor(h / (px * lh)));
  let lines = wrapLines(g, s, w, 400);
  if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);   // keep the tail while streaming, like a terminal
  lines.forEach((l, i) => g.fillText(l, x, y + 4 + i * px * lh));
  if (running) { const last = lines[lines.length - 1] || ''; const cx = x + g.measureText(last).width + 3, cy = y + 4 + (lines.length - 1) * px * lh; if (Math.floor(performance.now() / 400) % 2) { g.fillStyle = palette.faceAccent; g.fillRect(cx, cy + 1, 2, px); } }
}
/** Result media body (image / video / audio; a batch as a small grid). */
export function drawMediaBody(g, x, y, w, h, rec, inst, running, kind, time) {
  const list = rec?.media || [];
  if (!list.length) { drawText(g, `Press Run to generate ${kind === 'audio' ? 'audio' : kind === 'video' ? 'a video' : 'an image'}`, x, y, w, h, { size: 16, color: palette.faceDim }); return; }
  if (list.length === 1) {
    const m = list[0];
    const aw = kind === 'audio' ? w : Math.min(w, h * ((m.w || 16) / (m.h || 10)) + 2);
    drawMedia(g, m, x + (w - aw) / 2, y, aw, h, { fit: 'contain', time, radius: 12, caption: false });
    if (m.missing) drawText(g, 'stored file missing', x, y + h - 26, w, 22, { size: 12, color: palette.faceWarn });
  } else drawMediaGrid(g, list, x, y, w, h, { gap: 8, time });
}
/** Map a face click to an action; returns true when handled. */
export function facePointer(ctx, ev, kind) {
  if (ev.type !== 'click') return false;
  const inst = ctx.instance;
  const cw = inst.face.cw, ch = inst.face.ch;   // logical face px (the bitmap may be scaled)
  const px = ev.u * cw, py = ev.v * ch;
  const hit = (inst._hits || []).find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  if (!hit) return false;
  switch (hit.action) {
    case 'run': { const spec = inst._buildSpec?.(); if (!spec || !spec.prompt) { inst._err = { message: 'Nothing to send — connect or type a prompt', fix: null }; } else startRun(inst, spec, { kind }); break; }
    case 'stop': cancelRun(inst); break;
    case 'approve': approveRun(inst); break;
    case 'retry': inst._err = null; retryRun(inst, kind); break;
    case 'dismiss': inst._err = null; break;
    case 'connections': ui.openConnections(inst.params.provider); break;
    case 'history': selectHistory(inst, hit.arg); break;
    case 'model': ui.openModelBrowser({ kind, providerId: inst.params.provider, current: inst.params.model, onPick: (id, providerId) => { if (providerId && providerId !== inst.params.provider) { inst.params.provider = providerId; } inst.params.model = id; inst.faceDirty = true; inst.world?.changed?.('param'); } }); break;
    default: return false;
  }
  inst.faceDirty = true;
  return true;
}

/* ------------------------------------------------------------------ */
/* the panel section                                                    */
/* ------------------------------------------------------------------ */
/**
 * Panel for a Generate component: provider + model (browser), kind-specific controls, run
 * controls, connection status and the history list. `extra(section)` adds kind-specific rows.
 */
export function buildGeneratePanel(api, b, kind, { extra = null } = {}) {
  ensureModel(b, kind);
  const s = api.section('Generate');
  const ids = providerIdsFor(kind);
  const sel = api.select(s, 'provider', ids, () => b.params.provider, (v) => { api.setParam('provider', v); api.setParam('model', defaultModelFor(v, kind)); api.rebuild(); }, 'provider');
  sel.querySelectorAll('option').forEach((o) => { const p = providerRegistry.get(o.value); const st = providerStatus(o.value); o.textContent = `${p?.label || o.value}${st === 'demo' ? ' · offline, free' : st === 'connected' ? ' · connected' : st === 'locked' ? ' · vault locked' : ' · no key'}`; });
  // model row: a button that opens the model browser
  const r = api.row(s, 'model');
  const mb = api.h('button', 'model-pick'); mb.type = 'button'; mb.id = 'gen-model'; r.appendChild(mb);
  const updModel = () => { const free = modelIsFree(b.params.provider, b.params.model); const html = `<b>${escapeHTML(modelLabel(b.params.provider, b.params.model))}${free ? ' <span class="badge free">Free</span>' : ''}</b><small>${escapeHTML(modelPriceText(b.params.provider, b.params.model) || b.params.model || '')}</small>`; if (mb.innerHTML !== html) mb.innerHTML = html; };
  updModel(); api.live(updModel);
  mb.addEventListener('click', () => ui.openModelBrowser({ kind, providerId: b.params.provider, current: b.params.model, onPick: (id, providerId) => { if (providerId && providerId !== b.params.provider) api.setParam('provider', providerId); api.setParam('model', id); api.rebuild(); } }));
  // a text component still on Demo while an OpenRouter key exists: one click to a free live model
  if (kind === 'text' && b.params.provider === 'demo' && providerStatus('openrouter') === 'connected') {
    api.action(s, 'Switch to OpenRouter (free model)', async () => {
      const id = await switchToFreeOpenRouter(b, kind);
      if (id) { api.world.overlays?.toast?.(`Now on OpenRouter · ${modelLabel('openrouter', id)} (free)`, 2200); api.rebuild(); }
      else { api.world.overlays?.toast?.('No free model in the OpenRouter list right now — pick one in the model browser', 2600); ui.openModelBrowser({ kind, providerId: 'openrouter', current: '', onPick: (mid, providerId) => { api.setParam('provider', providerId || 'openrouter'); api.setParam('model', mid); api.rebuild(); } }); }
    }, 'gen-switch-free');
    s.appendChild(api.h('div', 'panel-note', 'Free OpenRouter models cost nothing but are rate-limited; the Demo provider stays offline and free.'));
  }
  // connection status + fix
  const st = providerStatus(b.params.provider);
  if (st === 'missing' || st === 'locked') {
    const note = api.h('div', 'pm-hint bad', st === 'locked' ? 'The key vault is locked.' : `No ${providerRegistry.get(b.params.provider)?.label || ''} key yet.`); s.appendChild(note);
    api.action(s, 'Open Connections', () => ui.openConnections(b.params.provider), 'gen-open-connections');
  }
  if (extra) extra(s);
  api.check(s, 'auto-run on input change', () => !!b.params.autoRun, (v) => api.setParam('autoRun', v), 'autoRun');
  api.num(s, 'approve above $', () => b.params.approveAbove ?? 0.05, (v) => api.setParam('approveAbove', Math.max(0, v)), { step: 0.01, min: 0, max: 100, attr: 'approveAbove' });
  s.appendChild(api.h('div', 'panel-note', 'Runs whose estimate is above this amount wait for your approval on the face (0 = never ask).'));
  // run controls
  const run = api.section('Run');
  api.readonly(run, 'status', () => { const j = b._job; if (j?.active) return `${j.stage}${j.queuePosition ? ` · #${j.queuePosition}` : ''} · ${fmtElapsed(j.elapsed)} · ${Math.round(j.progress * 100)}%`; if (b._finishing) return 'saving result'; if (b._err) return `failed · ${b._err.message}`; if (b._approval) return `waiting for approval (${fmtUSD(b._approval.estimate)})`; const c = b.state.current; return c ? `done · ${fmtElapsed(c.elapsed)} · ${c.cost === 0 ? 'free' : fmtUSD(c.cost)}` : 'idle'; });
  const btns = api.h('div', 'btn-group'); run.appendChild(btns);
  const mk = (text, fn, id) => { const x = api.h('button', null, text); x.type = 'button'; x.id = id; x.addEventListener('click', fn); btns.appendChild(x); return x; };
  const bRun = mk('Run', () => { const spec = b._buildSpec?.(); if (spec?.prompt) startRun(b, spec, { kind }); else api.world.overlays?.toast('Nothing to send — connect or type a prompt', 2000); }, 'gen-run');
  const bStop = mk('Stop', () => cancelRun(b), 'gen-stop');
  const bRetry = mk('Retry', () => { b._err = null; retryRun(b, kind); }, 'gen-retry');
  api.live(() => { const active = !!b._job?.active; bRun.disabled = active || !!b._approval; bStop.disabled = !active && !b._approval; bRetry.disabled = active || !b._lastSpec; });
  if (b._approval) api.action(run, `Approve · run for ${fmtUSD(b._approval.estimate)}`, () => { approveRun(b); api.rebuild(); }, 'gen-approve');
  // history
  const hist = api.section('History', false);
  const list = api.h('ul', 'pm-list gen-history'); hist.appendChild(list);
  const render = () => {
    const h = b.state.history || []; const cur = b.state.current;
    const sig = h.map((x) => x.id).join(',') + '|' + (cur?.id || '');
    if (list.dataset.sig === sig) return; list.dataset.sig = sig; list.innerHTML = '';
    if (!h.length) { list.appendChild(api.h('li', 'pm-group', 'no results yet')); return; }
    for (const rec of h) {
      const li = api.h('li'); li.classList.toggle('on', cur?.id === rec.id);
      const main = api.h('div', 'pm-main');
      main.appendChild(api.h('span', null, rec.text ? rec.text.slice(0, 60) : (rec.media || []).map((m) => m.title).join(', ') || rec.kind));
      main.appendChild(api.h('small', null, `${modelLabel(rec.provider, rec.model)} · ${rec.cost === 0 ? 'free' : fmtUSD(rec.cost)}`));
      li.appendChild(main);
      li.addEventListener('click', () => { selectHistory(b, rec.id); render(); });
      list.appendChild(li);
    }
  };
  render(); api.live(render);
  api.action(hist, 'Clear history', () => { clearHistory(b); render(); });
}
export const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Schema-driven rows for a media model's params (stored in params.options). */
export function buildOptionRows(api, b, s, kind) {
  const info = modelInfo(b.params.provider, b.params.model);
  const schema = info?.params || [];
  const get = (k, d) => (b.params.options && b.params.options[k] !== undefined ? b.params.options[k] : d);
  const set = (k) => (v) => api.setParam('options', { ...(b.params.options || {}), [k]: v });
  if (info?.needsReference) s.appendChild(api.h('div', 'panel-note', `${info.label} needs a reference ${kind === 'audio' ? 'voice clip' : 'image'} on the reference input.`));
  if (info?.unverified) s.appendChild(api.h('div', 'panel-note', 'Model id, fields and price are from the curated list (unverified against the live docs) — the first run will tell.'));
  for (const p of schema) {
    switch (p.type) {
      case 'select': api.select(s, p.label, p.options, () => String(get(p.key, p.default)), set(p.key), `opt-${p.key}`); break;
      case 'boolean': api.check(s, p.label, () => !!get(p.key, p.default), set(p.key), `opt-${p.key}`); break;
      case 'number': api.num(s, p.label, () => get(p.key, p.default) ?? '', (v) => set(p.key)(v), { step: p.step ?? 1, min: p.min, max: p.max, attr: `opt-${p.key}` }); break;
      default: api.text(s, p.label, () => String(get(p.key, p.default) ?? ''), set(p.key), `opt-${p.key}`);
    }
  }
}
/** Join multi `context` inputs into one text block. */
export function contextText(values) { return (values || []).map((v) => asText(v)).filter(Boolean).join('\n'); }
