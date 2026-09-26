// ui/calendar.js — the Home page's Calendar view (ui/home.js mounts it): Day · Week · Month · Agenda
// over every project's task index (project-store.js `indexDoc`), scoped like the Tasks view.
// Cards with a due date are chips in their project's colour with a priority stripe (done struck
// through, overdue tinted); a card with a start and a due date is a span — a bar across the days
// in Week view, a thin bar through the cells in Month view; milestones are flags, a project's own
// start / due small markers, and "Show time" adds the hours logged per day. Click a chip →
// `onOpenTask`, a flag → `onOpenNode`, a day's "+" → New task with the date prefilled. Drag a chip
// to another day to reschedule its due through Home's `onWrite` (main.js `editTask`: open,
// background or closed projects alike); Shift keeps the span (start moves with due). ← → move a
// period, T goes to today (while Home shows the calendar). Day shows the week as a strip of days (click one to go\n// there, drop a chip on one to move it) over that day's agenda; switching views keeps the day in view, and\n// the title opens the date picker (ui/date-picker.js) to jump to any date.
import { icons } from '../icons.js';
import { isoDate, addDays, daysUntil, fmtDate, fmtHours, PRIORITY_COLOURS } from '../pm/model.js';
import { gridDays, weekStart, monthStart, offsetFor, focusDate } from '../components/project/calendar.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MODES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']];
const longDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export class CalendarView {
  /** @param {object} o { home } — reads home.projects / home.tasks.scope / home.people, writes through home.onWrite */
  constructor({ home }) {
    this.home = home;
    this.mode = 'month'; this.offset = 0; this.showTime = false;
    this.body = null; this.drag = null;
    window.addEventListener('keydown', (e) => this._key(e), true);
  }
  get today() { return isoDate(); }
  /** The chips and markers in scope: tasks with a due (span when start too), milestones, project start / due, minutes per day. */
  items() {
    const H = this.home, scope = H.tasks.scope, me = H.meName;
    const src = scope === 'project' && H.tasks.projectId ? H.projects.filter((p) => p.id === H.tasks.projectId) : H.projects.filter((p) => p.meta?.status !== 'archived' && (p.name || p.nodes));
    const out = [], time = {};
    for (const p of src) {
      const idx = p.index || {}, colour = p.meta?.colour || '#5aa9ff', name = p.name || 'Untitled';
      for (const t of idx.tasks || []) {
        if (!t.due) continue;
        if (scope === 'mine' && !sameName(t.assignee, me)) continue;
        out.push({ kind: 'task', id: t.id, boardUid: t.boardUid, projectId: p.id, project: name, colour, title: t.title, date: t.due, start: t.start && t.start < t.due ? t.start : '', done: !!t.done, priority: t.priority || 'medium', assignee: t.assignee || '', taskKind: t.kind || 'card' });
      }
      if (scope !== 'mine') {
        for (const m of idx.milestones || []) if (m.date) out.push({ kind: 'milestone', uid: m.uid, projectId: p.id, project: name, colour, title: m.title, date: m.date });
        if (p.meta?.start) out.push({ kind: 'project', projectId: p.id, project: name, colour, title: `${name} starts`, date: p.meta.start });
        if (p.meta?.due) out.push({ kind: 'project', projectId: p.id, project: name, colour, title: `${name} due`, date: p.meta.due });
      }
      for (const [d, m] of Object.entries(idx.time || {})) time[d] = (time[d] || 0) + m;
    }
    return { items: out, time };
  }
  mount(body) {
    this.body = body;
    body.innerHTML = `<div class="home-tools cal-tools">
        <div class="home-seg" role="group" aria-label="Scope"><button type="button" data-scope="project" aria-pressed="${this.home.tasks.scope === 'project'}" ${this.home.tasks.projectId ? '' : 'disabled'}>This project</button><button type="button" data-scope="all" aria-pressed="${this.home.tasks.scope === 'all'}">All</button><button type="button" data-scope="mine" aria-pressed="${this.home.tasks.scope === 'mine'}" ${this.home.meName ? '' : 'disabled'}>Mine</button></div>
        <div class="cal-nav"><button type="button" data-cal="today">Today</button><button type="button" data-cal="prev" aria-label="Previous">${icons.chevron}</button><button type="button" data-cal="next" aria-label="Next">${icons.chevron}</button><label class="cal-title-wrap" title="Go to a date"><h2 class="cal-title" aria-live="polite"></h2>${icons.chevronDown}<input type="date" class="cal-jump" data-cal="jump" aria-label="Go to date" required></label></div>
        <span class="grow"></span>
        <label class="cal-time"><input type="checkbox" data-cal="time" ${this.showTime ? 'checked' : ''}><span>Show time</span></label>
        <div class="home-seg" role="group" aria-label="View">${MODES.map(([v, l]) => `<button type="button" data-mode="${v}" aria-pressed="${v === this.mode}">${l}</button>`).join('')}</div>
      </div>
      <div class="cal-body"></div>`;
    body.addEventListener('click', (e) => this._click(e));
    body.addEventListener('change', (e) => {
      if (e.target.dataset.cal === 'time') { this.showTime = e.target.checked; this.render(); }
      else if (e.target.dataset.cal === 'jump' && e.target.value) { this.goTo(e.target.value); }
    });
    body.addEventListener('pointerdown', (e) => this._down(e));
  }
  render() {
    const root = this.body?.querySelector('.cal-body'); if (!root) return;
    for (const b of this.body.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    for (const b of this.body.querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === this.home.tasks.scope));
    const mine = this.body.querySelector('[data-scope="mine"]'); if (mine) mine.disabled = !this.home.meName;
    const { items, time } = this.items();
    const title = this.body.querySelector('.cal-title');
    const jump = this.body.querySelector('.cal-jump');
    if (jump) { jump.value = this.focus(); jump.disabled = this.mode === 'agenda'; }
    for (const b of this.body.querySelectorAll('.cal-nav [data-cal="prev"], .cal-nav [data-cal="next"]')) b.disabled = this.mode === 'agenda';
    if (!items.length) { title.textContent = this.mode === 'agenda' ? 'Next 30 days' : gridDays(this.mode, this.offset).title; root.innerHTML = `<div class="home-empty"><span class="modal-icon">${icons.calendar}</span><h2>Nothing scheduled</h2><p>Give cards due dates (and start dates for spans) and they land here; milestones show as flags.</p></div>`; return; }
    if (this.mode === 'agenda') { title.textContent = 'Next 30 days'; root.innerHTML = this._agenda(items, time); return; }
    const G = gridDays(this.mode, this.offset);
    title.textContent = G.title;
    root.innerHTML = this.mode === 'day' ? this._day(G.first, items, time) : this.mode === 'week' ? this._week(G, items, time) : this._month(G, items, time);
  }
  /** The day in view: the Day view's day, else today when the period holds it, else the period's first day. */
  focus() { return this.mode === 'agenda' ? this.today : focusDate(this.mode, this.offset, null, this.today); }
  /** Switch views keeping the day in view. */
  setMode(mode) {
    if (mode === this.mode) return;
    const f = this.focus();
    this.mode = mode;
    this.offset = mode === 'agenda' ? 0 : offsetFor(mode, f, this.today);
    this.render();
  }
  /** Show the period holding `date` (the title's date picker, the Day strip). */
  goTo(date) { if (this.mode === 'agenda') this.mode = 'day'; this.offset = offsetFor(this.mode, date, this.today); this.render(); }
  /** Day: the week as a strip of days over the day's agenda (milestones, project markers, what is due, what is in progress). */
  _day(d, items, time) {
    const ws = weekStart(d);
    const strip = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((x) => {
      const n = items.filter((it) => it.kind === 'task' && it.date === x).length, fl = items.some((it) => it.kind === 'milestone' && it.date === x);
      return `<button type="button" class="cal-strip-day${x === d ? ' on' : ''}${x === this.today ? ' today' : ''}" data-goto="${x}" data-date="${x}" aria-pressed="${x === d}" aria-label="${esc(longDay(x))}"><span>${DOW[(new Date(`${x}T00:00:00Z`).getUTCDay() + 6) % 7]}</span><b>${+x.slice(8)}</b><i>${n ? `${n} due` : fl ? 'milestone' : '&nbsp;'}</i></button>`;
    }).join('');
    const day = items.filter((it) => it.date === d);
    const due = day.filter((it) => it.kind === 'task');
    const doing = items.filter((it) => it.kind === 'task' && it.start && it.start <= d && d < it.date);
    const late = d === this.today ? items.filter((it) => it.kind === 'task' && !it.done && it.date < this.today) : [];
    const marks = day.filter((it) => it.kind === 'milestone').map((it) => this._flag(it)).join('') + day.filter((it) => it.kind === 'project').map((it) => this._marker(it)).join('');
    const sec = (label, list, cls = '') => `<section class="cal-day${cls}"><h3>${label}</h3><div class="cal-items" data-date="${d}">${list.map((it) => this._chip(it)).join('')}</div></section>`;
    return `<div class="cal-strip" role="group" aria-label="Days of this week">${strip}</div>
      <div class="cal-agenda cal-dayview">
        ${this.showTime && time[d] ? `<p class="cal-dayhours">${esc(fmtHours(time[d]))} logged</p>` : ''}
        ${marks ? `<section class="cal-day"><h3>Milestones</h3><div class="cal-items">${marks}</div></section>` : ''}
        ${late.length ? sec('Overdue', late, ' overdue') : ''}
        ${due.length ? sec(`Due · ${due.length}`, due) : `<section class="cal-day"><h3>Due</h3><p class="home-none">${d === this.today ? 'Nothing due today.' : 'Nothing due this day.'} <button type="button" class="cal-add-inline" data-add="${d}">${icons.plus}<span>New task</span></button></p></section>`}
        ${doing.length ? sec('In progress', doing) : ''}
      </div>`;
  }
  _chip(it, { cls = '' } = {}) {
    const late = !it.done && it.date < this.today;
    return `<button type="button" class="cal-chip ${cls}${it.done ? ' done' : ''}${late ? ' overdue' : ''}" style="--pc:${esc(it.colour)};--pr:${PRIORITY_COLOURS[it.priority] || PRIORITY_COLOURS.medium}" data-task="${esc(it.id)}" data-board="${esc(it.boardUid)}" data-project="${esc(it.projectId)}" data-start="${esc(it.start)}" data-due="${esc(it.date)}" title="${esc(it.title)} · ${esc(it.project)}${it.assignee ? ` · ${esc(it.assignee)}` : ''}${it.start ? ` · ${esc(fmtDate(it.start))} → ${esc(fmtDate(it.date))}` : ''} · drag to reschedule">${esc(it.title)}</button>`;
  }
  _flag(it) { return `<button type="button" class="cal-flag" style="--pc:${esc(it.colour)}" data-node="${esc(it.uid)}" data-project="${esc(it.projectId)}" title="${esc(it.title)} · ${esc(it.project)} · milestone">${icons.milestone}<span>${esc(it.title)}</span></button>`; }
  _marker(it) { return `<span class="cal-marker" style="--pc:${esc(it.colour)}" title="${esc(it.title)}">${esc(it.title)}</span>`; }
  _cell(d, G, items, time, { compact = false } = {}) {
    const inMonth = this.mode === 'week' || d.slice(0, 7) === G.first.slice(0, 7);
    const day = items.filter((it) => it.date === d);
    const spans = this.mode === 'month' ? items.filter((it) => it.kind === 'task' && it.start && it.start <= d && d <= it.date) : [];
    const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    return `<div class="cal-cell${inMonth ? '' : ' out'}${d === this.today ? ' today' : ''}${wd >= 5 ? ' weekend' : ''}" data-date="${d}" role="gridcell" aria-label="${esc(longDay(d))}">
      <div class="cal-cell-head"><span class="cal-num">${+d.slice(8, 10)}</span>${this.showTime && time[d] ? `<span class="cal-hours">${esc(fmtHours(time[d]))}</span>` : ''}<button type="button" class="cal-add" data-add="${d}" aria-label="New task due ${esc(fmtDate(d))}">${icons.plus}</button></div>
      ${spans.length ? `<div class="cal-spans">${spans.map((it) => `<i class="cal-span${it.start === d ? ' s' : ''}${it.date === d ? ' e' : ''}${it.done ? ' done' : ''}" style="--pc:${esc(it.colour)}" title="${esc(it.title)}"></i>`).join('')}</div>` : ''}
      <div class="cal-items">${day.filter((it) => it.kind === 'milestone').map((it) => this._flag(it)).join('')}${day.filter((it) => it.kind === 'project').map((it) => this._marker(it)).join('')}${day.filter((it) => it.kind === 'task' && !(compact && it.start)).map((it) => this._chip(it)).join('')}</div>
    </div>`;
  }
  _month(G, items, time) {
    return `<div class="cal-dow">${DOW.map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid month" role="grid" style="--rows:${G.days.length / 7}">${G.days.map((d) => this._cell(d, G, items, time)).join('')}</div>`;
  }
  _week(G, items, time) {
    const first = G.days[0], last = G.days[6];
    const spans = items.filter((it) => it.kind === 'task' && it.start && it.start <= last && it.date >= first);
    const rows = [];   // pack spans into lanes
    for (const it of spans.sort((a, b) => a.start.localeCompare(b.start))) { const a = Math.max(0, daysUntil(it.start, first)), b = Math.min(6, daysUntil(it.date, first)); let lane = rows.findIndex((r) => r.every((x) => x.b < a || x.a > b)); if (lane < 0) { rows.push([]); lane = rows.length - 1; } rows[lane].push({ it, a, b }); }
    const spanHtml = rows.map((lane) => `<div class="cal-lane">${lane.map(({ it, a, b }) => `<div class="cal-spanbar" style="grid-column:${a + 1} / ${b + 2}">${this._chip(it, { cls: 'bar' })}</div>`).join('')}</div>`).join('');
    return `<div class="cal-dow week">${G.days.map((d) => `<span class="${d === this.today ? 'today' : ''}">${DOW[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]} <b>${+d.slice(8, 10)}</b></span>`).join('')}</div>
      ${spanHtml ? `<div class="cal-lanes">${spanHtml}</div>` : ''}
      <div class="cal-grid week" role="grid" style="--rows:1">${G.days.map((d) => this._cell(d, G, items, time, { compact: true })).join('')}</div>`;
  }
  _agenda(items, time) {
    const end = addDays(this.today, 30);
    const days = [...new Set(items.filter((it) => it.date >= this.today && it.date <= end).map((it) => it.date))].sort();
    const late = items.filter((it) => it.kind === 'task' && !it.done && it.date < this.today);
    const block = (d, list, label) => `<section class="cal-day"><h3>${label}${this.showTime && time[d] ? ` <span class="cal-hours">${esc(fmtHours(time[d]))}</span>` : ''}</h3><div class="cal-items" data-date="${d}">${list.map((it) => (it.kind === 'milestone' ? this._flag(it) : it.kind === 'project' ? this._marker(it) : this._chip(it))).join('')}</div></section>`;
    return `<div class="cal-agenda">${late.length ? `<section class="cal-day overdue"><h3>Overdue</h3><div class="cal-items">${late.map((it) => this._chip(it)).join('')}</div></section>` : ''}${days.map((d) => block(d, items.filter((it) => it.date === d), `${d === this.today ? 'Today · ' : daysUntil(d) === 1 ? 'Tomorrow · ' : ''}${esc(longDay(d))}`)).join('') || '<p class="home-none">Nothing due in the next 30 days.</p>'}</div>`;
  }

  /* ---------- events ---------- */
  _click(e) {
    const t = e.target;
    if (this.drag?.moved) return;   // a drag's release is not a click
    const mode = t.closest('[data-mode]'); if (mode) { this.setMode(mode.dataset.mode); return; }
    const go = t.closest('[data-goto]'); if (go) { this.goTo(go.dataset.goto); return; }
    if (t.closest('.cal-jump')) return;   // the date picker takes it (ui/date-picker.js)
    const scope = t.closest('[data-scope]'); if (scope) { this.home.tasks.scope = scope.dataset.scope; this.render(); return; }
    const nav = t.closest('[data-cal]');
    if (nav && nav.dataset.cal !== 'time') { if (nav.dataset.cal === 'today') this.offset = 0; else this.offset += nav.dataset.cal === 'next' ? 1 : -1; this.render(); return; }
    const add = t.closest('[data-add]'); if (add) { this.home.newTaskOn(add.dataset.add); return; }
    const flag = t.closest('.cal-flag'); if (flag) { this.home.onOpenNode({ projectId: flag.dataset.project, uid: flag.dataset.node }); return; }
    const chip = t.closest('.cal-chip'); if (chip) { this.home.onOpenTask({ projectId: chip.dataset.project, boardUid: chip.dataset.board, taskId: chip.dataset.task }); }
  }
  _key(e) {
    if (!this.home.isOpen || this.home.view !== 'calendar' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.matches?.('input, textarea, select')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (this.mode !== 'agenda') { this.offset += e.key === 'ArrowRight' ? 1 : -1; this.render(); } }
    else if (e.key.toLowerCase() === 't' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); this.offset = 0; this.render(); }
  }
  /* drag a chip to another day: window listeners so the chip may be re-rendered under the pointer */
  _down(e) {
    const chip = e.target.closest('.cal-chip'); if (!chip || e.button !== 0) return;
    this.drag = { chip, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId, ghost: null };
    const move = (ev) => this._move(ev), up = (ev) => { this._up(ev); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  }
  _move(e) {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    if (!d.moved) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return; d.moved = true; d.ghost = d.chip.cloneNode(true); d.ghost.classList.add('cal-ghost'); document.body.appendChild(d.ghost); d.chip.classList.add('dragging'); this.body.classList.add('cal-dragging'); }
    d.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-date]');
    for (const c of this.body.querySelectorAll('.drop')) c.classList.remove('drop');
    if (cell) cell.classList.add('drop');
    d.over = cell?.dataset.date || null; d.shift = e.shiftKey;
  }
  async _up(e) {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.ghost?.remove(); d.chip.classList.remove('dragging'); this.body?.classList.remove('cal-dragging');
    for (const c of this.body?.querySelectorAll('.drop') || []) c.classList.remove('drop');
    if (!d.moved) return;
    setTimeout(() => { this.drag = null; }, 0);
    const to = d.over, from = d.chip.dataset.due; if (!to || to === from) return;
    const patch = { due: to };
    const start = d.chip.dataset.start;
    if (start && (d.shift || e.shiftKey)) patch.start = addDays(start, daysUntil(to, from));   // keep the span length
    else if (start && start > to) patch.start = to;   // a due before the start: collapse the span
    const r = await this.home.onWrite({ projectId: d.chip.dataset.project, boardUid: d.chip.dataset.board, taskId: d.chip.dataset.task, project: d.chip.title.split(' · ')[1], op: 'update', patch, label: 'Reschedule card' });
    if (!r) this.home.toast('Could not reschedule that card', 1600); else if (r.mode === 'active') this.home.toast(`Due ${fmtDate(to)} · Ctrl+Z undoes`, 1400);
    this.home.refresh();
  }
}
export { gridDays, weekStart, monthStart };
