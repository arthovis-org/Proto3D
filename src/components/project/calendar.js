// Calendar — a face that lays a board's tasks and the milestones on a Day, Week or Month view.
//
// Header: the period's title — click it to jump to any date with the date picker (a face date
// field, ui/date-picker.js) — then ‹ Today › to page and a Day · Week · Month switch; switching keeps
// the day you are looking at in view. Month: Monday-first weeks, a ring on today, chips per day
// (title in the colour of its priority, assignee or project; done chips muted; "+n more"), a thin
// bar through the days a card with a start date spans, a flag on a milestone's day. Week: seven
// full-height columns, spans as bars across the days they cover, the day's chips under them. Day: a
// strip of the week's days (dots for what is due) over the day's agenda — milestones, what is due,
// what is in progress, and on today what is overdue. A side column lists the selected day (Month and
// Week; click a day to select it, click its number to open it in Day view) or, in Day view, what is
// coming up next. Weekends can be hidden (five columns).
//
// Outputs: the tasks due today, this week's tasks, the selected day's tasks and `when a task is due`
// — one pulse per task on the day it becomes due (fired ids are kept in state per date, so a reload
// never re-fires). `offset` counts days, weeks or months from now (following `view`), so a saved
// calendar keeps showing "next month". The Home page's Calendar view (ui/calendar.js) is the
// cross-project cousin of this face and shares `gridDays`.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, typography } from '../../theme.js';
import { clear, roundRect, font, drawText, PAD, drawCaps, drawTile, drawDivider, fitLine, tabular, beginFields, drawAvatar } from '../../faces.js';
import { isoDate, addDays, daysUntil, fmtDate, PRIORITY_COLOURS, initials } from '../../pm/model.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const CAL_VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const PROJECT_COLOURS = ['#5aa9ff', '#2dd4bf', '#34c99a', '#f5b942', '#ff7a45', '#ff4d5e', '#e25aa6', '#8b7cf6'];
const hashHue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PROJECT_COLOURS[h % PROJECT_COLOURS.length]; };
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const fmt = (iso, o) => utc(iso).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });
const wd = (iso) => (utc(iso).getUTCDay() + 6) % 7;   // Monday = 0
/** ISO Monday of the week holding `iso`. */
export const weekStart = (iso) => addDays(iso, -wd(iso));
/** The first day of the month `n` months from the one holding `iso`. */
export function monthStart(iso, n = 0) { const d = utc(iso); return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); }
export const monthTitle = (iso) => fmt(iso, { month: 'long', year: 'numeric' });
/** ISO 8601 week number. */
export function isoWeek(iso) { const th = addDays(weekStart(iso), 3), y = utc(th).getUTCFullYear(); return 1 + Math.floor(daysUntil(th, `${y}-01-01`) / 7); }
/** "21 – 27 Sep 2026", "28 Sep – 4 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function rangeTitle(a, b) {
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${fmt(a, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (a.slice(0, 7) !== b.slice(0, 7)) return `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${+a.slice(8)} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
const normView = (v) => (v === 'day' || v === 'week' ? v : 'month');
/**
 * The visible days: one day, one Monday-first week, or a month grid (the weeks covering the month).
 * `offset` counts days, weeks or months from the period holding `today`.
 */
export function gridDays(view, offset, today = isoDate()) {
  const n = Math.round(offset || 0);
  if (view === 'day') { const d = addDays(today, n); return { first: d, days: [d], title: fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }; }
  if (view === 'week') { const s = addDays(weekStart(today), 7 * n); return { first: s, days: Array.from({ length: 7 }, (_, i) => addDays(s, i)), title: rangeTitle(s, addDays(s, 6)), week: isoWeek(s) }; }
  const first = monthStart(today, n), start = weekStart(first);
  const last = addDays(monthStart(first, 1), -1);
  const len = Math.ceil((daysUntil(last, start) + 1) / 7) * 7;
  return { first, days: Array.from({ length: len }, (_, i) => addDays(start, i)), title: monthTitle(first) };
}
/** Whether `d` belongs to the period (Month: the month itself, not the spill-over days). */
const inPeriod = (view, G, d) => (view === 'month' ? d.slice(0, 7) === G.first.slice(0, 7) : d >= G.days[0] && d <= G.days[G.days.length - 1]);
/** The offset that shows `date` in `view` (relative to the period holding `today`). */
export function offsetFor(view, date, today = isoDate()) {
  if (view === 'day') return daysUntil(date, today);
  if (view === 'week') return Math.round(daysUntil(weekStart(date), weekStart(today)) / 7);
  const a = utc(date), b = utc(today);
  return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + a.getUTCMonth() - b.getUTCMonth();
}
/** The day the calendar is "on": the selected day when it is in view, else today when it is, else the period's first day. */
export function focusDate(view, offset, selected, today = isoDate()) {
  const G = gridDays(view, offset, today);
  if (view === 'day') return G.first;
  if (selected && inPeriod(view, G, selected)) return selected;
  if (inPeriod(view, G, today)) return today;
  return G.first;
}
const flatTasks = (v) => (Array.isArray(v) ? v.flat().filter((t) => t && typeof t === 'object' && t.id) : []);
const flatMilestones = (v) => (Array.isArray(v) ? v.flat().filter((m) => m && m.date) : []);
const dueOf = (t) => (t.due || t.end || '').slice(0, 10);
const startOf = (t) => { const s = (t.start || '').slice(0, 10), d = dueOf(t); return s && d && s < d ? s : ''; };

