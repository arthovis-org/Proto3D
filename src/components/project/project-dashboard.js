// Project Dashboard — one face that summarises a board: stat tiles (done %, overdue, blocked,
// days remaining), a done ring, per-column bars, the burndown line (from the board's state
// history carried in `progress`), the next milestone, a load bar per connected Person and a
// progress bar per connected Checklist. `progress` re-emits the done ratio as a number.
// Restrained palette: neutral greys, the accent for the board's own numbers, green for done,
// red only for what is wrong (overdue, over WIP).
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, typography } from '../../theme.js';
import { clear, roundRect, font, drawText, PAD, drawCaps, drawBar, drawDivider, drawTile, drawStat, fitLine, tabular } from '../../faces.js';
import { daysUntil, fmtDate, fmtHours, HOURS_PER_DAY } from '../../pm/model.js';

/** Vertical layout of the face (logical px): shared by the renderer and the port anchors so the pins stay level with their panels. */
function rows(w, h) {
  const P = PAD, tileY = P + 40, tileH = 74;
  const secY = tileY + tileH + 16, r = Math.min(h * 0.16, 44), cy = secY + r + 8, bh = 2 * r + 16;
  const ly = secY + bh + 18, lh = h - ly - P;
  return { P, tileY, tileH, secY, r, cy, bh, ly, lh };
}

