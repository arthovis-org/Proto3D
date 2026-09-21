// Yes / no check — one `noul` question: a calibrated probability that the state meets your
// criterion. Above the threshold `pass` fires, below it `fail`; the guard in front of a costly
// generation or an Action.
import { registry } from '../../../src/core/registry.js';
import { icons } from '../../../src/icons.js';
import { palette } from '../../../src/theme.js';
import { clear, drawText, font, roundRect, tabular, PAD } from '../../../src/faces.js';
import { stateText, hash, runDecision, drawJevHeader, drawJevFooter, drawJevError, drawWaiting, drawStateExcerpt, bodyRect, statusOf, facePointer, footer, buildJevPanel, modeParam, runInput, stateInput, cancelDecision, pct, CATEGORY, scaled, anchorsOf } from './common.js';

const question = (p) => ({ ok: { type: 'noul', instructions: p.instructions || 'Does the state meet the criterion?', criteria: { true: p.criteria_true || 'yes', false: p.criteria_false || 'no' } } });

export default registry.register({
  id: 'jev-check', category: CATEGORY, label: 'Yes / no check', icon: icons['jev-check'], size: 'XL',   // the decision is the hero of every demo: the biggest face the core has
  description: 'Jev gives a calibrated probability for a yes / no question; pass or fail fires against your threshold',
  inputs: [stateInput, runInput],
  outputs: [
    { key: 'probability', label: 'probability', type: 'number' },
    { key: 'yes', label: 'yes', type: 'boolean' },
    { key: 'pass', label: 'pass', type: 'event' },
    { key: 'fail', label: 'fail', type: 'event' },
  ],
  params: [
    { key: 'instructions', label: 'instructions', type: 'text', default: 'Is this request on-topic for a product launch and free of personal data?', multiline: true, hidden: true },
    { key: 'criteria_true', label: 'true means', type: 'text', default: 'A marketing or content request about the product launch with no personal data', hidden: true },
    { key: 'criteria_false', label: 'false means', type: 'text', default: 'Off-topic, or it contains personal data such as phone numbers, email addresses or home addresses', hidden: true },
    { key: 'threshold', label: 'pass at ≥', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    modeParam,
  ],
  describeLink(from, toDef, to, n) { return from.type === 'event' ? `${n.to} runs only when the check ${from.key === 'pass' ? 'passes' : 'fails'}` : `${n.to} reads the check's ${from.label}`; },
  onDestroy(inst) { cancelDecision(inst); },
  evaluate(ctx) {
    const { inputs, params, emit, instance } = ctx;
    const text = stateText(inputs.state);
    const q = text ? question(params) : null;
    const key = q ? hash(JSON.stringify([text, q])) : null;
    const r = runDecision(ctx, { key, state: text, questions: q, mode: params.mode });
    instance._jevView = { ...r, text };
    const thr = +params.threshold || 0;
    if (r.landed?.answers?.ok) { const p = r.landed.answers.ok.noul; const payload = { probability: p, text }; emit(p >= thr ? 'pass' : 'fail', payload); }
    const p = r.last?.answers?.ok?.noul;
    if (p === undefined) return {};
    return { probability: p, yes: p >= thr };
  },
  footer,
  face: {
    live: true, fps: 4,
    portAnchors: ({ w, h }) => anchorsOf(w, h, { state: 96, run: (H) => H - PAD - 17, probability: 96, yes: 128, pass: (H) => H / 2 + 20, fail: (H) => H / 2 + 56 }),
    render(g, w0, h0, { params, instance, time }) {
      scaled(g, w0, h0, instance, (w, h) => {
        clear(g, w, h);
        const v = instance._jevView || { text: '' };
        const hits = []; instance._jevHits = hits;
        const top = drawJevHeader(g, w, { kind: `noul · pass at ${Math.round((+params.threshold || 0) * 100)}%`, question: params.instructions, status: statusOf(v), time });
        const box = bodyRect(w, h, top);
        const p = v.last?.answers?.ok?.noul;
        if (v.error) drawJevError(g, box.x, box.y, box.w, box.h, v.error, hits);
        else if (!v.text) drawWaiting(g, box, 'Connect the text to check — a prompt, a message, a payload');
        else if (p === undefined) drawWaiting(g, box, v.busy ? 'Reading the state…' : 'Press Run to check');
        else {
          const thr = +params.threshold || 0, yes = p >= thr;
          const color = yes ? palette.faceGood : palette.faceBad;
          // the verdict, big, then a wide probability bar with the threshold marker
          g.font = font(40, 700); g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'top';
          g.fillText(yes ? 'YES' : 'NO', box.x, box.y - 4);
          tabular(g); g.font = font(36, 600); g.fillStyle = palette.faceText; g.textAlign = 'right'; g.fillText(pct(p), box.x + box.w, box.y - 2);
          g.font = font(14, 500); g.fillStyle = palette.faceDim; g.textAlign = 'right'; g.fillText('probability of yes', box.x + box.w, box.y + 40);
          const by = box.y + 74, bh = 16;
          g.fillStyle = palette.faceLine; roundRect(g, box.x, by, box.w, bh, bh / 2); g.fill();
          g.fillStyle = color; roundRect(g, box.x, by, Math.max(bh, box.w * p), bh, bh / 2); g.fill();
          const mx = box.x + box.w * thr;
          g.fillStyle = palette.faceWarn; g.fillRect(mx - 1.5, by - 8, 3, bh + 16);
          g.font = font(13, 600); g.fillStyle = palette.faceWarn; g.textAlign = mx > box.x + box.w - 90 ? 'right' : 'left'; g.textBaseline = 'top'; g.fillText(`pass at ${pct(thr)}`, mx + (mx > box.x + box.w - 90 ? -8 : 8), by + bh + 10);
          const line = yes ? params.criteria_true : params.criteria_false;
          const r2 = drawText(g, line || '', box.x, by + bh + 34, box.w, 42, { size: 15, min: 12, color: palette.faceDim, align: 'left', valign: 'top', lineHeight: 1.35 });
          drawStateExcerpt(g, box, by + bh + 34 + r2.lines * r2.px * 1.35 + 12, v.text);
        }
        drawJevFooter(g, w, h, v, hits, { stale: v.stale && params.mode === 'manual' });
      });
    },
    onPointer: facePointer,
  },
  panel(api, b) {
    buildJevPanel(api, b, {
      title: 'Jev · check', instructionsRows: 2,
      extra(s) {
        api.area(s, 'true means', () => b.params.criteria_true, (v) => api.setParam('criteria_true', v, 'ct'), 'criteria_true', 2);
        api.area(s, 'false means', () => b.params.criteria_false, (v) => api.setParam('criteria_false', v, 'cf'), 'criteria_false', 2);
      },
    });
  },
});
