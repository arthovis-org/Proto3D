// Calendar — a face that lays a board's tasks and the milestones on a month (or week) grid:
// weekday header, day numbers, a ring on today, up to three chips per day (title in the colour
// of its priority, assignee or project; done chips muted; "+n" for the rest), a flag glyph on a
// milestone's day, and a selected-day list at the bottom (click a cell). Outputs: the tasks due
// today, this week's tasks, the selected day's tasks and `when a task is due` — one pulse per
// task on the day it becomes due (fired ids are kept in state per date, so a reload never
// re-fires). `offset` (months or weeks from now) is editable on the face and scrubbable in the
// panel. The Home page's Calendar view (ui/calendar.js) is the cross-project cousin of this face.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, typography } from '../../theme.js';
import { clear, roundRect, font, drawText, PAD, drawCaps, drawTile, drawDivider, fitLine, tabular, beginFields, drawAvatar } from '../../faces.js';
import { isoDate, addDays, daysUntil, fmtDate, PRIORITY_COLOURS, initials } from '../../pm/model.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PROJECT_COLOURS = ['#5aa9ff', '#2dd4bf', '#34c99a', '#f5b942', '#ff7a45', '#ff4d5e', '#e25aa6', '#8b7cf6'];
const hashHue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PROJECT_COLOURS[h % PROJECT_COLOURS.length]; };
/** ISO Monday of the week holding `iso`. */
export const weekStart = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
/** The first day of the month `n` months from the one holding `iso`. */
export function monthStart(iso, n = 0) { const d = new Date(`${iso}T00:00:00Z`); return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
export const monthTitle = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** The visible days: a month grid (Monday-first weeks covering the month) or one week. */
export function gridDays(view, offset, today = isoDate()) {
  if (view === 'week') { const s = addDays(weekStart(today), 7 * Math.round(offset || 0)); return { first: s, days: Array.from({ length: 7 }, (_, i) => addDays(s, i)), title: `Week of ${fmtDate(s)}` }; }
  const first = monthStart(today, Math.round(offset || 0)), start = weekStart(first);
  const last = addDays(monthStart(first, 1), -1);
  const n = Math.ceil((daysUntil(last, start) + 1) / 7) * 7;
  return { first, days: Array.from({ length: n }, (_, i) => addDays(start, i)), title: monthTitle(first) };
}
const flatTasks = (v) => (Array.isArray(v) ? v.flat().filter((t) => t && typeof t === 'object' && t.id) : []);
const flatMilestones = (v) => (Array.isArray(v) ? v.flat().filter((m) => m && m.date) : []);
const dueOf = (t) => (t.due || t.end || '').slice(0, 10);

/** Layout in face px shared by the renderer, the pointer handler and the port anchors. */
function layout(w, h, rows) {
  const P = PAD, headH = 44, dowH = 20, listH = Math.max(88, h * 0.26);
  const gridTop = P + headH + dowH, gridBottom = h - P - listH - 10;
  const cellW = (w - 2 * P) / 7, cellH = (gridBottom - gridTop) / Math.max(1, rows);
  return { P, headH, dowH, gridTop, gridBottom, cellW, cellH, listTop: gridBottom + 10, listH };
}

export default registry.register({
  id: 'calendar', category: 'project', label: 'Calendar', icon: icons.calendar, size: 'XL',
  description: 'A month or week grid of a board\'s tasks and the milestones; click a day to list it, get pulses when tasks come due',
  inputs: [
    { key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks', multi: true, optional: true, loose: true },
    { key: 'milestones', label: 'milestones', type: 'data', subtype: 'milestone', multi: true, optional: true, loose: true },
  ],
  outputs: [
    { key: 'dueToday', label: 'due today', type: 'data', subtype: 'tasks' },
    { key: 'thisWeek', label: 'this week', type: 'data', subtype: 'tasks' },
    { key: 'due', label: 'when a task is due', type: 'event' },
    { key: 'selectedDay', label: 'selected day', type: 'data', subtype: 'tasks' },
  ],
  params: [
    { key: 'view', label: 'view', type: 'select', options: ['month', 'week'], default: 'month' },
    { key: 'offset', label: 'offset (months / weeks from now)', type: 'number', default: 0, min: -120, max: 120, step: 1 },
    { key: 'colourBy', label: 'colour by', type: 'select', options: ['project', 'priority', 'assignee'], default: 'priority' },
    { key: 'showWeekends', label: 'show weekends', type: 'boolean', default: true },
  ],
  evaluate({ inputs, params, state, instance, emit }) {
    const tasks = flatTasks(inputs.tasks), ms = flatMilestones(inputs.milestones);
    const today = isoDate();
    const ws = weekStart(today), we = addDays(ws, 6);
    const dueToday = tasks.filter((t) => dueOf(t) === today);
    const thisWeek = tasks.filter((t) => { const d = dueOf(t); return d && d >= ws && d <= we; });
    // one pulse per task on the day it becomes due; the fired set is kept per date so a new day starts clean
    if (state.firedDate !== today) { state.firedDate = today; state.fired = []; }
    const fired = new Set(state.fired || []);
    for (const t of dueToday) if (!t.done && !fired.has(t.id)) { fired.add(t.id); emit('due', { ...t }); }
    state.fired = [...fired];
    const sel = state.selected || today;
    const sig = JSON.stringify([tasks.map((t) => [t.id, t.title, dueOf(t), t.start, t.done, t.assignee, t.priority, t.board]), ms.map((m) => [m.title, m.date, m.reached]), today, params.view, params.offset, params.colourBy, params.showWeekends]);
    if (sig !== instance._calSig) { instance._calSig = sig; instance.faceDirty = true; }
    instance._cal = { tasks, ms };
    return { dueToday, thisWeek, selectedDay: tasks.filter((t) => dueOf(t) === sel) };
  },
  footer: ({ instance, state }) => { const n = instance._cal?.tasks.length || 0; const sel = state.selected; return n ? `${n} task${n === 1 ? '' : 's'}${sel ? ` · ${fmtDate(sel)} selected` : ''}` : 'connect a board\'s tasks'; },
  face: {
    portAnchors({ w, h }) {
      const L = layout(w, h, 6);
      return { in: { tasks: (L.gridTop + L.gridBottom) / 2, milestones: L.P + L.headH + L.dowH / 2 }, out: { dueToday: L.listTop + 18, thisWeek: L.listTop + 40, due: L.listTop + 62, selectedDay: L.listTop + 84 } };
    },
    render(g, w, h, { params, state, instance }) {
      clear(g, w, h);
      const { tasks = [], ms = [] } = instance._cal || {};
      const today = isoDate();
      const G = gridDays(params.view, params.offset, today);
      const rows = G.days.length / 7;
      const L = layout(w, h, rows);
      const P = L.P;
      // header: title · offset (editable) · counts
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = palette.faceText; g.font = font(typography.scale.title, 600);
      g.fillText(fitLine(g, G.title, w * 0.5), P, P + 26);
      const F = beginFields(instance);
      const fx = w - P - 150;
      if (!F.add({ id: 'offset', kind: 'number', param: 'offset', label: params.view === 'month' ? 'months from now' : 'weeks from now', step: 1, min: -120, max: 120, rect: { x: fx, y: P + 4, w: 64, h: 30 }, font: { size: 15, weight: 600, align: 'center' } }).editing) {
        drawTile(g, fx, P + 4, 64, 30, { r: 8 });
        tabular(g); g.fillStyle = palette.faceText; g.font = font(15, 600); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(`${params.offset > 0 ? '+' : ''}${Math.round(params.offset || 0)}`, fx + 32, P + 19);
      }
      g.fillStyle = palette.faceDim; g.font = font(12, 500); g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(params.view === 'month' ? 'months' : 'weeks', w - P, P + 19);
      // weekday header
      const dowY = P + L.headH + L.dowH / 2;
      for (let i = 0; i < 7; i++) { if (!params.showWeekends && i >= 5) continue; drawCaps(g, DOW[i], P + i * L.cellW + 8, dowY, { size: 11 }); }
      drawDivider(g, P, P + L.headH + L.dowH, w - 2 * P);
      // cells
      const byDay = new Map(); for (const t of tasks) { const d = dueOf(t); if (d) (byDay.get(d) || byDay.set(d, []).get(d)).push(t); }
      const flags = new Map(); for (const m of ms) (flags.get(m.date) || flags.set(m.date, []).get(m.date)).push(m);
      const sel = state.selected || today;
      const monthOf = G.first.slice(0, 7);
      const colourOf = (t) => (params.colourBy === 'priority' ? PRIORITY_COLOURS[t.priority] || PRIORITY_COLOURS.medium : params.colourBy === 'assignee' ? hashHue(t.assignee) : hashHue(t.board || t.project || ''));
      const CHIP = 18, maxChips = Math.max(1, Math.floor((L.cellH - 26) / (CHIP + 3)));
      G.days.forEach((d, i) => {
        const col = i % 7, row = Math.floor(i / 7);
        if (!params.showWeekends && col >= 5) return;
        const x = P + col * L.cellW, y = L.gridTop + row * L.cellH;
        const inMonth = params.view === 'week' || d.slice(0, 7) === monthOf;
        if (d === sel) { g.fillStyle = palette.faceCard; roundRect(g, x + 2, y + 2, L.cellW - 4, L.cellH - 4, 8); g.fill(); }
        if (col >= 5 && inMonth) { g.fillStyle = palette.faceLine; g.globalAlpha = 0.35; roundRect(g, x + 2, y + 2, L.cellW - 4, L.cellH - 4, 8); g.fill(); g.globalAlpha = 1; }
        // day number (today: a ring in the accent)
        tabular(g); g.font = font(13, d === today ? 700 : 500); g.textAlign = 'left'; g.textBaseline = 'middle';
        const num = String(+d.slice(8, 10));
        if (d === today) { g.strokeStyle = palette.faceAccent; g.lineWidth = 2; g.beginPath(); g.arc(x + 17, y + 14, 11, 0, Math.PI * 2); g.stroke(); g.textAlign = 'center'; g.fillStyle = palette.faceAccent; g.fillText(num, x + 17, y + 14.5); g.textAlign = 'left'; }
        else { g.fillStyle = inMonth ? palette.faceText : palette.faceDim; g.globalAlpha = inMonth ? 1 : 0.55; g.fillText(num, x + 10, y + 14); g.globalAlpha = 1; }
        // milestone flag(s)
        const fl = flags.get(d);
        if (fl) { const fxx = x + L.cellW - 18, fy = y + 6; g.strokeStyle = fl.some((m) => m.reached) ? palette.faceGood : palette.faceAccent; g.fillStyle = g.strokeStyle; g.lineWidth = 1.6; g.beginPath(); g.moveTo(fxx, fy); g.lineTo(fxx, fy + 16); g.stroke(); g.beginPath(); g.moveTo(fxx, fy); g.lineTo(fxx + 10, fy + 3.5); g.lineTo(fxx, fy + 7); g.closePath(); g.fill(); }
        // chips
        const list = byDay.get(d) || [];
        let cy = y + 27;
        list.slice(0, list.length > maxChips ? maxChips - 1 : maxChips).forEach((t) => {
          const c = colourOf(t);
          g.globalAlpha = t.done ? 0.45 : 1;
          g.fillStyle = palette.faceCard; roundRect(g, x + 5, cy, L.cellW - 10, CHIP, 5); g.fill();
          g.fillStyle = c; roundRect(g, x + 5, cy, 3, CHIP, 1.5); g.fill();
          g.fillStyle = t.done ? palette.faceDim : palette.faceText; g.font = font(11, 500); g.textAlign = 'left'; g.textBaseline = 'middle';
          const tt = fitLine(g, t.title || '', L.cellW - 22); g.fillText(tt, x + 12, cy + CHIP / 2 + 0.5);
          if (t.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 12, cy + CHIP / 2); g.lineTo(x + 12 + g.measureText(tt).width, cy + CHIP / 2); g.stroke(); }
          g.globalAlpha = 1;
          cy += CHIP + 3;
        });
        if (list.length > maxChips) { g.fillStyle = palette.faceDim; g.font = font(11, 600); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`+${list.length - (maxChips - 1)} more`, x + 10, cy + CHIP / 2); }
      });
      // grid lines
      g.strokeStyle = palette.faceLine; g.lineWidth = 1;
      for (let r = 1; r < rows; r++) { const y = Math.round(L.gridTop + r * L.cellH) + 0.5; g.beginPath(); g.moveTo(P, y); g.lineTo(w - P, y); g.stroke(); }
      // selected-day list
      const ly = L.listTop;
      drawTile(g, P, ly, w - 2 * P, L.listH);
      const dayTasks = byDay.get(sel) || [];
      drawCaps(g, `${sel === today ? 'today' : fmtDate(sel)} · ${dayTasks.length} due${flags.get(sel) ? ` · ${flags.get(sel).map((m) => m.title).join(', ')}` : ''}`, P + 12, ly + 16);
      if (!tasks.length) { drawText(g, 'Drop a Kanban board here (or connect its tasks) to see its cards by day', P, ly + 20, w - 2 * P, L.listH - 24, { size: 15, color: palette.faceDim }); return; }
      if (!dayTasks.length) { drawText(g, 'nothing due · click a day to list it', P, ly + 20, w - 2 * P, L.listH - 24, { size: 14, color: palette.faceDim }); return; }
      const ROW = 24; let yy = ly + 30;
      for (const t of dayTasks) {
        if (yy + ROW > ly + L.listH - 4) { g.fillStyle = palette.faceDim; g.font = font(12, 500); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`+ ${dayTasks.length - dayTasks.indexOf(t)} more…`, P + 12, yy + 10); break; }
        g.fillStyle = PRIORITY_COLOURS[t.priority] || PRIORITY_COLOURS.medium; roundRect(g, P + 12, yy + 6, 3, ROW - 12, 1.5); g.fill();
        if (t.assignee) drawAvatar(g, initials(t.assignee), P + 32, yy + ROW / 2, 9, hashHue(t.assignee));
        g.fillStyle = t.done ? palette.faceDim : palette.faceText; g.font = font(13, 500); g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(fitLine(g, t.title || '', w - 2 * P - 200), P + (t.assignee ? 48 : 24), yy + ROW / 2);
        g.fillStyle = palette.faceDim; g.font = font(12, 500); g.textAlign = 'right';
        g.fillText(`${t.column || ''}${t.priority ? ` · ${t.priority}` : ''}${t.done ? ' · done' : ''}`, w - P - 12, yy + ROW / 2);
        yy += ROW;
      }
    },
    /** A click on a cell selects that day (the list and the `selected day` output follow). */
    onPointer({ params, state, instance }, ev) {
      if (ev.type !== 'click') return false;
      const w = instance.face.cw, h = instance.face.ch;
      const G = gridDays(params.view, params.offset);
      const L = layout(w, h, G.days.length / 7);
      const x = ev.u * w, y = ev.v * h;
      if (y < L.gridTop || y > L.gridBottom || x < L.P || x > w - L.P) return false;
      const col = Math.floor((x - L.P) / L.cellW), row = Math.floor((y - L.gridTop) / L.cellH);
      const d = G.days[row * 7 + col]; if (!d) return false;
      state.selected = d;
      return true;
    },
  },
});
