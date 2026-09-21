// Route by meaning — one `choice` question: Jev picks one of your lanes for whatever text arrives
// (a message, a card, an event payload). Below the confidence threshold the decision goes to
// `unsure` instead, so a human sees the doubtful ones. Lane events carry { lane, text, confidence }.
import { registry } from '../../../src/core/registry.js';
import { icons } from '../../../src/icons.js';
import { palette } from '../../../src/theme.js';
import { clear, drawText, font, fitLine, PAD } from '../../../src/faces.js';
import { stateText, hash, runDecision, drawJevHeader, drawBars, drawConfidence, drawJevFooter, drawJevError, drawWaiting, drawStateExcerpt, bodyRect, statusOf, facePointer, footer, buildJevPanel, buildListEditor, syncPortLabels, modeParam, runInput, stateInput, cancelDecision, CATEGORY, scaled, anchorsOf } from './common.js';

export const DEFAULT_LANES = [
  { key: 'returns', label: 'Returns', description: 'Exchanges, wrong or damaged items, sizes, refunds' },
  { key: 'shipping', label: 'Shipping', description: 'Delivery status, tracking, late or missing parcels' },
  { key: 'billing', label: 'Billing', description: 'Charges, invoices, cards and payments' },
];
export const MAX_LANES = 6;
const slug = (s, i) => String(s || `lane${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `lane${i + 1}`;
/** 2–6 lanes with a key, a label and a description, whatever the param holds. */
export function lanesOf(params) {
  const raw = Array.isArray(params.lanes) ? params.lanes : [];
  const list = raw.map((l, i) => (typeof l === 'string' ? { key: slug(l, i), label: l, description: '' } : { key: slug(l.key || l.label, i), label: String(l.label || l.key || `Lane ${i + 1}`), description: String(l.description || '') })).filter((l) => l.label.trim());
  return (list.length >= 2 ? list : DEFAULT_LANES).slice(0, MAX_LANES);
}
const question = (params, lanes) => ({ lane: { type: 'choice', instructions: params.instructions || 'Which lane does this belong to?', criteria: Object.fromEntries(lanes.map((l) => [l.label, l.description || l.label])) } });
const laneIndex = (lanes, choice) => lanes.findIndex((l) => l.label === choice || l.key === choice);

export default registry.register({
  id: 'jev-route', category: CATEGORY, label: 'Route by meaning', icon: icons['jev-route'], size: 'XL',   // the decision is the hero of every demo: the biggest face the core has
  description: 'Jev picks one of your lanes for any text and fires that lane\'s event; doubtful ones go to unsure',
  inputs: [stateInput, runInput],
  outputs: [
    { key: 'choice', label: 'lane', type: 'text' },
    { key: 'confidence', label: 'confidence', type: 'number' },
    { key: 'probabilities', label: 'probabilities', type: 'data' },
    ...Array.from({ length: MAX_LANES }, (_, i) => ({ key: `lane${i + 1}`, label: DEFAULT_LANES[i]?.label || `lane ${i + 1}`, type: 'event' })),
    { key: 'unsure', label: 'unsure', type: 'event' },
    { key: 'decided', label: 'decided', type: 'event' },
  ],
  params: [
    { key: 'instructions', label: 'instructions', type: 'text', default: 'Which team should handle this customer message?', multiline: true, hidden: true },
    { key: 'lanes', label: 'lanes', type: 'json', default: DEFAULT_LANES, hidden: true },
    { key: 'threshold', label: 'confidence floor', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05 },
    modeParam,
  ],
  describeLink(from, toDef, to, n) { return from.type === 'event' ? `${n.to} runs when Jev routes to ${from.label}` : `${n.to} reads Jev's ${from.label}`; },
  onDestroy(inst) { cancelDecision(inst); },
  evaluate(ctx) {
    const { inputs, params, emit, instance } = ctx;
    const lanes = lanesOf(params);
    syncPortLabels(instance, lanes.map((l) => l.label));
    const text = stateText(inputs.state);
    const q = text ? question(params, lanes) : null;
    const key = q ? hash(JSON.stringify([text, q])) : null;
    const r = runDecision(ctx, { key, state: text, questions: q, mode: params.mode });
    instance._jevView = { ...r, lanes, text };
    const thr = +params.threshold || 0;
    if (r.landed?.answers?.lane) {
      const a = r.landed.answers.lane; const i = laneIndex(lanes, a.choice);
      // lane events carry the routed text itself (a desk screen shows it as it is); `decided` carries the whole verdict
      if (i >= 0 && a.confidence >= thr) emit(`lane${i + 1}`, text); else emit('unsure', text);
      emit('decided', { lane: i >= 0 ? lanes[i].key : null, label: a.choice, confidence: a.confidence, text, probabilities: a.probabilities });
    }
    const a = r.last?.answers?.lane;
    if (!a) return {};
    const i = laneIndex(lanes, a.choice);
    return { choice: a.confidence >= thr && i >= 0 ? lanes[i].key : 'unsure', confidence: a.confidence, probabilities: a.probabilities };
  },
  footer,
  face: {
    live: true, fps: 4,
    portAnchors: ({ w, h }) => anchorsOf(w, h, { state: 96, run: (H) => H - PAD - 17, choice: 96, confidence: 128, probabilities: 160 }),
    render(g, w0, h0, { params, instance, time }) {
      scaled(g, w0, h0, instance, (w, h) => {
        clear(g, w, h);
        const v = instance._jevView || { lanes: lanesOf(params), text: '' };
        const hits = []; instance._jevHits = hits;
        const top = drawJevHeader(g, w, { kind: `choice · ${v.lanes.length} lanes · floor ${Math.round((+params.threshold || 0) * 100)}%`, question: params.instructions, status: statusOf(v), time });
        const box = bodyRect(w, h, top);
        const a = v.last?.answers?.lane;
        if (v.error) drawJevError(g, box.x, box.y, box.w, box.h, v.error, hits);
        else if (!v.text) drawWaiting(g, box, 'Connect some text to state — a phone, a Text node, a card');
        else if (!a) drawWaiting(g, box, v.busy ? 'Reading the state…' : 'Press Run to decide');
        else {
          const thr = +params.threshold || 0; const unsure = a.confidence < thr;
          const i = v.lanes.findIndex((l) => l.label === a.choice);
          g.font = font(27, 600); g.fillStyle = unsure ? palette.faceWarn : palette.faceText; g.textAlign = 'left'; g.textBaseline = 'top';
          g.fillText(fitLine(g, unsure ? 'Unsure — ask a human' : `→ ${a.choice}`, box.w - 190), box.x, box.y);
          drawConfidence(g, box.x + box.w - 175, box.y, a.confidence, thr);
          const rows = v.lanes.map((l) => ({ key: l.label, label: l.label, p: a.probabilities?.[l.label] ?? 0 }));
          const rowH = Math.min(32, Math.floor((box.h - 44) / Math.max(rows.length, 1)));
          const yEnd = drawBars(g, box.x, box.y + 44, box.w, rows, { rowH, win: unsure ? null : v.lanes[i]?.label });
          drawStateExcerpt(g, box, yEnd + 10, v.text);
        }
        drawJevFooter(g, w, h, v, hits, { stale: v.stale && params.mode === 'manual' });
      });
    },
    onPointer: facePointer,
  },
  panel(api, b) {
    buildJevPanel(api, b, {
      title: 'Jev · route', instructionsRows: 2,
      extra(s) {
        buildListEditor(api, s, { label: 'lanes (2–6)', get: () => lanesOf(b.params).map(({ label, description }) => ({ label, description })), set: (list) => api.setParam('lanes', list.map((l, i) => ({ key: slug(l.label, i), label: l.label, description: l.description })), 'lanes'), placeholder: ['lane', 'what belongs here'], hint: 'Jev reads the lane names and descriptions literally; a good description is a short list of what belongs there.' });
      },
    });
  },
});