/** Layout in face px shared by the renderer, the pointer handler and the port anchors. */
function layout(w, h, view) {
  const P = PAD, headH = 48, top = P + headH + 8;
  const sideW = Math.max(230, Math.round(w * (view === 'day' ? 0.34 : 0.27)));
  const sx = w - P - sideW, mx = P, mw = sx - 16 - P;
  return { P, headH, top, bottom: h - P, mx, mw, sx, sideW, dowH: 24, stripH: 58 };
}
/** Header controls, right to left: the view switch, then ‹ Today ›. */
function headerRects(w, P) {
  const segW = 62, segH = 30, y = P + 4;
  const segX = w - P - segW * 3;
  const seg = CAL_VIEWS.map(([v], i) => ({ act: 'view', value: v, x: segX + i * segW, y, w: segW, h: segH }));
  const nx = segX - 14 - (30 + 4 + 64 + 4 + 30);
  const nav = [{ act: 'prev', x: nx, y, w: 30, h: segH }, { act: 'today', x: nx + 34, y, w: 64, h: segH }, { act: 'next', x: nx + 102, y, w: 30, h: segH }];
  return { seg, nav, titleW: nx - P - 16, y, h: segH };
}

/* ---------- writes from the face (view state: not in the undo history) ---------- */
function setView(instance, params, state, view) {
  view = normView(view);
  if (view === normView(params.view)) return;
  const f = focusDate(normView(params.view), params.offset, state.selected);
  params.view = view; params.offset = offsetFor(view, f);
  state.selected = f;
  instance.world?.changed?.('param');
}
function page(instance, params, state, n) {
  const view = normView(params.view);
  params.offset = n === 0 ? 0 : Math.round(params.offset || 0) + n;
  if (n === 0) state.selected = isoDate();
  else if (view === 'day') state.selected = gridDays('day', params.offset).first;
  instance.world?.changed?.('param');
}
/** Go to a date (the title's date picker): keep the view, show the period holding it, select it. */
function jumpTo(instance, date, api) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  const params = instance.params, view = normView(params.view);
  const next = offsetFor(view, date);
  instance.state.selected = date;
  if (next !== params.offset && api?.cmd && api.history) { const c = api.cmd.setParam(api.world, instance, 'offset', next); c.label = `Go to ${fmtDate(date)}`; api.history.execute(c); }
  else { params.offset = next; instance.world?.changed?.('param'); }
  instance.faceDirty = true;
}

