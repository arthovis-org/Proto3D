// Checklist — items with done flags. Edit them in the panel or click a row on the 3D face to
// toggle it (undoable). `progress` is 0..1; `when complete` pulses once when every item is done.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, typography } from '../../theme.js';
import { clear, roundRect, font, drawText, PAD, drawCaps, drawBar, drawDivider, fitLine } from '../../faces.js';
import * as cmd from '../../core/commands.js';
import { buildChecklistPanel } from '../../pm/panel-pm.js';

const ROW = 38;
const itemsOf = (params) => (Array.isArray(params.items) ? params.items : []);

export default registry.register({
  id: 'checklist', category: 'project', label: 'Checklist', icon: icons.checklist, size: 'M',
  description: 'A list of items to tick off by clicking the rows on its face',
  outputs: [{ key: 'progress', label: 'progress', type: 'number' }, { key: 'done', label: 'when complete', type: 'event' }],
  params: [{ key: 'items', label: 'items', type: 'json', default: [{ text: 'Kick-off meeting', done: true }, { text: 'Write the brief', done: false }, { text: 'Review with the team', done: false }], hidden: true }],
  panel: buildChecklistPanel,
  evaluate({ params, state, emit }) {
    const items = itemsOf(params);
    const done = items.filter((i) => i.done).length;
    const progress = items.length ? +(done / items.length).toFixed(3) : 0;
    const complete = items.length > 0 && done === items.length;
    if (complete && !state.wasComplete) emit('done', { items: items.length });
    state.wasComplete = complete;
    return { progress };
  },
  footer: ({ params, outputs }) => { const items = itemsOf(params); return `${items.filter((i) => i.done).length} / ${items.length} · ${Math.round((outputs.progress || 0) * 100)} %`; },
  face: {
    render(g, w, h, { params, instance, outputs }) {
      clear(g, w, h);
      const items = itemsOf(params);
      const P = PAD;
      // header row: progress caps + thin bar
      const done = items.filter((i) => i.done).length;
      drawCaps(g, `${done} of ${items.length} done`, P, P + 6);
      drawBar(g, P, P + 20, w - 2 * P, 4, items.length ? done / items.length : 0, { fill: done === items.length && items.length ? palette.faceGood : palette.faceAccent });
      const top = P + 40;
      const rows = Math.max(1, Math.floor((h - top - 12) / ROW));
      const scroll = instance.state.scroll || 0;
      if (!items.length) { drawText(g, 'no items — add some in the panel', 0, top, w, h - top, { size: 17, color: palette.faceDim }); return; }
      items.slice(scroll, scroll + rows).forEach((it, i) => {
        const y = top + i * ROW;
        if (i) drawDivider(g, P, y, w - 2 * P);
        const bx = P, by = y + (ROW - 20) / 2;
        if (it.done) { g.fillStyle = palette.faceGood; roundRect(g, bx, by, 20, 20, 6); g.fill(); g.strokeStyle = '#0b2a22'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(bx + 5, by + 10.5); g.lineTo(bx + 8.5, by + 14); g.lineTo(bx + 15, by + 6.5); g.stroke(); }
        else { g.strokeStyle = palette.faceDim; g.lineWidth = 1.5; roundRect(g, bx + 0.75, by + 0.75, 18.5, 18.5, 5.5); g.stroke(); }
        g.fillStyle = it.done ? palette.faceDim : palette.faceText; g.font = font(typography.scale.label, it.done ? 400 : 500); g.textAlign = 'left'; g.textBaseline = 'middle';
        const s2 = fitLine(g, it.text || '', w - 2 * P - 34);
        g.fillText(s2, P + 34, y + ROW / 2);
        if (it.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 1.2; g.beginPath(); g.moveTo(P + 34, y + ROW / 2); g.lineTo(P + 34 + g.measureText(s2).width, y + ROW / 2); g.stroke(); }
      });
      if (items.length > rows) { g.fillStyle = palette.faceDim; g.font = font(12, 500); g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText(`${scroll + 1}–${Math.min(items.length, scroll + rows)} of ${items.length} · click bottom edge to scroll`, w - P, h - 8); }
    },
    onPointer({ params, instance }, ev) {
      if (ev.type !== 'click') return false;
      const items = itemsOf(params);
      const h = instance.face.canvas.height;
      const top = PAD + 40;
      const rows = Math.max(1, Math.floor((h - top - 12) / ROW));
      const y = ev.v * h;
      if (items.length > rows && y > h - 22) { instance.state.scroll = ((instance.state.scroll || 0) + rows) % items.length; return true; }
      const row = Math.floor((y - top) / ROW) + (instance.state.scroll || 0);
      if (row < 0 || row >= items.length) return false;
      const next = items.map((it, i) => (i === row ? { ...it, done: !it.done } : it));
      const c = cmd.setParam(instance.world, instance, 'items', next); c.label = 'Toggle item';
      if (instance.world?.history) instance.world.history.execute(c); else c.do();
      return true;
    },
  },
});
