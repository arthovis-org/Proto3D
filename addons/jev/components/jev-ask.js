// Ask Jev — the playground node: the raw API shape. Type a state and a `questions` map exactly as
// the systemone endpoint takes them (noul / choice / score) and read every answer on the face.
// Where you learn what the three primitives return before you wire the specialised nodes.
import { registry } from '../../../src/core/registry.js';
import { icons } from '../../../src/icons.js';
import { palette } from '../../../src/theme.js';
import { clear, font, fitLine, tabular, drawBar, drawDivider, PAD } from '../../../src/faces.js';
import { stateText, hash, runDecision, drawJevHeader, drawJevFooter, drawJevError, drawWaiting, bodyRect, statusOf, facePointer, footer, buildJevPanel, modeParam, runInput, stateInput, cancelDecision, pct, CATEGORY, scaled, anchorsOf } from './common.js';

export const DEFAULT_STATE = 'My running shoes arrived in the wrong size. Can I swap them for a size 10?';
export const DEFAULT_QUESTIONS = {
  department: { type: 'choice', instructions: 'Which team should handle this?', criteria: { returns: 'Exchanges, wrong or damaged items', shipping: 'Delivery status', billing: 'Charges, invoices' } },
  is_urgent: { type: 'noul', instructions: 'Does this need attention right now?' },
  frustration: { type: 'score', instructions: 'How frustrated is the customer?', criteria: ['calm', 'annoyed', 'angry'] },
};
const validQuestions = (q) => q && typeof q === 'object' && !Array.isArray(q) && Object.values(q).every((x) => x && typeof x === 'object' && ['noul', 'choice', 'score'].includes(x.type));

/** One line per answer, for the `summary` output. */
export function summarize(answers) {
  return Object.entries(answers || {}).map(([id, a]) => {
    if (a.type === 'noul') return `${id}: ${pct(a.noul)} yes`;
    if (a.type === 'choice') return `${id}: ${a.choice} (${pct(a.probabilities?.[a.choice])}, confidence ${pct(a.confidence)})`;
    if (a.type === 'score') return `${id}: ${a.legend?.[String(Math.round(a.score))] ?? a.score} (${(a.score ?? 0).toFixed(2)}, confidence ${pct(a.confidence)})`;
    return `${id}: ${JSON.stringify(a)}`;
  }).join('\n');
}

export default registry.register({
  id: 'jev-ask', category: CATEGORY, label: 'Ask Jev', icon: icons['jev-ask'], size: 'XL',   // the decision is the hero of every demo: the biggest face the core has
  description: 'The raw API: a state and a map of noul / choice / score questions, every answer on the face',
  inputs: [stateInput, runInput],
  outputs: [{ key: 'answers', label: 'answers', type: 'data' }, { key: 'summary', label: 'summary', type: 'text' }, { key: 'answered', label: 'answered', type: 'event' }],
  params: [
    { key: 'state', label: 'state', type: 'text', default: DEFAULT_STATE, multiline: true, hidden: true },
    { key: 'questions', label: 'questions', type: 'json', default: DEFAULT_QUESTIONS },
    modeParam,
  ],
  onDestroy(inst) { cancelDecision(inst); },
  evaluate(ctx) {
    const { inputs, params, emit, instance } = ctx;
    const text = stateText(inputs.state) || String(params.state || '');
    const ok = validQuestions(params.questions);
    const key = text && ok ? hash(JSON.stringify([text, params.questions])) : null;
    const r = runDecision(ctx, { key, state: text, questions: params.questions, mode: params.mode });
    instance._jevView = { ...r, text, badQuestions: !ok };
    if (r.landed) emit('answered', r.landed.answers);
    const answers = r.last?.answers;
    if (!answers) return {};
    return { answers, summary: summarize(answers) };
  },
  footer,
  face: {
    live: true, fps: 4,
    portAnchors: ({ w, h }) => anchorsOf(w, h, { state: 96, run: (H) => H - PAD - 17, answers: 96, summary: 128, answered: (H) => H - PAD - 17 }),
    render(g, w0, h0, { params, instance, time }) {
      scaled(g, w0, h0, instance, (w, h) => {
        clear(g, w, h);
        const v = instance._jevView || { text: '' };
        const hits = []; instance._jevHits = hits;
        const n = Object.keys(params.questions || {}).length;
        const top = drawJevHeader(g, w, { kind: `${n} question${n === 1 ? '' : 's'} · raw api`, question: v.text, status: statusOf(v), time });
        const box = bodyRect(w, h, top);
        const answers = v.last?.answers;
        if (v.error) drawJevError(g, box.x, box.y, box.w, box.h, v.error, hits);
        else if (v.badQuestions) drawWaiting(g, box, 'questions must be a map of { type: noul | choice | score, instructions, criteria }');
        else if (!answers) drawWaiting(g, box, v.busy ? 'Asking…' : 'Press Run to ask');
        else drawAnswers(g, box, answers);
        drawJevFooter(g, w, h, v, hits, { stale: v.stale && params.mode === 'manual' });
      });
    },
    onPointer: facePointer,
  },
  panel(api, b) {
    buildJevPanel(api, b, {
      title: 'Jev · ask', instructionsRows: 0,
      before(s) {
        api.area(s, 'state', () => b.params.state, (v) => api.setParam('state', v, 'state'), 'state', 3);
        const p = api.h('div', 'panel-note', 'The questions param below is the raw API map. Three types: noul → { noul }, choice → { choice, probabilities, confidence }, score → { score, probabilities, confidence, legend }.');
        s.appendChild(p);
      },
    });
  },
});

