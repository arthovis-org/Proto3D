// Rank a list — one `score` question per item (up to 40) in a single systemone request: the list
// is the state, each question scopes itself to one item. Items come from anything: an array, a
// board's `tasks`, several plain values, lines of text. Sorted by expected score, highest first.
import { registry } from '../../../src/core/registry.js';
import { icons } from '../../../src/icons.js';
import { palette } from '../../../src/theme.js';
import { clear, font, fitLine, tabular, drawBar, PAD } from '../../../src/faces.js';
import { flattenItems, hash, runDecision, drawJevHeader, drawJevFooter, drawJevError, drawWaiting, bodyRect, statusOf, facePointer, footer, buildJevPanel, buildListEditor, modeParam, runInput, cancelDecision, pct, CATEGORY, scaled, anchorsOf } from './common.js';
import { levelsOf, levelAt } from './jev-score.js';

export const RANK_LEVELS = ['not urgent', 'low', 'medium', 'high', 'critical'];
export const MAX_ITEMS = 40;
const questions = (p, levels, items) => Object.fromEntries(items.map((it, i) => [`i${i}`, { type: 'score', instructions: `${p.instructions || 'How high does this item rank?'} Item: "${it.text}"`, criteria: levels }]));

/** Merge answers back onto the items and sort, highest expected score first. */
export function rankedFrom(items, answers, levels, limit) {
  const rows = items.map((it, i) => { const a = answers?.[`i${i}`]; return { id: it.id, text: it.text, ref: it.ref, score: a?.score ?? 0, level: a ? levelAt(levels, a.score) : null, confidence: a?.confidence ?? 0, probabilities: a?.probabilities || null }; });
  rows.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export default registry.register({
  id: 'jev-rank', category: CATEGORY, label: 'Rank a list', icon: icons['jev-rank'], size: 'XL',   // the decision is the hero of every demo: the biggest face the core has
  description: 'Jev scores every item of a list on your rubric in one request and returns it sorted, highest first',
  inputs: [{ key: 'items', label: 'items', type: 'any', multi: true, optional: true }, runInput],
  outputs: [
    { key: 'ranked', label: 'ranked', type: 'data' },
    { key: 'top', label: 'top item', type: 'text' },
    { key: 'ranked_text', label: 'as text', type: 'text' },
    { key: 'ranked_event', label: 'ranked', type: 'event' },
  ],
  params: [
    { key: 'instructions', label: 'what "higher" means', type: 'text', default: 'How urgent is this card for the launch?', multiline: true, hidden: true },
    { key: 'levels', label: 'levels', type: 'json', default: RANK_LEVELS, hidden: true },
    { key: 'limit', label: 'keep top (0 = all)', type: 'number', default: 0, min: 0, max: 40, step: 1 },
    modeParam,
  ],
  describeLink(from, toDef, to, n) { return from.type === 'event' ? `${n.to} runs when a new ranking lands` : `${n.to} reads the ranking`; },
  onDestroy(inst) { cancelDecision(inst); },
  evaluate(ctx) {
    const { inputs, params, emit, instance } = ctx;
    const levels = levelsOf(params, RANK_LEVELS);
    const items = flattenItems(inputs.items, MAX_ITEMS);
    const q = items.length ? questions(params, levels, items) : null;
    const state = items.map((it) => it.text);
    const key = q ? hash(JSON.stringify([state, q])) : null;
    const r = runDecision(ctx, { key, state, questions: q, mode: params.mode });
    const limit = Math.round(+params.limit) || 0;
    const ranked = r.last?.answers && items.length ? rankedFrom(items, r.last.answers, levels, limit) : null;
    instance._jevView = { ...r, items, levels, ranked };
    if (r.landed && ranked) emit('ranked_event', ranked.map(({ ref, ...row }) => row));
    if (!ranked) return {};
    const plain = ranked.map(({ ref, ...row }) => row);
    return { ranked: plain, top: ranked[0]?.text, ranked_text: ranked.map((row, i) => `${i + 1}. ${row.text} — ${row.level} (${row.score.toFixed(1)})`).join('\n') };
  },
  footer,
  face: {
    live: true, fps: 4,
    portAnchors: ({ w, h }) => anchorsOf(w, h, { items: 96, run: (H) => H - PAD - 17, ranked: 96, top: 128, ranked_text: 160, ranked_event: (H) => H - PAD - 17 }),
    render(g, w0, h0, { params, instance, time }) {
      scaled(g, w0, h0, instance, (w, h) => {
        clear(g, w, h);
        const v = instance._jevView || { items: [], ranked: null };
        const hits = []; instance._jevHits = hits;
        const top = drawJevHeader(g, w, { kind: `score × ${v.items.length} item${v.items.length === 1 ? '' : 's'} · ${v.levels.length} levels`, question: params.instructions, status: statusOf(v), time });
        const box = bodyRect(w, h, top);
        if (v.error) drawJevError(g, box.x, box.y, box.w, box.h, v.error, hits);
        else if (!v.items.length) drawWaiting(g, box, 'Connect a list — a board\'s tasks, an array, several values');
        else if (!v.ranked) drawWaiting(g, box, v.busy ? `Scoring ${v.items.length} items…` : 'Press Run to rank');
        else {
          const rowH = Math.min(38, Math.floor(box.h / 5)); const n = Math.min(5, v.ranked.length, Math.floor(box.h / rowH));
          const max = v.levels.length - 1;
          for (let i = 0; i < n; i++) {
            const row = v.ranked[i]; const y = box.y + i * rowH; const cy = y + rowH / 2;
            tabular(g); g.font = font(14, 600); g.fillStyle = i === 0 ? palette.faceAccent : palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle';
            g.fillText(String(i + 1), box.x, cy + 0.5);
            g.font = font(16, i === 0 ? 600 : 500); g.fillStyle = palette.faceText;
            g.fillText(fitLine(g, row.text, box.w - 256), box.x + 24, cy + 0.5);
            drawBar(g, box.x + box.w - 210, cy - 4, 130, 8, max ? row.score / max : 0, { fill: i === 0 ? palette.faceAccent : palette.faceDim });
            g.font = font(13.5, 500); g.fillStyle = palette.faceDim; g.textAlign = 'right'; g.fillText(`${row.level} · ${pct(row.confidence)}`, box.x + box.w, cy + 0.5);
          }
          if (v.ranked.length > n) { g.font = font(13, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(`+ ${v.ranked.length - n} more on the ranked output`, box.x + 22, box.y + n * rowH + 2); }
        }
        drawJevFooter(g, w, h, v, hits, { stale: v.stale && params.mode === 'manual' });
      });
    },
    onPointer: facePointer,
  },
  panel(api, b) {
    buildJevPanel(api, b, {
      title: 'Jev · rank', instructionsRows: 2,
      extra(s) { buildListEditor(api, s, { label: 'levels, lowest first (2–10)', get: () => levelsOf(b.params, RANK_LEVELS), set: (list) => api.setParam('levels', list, 'levels'), min: 2, max: 10, fields: ['label'], placeholder: ['level'], hint: 'One score question per item, all in a single request (up to 40 items).' }); },
    });
  },
});
