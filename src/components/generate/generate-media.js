// Generate Image / Video / Audio — one factory, three registrations. A prompt (and an optional
// reference media) goes to fal.ai, kie.ai or the offline Demo; the result is a media object
// (`media`, the first item) plus `all` (every item of a batch), `when done` pulses with the media
// and `usage` reports cost. Model parameters are schema-driven from the provider's curated list
// (size / aspect / duration / voice…), stored in `options`. A Settings node on `settings`
// overrides them (size, steps, guidance, strength, seed, count, LoRA, style prefix), a `negative`
// prompt goes to the models that take one, Guides (`guides`, image and video) and a Mask (`mask`,
// image: inpainting) switch the adapter's endpoint. The face shows queue position, progress, the
// result preview and the history strip; cancel and retry work on the face and in the panel;
// errors come with a fix action (no key → Connections).
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { isMedia } from '../../core/types.js';
import { asText } from '../util.js';
import { evaluateCommon, drawGenerateFace, drawMediaBody, facePointer, buildGeneratePanel, buildOptionRows, usageOf, hydrateState, modelInfo, generateAnchors, applySettings } from './common.js';

const NOUN = { image: 'an image', video: 'a video clip', audio: 'audio' };
const DESC = {
  image: 'Text (and an optional reference image) to an image — FLUX, Recraft, Ideogram, Nano Banana… through fal, kie or the offline Demo',
  video: 'Text (and an optional reference image) to a short video clip — MiniMax, Kling, Veo, Luma… through fal, kie or the offline Demo',
  audio: 'Text to music, sound or speech — Stable Audio, Kokoro TTS, Suno… through fal, kie or the offline Demo',
};