/** Each answer on one compact row: id · type-specific readout · a small bar. */
function drawAnswers(g, box, answers) {
  const entries = Object.entries(answers);
  const rowH = Math.min(48, Math.floor(box.h / Math.max(entries.length, 1)));
  entries.forEach(([id, a], i) => {
    const y = box.y + i * rowH, cy = y + rowH / 2 - 2;
    g.font = font(14, 600); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(fitLine(g, id, 130), box.x, cy);
    g.font = font(11, 600); g.fillStyle = palette.faceAccent; g.fillText(a.type, box.x, cy + 17);
    const x = box.x + 146, w = box.w - 146;
    tabular(g); g.font = font(17, 600); g.fillStyle = palette.faceText;
    if (a.type === 'noul') { g.fillText(`${pct(a.noul)} yes`, x, cy); drawBar(g, x + 110, cy - 4, w - 110, 8, a.noul, { fill: a.noul >= 0.5 ? palette.faceGood : palette.faceBad }); }
    else if (a.type === 'choice') {
      g.fillText(fitLine(g, `${a.choice} · ${pct(a.probabilities?.[a.choice])}`, w * 0.45), x, cy);
      g.font = font(12, 500); g.fillStyle = palette.faceDim; g.textAlign = 'right';
      g.fillText(fitLine(g, `confidence ${pct(a.confidence)} · ${Object.entries(a.probabilities || {}).filter(([k]) => k !== a.choice).map(([k, p]) => `${k} ${pct(p)}`).join(' · ')}`, w * 0.55), box.x + box.w, cy);
    } else if (a.type === 'score') {
      const legend = a.legend || {}; const win = legend[String(Math.round(a.score))] ?? a.score;
      g.fillText(fitLine(g, `${win} · ${(a.score ?? 0).toFixed(2)}`, w * 0.45), x, cy);
      const keys = Object.keys(a.probabilities || {}); const max = Math.max(1, keys.length - 1);
      drawBar(g, x + w * 0.5, cy - 4, w * 0.5, 8, max ? a.score / max : 0, { fill: palette.faceAccent });
      g.font = font(11.5, 500); g.fillStyle = palette.faceDim; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(`confidence ${pct(a.confidence)}`, box.x + box.w, cy + 8);
    }
    if (i < entries.length - 1) drawDivider(g, box.x, y + rowH - 1, box.w);
  });
}
