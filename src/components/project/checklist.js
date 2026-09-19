// Checklist — items with done flags. Edit them in the panel or click a row on the 3D face to
// toggle it (undoable). `progress` is 0..1; `when complete` pulses once when every item is done.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, roundRect, font, drawText } from '../../faces.js';
import * as cmd from '../../core/commands.js';
import { buildChecklistPanel } from '../../pm/panel-pm.js';

const ROW = 40;
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
    render(g, w, h, { params, instance }) {
      clear(g, w, h);
      const items = itemsOf(params);
      const rows = Math.max(1, Math.floor((h - 16) / ROW));
      const scroll = instance.state.scroll || 0;
      if (!items.length) { drawText(g, 'no items — add some in the panel', 0, 0, w, h, { size: 18, color: palette.faceDim }); return; }
      items.slice(scroll, scroll + rows).forEach((it, i) => {
        const y = 8 + i * ROW;
        g.fillStyle = it.done ? '#2dd4bf' : palette.faceCard; roundRect(g, 14, y + 8, 24, 24, 6); g.fill();
        if (it.done) { g.strokeStyle = '#06231f'; g.lineWidth = 3; g.beginPath(); g.moveTo(19, y + 20); g.lineTo(25, y + 26); g.lineTo(34, y + 13); g.stroke(); }
        g.fillStyle = it.done ? palette.faceDim : palette.faceText; g.font = font(20, it.done ? 500 : 600); g.textAlign = 'left'; g.textBaseline = 'middle';
        let s = it.text || ''; while (s.length > 1 && g.measureText(s).width > w - 70) s = s.slice(0, -1);
        g.fillText(s === it.text ? s : s + '…', 50, y + 20);
        if (it.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 2; g.beginPath(); g.moveTo(50, y + 20); g.lineTo(50 + g.measureText(s).width, y + 20); g.stroke(); }
      });
      if (items.length > rows) { g.fillStyle = palette.faceDim; g.font = font(14); g.textAlign = 'right'; g.fillText(`${scroll + 1}–${Math.min(items.length, scroll + rows)} of ${items.length} · click bottom edge to scroll`, w - 10, h - 10); }
    },
    onPointer({ params, instance }, ev) {
      if (ev.type !== 'click') return false;
      const items = itemsOf(params);
      const h = instance.face.canvas.height;
      const rows = Math.max(1, Math.floor((h - 16) / ROW));
      const y = ev.v * h;
      if (items.length > rows && y > h - 22) { instance.state.scroll = ((instance.state.scroll || 0) + rows) % items.length; return true; }
      const row = Math.floor((y - 8) / ROW) + (instance.state.scroll || 0);
      if (row < 0 || row >= items.length) return false;
      const next = items.map((it, i) => (i === row ? { ...it, done: !it.done } : it));
      const c = cmd.setParam(instance.world, instance, 'items', next); c.label = 'Toggle item';
      if (instance.world?.history) instance.world.history.execute(c); else c.do();
      return true;
    },
  },
});
