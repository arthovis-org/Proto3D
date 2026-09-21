// Score on a rubric — one `score` question: an ordered ladder of 2–10 levels, a probability per
// level and the expected level as a number. Triage, sentiment, severity, quality gates.
import { registry } from '../../../src/core/registry.js';
import { icons } from '../../../src/icons.js';
import { palette } from '../../../src/theme.js';
import { clear, font, fitLine, tabular, PAD } from '../../../src/faces.js';
import { stateText, hash, runDecision, drawJevHeader, drawBars, drawConfidence, drawJevFooter, drawJevError, drawWaiting, drawStateExcerpt, bodyRect, statusOf, facePointer, footer, buildJevPanel, buildListEditor, modeParam, runInput, stateInput, cancelDecision, CATEGORY, scaled, anchorsOf } from './common.js';

export const DEFAULT_LEVELS = ['low', 'medium', 'high', 'critical'];
/** 2–10 non-empty level names, lowest first. */
export function levelsOf(params, fallback = DEFAULT_LEVELS) {
  const raw = Array.isArray(params.levels) ? params.levels.map((l) => (typeof l === 'string' ? l : l?.label ?? '')).map((s) => String(s).trim()).filter(Boolean) : [];
  return (raw.length >= 2 ? raw : fallback).slice(0, 10);
}
const question = (p, levels) => ({ level: { type: 'score', instructions: p.instructions || 'Score the state on this rubric', criteria: levels } });
/** The level name nearest an expected score. */
export const levelAt = (levels, score) => levels[Math.max(0, Math.min(levels.length - 1, Math.round(score ?? 0)))];

export default registry.register({
  id: 'jev-score', category: CATEGORY, label: 'Score on a rubric', icon: icons['jev-score'], size: 'XL',   // the decision is the hero of every demo: the biggest face the core has
  description: 'Jev places the state on an ordered ladder of levels: expected score, a probability per level and the winning level name',
  inputs: [stateInput, runInput],
  outputs: [
    { key: 'score', label: 'score', type: 'number' },
    { key: 'level', label: 'level', type: 'text' },
    { key: 'confidence', label: 'confidence', type: 'number' },
    { key: 'probabilities', label: 'probabilities', type: 'data' },
    { key: 'scored', label: 'scored', type: 'event' },
  ],
  params: [
    { key: 'instructions', label: 'instructions', type: 'text', default: 'How urgent is this for the launch?', multiline: true, hidden: true },
    { key: 'levels', label: 'levels', type: 'json', default: DEFAULT_LEVELS, hidden: true },
    modeParam,
  ],
  describeLink(from, toDef, to, n) { return from.type === 'event' ? `${n.to} runs when a new score lands` : `${n.to} reads the ${from.label}`; },
  onDestroy(inst) { cancelDecision(inst); },
  evaluate(ctx) {
    const { inputs, params, emit, instance } = ctx;
    const levels = levelsOf(params);
    const text = stateText(inputs.state);
    const q = text ? question(params, levels) : null;
    const key = q ? hash(JSON.stringify([text, q])) : null;
    const r = runDecision(ctx, { key, state: text, questions: q, mode: params.mode });
    instance._jevView = { ...r, levels, text };
    if (r.landed?.answers?.level) { const a = r.landed.answers.level; emit('scored', { score: a.score, level: levelAt(levels, a.score), confidence: a.confidence, text }); }
    const a = r.last?.answers?.level;
    if (!a) return {};
    return { score: a.score, level: levelAt(levels, a.score), confidence: a.confidence, probabilities: a.probabilities };
  },
  footer,
  face: {
    live: true, fps: 4,
    portAnchors: ({ w, h }) => anchorsOf(w, h, { state: 96, run: (H) => H - PAD - 17, score: 96, level: 128, confidence: 160, probabilities: 192, scored: (H) => H - PAD - 17 }),
    render(g, w0, h0, { params, instance, time }) {
      scaled(g, w0, h0, instance, (w, h) => {
        clear(g, w, h);
        const v = instance._jevView || { levels: levelsOf(params), text: '' };
        const hits = []; instance._jevHits = hits;
        const top = drawJevHeader(g, w, { kind: `score · ${v.levels.length} levels`, question: params.instructions, status: statusOf(v), time });
        const box = bodyRect(w, h, top);
        const a = v.last?.answers?.level;
        if (v.error) drawJevError(g, box.x, box.y, box.w, box.h, v.error, hits);
        else if (!v.text) drawWaiting(g, box, 'Connect the text to score — a card, a message, a draft');
        else if (!a) drawWaiting(g, box, v.busy ? 'Reading the state…' : 'Press Run to score');
        else {
          const lv = v.levels, win = levelAt(lv, a.score);
          tabular(g); g.font = font(36, 600); g.fillStyle = palette.faceText; g.textAlign = 'left'; g.textBaseline = 'top';
          g.fillText(fitLine(g, win, box.w - 260), box.x, box.y - 6);
          g.font = font(15, 500); g.fillStyle = palette.faceDim; g.fillText(`expected level ${a.score.toFixed(2)} of ${lv.length - 1}`, box.x, box.y + 36);
          drawConfidence(g, box.x + box.w - 150, box.y, a.confidence);
          // the ladder reads top-down from the highest level
          const rows = [...lv].reverse().map((l, k) => ({ key: l, label: l, p: a.probabilities?.[String(lv.length - 1 - k)] ?? 0 }));
          const rowH = Math.min(30, Math.floor((box.h - 62) / Math.max(rows.length, 1)));
          const yEnd = drawBars(g, box.x, box.y + 62, box.w, rows, { rowH, win });
          drawStateExcerpt(g, box, yEnd + 10, v.text);
        }
        drawJevFooter(g, w, h, v, hits, { stale: v.stale && params.mode === 'manual' });
      });
    },
    onPointer: facePointer,
  },
  panel(api, b) {
    buildJevPanel(api, b, {
      title: 'Jev · score', instructionsRows: 2,
      extra(s) { buildListEditor(api, s, { label: 'levels, lowest first (2–10)', get: () => levelsOf(b.params), set: (list) => api.setParam('levels', list, 'levels'), min: 2, max: 10, fields: ['label'], placeholder: ['level'], hint: 'Jev reads the level names literally and is weak at numeric proximity: name the levels, do not number them.' }); },
    });
  },
});
