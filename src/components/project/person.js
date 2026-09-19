// Person — a team member: name, role, colour, capacity. Plug its `person` output into a board's
// `people` slot and the relationship works both ways: the board lays out this person's cards
// (highlight / filter / swimlane), and the person's face lists every card assigned to them on
// every board they are connected to, grouped by column, with due dates (overdue in red) and a
// load bar against capacity. The panel shows the same list; clicking a row opens that card on
// its board. `tasks` is an optional explicit feed (a board's `tasks` output) for the same list.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, drawText, roundRect, font } from '../../faces.js';
import { initials, fmtDate, PRIORITY_COLOURS, daysUntil } from '../../pm/model.js';
import { personTasks, groupByColumn } from '../../pm/relations.js';
import { buildPersonPanel } from '../../pm/panel-pm.js';

const sig = (rows) => rows.map((r) => `${r.board.uid}:${r.card.id}:${r.column.id}:${r.card.title}:${r.card.due}:${r.card.priority}`).join('|');

export default registry.register({
  id: 'person', category: 'project', label: 'Person', icon: icons.person, size: 'L',
  description: 'A team member whose card lists their tasks on every board it is plugged into',
  inputs: [{ key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks', multi: true, optional: true }],
  outputs: [
    { key: 'person', label: 'person', type: 'data', subtype: 'person' },
    { key: 'load', label: 'load', type: 'number' },
    { key: 'summary', label: 'task list', type: 'text' },
  ],
  params: [
    { key: 'name', label: 'name', type: 'text', default: 'Alex' },
    { key: 'role', label: 'role', type: 'text', default: 'Engineer' },
    { key: 'colour', label: 'colour', type: 'color', default: '#5aa9ff' },
    { key: 'capacity', label: 'capacity (open tasks)', type: 'number', default: 4, min: 1, max: 50, step: 1 },
  ],
  panel: buildPersonPanel,
  evaluate({ params, state, instance }) {
    const rows = personTasks(instance);
    const open = rows.filter((r) => !r.done);
    const s = sig(rows);
    if (s !== instance._sig) { instance._sig = s; instance.faceDirty = true; }
    instance._tasks = rows;
    const lines = open.map((r) => `• ${r.card.title} — ${r.column.title}${r.card.due ? ` · due ${fmtDate(r.card.due)}${r.overdue ? ' (overdue)' : ''}` : ''}`);
    const summary = `${params.name} · ${open.length} open of ${rows.length}\n${lines.join('\n') || (rows.length ? 'all done' : 'no tasks yet')}`;
    return {
      person: {
        id: instance.uid, name: params.name, role: params.role, colour: params.colour, capacity: params.capacity, load: open.length,
        tasks: rows.map((r) => ({ id: r.card.id, title: r.card.title, column: r.column.title, due: r.card.due, priority: r.card.priority, done: r.done, overdue: r.overdue, board: r.board.title })),
      },
      load: open.length,
      summary,
    };
  },
  footer: ({ params, outputs }) => `${outputs.load ?? 0} / ${params.capacity} open ${params.role ? '· ' + params.role : ''}`,
  face: {
    render(g, w, h, { params, outputs, instance }) {
      clear(g, w, h);
      const rows = instance._tasks || [];
      const open = rows.filter((r) => !r.done);
      // header: avatar, name, role, load bar
      const r = 34;
      g.fillStyle = params.colour || '#5aa9ff'; g.beginPath(); g.arc(16 + r, 16 + r, r, 0, Math.PI * 2); g.fill();
      drawText(g, initials(params.name), 16, 16, 2 * r, 2 * r, { size: r * 0.9, weight: 700, color: '#fff' });
      const x = 32 + 2 * r;
      drawText(g, params.name || '—', x, 12, w - x - 150, 34, { size: 30, weight: 700, align: 'left' });
      drawText(g, params.role || '', x, 46, w - x - 150, 22, { size: 17, color: palette.faceDim, align: 'left' });
      const load = outputs.load ?? open.length, cap = Math.max(1, params.capacity);
      const bw = 130, bx = w - bw - 14, by = 44, bh = 10;
      g.fillStyle = palette.faceCard; roundRect(g, bx, by, bw, bh, 5); g.fill();
      g.fillStyle = load > cap ? '#ff4d5e' : params.colour || '#5aa9ff'; roundRect(g, bx, by, bw * Math.min(1, load / cap), bh, 5); g.fill();
      g.fillStyle = load > cap ? '#ff4d5e' : palette.faceDim; g.font = font(15, 600, true); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.fillText(`${load} / ${cap} open`, w - 14, by - 8);
      g.fillStyle = palette.faceDim; g.font = font(12, 500); g.fillText(rows.length ? `${rows.length} task${rows.length === 1 ? '' : 's'} on ${new Set(rows.map((t) => t.board)).size} board${new Set(rows.map((t) => t.board)).size === 1 ? '' : 's'}` : 'no board yet', w - 14, by + 26);
      // task list grouped by column
      let y = 16 + 2 * r + 16;
      g.strokeStyle = palette.faceGrid; g.lineWidth = 2; g.beginPath(); g.moveTo(14, y - 8); g.lineTo(w - 14, y - 8); g.stroke();
      if (!rows.length) {
        drawText(g, 'Plug me into a board\'s people slot\nto see my tasks here', 14, y, w - 28, h - y - 12, { size: 20, color: palette.faceDim, lineHeight: 1.35 });
        return;
      }
      const ROW = 26, HEAD = 22;
      const groups = groupByColumn(rows);
      const total = groups.reduce((a, gr) => a + HEAD + gr.rows.length * ROW, 0);
      const avail = h - y - 10;
      let left = Math.floor(avail / ROW) + groups.length;   // rough budget of rows we can draw
      outer: for (const gr of groups) {
        if (y + HEAD > h - 12) break;
        g.fillStyle = palette.faceDim; g.font = font(12, 700); g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(gr.column.toUpperCase(), 14, y + HEAD / 2);
        g.fillText(String(gr.rows.length), w - 14 - g.measureText(String(gr.rows.length)).width, y + HEAD / 2);
        y += HEAD;
        for (const t of gr.rows) {
          if (y + ROW > h - 8) { g.fillStyle = palette.faceDim; g.font = font(13, 500); g.fillText(`+ ${total - (y - (16 + 2 * r + 16))} more…`, 14, y + 4); break outer; }
          g.fillStyle = PRIORITY_COLOURS[t.card.priority] || PRIORITY_COLOURS.medium; roundRect(g, 16, y + 8, 8, 10, 2); g.fill();
          const dueText = t.card.due ? (t.overdue ? `! ${fmtDate(t.card.due)}` : t.done ? 'done' : daysUntil(t.card.due) === 0 ? 'today' : fmtDate(t.card.due)) : t.done ? 'done' : '';
          g.font = font(13, t.overdue ? 700 : 500); const dw = dueText ? g.measureText(dueText).width : 0;
          g.fillStyle = t.overdue ? '#ff4d5e' : palette.faceDim; g.textAlign = 'right'; g.fillText(dueText, w - 14, y + ROW / 2);
          g.textAlign = 'left'; g.fillStyle = t.done ? palette.faceDim : palette.faceText; g.font = font(16, t.done ? 500 : 600);
          const maxW = w - 30 - 14 - dw - 12;
          let s = t.card.title; while (s.length > 1 && g.measureText(s).width > maxW) s = s.slice(0, -1);
          g.fillText(s === t.card.title ? s : s + '…', 32, y + ROW / 2);
          if (t.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 1.5; g.beginPath(); g.moveTo(32, y + ROW / 2); g.lineTo(32 + g.measureText(s).width, y + ROW / 2); g.stroke(); }
          y += ROW; left -= 1;
        }
      }
    },
  },
});