const isGuide = (v) => !!(v && typeof v === 'object' && typeof v.mode === 'string' && isMedia(v.image));
function definition(kind) {
  const visual = kind !== 'audio';
  const buildSpec = ({ inputs, params }) => {
    const prompt = inputs.prompt !== undefined ? asText(inputs.prompt) : String(params.prompt || '');
    const reference = isMedia(inputs.reference) ? inputs.reference : undefined;
    const seed = params.seed === '' || params.seed === null || params.seed === undefined ? undefined : +params.seed;
    const info = modelInfo(params.provider, params.model);
    const spec = { kind, model: params.model, prompt, options: { ...(params.options || {}) }, reference, count: kind === 'image' ? Math.max(1, Math.min(4, Math.round(+params.count) || 1)) : 1, seed };
    const negative = inputs.negative !== undefined ? asText(inputs.negative) : String(params.negative || '');
    if (negative.trim() && (info?.negativeField || params.provider === 'demo')) spec.negative = negative.trim();   // dropped for models without a negative prompt field
    if (visual) {
      const guides = (inputs.guides || []).filter(isGuide);
      if (guides.length) spec.guides = guides;
      if (kind === 'image' && isMedia(inputs.mask)) spec.mask = inputs.mask;
    }
    return applySettings(spec, inputs.settings, info);
  };
  return {
    id: `generate-${kind}`, category: 'generate', label: `Generate ${kind[0].toUpperCase()}${kind.slice(1)}`, icon: icons[`generate-${kind}`], size: 'L',
    description: DESC[kind],
    inputs: [
      { key: 'prompt', label: 'prompt', type: 'text', optional: true },
      { key: 'negative', label: 'negative', type: 'text', optional: true },
      { key: 'settings', label: 'settings', type: 'data', subtype: 'settings', optional: true },
      { key: 'reference', label: 'reference', type: 'media', optional: true },
      ...(visual ? [{ key: 'guides', label: 'guides', type: 'data', subtype: 'guide', multi: true, optional: true }] : []),
      ...(kind === 'image' ? [{ key: 'mask', label: 'mask', type: 'media', optional: true }] : []),
      { key: 'run', label: 'run', type: 'event', optional: true },
    ],
    outputs: [
      { key: 'media', label: kind, type: 'media' },
      { key: 'all', label: 'all', type: 'data' },
      { key: 'done', label: 'when done', type: 'event' },
      { key: 'usage', label: 'usage', type: 'data' },
    ],
    params: [
      { key: 'provider', label: 'provider', type: 'select', options: ['demo', 'fal', 'kie'], default: 'demo', hidden: true },
      { key: 'model', label: 'model', type: 'text', default: '', hidden: true },
      { key: 'prompt', label: 'prompt (when nothing is connected)', type: 'text', default: '', hidden: true },
      { key: 'negative', label: 'negative prompt (when nothing is connected)', type: 'text', default: '', hidden: true },
      { key: 'options', label: 'model options', type: 'json', default: {}, hidden: true },
      { key: 'seed', label: 'seed', type: 'text', default: '', hidden: true },
      { key: 'count', label: 'count', type: 'number', default: 1, min: 1, max: 4, step: 1, hidden: true },
      { key: 'autoRun', label: 'auto-run on input change', type: 'boolean', default: false, hidden: true },
      { key: 'approveAbove', label: 'approve above $', type: 'number', default: 0.05, min: 0, max: 100, step: 0.01, hidden: true },
    ],
    describeLink(from, toDef, to, n) {
      if (from.key === 'media') return toDef.id === 'kanban-board' && to.key === 'cover' ? `${n.fromPoss} ${kind} becomes a card cover on ${n.to}` : toDef.id === 'media-grid' ? `${n.fromPoss} ${kind} joins the ${n.to} gallery` : toDef.id === 'image-edit' ? `${n.to} edits ${n.fromPoss} ${kind}` : toDef.id === 'enhance' ? `${n.to} enhances ${n.fromPoss} ${kind}` : toDef.id === 'generate-guide' ? `${n.fromPoss} ${kind} guides through ${n.to}` : toDef.id === 'generate-mask' ? `${n.fromPoss} ${kind} sizes the mask of ${n.to}` : to.key === 'reference' ? `${n.fromPoss} ${kind} is the reference for ${n.to}` : `${n.fromPoss} ${kind} shows on ${n.to}`;
      if (from.key === 'done') return `When ${n.from} finishes, ${n.to} runs`;
      if (from.key === 'all') return `${n.fromPoss} whole batch goes to ${n.to}`;
      if (from.key === 'usage') return `${n.fromPoss} cost goes to ${n.to}`;
      return null;
    },
    onCreate(inst) { hydrateState(inst); },
    evaluate(ctx) {
      const inst = ctx.instance;
      inst._buildSpec = () => buildSpec(ctx);
      const rec = evaluateCommon(ctx, kind, buildSpec);
      return { media: rec?.media?.[0], all: rec?.media, usage: usageOf(rec) };
    },
    footer: ({ instance, outputs }) => (instance._job?.active ? `${instance._job.stage}${instance._job.queuePosition ? ` · #${instance._job.queuePosition}` : ''}` : outputs.media ? `${outputs.media.title || kind}${outputs.all?.length > 1 ? ` · ${outputs.all.length} items` : ''}` : 'idle'),
    face: {
      live: true, fps: 6,
      portAnchors: generateAnchors,
      render(g, w, h, ctx) { drawGenerateFace(g, w, h, ctx, { kind, body: (g2, x, y, bw, bh, rec, inst, running) => drawMediaBody(g2, x, y, bw, bh, rec, inst, running, kind, ctx.time), promptText: buildSpec(ctx).prompt }); },
      onPointer(ctx, ev) { return facePointer(ctx, ev, kind); },
    },
    panel(api, b) {
      buildGeneratePanel(api, b, kind, {
        extra(s) {
          api.area(s, 'prompt (fallback)', () => b.params.prompt || '', (v) => api.setParam('prompt', v, 'prompt'), 'prompt', 3);
          s.appendChild(api.h('div', 'panel-note', `Used when no prompt is connected. The result is ${NOUN[kind]} on the "${kind}" output; a Media Grid, a screen, a Display or a card cover can take it.`));
          const info = modelInfo(b.params.provider, b.params.model);
          api.area(s, 'negative prompt (fallback)', () => b.params.negative || '', (v) => api.setParam('negative', v, 'negative'), 'negative', 2);
          const negNote = api.h('div', 'panel-note'); negNote.id = 'gen-negative-note'; s.appendChild(negNote);
          const updNeg = () => { const i = modelInfo(b.params.provider, b.params.model); const t = i?.negativeField || b.params.provider === 'demo' ? 'What the model should avoid; the connected "negative" input wins over this text.' : 'negative prompt ignored by this model'; if (negNote.textContent !== t) negNote.textContent = t; negNote.classList.toggle('pm-hint', !(i?.negativeField || b.params.provider === 'demo')); }; updNeg(); api.live(updNeg);
          if (visual) s.appendChild(api.h('div', 'panel-note', `A Settings node on "settings" overrides size, steps, guidance, strength, seed and count. Guides (image to image, edges, depth, pose, style) on "guides"${kind === 'image' ? ' and a Mask on "mask" (inpainting)' : ''} pick the matching fal endpoint; kie refuses them; Demo shows the effect offline.`));
          buildOptionRows(api, b, s, kind);
          if (kind === 'image' && !(info?.params || []).some((p) => p.key === 'num_images')) api.num(s, 'count', () => b.params.count || 1, (v) => api.setParam('count', Math.max(1, Math.min(4, Math.round(v)))), { step: 1, min: 1, max: 4, attr: 'count' });
          api.text(s, 'seed (blank = random)', () => String(b.params.seed ?? ''), (v) => api.setParam('seed', v.replace(/[^\d]/g, ''), 'seed'), 'seed');
        },
      });
    },
  };
}
export const generateImage = registry.register(definition('image'));
export const generateVideo = registry.register(definition('video'));
export const generateAudio = registry.register(definition('audio'));
