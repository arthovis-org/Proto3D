// Generate Text — a language model call (OpenRouter or the offline Demo). Prompt in, streamed
// text out; `context` inputs become system context, an `image` input goes to vision models,
// JSON mode parses the answer into `data`, `when done` pulses with the text, `usage` reports
// tokens and cost. The face streams the answer as it arrives and keeps the last eight results.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { isMedia } from '../../core/types.js';
import { asText } from '../util.js';
import { evaluateCommon, drawGenerateFace, drawTextBody, facePointer, buildGeneratePanel, usageOf, contextText, hydrateState } from './common.js';

const KIND = 'text';
function buildSpec({ inputs, params }) {
  const prompt = inputs.prompt !== undefined ? asText(inputs.prompt) : String(params.prompt || '');
  const images = isMedia(inputs.image) && inputs.image.kind === 'image' ? [inputs.image.src] : [];
  return { kind: KIND, model: params.model, prompt, system: params.system || '', context: contextText(inputs.context), images, temperature: +params.temperature, maxTokens: Math.round(+params.maxTokens) || 1024, json: !!params.json };
}

export default registry.register({
  id: 'generate-text', category: 'generate', label: 'Generate Text', icon: icons['generate-text'], size: 'L',
  description: 'Ask a language model (OpenRouter or Demo): streams the answer, JSON mode, vision input, cost and tokens',
  inputs: [
    { key: 'prompt', label: 'prompt', type: 'text', optional: true },
    { key: 'context', label: 'context', type: 'any', multi: true, optional: true },
    { key: 'image', label: 'image', type: 'media', optional: true },
    { key: 'run', label: 'run', type: 'event', optional: true },
  ],
  outputs: [
    { key: 'text', label: 'text', type: 'text' },
    { key: 'data', label: 'data', type: 'data' },
    { key: 'done', label: 'when done', type: 'event' },
    { key: 'usage', label: 'usage', type: 'data' },
  ],
  params: [
    { key: 'provider', label: 'provider', type: 'select', options: ['demo', 'openrouter'], default: 'demo', hidden: true },
    { key: 'model', label: 'model', type: 'text', default: '', hidden: true },
    { key: 'prompt', label: 'prompt (when nothing is connected)', type: 'text', default: '', hidden: true },
    { key: 'system', label: 'system prompt', type: 'text', default: '', hidden: true },
    { key: 'temperature', label: 'temperature', type: 'number', default: 0.7, min: 0, max: 2, step: 0.1, hidden: true },
    { key: 'maxTokens', label: 'max tokens', type: 'number', default: 512, min: 16, max: 32000, step: 16, hidden: true },
    { key: 'json', label: 'JSON mode', type: 'boolean', default: false, hidden: true },
    { key: 'autoRun', label: 'auto-run on input change', type: 'boolean', default: false, hidden: true },
    { key: 'approveAbove', label: 'approve above $', type: 'number', default: 0.05, min: 0, max: 100, step: 0.01, hidden: true },
  ],
  describeLink(from, toDef, to, n) {
    if (from.key === 'text') return `${n.fromPoss} generated text goes to ${n.to}`;
    if (from.key === 'done') return toDef.id === 'kanban-board' && to.key === 'addTask' ? `When ${n.from} finishes, its text becomes a card on ${n.to}` : `When ${n.from} finishes, ${n.to} runs`;
    if (from.key === 'data') return `${n.fromPoss} parsed JSON goes to ${n.to}`;
    if (from.key === 'usage') return `${n.fromPoss} tokens and cost go to ${n.to}`;
    return null;
  },
  onCreate(inst) { hydrateState(inst); },
  evaluate(ctx) {
    const inst = ctx.instance;
    inst._buildSpec = () => buildSpec(ctx);
    const rec = evaluateCommon(ctx, KIND, buildSpec);
    const streaming = inst._job?.active && typeof inst._partial === 'string' ? inst._partial : undefined;
    return { text: streaming !== undefined ? streaming : rec?.text, data: rec?.data, usage: usageOf(rec) };
  },
  footer: ({ instance, outputs }) => (instance._job?.active ? `${instance._job.stage}…` : outputs.text ? `${outputs.text.length} chars` : 'idle'),
  face: {
    live: true, fps: 6,
    render(g, w, h, ctx) { drawGenerateFace(g, w, h, ctx, { kind: KIND, body: drawTextBody, promptText: buildSpec(ctx).prompt }); },
    onPointer(ctx, ev) { return facePointer(ctx, ev, KIND); },
  },
  panel(api, b) {
    buildGeneratePanel(api, b, KIND, {
      extra(s) {
        api.area(s, 'prompt (fallback)', () => b.params.prompt || '', (v) => api.setParam('prompt', v, 'prompt'), 'prompt', 3);
        s.appendChild(api.h('div', 'panel-note', 'Used when no prompt is connected. Connect a Prompt component for variables.'));
        api.area(s, 'system prompt', () => b.params.system || '', (v) => api.setParam('system', v, 'system'), 'system', 3);
        api.num(s, 'temperature', () => b.params.temperature, (v) => api.setParam('temperature', Math.min(2, Math.max(0, v))), { step: 0.1, min: 0, max: 2, attr: 'temperature' });
        api.num(s, 'max tokens', () => b.params.maxTokens, (v) => api.setParam('maxTokens', Math.max(16, Math.round(v))), { step: 16, min: 16, max: 32000, attr: 'maxTokens' });
        api.check(s, 'JSON mode', () => !!b.params.json, (v) => api.setParam('json', v), 'json');
        s.appendChild(api.h('div', 'panel-note', 'JSON mode asks the model for a JSON object and parses it into the data output.'));
      },
    });
  },
});
