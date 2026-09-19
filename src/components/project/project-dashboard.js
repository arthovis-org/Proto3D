// Project Dashboard — one face that summarises a board: its title, done-ratio ring, per-column
// bars, overdue count, the burndown line (from the board's state history carried in `progress`),
// the next milestone and, when People are plugged into `people`, a load bar per person.
// `progress` re-emits the done ratio as a number for displays and logic.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, roundRect, font, drawText } from '../../faces.js';
import { daysUntil, fmtDate } from '../../pm/model.js';

export default registry.register({
  id: 'project-dashboard', category: 'project', label: 'Project Dashboard', icon: icons['project-dashboard'], size: 'L',
  description: 'One screen with a board\'s progress: done ring, column bars, burndown, milestone and each connected person\'s load',
  inputs: [
    { key: 'progress', label: 'progress', type: 'data', subtype: 'stats' },
    { key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks', optional: true },
    { key: 'milestone', label: 'milestone', type: 'data', subtype: 'milestone', optional: true },
    { key: 'people', label: 'people', type: 'data', subtype: 'person', multi: true, optional: true },
  ],
  outputs: [{ key: 'progress', label: 'progress', type: 'number' }],
  params: [{ key: 'caption', label: 'caption', type: 'text', default: '' }],
  evaluate({ inputs, upstream, state, instance }) {
    const s = inputs.progress;
    // the board's title is part of what this face shows: repaint when the relationship changes
    const src = upstream('progress')[0]?.node;
    const title = src ? src.title : '';
    if (title !== state.boardTitle) { state.boardTitle = title; instance.faceDirty = true; }
    return { progress: s && typeof s.doneRatio === 'number' ? s.doneRatio : undefined };
  },
  footer: ({ inputs, state }) => { const s = inputs.progress; return s ? `${state.boardTitle ? state.boardTitle + ' · ' : ''}${s.done} / ${s.total} done · ${s.overdue} overdue` : 'connect a board\'s progress'; },
  face: {
    render(g, w, h, { inputs, params, state }) {
      clear(g, w, h);
      const s = inputs.progress;
      if (!s || !Array.isArray(s.columns)) { drawText(g, 'connect a Kanban board\'s progress output', 0, 0, w, h, { size: 20, color: palette.faceDim }); return; }
      const pad = 14;
      // --- title strip: which board this is about
      g.fillStyle = palette.faceDim; g.font = font(13, 700); g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText((state.boardTitle || params.caption || 'board').toUpperCase(), pad, pad - 4);
      // --- left: done ring
      const r = Math.min(h * 0.28, w * 0.15);
      const cx = pad + r + 6, cy = pad + r + 26;
      g.lineWidth = r * 0.26; g.lineCap = 'round';
      g.strokeStyle = palette.faceCard; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#2dd4bf'; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.doneRatio || 0)); g.stroke();
      drawText(g, `${Math.round((s.doneRatio || 0) * 100)}%`, cx - r, cy - r, 2 * r, 2 * r, { size: r * 0.62, weight: 700, mono: true });
      drawText(g, `${s.done} of ${s.total} done`, cx - r - 20, cy + r + 8, 2 * r + 40, 22, { size: 15, color: palette.faceDim });
      // --- right top: per-column bars
      const bx = cx + r + 30, bw = w - bx - pad, bh = h * 0.42;
      const people = Array.isArray(inputs.people) ? inputs.people.filter((p) => p && p.name) : [];
      const cols = s.columns; const maxC = Math.max(1, ...cols.map((c) => c.count));
      const cw = bw / cols.length;
      cols.forEach((c, i) => {
        const x = bx + i * cw + 6, barW = Math.max(6, cw - 12);
        const hh = Math.max(4, (bh - 26) * c.count / maxC);
        g.fillStyle = c.overWip ? '#ff4d5e' : i === cols.length - 1 ? '#2dd4bf' : palette.faceAccent;
        roundRect(g, x, pad + bh - 26 - hh, barW, hh, 5); g.fill();
        g.fillStyle = palette.faceText; g.font = font(15, 700, true); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillText(String(c.count), x + barW / 2, pad + bh - 30 - hh);
        g.fillStyle = palette.faceDim; g.font = font(12, 500);
        let t = c.title; while (t.length > 2 && g.measureText(t).width > barW + 6) t = t.slice(0, -1);
        g.fillText(t === c.title ? t : t + '…', x + barW / 2, pad + bh - 8);
      });
      // --- right bottom: burndown line (and, with people connected, a load bar per person beside it)
      const ly = pad + bh + 10, lh = h - ly - pad - 26;
      const pw = people.length ? Math.min(bw * 0.46, 250) : 0;
      const lw = bw - pw - (pw ? 10 : 0);
      g.fillStyle = palette.faceCard; roundRect(g, bx, ly, lw, lh, 8); g.fill();
      const series = Array.isArray(s.burndown) ? s.burndown : [];
      if (series.length >= 2) {
        const maxR = Math.max(1, ...series.map((p) => p.total || p.remaining || 0));
        g.strokeStyle = palette.faceAccent; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
        series.forEach((p, i) => { const x = bx + 10 + (lw - 20) * (i / (series.length - 1)); const y = ly + lh - 8 - (lh - 16) * ((p.remaining || 0) / maxR); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
        g.strokeStyle = 'rgba(128,140,160,0.4)'; g.setLineDash([4, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx + 10, ly + 8); g.lineTo(bx + lw - 10, ly + lh - 8); g.stroke(); g.setLineDash([]);
      } else drawText(g, 'burndown: move cards to record points', bx, ly, lw, lh, { size: 13, color: palette.faceDim });
      g.fillStyle = palette.faceDim; g.font = font(12, 600); g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(`BURNDOWN · ${s.remaining ?? 0} of ${s.estimate ?? 0} d remaining`, bx + 8, ly + 5);
      if (pw) {
        const px = bx + lw + 10;
        g.fillStyle = palette.faceCard; roundRect(g, px, ly, pw, lh, 8); g.fill();
        g.fillStyle = palette.faceDim; g.font = font(12, 600); g.fillText(`PEOPLE · ${people.length}`, px + 8, ly + 5);
        const rowH = Math.min(30, (lh - 24) / Math.max(1, people.length));
        people.forEach((p, i) => {
          const y = ly + 22 + i * rowH;
          const cap = Math.max(1, +p.capacity || 1), load = +p.load || 0;
          g.fillStyle = palette.faceText; g.font = font(Math.min(14, rowH * 0.5), 600); g.textAlign = 'left'; g.textBaseline = 'middle';
          let name = String(p.name); while (name.length > 3 && g.measureText(name).width > pw * 0.42) name = name.slice(0, -1);
          g.fillText(name === p.name ? name : name + '…', px + 8, y + rowH / 2);
          const barX = px + 8 + pw * 0.44, barW = pw - 16 - pw * 0.44 - 34;
          g.fillStyle = 'rgba(128,140,160,0.3)'; roundRect(g, barX, y + rowH / 2 - 4, barW, 8, 4); g.fill();
          g.fillStyle = load > cap ? '#ff4d5e' : p.colour || palette.faceAccent; roundRect(g, barX, y + rowH / 2 - 4, barW * Math.min(1, load / cap), 8, 4); g.fill();
          g.fillStyle = load > cap ? '#ff4d5e' : palette.faceDim; g.font = font(11, 600, true); g.textAlign = 'right'; g.fillText(`${load}/${cap}`, px + pw - 8, y + rowH / 2);
        });
      }
      // --- bottom strip: overdue · blocked · next milestone
      const sy = h - pad - 18;
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillStyle = s.overdue ? '#ff4d5e' : palette.faceDim; g.font = font(17, 700);
      g.fillText(`${s.overdue} overdue`, pad, sy);
      g.fillStyle = palette.faceDim; g.font = font(15, 500);
      g.fillText(`${s.blocked || 0} blocked`, pad + 120, sy);
      const m = inputs.milestone;
      const mt = m && m.date ? `next: ${m.title} · ${fmtDate(m.date)}${Number.isFinite(daysUntil(m.date)) ? ` (${daysUntil(m.date)} d)` : ''}` : params.caption || '';
      g.textAlign = 'right'; g.fillStyle = m?.reached ? '#2dd4bf' : palette.faceText; g.font = font(15, 600);
      g.fillText(mt, w - pad, sy);
    },
  },
});
