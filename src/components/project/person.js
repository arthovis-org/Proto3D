// Person — a team member: name, role, colour, capacity. Plug its `person` output into a board's
// `people` slot and the relationship works both ways: the board lays out this person's cards
// (highlight / filter / swimlane), and the person's face lists every card assigned to them on
// every board they are connected to, grouped by column, with due dates (overdue in red) and a
// load bar against capacity. The panel shows the same list; clicking a row opens that card on
// its board. `tasks` is an optional explicit feed (a board's `tasks` output) for the same list.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, typography } from '../../theme.js';
import { clear, drawText, roundRect, font, PAD, drawAvatar, drawBar, drawCaps, drawDivider, fitLine, tabular } from '../../faces.js';
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
      const P = PAD;
      // header: avatar · name / role · load
      const r = 30;
      drawAvatar(g, initials(params.name), P + r, P + r, r, params.colour || palette.faceAccent);
      const x = P + 2 * r + 16;
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = palette.faceText; g.font = font(typography.scale.title, 600);
      g.fillText(fitLine(g, params.name || '—', w - x - P - 150), x, P + 28);
      g.fillStyle = palette.faceDim; g.font = font(typography.scale.subtitle, 500);
      g.fillText(fitLine(g, params.role || '', w - x - P - 150), x, P + 52);
      const load = outputs.load ?? open.length, cap = Math.max(1, params.capacity);
      const bw = 132, bx = w - bw - P, by = P + 22;
      tabular(g); g.font = font(14, 600); g.textAlign = 'right'; g.fillStyle = load > cap ? palette.faceBad : palette.faceText;
      g.fillText(`${load} / ${cap} open`, w - P, P + 12);
      drawBar(g, bx, by, bw, 6, load / cap, { fill: load > cap ? palette.faceBad : params.colour || palette.faceAccent });
      const boards = new Set(rows.map((t) => t.board)).size;
      g.fillStyle = palette.faceDim; g.font = font(12, 500);
      g.fillText(rows.length ? `${rows.length} task${rows.length === 1 ? '' : 's'} · ${boards} board${boards === 1 ? '' : 's'}` : 'no board yet', w - P, by + 26);
      // task list grouped by column
      let y = P + 2 * r + 20;
      drawDivider(g, P, y - 8, w - 2 * P);
      if (!rows.length) {
        drawText(g, 'Drop me on a board (or plug me into its people slot) to see my tasks here', P, y, w - 2 * P, h - y - P, { size: 18, color: palette.faceDim, lineHeight: 1.4 });
        return;
      }
      const ROW = 27, HEAD = 26;
      const groups = groupByColumn(rows);
      const total = rows.length;
      let drawn = 0;
      outer: for (const gr of groups) {
        if (y + HEAD > h - P) break;
        const cw = drawCaps(g, gr.column, P, y + HEAD / 2);
        tabular(g); g.font = font(12, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(`· ${gr.rows.length}`, P + cw + 8, y + HEAD / 2);
        y += HEAD;
        for (const t of gr.rows) {
          if (y + ROW > h - 6) { g.fillStyle = palette.faceDim; g.font = font(13, 500); g.textAlign = 'left'; g.fillText(`+ ${total - drawn} more…`, P + 14, y + 6); break outer; }
          g.fillStyle = PRIORITY_COLOURS[t.card.priority] || PRIORITY_COLOURS.medium; roundRect(g, P, y + 8, 3, ROW - 16, 1.5); g.fill();
          const dueText = t.card.due ? (t.overdue ? `! ${fmtDate(t.card.due)}` : t.done ? 'done' : daysUntil(t.card.due) === 0 ? 'today' : fmtDate(t.card.due)) : t.done ? 'done' : '';
          g.font = font(13, t.overdue ? 600 : 500); const dw = dueText ? g.measureText(dueText).width : 0;
          g.fillStyle = t.overdue ? palette.faceBad : palette.faceDim; g.textAlign = 'right'; g.fillText(dueText, w - P, y + ROW / 2);
          g.textAlign = 'left'; g.fillStyle = t.done ? palette.faceDim : palette.faceText; g.font = font(typography.scale.label, t.done ? 400 : 500);
          const s2 = fitLine(g, t.card.title, w - 2 * P - 14 - dw - 12);
          g.fillText(s2, P + 14, y + ROW / 2);
          if (t.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 1.2; g.beginPath(); g.moveTo(P + 14, y + ROW / 2); g.lineTo(P + 14 + g.measureText(s2).width, y + ROW / 2); g.stroke(); }
          y += ROW; drawn += 1;
        }
      }
    },
  },
});