/* ---------- drawing helpers ---------- */
function drawButton(g, r, label, { on = false, glyph = null } = {}) {
  g.fillStyle = on ? withA(palette.faceAccent, 0.18) : palette.faceCard; roundRect(g, r.x, r.y, r.w, r.h, 8); g.fill();
  g.fillStyle = on ? palette.faceAccent : palette.faceText; g.strokeStyle = g.fillStyle;
  if (glyph) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, d = glyph === 'prev' ? -1 : 1;
    g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(cx - 3 * d, cy - 6); g.lineTo(cx + 3 * d, cy); g.lineTo(cx - 3 * d, cy + 6); g.stroke();
    return;
  }
  g.font = font(13, on ? 600 : 500); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
}
function withA(hex, a) { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`; }
function drawFlag(g, x, y, reached) {
  g.strokeStyle = reached ? palette.faceGood : palette.faceAccent; g.fillStyle = g.strokeStyle; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke();
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10, y + 3.5); g.lineTo(x, y + 7); g.closePath(); g.fill();
}
/** A task chip: tinted card, a colour stripe, the title (struck through when done). */
function drawChip(g, t, x, y, w, h, colour, { size = 11, lines = 1 } = {}) {
  g.globalAlpha = t.done ? 0.45 : 1;
  g.fillStyle = palette.faceCard; roundRect(g, x, y, w, h, 5); g.fill();
  g.fillStyle = colour; roundRect(g, x, y, 3, h, 1.5); g.fill();
  g.fillStyle = t.done ? palette.faceDim : palette.faceText; g.font = font(size, 500); g.textAlign = 'left'; g.textBaseline = 'middle';
  const text = t.title || '', maxW = w - 14;
  let rows = [fitLine(g, text, maxW)];
  if (lines > 1 && g.measureText(text).width > maxW) {   // wrap on words into two lines, the second one ellipsised
    const words = text.split(/\s+/); let first = '';
    while (words.length && g.measureText(first ? `${first} ${words[0]}` : words[0]).width <= maxW) first = first ? `${first} ${words.shift()}` : words.shift();
    rows = first ? [first, fitLine(g, words.join(' '), maxW)] : [fitLine(g, text, maxW)];
  }
  const lh = size * 1.3, y0 = y + h / 2 - ((rows.length - 1) * lh) / 2 + 0.5;
  rows.forEach((r, i) => {
    g.fillText(r, x + 8, y0 + i * lh);
    if (t.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 8, y0 + i * lh); g.lineTo(x + 8 + g.measureText(r).width, y0 + i * lh); g.stroke(); }
  });
  g.globalAlpha = 1;
}
/** One agenda row: priority stripe, avatar, title, meta on the right. Returns the row height. */
function drawRow(g, t, x, y, w, { big = false, today, meta = null } = {}) {
  const H = big ? 34 : 26;
  const late = !t.done && dueOf(t) && dueOf(t) < today;
  g.fillStyle = PRIORITY_COLOURS[t.priority] || PRIORITY_COLOURS.medium; roundRect(g, x, y + 6, 3, H - 12, 1.5); g.fill();
  let tx = x + 12;
  if (t.assignee) { drawAvatar(g, initials(t.assignee), tx + (big ? 11 : 9), y + H / 2, big ? 11 : 9, hashHue(t.assignee)); tx += big ? 30 : 24; }
  const m = meta ?? `${t.column || ''}${t.priority && t.priority !== 'medium' ? ` · ${t.priority}` : ''}${t.done ? ' · done' : late ? ' · overdue' : ''}`;
  g.font = font(big ? 12.5 : 11.5, 500); const mw = Math.min(w * 0.45, g.measureText(m).width);
  g.fillStyle = t.done ? palette.faceDim : palette.faceText; g.font = font(big ? 14 : 12.5, big ? 600 : 500); g.textAlign = 'left'; g.textBaseline = 'middle';
  const title = fitLine(g, t.title || '', x + w - tx - mw - 14);
  g.fillText(title, tx, y + H / 2 + 0.5);
  if (t.done) { g.strokeStyle = palette.faceDim; g.lineWidth = 1; g.beginPath(); g.moveTo(tx, y + H / 2); g.lineTo(tx + g.measureText(title).width, y + H / 2); g.stroke(); }
  g.fillStyle = late ? palette.faceBad : palette.faceDim; g.font = font(big ? 12.5 : 11.5, 500); g.textAlign = 'right';
  g.fillText(fitLine(g, m, mw + 1), x + w - 6, y + H / 2 + 0.5);
  return H;
}

export default registry.register({
  id: 'calendar', category: 'project', label: 'Calendar', icon: icons.calendar, size: 'XL',
  description: 'A day, week or month view of a board\'s tasks and the milestones; jump to any date, click a day to list it, get pulses when tasks come due',
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
    { key: 'view', label: 'view', type: 'select', options: ['day', 'week', 'month'], default: 'month' },
    { key: 'offset', label: 'offset (days / weeks / months from now)', type: 'number', default: 0, min: -3650, max: 3650, step: 1 },
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
    const sel = normView(params.view) === 'day' ? gridDays('day', params.offset, today).first : state.selected || today;
    const sig = JSON.stringify([tasks.map((t) => [t.id, t.title, dueOf(t), t.start, t.done, t.assignee, t.priority, t.board, t.column]), ms.map((m) => [m.title, m.date, m.reached]), today, params.view, params.offset, params.colourBy, params.showWeekends, state.selected]);
    if (sig !== instance._calSig) { instance._calSig = sig; instance.faceDirty = true; }
    instance._cal = { tasks, ms };
    return { dueToday, thisWeek, selectedDay: tasks.filter((t) => dueOf(t) === sel) };
  },
  footer: ({ instance, state, params }) => {
    const n = instance._cal?.tasks.length || 0;
    if (!n) return 'connect a board\'s tasks';
    const view = normView(params.view);
    return `${n} task${n === 1 ? '' : 's'} · ${view === 'day' ? 'click a day in the strip' : `${state.selected ? `${fmtDate(state.selected)} selected · ` : ''}click a day number to open it`}`;
  },
  face: {
    portAnchors({ w, h, params }) {
      const L = layout(w, h, normView(params?.view));
      return { in: { tasks: (L.top + L.bottom) / 2, milestones: L.top + 20 }, out: { dueToday: L.top + 22, thisWeek: L.top + 46, due: L.top + 70, selectedDay: L.top + 94 } };
    },
    render(g, w, h, { params, state, instance }) {
      clear(g, w, h);
      const { tasks = [], ms = [] } = instance._cal || {};
      const today = isoDate();
      const view = normView(params.view);
      const G = gridDays(view, params.offset, today);
      const L = layout(w, h, view);
      const P = L.P;
      const hits = instance._calHits = [];
      const colourOf = (t) => (params.colourBy === 'priority' ? PRIORITY_COLOURS[t.priority] || PRIORITY_COLOURS.medium : params.colourBy === 'assignee' ? hashHue(t.assignee) : hashHue(t.board || t.project || ''));
      const byDay = new Map(); for (const t of tasks) { const d = dueOf(t); if (d) (byDay.get(d) || byDay.set(d, []).get(d)).push(t); }
      const flags = new Map(); for (const m of ms) (flags.get(m.date) || flags.set(m.date, []).get(m.date)).push(m);
      const spans = tasks.filter((t) => startOf(t));
      const sel = view === 'day' ? G.first : (state.selected || today);

      /* header: the title (a date field: click to jump), ‹ Today ›, Day · Week · Month */
      const H = headerRects(w, P);
      const F = beginFields(instance);
      const field = F.add({
        id: 'jump', kind: 'date', mode: 'open', label: 'go to date',
        get: () => focusDate(view, params.offset, state.selected, today),
        set: (v, api) => jumpTo(instance, v, api),
        rect: { x: P, y: H.y, w: Math.min(H.titleW, 420), h: H.h }, font: { size: 15, weight: 600 },
      });
      if (!field.editing) {
        g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = palette.faceText; g.font = font(typography.scale.title, 600);
        const title = fitLine(g, G.title, H.titleW - 110);
        g.fillText(title, P, H.y + H.h / 2);
        const tw = g.measureText(title).width;
        // the "pick a date" affordance: a small chevron after the title
        g.strokeStyle = palette.faceDim; g.lineWidth = 1.8; g.lineCap = 'round'; g.lineJoin = 'round';
        const cx = P + tw + 14, cy = H.y + H.h / 2;
        g.beginPath(); g.moveTo(cx - 4, cy - 2); g.lineTo(cx, cy + 2); g.lineTo(cx + 4, cy - 2); g.stroke();
        g.fillStyle = palette.faceDim; g.font = font(12, 500);
        const sub = view === 'week' ? `Week ${G.week}` : view === 'day' ? (G.first === today ? 'Today' : `${Math.abs(daysUntil(G.first, today))} day${Math.abs(daysUntil(G.first, today)) === 1 ? '' : 's'} ${G.first > today ? 'ahead' : 'ago'}`) : '';
        if (sub) g.fillText(fitLine(g, sub, H.titleW - tw - 30), cx + 12, cy + 0.5);
      }
      const offsetN = Math.round(params.offset || 0);
      H.nav.forEach((r) => { drawButton(g, r, r.act === 'today' ? 'Today' : '', { glyph: r.act === 'today' ? null : r.act, on: r.act === 'today' && offsetN === 0 && (view === 'day' || !state.selected || state.selected === today) }); hits.push(r); });
      g.fillStyle = palette.faceCard; roundRect(g, H.seg[0].x, H.y, H.seg.length * H.seg[0].w, H.h, 9); g.fill();
      H.seg.forEach((r, i) => { const on = r.value === view; if (on) { g.fillStyle = withA(palette.faceAccent, 0.2); roundRect(g, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 7); g.fill(); } g.fillStyle = on ? palette.faceAccent : palette.faceDim; g.font = font(13, on ? 600 : 500); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(CAL_VIEWS[i][1], r.x + r.w / 2, r.y + r.h / 2 + 0.5); hits.push(r); });
      drawDivider(g, P, P + L.headH, w - 2 * P);

      if (view === 'day') drawDayView(); else drawGrid();
      drawSide();

      /* ---------- Month / Week grid ---------- */
      function drawGrid() {
        const cols = params.showWeekends === false ? 5 : 7;
        const days = G.days.filter((d) => cols === 7 || wd(d) < 5);
        const rows = Math.ceil(days.length / cols);
        const cellW = L.mw / cols, gridTop = L.top + L.dowH, cellH = (L.bottom - gridTop) / rows;
        // weekday header (Week: with the date; today in the accent)
        for (let c = 0; c < cols; c++) {
          const x = L.mx + c * cellW + 8, y = L.top + L.dowH / 2 - 2;
          if (view === 'week') {
            const d = days[c], isT = d === today;
            drawCaps(g, DOW[wd(d)], x, y, { size: 11, color: isT ? palette.faceAccent : palette.faceDim });
            g.font = font(13, isT ? 700 : 600); g.fillStyle = isT ? palette.faceAccent : palette.faceText; g.textAlign = 'left'; tabular(g);
            g.fillText(String(+d.slice(8)), x + 36, y + 0.5);
          } else drawCaps(g, DOW[c], x, y, { size: 11 });
        }
        drawDivider(g, L.mx, gridTop - 1, L.mw);
        // week: span bars first, packed into lanes across the columns
        let laneH = 0;
        if (view === 'week') {
          const a0 = days[0], a1 = days[days.length - 1];
          const lanes = [];
          for (const t of spans.filter((t) => startOf(t) <= a1 && dueOf(t) >= a0).sort((x, y) => startOf(x).localeCompare(startOf(y)))) {
            const ci = (d) => { let i = days.findIndex((x) => x >= d); if (i < 0) i = days.length - 1; return i; };
            const a = startOf(t) < a0 ? 0 : ci(startOf(t)), b = dueOf(t) > a1 ? days.length - 1 : Math.max(a, days.findLastIndex((x) => x <= dueOf(t)));
            let lane = lanes.findIndex((l) => l.every((s) => s.b < a || s.a > b)); if (lane < 0) { lanes.push([]); lane = lanes.length - 1; }
            lanes[lane].push({ t, a, b });
          }
          const maxLanes = Math.min(lanes.length, Math.max(1, Math.floor((cellH - 80) / 24)));
          laneH = maxLanes * 24 + (maxLanes ? 6 : 0);
          lanes.slice(0, maxLanes).forEach((l, i) => l.forEach(({ t, a, b }) => {
            const x = L.mx + a * cellW + 4, y = gridTop + 6 + i * 24, bw = (b - a + 1) * cellW - 8;
            drawChip(g, t, x, y, bw, 20, colourOf(t), { size: 11.5 });
            hits.push({ act: 'day', value: dueOf(t) >= a0 && dueOf(t) <= a1 ? dueOf(t) : days[b], x, y, w: bw, h: 20 });
          }));
        }
        days.forEach((d, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          const x = L.mx + col * cellW, y = gridTop + row * cellH;
          const inMonth = view === 'week' || d.slice(0, 7) === G.first.slice(0, 7);
          if (d === sel) { g.fillStyle = withA(palette.faceAccent, 0.1); roundRect(g, x + 2, y + 2, cellW - 4, cellH - 4, 8); g.fill(); g.strokeStyle = withA(palette.faceAccent, 0.5); g.lineWidth = 1.5; roundRect(g, x + 2.5, y + 2.5, cellW - 5, cellH - 5, 8); g.stroke(); }
          else if (wd(d) >= 5 && inMonth) { g.fillStyle = palette.faceLine; g.globalAlpha = 0.35; roundRect(g, x + 2, y + 2, cellW - 4, cellH - 4, 8); g.fill(); g.globalAlpha = 1; }
          hits.push({ act: 'select', value: d, x, y, w: cellW, h: cellH });
          // day number (today: a filled accent disc); a click on it opens the day
          const top = view === 'week' ? y + laneH : y;
          if (view === 'month') {
            tabular(g); g.font = font(13, d === today ? 700 : 500); g.textBaseline = 'middle'; g.textAlign = 'center';
            if (d === today) { g.fillStyle = palette.faceAccent; g.beginPath(); g.arc(x + 17, y + 15, 11, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; }
            else { g.fillStyle = inMonth ? palette.faceText : palette.faceDim; g.globalAlpha = inMonth ? 1 : 0.5; }
            g.fillText(String(+d.slice(8, 10)), x + 17, y + 15.5); g.globalAlpha = 1;
            hits.push({ act: 'open', value: d, x: x + 4, y: y + 3, w: 28, h: 24 });
          } else hits.push({ act: 'open', value: d, x: L.mx + col * cellW, y: L.top, w: cellW, h: L.dowH });
          const fl = flags.get(d);
          if (fl) drawFlag(g, x + cellW - 18, y + 6, fl.some((m) => m.reached));
          // month: thin bars through the days a card spans
          let cy = view === 'week' ? top + 8 : y + 30;
          if (view === 'month') {
            const through = spans.filter((t) => startOf(t) <= d && d <= dueOf(t)).slice(0, 3);
            through.forEach((t, k) => { g.globalAlpha = t.done ? 0.35 : 0.75; g.fillStyle = colourOf(t); const s = startOf(t) === d || wd(d) === 0, e = dueOf(t) === d || wd(d) === 6; roundRect(g, x + (s ? 6 : 0), y + cellH - 7 - k * 4, cellW - (s ? 6 : 0) - (e ? 6 : 0), 2.5, 1.2); g.fill(); g.globalAlpha = 1; });
          }
          const list = (byDay.get(d) || []).filter((t) => view !== 'week' || !startOf(t));
          const CHIP = view === 'week' ? 40 : 18, gap = view === 'week' ? 5 : 3;
          const room = (y + cellH - (view === 'month' ? 12 : 6)) - cy;
          const maxChips = Math.max(0, Math.floor((room + gap) / (CHIP + gap)));
          const shown = list.length > maxChips ? Math.max(0, maxChips - 1) : list.length;
          list.slice(0, shown).forEach((t) => { drawChip(g, t, x + 5, cy, cellW - 10, CHIP, colourOf(t), { size: view === 'week' ? 12 : 11, lines: view === 'week' ? 2 : 1 }); cy += CHIP + gap; });
          if (list.length > shown) { g.fillStyle = palette.faceDim; g.font = font(11, 600); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`+${list.length - shown} more`, x + 9, cy + Math.min(CHIP, 16) / 2); }
        });
        // grid lines
        g.strokeStyle = palette.faceLine; g.lineWidth = 1;
        for (let r = 1; r < rows; r++) { const y = Math.round(gridTop + r * cellH) + 0.5; g.beginPath(); g.moveTo(L.mx, y); g.lineTo(L.mx + L.mw, y); g.stroke(); }
        for (let c = 1; c < cols; c++) { const x = Math.round(L.mx + c * cellW) + 0.5; g.beginPath(); g.moveTo(x, gridTop + 4); g.lineTo(x, L.bottom - 4); g.stroke(); }
      }

      /* ---------- Day: the week strip over the day's agenda ---------- */
      function drawDayView() {
        const d = G.first, ws0 = weekStart(d);
        const strip = Array.from({ length: 7 }, (_, i) => addDays(ws0, i)).filter((x) => params.showWeekends !== false || wd(x) < 5);
        const gap = 6, pw = (L.mw - gap * (strip.length - 1)) / strip.length, py = L.top;
        strip.forEach((x, i) => {
          const px = L.mx + i * (pw + gap), on = x === d, isT = x === today;
          g.fillStyle = on ? withA(palette.faceAccent, 0.18) : palette.faceCard; roundRect(g, px, py, pw, L.stripH, 10); g.fill();
          if (isT && !on) { g.strokeStyle = palette.faceAccent; g.lineWidth = 1.5; roundRect(g, px + 0.75, py + 0.75, pw - 1.5, L.stripH - 1.5, 10); g.stroke(); }
          drawCaps(g, DOW[wd(x)], px + pw / 2, py + 15, { size: 10.5, align: 'center', color: on || isT ? palette.faceAccent : palette.faceDim });
          tabular(g); g.font = font(18, 700); g.fillStyle = on || isT ? palette.faceAccent : palette.faceText; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(+x.slice(8)), px + pw / 2, py + 34);
          const n = (byDay.get(x) || []).length;
          for (let k = 0; k < Math.min(n, 4); k++) { g.fillStyle = on ? palette.faceAccent : palette.faceDim; g.beginPath(); g.arc(px + pw / 2 + (k - (Math.min(n, 4) - 1) / 2) * 7, py + L.stripH - 8, 2.2, 0, Math.PI * 2); g.fill(); }
          if (flags.get(x)) drawFlag(g, px + pw - 14, py + 6, flags.get(x).some((m) => m.reached));
          hits.push({ act: 'day', value: x, x: px, y: py, w: pw, h: L.stripH });
        });
        // the agenda
        let y = py + L.stripH + 14;
        const x = L.mx, w0 = L.mw, end = L.bottom;
        const sections = [];
        const fl = flags.get(d) || [];
        const due = byDay.get(d) || [];
        const doing = spans.filter((t) => startOf(t) <= d && d < dueOf(t));
        const late = d === today ? tasks.filter((t) => !t.done && dueOf(t) && dueOf(t) < today) : [];
        if (late.length) sections.push(['Overdue', late, (t) => `due ${fmtDate(dueOf(t))}${t.assignee ? ` · ${t.assignee}` : ''}`]);
        sections.push([`Due${due.length ? ` · ${due.length}` : ''}`, due, null]);
        if (doing.length) sections.push(['In progress', doing, (t) => `${fmtDate(startOf(t))} → ${fmtDate(dueOf(t))}`]);
        if (fl.length) {
          drawTile(g, x, y, w0, 34, { r: 10, bg: withA(palette.faceAccent, 0.12) });
          drawFlag(g, x + 14, y + 9, fl.some((m) => m.reached));
          g.fillStyle = palette.faceText; g.font = font(13.5, 600); g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(fitLine(g, fl.map((m) => `${m.title}${m.reached ? ' ✓' : ''}`).join(' · '), w0 - 50), x + 34, y + 17.5);
          y += 44;
        }
        if (!tasks.length) { drawText(g, 'Drop a Kanban board here (or connect its tasks) to see its cards by day', x, y, w0, end - y, { size: 16, color: palette.faceDim }); return; }
        for (const [label, list, meta] of sections) {
          if (y + 40 > end) break;
          drawCaps(g, label, x + 2, y + 8, { size: 11, color: label === 'Overdue' ? palette.faceBad : palette.faceDim });
          y += 20;
          if (!list.length) { g.fillStyle = palette.faceDim; g.font = font(13, 500); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(d === today ? 'Nothing due today' : 'Nothing due this day', x + 2, y + 12); y += 32; continue; }
          for (let i = 0; i < list.length; i++) {
            if (y + 34 > end) { g.fillStyle = palette.faceDim; g.font = font(12, 600); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`+ ${list.length - i} more`, x + 12, Math.min(y + 10, end - 6)); y = end; break; }
            if (i) drawDivider(g, x + 12, y, w0 - 12);
            y += drawRow(g, list[i], x, y, w0, { big: true, today, meta: meta ? meta(list[i]) : null });
          }
          y += 10;
        }
      }

      /* ---------- side column: the selected day (Month / Week) or what is coming up (Day) ---------- */
      function drawSide() {
        const x = L.sx, y = L.top, w0 = L.sideW, hh = L.bottom - L.top;
        drawTile(g, x, y, w0, hh);
        const pad = 14, iw = w0 - 2 * pad;
        if (view === 'day') {
          drawCaps(g, 'Coming up · next 7 days', x + pad, y + 18, { size: 11 });
          let yy = y + 36;
          let any = false;
          for (let k = 1; k <= 7 && yy + 30 < y + hh; k++) {
            const d = addDays(G.first, k), list = byDay.get(d) || [], fl = flags.get(d) || [];
            if (!list.length && !fl.length) continue;
            any = true;
            g.fillStyle = palette.faceText; g.font = font(12.5, 600); g.textAlign = 'left'; g.textBaseline = 'middle';
            g.fillText(`${fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}${d === today ? ' · today' : ''}`, x + pad, yy + 8);
            g.fillStyle = palette.faceDim; g.font = font(11.5, 500); g.textAlign = 'right';
            g.fillText(`${list.length} due`, x + w0 - pad, yy + 8);
            hits.push({ act: 'day', value: d, x, y: yy - 4, w: w0, h: 22 });
            yy += 22;
            for (const m of fl) { if (yy + 22 > y + hh) break; drawFlag(g, x + pad + 2, yy + 2, m.reached); g.fillStyle = palette.faceText; g.font = font(12, 500); g.textAlign = 'left'; g.fillText(fitLine(g, m.title, iw - 20), x + pad + 18, yy + 10); yy += 22; }
            for (const t of list) { if (yy + 24 > y + hh) break; yy += drawRow(g, t, x + pad - 4, yy, iw + 4, { today }); }
            yy += 6;
          }
          if (!any) { g.fillStyle = palette.faceDim; g.font = font(13, 500); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Nothing due in the next week', x + pad, y + 50); }
          return;
        }
        const dayTasks = byDay.get(sel) || [];
        g.fillStyle = palette.faceText; g.font = font(15, 600); g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(fitLine(g, fmt(sel, { weekday: 'long', day: 'numeric', month: 'long' }), iw - 70), x + pad, y + 20);
        // "Open ›": this day in Day view
        const ob = { act: 'open', value: sel, x: x + w0 - pad - 58, y: y + 7, w: 58, h: 26 };
        g.fillStyle = palette.faceBg; roundRect(g, ob.x, ob.y, ob.w, ob.h, 7); g.fill();
        g.fillStyle = palette.faceAccent; g.font = font(12, 600); g.textAlign = 'center'; g.fillText('Open ›', ob.x + ob.w / 2, ob.y + ob.h / 2 + 0.5);
        hits.push(ob);
        drawCaps(g, `${sel === today ? 'today · ' : ''}${dayTasks.length} due${flags.get(sel) ? ` · ${flags.get(sel).map((m) => m.title).join(', ')}` : ''}`, x + pad, y + 44, { size: 10.5 });
        let yy = y + 58;
        if (!tasks.length) { drawText(g, 'Drop a Kanban board here (or connect its tasks) to see its cards by day', x + pad, yy, iw, hh - 70, { size: 14, color: palette.faceDim }); return; }
        const doing = spans.filter((t) => startOf(t) <= sel && sel < dueOf(t));
        if (!dayTasks.length && !doing.length) { g.fillStyle = palette.faceDim; g.font = font(13, 500); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Nothing due · click a day to list it', x + pad, yy + 12); return; }
        const rows = [...dayTasks.map((t) => [t, null]), ...doing.map((t) => [t, `in progress → ${fmtDate(dueOf(t))}`])];
        for (let i = 0; i < rows.length; i++) {
          if (yy + 26 > y + hh - 6) { g.fillStyle = palette.faceDim; g.font = font(12, 600); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`+ ${rows.length - i} more…`, x + pad, yy + 10); break; }
          yy += drawRow(g, rows[i][0], x + pad - 4, yy, iw + 4, { today, meta: rows[i][1] });
        }
      }
    },
    /** Header buttons page and switch the view; a cell selects its day, its number (or "Open ›") opens it in Day view. */
    onPointer({ params, state, instance }, ev) {
      if (ev.type !== 'click') return false;
      const px = ev.u * instance.face.cw, py = ev.v * instance.face.ch;
      const hits = instance._calHits || [];
      let hit = null;
      for (let i = hits.length - 1; i >= 0; i--) { const r = hits[i]; if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) { hit = r; break; } }   // the last drawn is on top
      if (!hit) return false;
      const today = isoDate();
      switch (hit.act) {
        case 'prev': page(instance, params, state, -1); break;
        case 'next': page(instance, params, state, 1); break;
        case 'today': page(instance, params, state, 0); break;
        case 'view': setView(instance, params, state, hit.value); break;
        case 'select': state.selected = hit.value; break;
        case 'open': params.view = 'day'; params.offset = offsetFor('day', hit.value, today); state.selected = hit.value; instance.world?.changed?.('param'); break;
        case 'day':
          if (normView(params.view) === 'day') { params.offset = offsetFor('day', hit.value, today); instance.world?.changed?.('param'); }
          state.selected = hit.value; break;
        default: return false;
      }
      instance.faceDirty = true;
      return true;
    },
  },
});