export default registry.register({
  id: 'project-dashboard', category: 'project', label: 'Project Dashboard', icon: icons['project-dashboard'], size: 'L',
  description: 'One screen with a board\'s progress: stat tiles, done ring, column bars, burndown, milestone, people load and checklists',
  inputs: [
    { key: 'progress', label: 'progress', type: 'data', subtype: 'stats' },
    { key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks', optional: true },
    { key: 'milestone', label: 'milestone', type: 'data', subtype: 'milestone', optional: true },
    { key: 'people', label: 'people', type: 'data', subtype: 'person', multi: true, optional: true },
    { key: 'checklists', label: 'checklists', type: 'number', multi: true, optional: true },
  ],
  outputs: [{ key: 'progress', label: 'progress', type: 'number' }],
  params: [{ key: 'caption', label: 'caption', type: 'text', default: '' }],
  evaluate({ inputs, upstream, state, instance }) {
    const s = inputs.progress;
    // the board's title is part of what this face shows: repaint when the relationship changes
    const src = upstream('progress')[0]?.node;
    const title = src ? src.title : '';
    if (title !== state.boardTitle) { state.boardTitle = title; instance.faceDirty = true; }
    const lists = upstream('checklists').map((u, i) => ({ title: u.node.title, value: Array.isArray(inputs.checklists) ? inputs.checklists[i] : undefined }));
    const sig = JSON.stringify(lists);
    if (sig !== instance._chkSig) { instance._chkSig = sig; instance._checklists = lists; instance.faceDirty = true; }
    return { progress: s && typeof s.doneRatio === 'number' ? s.doneRatio : undefined };
  },
  footer: ({ inputs, state }) => { const s = inputs.progress; return s ? `${state.boardTitle ? state.boardTitle + ' · ' : ''}${s.done} / ${s.total} done · ${s.overdue} overdue` : 'connect a board\'s progress'; },
  face: {
    /** Each input beside the panel it fills: progress → stat tiles, tasks → column bars, milestone → header line, people / checklists → the side tile; the progress output beside the done ring. */
    portAnchors({ w, h }) {
      const R = rows(w, h);
      return {
        in: { progress: R.tileY + R.tileH / 2, tasks: R.cy, milestone: R.P + 22, people: R.ly + R.lh * 0.35, checklists: R.ly + R.lh * 0.78 },
        out: { progress: R.cy },
      };
    },
    render(g, w, h, { inputs, params, state, instance }) {
      clear(g, w, h);
      const s = inputs.progress;
      const P = PAD;
      if (!s || !Array.isArray(s.columns)) { drawText(g, 'Drop a Kanban board here (or connect its progress) to see its health', P, 0, w - 2 * P, h, { size: 18, color: palette.faceDim, lineHeight: 1.4 }); return; }
      // --- header: which board · caption
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = palette.faceText; g.font = font(typography.scale.title, 600);
      g.fillText(fitLine(g, state.boardTitle || params.caption || 'Board', w * 0.6), P, P + 24);
      const m = inputs.milestone;
      if (m && m.date) {
        const dl = daysUntil(m.date);
        g.textAlign = 'right'; g.fillStyle = m.reached ? palette.faceGood : palette.faceDim; g.font = font(13, 500);
        g.fillText(`${m.title} · ${fmtDate(m.date)}${Number.isFinite(dl) ? (dl >= 0 ? ` · ${dl} d` : ` · ${-dl} d ago`) : ''}`, w - P, P + 22);
      } else if (params.caption) { g.textAlign = 'right'; g.fillStyle = palette.faceDim; g.font = font(13, 500); g.fillText(params.caption, w - P, P + 22); }
      // --- stat tiles
      const R = rows(w, h);
      const tileY = R.tileY, tileH = R.tileH, gap = 8;
      // time logged: from the `tasks` rows when connected (each carries `logged` minutes), else from the board's progress stats
      const rows2 = Array.isArray(inputs.tasks) ? inputs.tasks : null;
      const logged = rows2 ? rows2.reduce((a, r) => a + (r.logged || 0), 0) : s.loggedMinutes || 0;
      const estMin = rows2 ? rows2.reduce((a, r) => a + Math.round((Number.isFinite(+r.estimate) ? +r.estimate : 0) * HOURS_PER_DAY * 60), 0) : s.estimateMinutes || 0;
      const tiles = [
        ['done', `${Math.round((s.doneRatio || 0) * 100)}%`, palette.faceText, `${s.done} of ${s.total}`],
        ['overdue', String(s.overdue || 0), s.overdue ? palette.faceBad : palette.faceText, ''],
        ['blocked', String(s.blocked || 0), palette.faceText, ''],
        ['remaining', `${s.remaining ?? 0}d`, palette.faceText, `of ${s.estimate ?? 0}d`],
        ['logged', fmtHours(logged), logged > estMin && estMin ? palette.faceBad : palette.faceText, `of ${fmtHours(estMin)}`],
      ];
      const tw = (w - 2 * P - gap * (tiles.length - 1)) / tiles.length;
      tiles.forEach(([label, value, color, sub], i) => drawStat(g, P + i * (tw + gap), tileY, tw, tileH, label, value, { color, sub }));
      // --- ring + column bars
      const secY = R.secY, r = R.r;
      const cx = P + r, cy = R.cy;
      g.lineWidth = r * 0.22; g.lineCap = 'round';
      g.strokeStyle = palette.faceLine; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = palette.faceGood; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.doneRatio || 0)); g.stroke();
      tabular(g); drawText(g, `${Math.round((s.doneRatio || 0) * 100)}%`, cx - r, cy - r, 2 * r, 2 * r, { size: r * 0.55, weight: 600 });
      const bx = cx + r + 24, bw = w - bx - P, bh = R.bh;
      drawCaps(g, 'columns', bx, secY + 6);
      const cols = s.columns; const maxC = Math.max(1, ...cols.map((c) => c.count));
      const cw = bw / cols.length;
      const barTop = secY + 20, barBottom = secY + bh - 16;
      cols.forEach((c, i) => {
        const x = bx + i * cw + 4, barW = Math.max(6, cw - 8);
        const hh = Math.max(4, (barBottom - barTop - 18) * c.count / maxC);
        g.fillStyle = c.overWip ? palette.faceBad : i === cols.length - 1 ? palette.faceGood : palette.faceAccent;
        roundRect(g, x, barBottom - hh, barW, hh, 4); g.fill();
        tabular(g); g.fillStyle = palette.faceText; g.font = font(13, 600); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillText(String(c.count), x + barW / 2, barBottom - hh - 5);
        g.fillStyle = palette.faceDim; g.font = font(11, 500);
        g.fillText(fitLine(g, c.title, barW + 4), x + barW / 2, barBottom + 14);
      });
      // --- lower: burndown · people · checklists
      const ly = R.ly, lh = R.lh;
      if (lh < 40) return;
      const people = Array.isArray(inputs.people) ? inputs.people.filter((p) => p && p.name) : [];
      const lists = instance._checklists || [];
      const side = people.length || lists.length ? Math.min(bw * 0.5, 250) : 0;
      const lw = w - 2 * P - side - (side ? 12 : 0);
      drawTile(g, P, ly, lw, lh);
      drawCaps(g, 'burndown', P + 12, ly + 16);
      const series = Array.isArray(s.burndown) ? s.burndown : [];
      if (series.length >= 2) {
        const maxR = Math.max(1, ...series.map((p) => p.total || p.remaining || 0));
        const x0 = P + 12, x1 = P + lw - 12, y0 = ly + 30, y1 = ly + lh - 12;
        g.strokeStyle = palette.faceLine; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y1); g.lineTo(x1, y1); g.stroke();
        g.strokeStyle = palette.faceDim; g.setLineDash([3, 5]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
        g.strokeStyle = palette.faceAccent; g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
        series.forEach((p, i) => { const x = x0 + (x1 - x0) * (i / (series.length - 1)); const y = y1 - (y1 - y0) * ((p.remaining || 0) / maxR); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
      } else drawText(g, 'move cards to record points', P, ly + 20, lw, lh - 20, { size: 13, color: palette.faceDim });
      if (side) {
        const px = P + lw + 12;
        drawTile(g, px, ly, side, lh);
        let y = ly + 16;
        const rowH = 22;
        if (people.length) {
          drawCaps(g, `people · ${people.length}`, px + 12, y); y += 14;
          for (const p of people) {
            if (y + rowH > ly + lh - 4) break;
            const cap = Math.max(1, +p.capacity || 1), load = +p.load || 0;
            g.fillStyle = palette.faceText; g.font = font(13, 500); g.textAlign = 'left'; g.textBaseline = 'middle';
            g.fillText(fitLine(g, String(p.name), side * 0.4), px + 12, y + rowH / 2);
            const barX = px + 12 + side * 0.42, barW = side - 24 - side * 0.42 - 36;
            drawBar(g, barX, y + rowH / 2 - 3, barW, 6, load / cap, { fill: load > cap ? palette.faceBad : p.colour || palette.faceAccent });
            tabular(g); g.fillStyle = load > cap ? palette.faceBad : palette.faceDim; g.font = font(11, 600); g.textAlign = 'right'; g.fillText(`${load}/${cap}`, px + side - 12, y + rowH / 2);
            y += rowH;
          }
        }
        if (lists.length && y + 30 < ly + lh) {
          if (people.length) { drawDivider(g, px + 12, y + 4, side - 24); y += 12; }
          drawCaps(g, `checklists · ${lists.length}`, px + 12, y); y += 14;
          for (const c of lists) {
            if (y + rowH > ly + lh - 4) break;
            const v = typeof c.value === 'number' ? c.value : 0;
            g.fillStyle = palette.faceText; g.font = font(13, 500); g.textAlign = 'left'; g.textBaseline = 'middle';
            g.fillText(fitLine(g, c.title, side * 0.4), px + 12, y + rowH / 2);
            const barX = px + 12 + side * 0.42, barW = side - 24 - side * 0.42 - 36;
            drawBar(g, barX, y + rowH / 2 - 3, barW, 6, v, { fill: v >= 1 ? palette.faceGood : palette.faceAccent });
            tabular(g); g.fillStyle = palette.faceDim; g.font = font(11, 600); g.textAlign = 'right'; g.fillText(`${Math.round(v * 100)}%`, px + side - 12, y + rowH / 2);
            y += rowH;
          }
        }
      }
    },
  },
});
