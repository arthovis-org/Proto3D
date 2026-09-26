// ui/date-picker.js — the date picker every `<input type="date">` in the app uses instead of the
// browser's own popup: one themed popover (a month grid with today ringed and the picked day filled,
// weekends tinted, days outside `min` / `max` disabled), a month / year chooser behind the title, and
// quick picks (Today · Tomorrow · Next Monday · In a week · In a month · Clear). The input itself is
// untouched — its value is still an ISO date, typing into its segments still works, and a pick fires
// `input` and `change` like the native control, so the panel, Home, the project dialog and the face
// field editor all keep their own handlers.
//
// Opening: a click on a date input, Alt+↓ / F4 while it has focus, or `openDatePicker(input)` (the
// face field editor calls it as its date editor opens). Keys while open: ← → ↑ ↓ move a day / week,
// PageUp / PageDown a month (Shift: a year), Home / End the week's ends, T today, Enter picks, Esc
// closes. The popover never takes focus (its buttons swallow the press), so an editor that commits on
// blur — the face field editor — stays open until a day is picked. It is drawn at the UI scale
// (ui-prefs.js), placed under the input or above it when there is no room.
import { icons } from '../icons.js';
import { uiScale } from './ui-prefs.js';

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => (ISO.test(s || '') ? new Date(`${s}T00:00:00Z`) : null);
/** Today in the local calendar, as an ISO date. */
export const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
export const addDaysIso = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const addMonthsIso = (s, n) => {
  const d = parse(s), day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return iso(t);
};
const dow = (s) => (parse(s).getUTCDay() + 6) % 7;   // Monday = 0
const monthName = (m, style = 'long') => new Date(Date.UTC(2000, m, 1)).toLocaleDateString(undefined, { month: style, timeZone: 'UTC' });
const longDate = (s) => parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "today", "tomorrow", "in 3 days", "2 weeks ago"… relative to `today`. */
export function relativeDay(s, today = todayIso()) {
  const n = Math.round((parse(s) - parse(today)) / 86400000);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const a = Math.abs(n), unit = a >= 60 ? [Math.round(a / 30.44), 'month'] : a >= 14 ? [Math.round(a / 7), 'week'] : [a, 'day'];
  const txt = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
  return n > 0 ? `in ${txt}` : `${txt} ago`;
}
/** The quick picks, as { id, label, date(today) }; `null` clears. */
export const QUICK_PICKS = [
  { id: 'today', label: 'Today', date: (t) => t },
  { id: 'tomorrow', label: 'Tomorrow', date: (t) => addDaysIso(t, 1) },
  { id: 'monday', label: 'Next Monday', date: (t) => addDaysIso(t, 7 - dow(t)) },
  { id: 'week', label: 'In a week', date: (t) => addDaysIso(t, 7) },
  { id: 'month', label: 'In a month', date: (t) => addMonthsIso(t, 1) },
];
/** The 42 days (six Monday-first weeks) shown for the month holding `s`. */
export function monthGrid(s) {
  const d = parse(s), first = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const start = addDaysIso(first, -dow(first));
  return Array.from({ length: 42 }, (_, i) => addDaysIso(start, i));
}

class Picker {
  constructor() {
    this.el = null; this.input = null; this.cursor = null; this.mode = 'days'; this.yearBase = 0;
    this._onKey = (e) => this._key(e);
    this._onDown = (e) => { if (this.el && !this.el.contains(e.target) && e.target !== this.input) this.close(); };
    this._onMove = () => this._place();
  }
  get isOpen() { return !!this.el; }
  open(input) {
    if (!input || input.disabled || input.readOnly) return;
    if (this.input === input && this.el) return;
    this.close();
    this.input = input;
    const v = parse(input.value) ? input.value : '';
    this.cursor = v || this._clamp(todayIso());
    this.mode = 'days';
    const el = document.createElement('div');
    el.id = 'date-picker'; el.className = 'dp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Choose a date');
    // the popover never takes focus: an editor that commits on blur stays open underneath
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); if (this.mode === 'days') this._moveMonth(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    document.body.appendChild(el);
    this.el = el;
    this.render();
    this._place();
    input.setAttribute('aria-expanded', 'true');
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('pointerdown', this._onDown, true);
    window.addEventListener('resize', this._onMove);
    window.addEventListener('scroll', this._onMove, true);
    this._raf = requestAnimationFrame(() => this._follow());
  }
  close() {
    if (!this.el) return;
    cancelAnimationFrame(this._raf);
    this.el.remove(); this.el = null;
    this.input?.removeAttribute('aria-expanded');
    this.input = null;
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('pointerdown', this._onDown, true);
    window.removeEventListener('resize', this._onMove);
    window.removeEventListener('scroll', this._onMove, true);
  }
  /** Keep the popover under its input (the face editor's input moves with the camera); close when the input goes away. */
  _follow() {
    if (!this.el) return;
    if (!this.input?.isConnected || this.input.closest('[hidden]')) { this.close(); return; }
    this._place();
    this._raf = requestAnimationFrame(() => this._follow());
  }
  get min() { return parse(this.input?.min) ? this.input.min : ''; }
  get max() { return parse(this.input?.max) ? this.input.max : ''; }
  _clamp(s) { if (this.min && s < this.min) return this.min; if (this.max && s > this.max) return this.max; return s; }
  _allowed(s) { return !(this.min && s < this.min) && !(this.max && s > this.max); }

  render() {
    const el = this.el; if (!el) return;
    const today = todayIso(), value = parse(this.input.value) ? this.input.value : '';
    const c = parse(this.cursor), y = c.getUTCFullYear(), m = c.getUTCMonth();
    const head = `<div class="dp-head">
        <button type="button" class="dp-nav" data-nav="-1" aria-label="${this.mode === 'days' ? 'Previous month' : this.mode === 'months' ? 'Previous year' : 'Earlier years'}">${icons.chevronLeft}</button>
        <button type="button" class="dp-title" data-act="mode" aria-label="Choose month and year">${this.mode === 'years' ? `${this.yearBase} – ${this.yearBase + 11}` : this.mode === 'months' ? y : `${monthName(m)} <b>${y}</b>`}${icons.chevronDown || ''}</button>
        <button type="button" class="dp-nav" data-nav="1" aria-label="${this.mode === 'days' ? 'Next month' : this.mode === 'months' ? 'Next year' : 'Later years'}">${icons.chevron}</button>
      </div>`;
    let body = '';
    if (this.mode === 'days') {
      const days = monthGrid(this.cursor);
      body = `<div class="dp-dow">${DOW.map((d, i) => `<span${i >= 5 ? ' class="we"' : ''}>${d}</span>`).join('')}</div><div class="dp-grid" role="grid">${days.map((d) => {
        const cls = ['dp-day'];
        if (d.slice(0, 7) !== this.cursor.slice(0, 7)) cls.push('out');
        if (dow(d) >= 5) cls.push('we');
        if (d === today) cls.push('today');
        if (d === value) cls.push('sel');
        if (d === this.cursor) cls.push('cur');
        const ok = this._allowed(d);
        return `<button type="button" class="${cls.join(' ')}" data-date="${d}" role="gridcell" aria-selected="${d === value}" aria-label="${longDate(d)}"${ok ? '' : ' disabled'}>${+d.slice(8)}</button>`;
      }).join('')}</div>`;
    } else if (this.mode === 'months') {
      body = `<div class="dp-cells">${Array.from({ length: 12 }, (_, i) => {
        const cur = i === m, now = `${y}-${pad(i + 1)}` === today.slice(0, 7), sel = value && `${y}-${pad(i + 1)}` === value.slice(0, 7);
        return `<button type="button" class="dp-cell${cur ? ' cur' : ''}${now ? ' today' : ''}${sel ? ' sel' : ''}" data-month="${i}">${monthName(i, 'short')}</button>`;
      }).join('')}</div>`;
    } else {
      body = `<div class="dp-cells">${Array.from({ length: 12 }, (_, i) => {
        const yy = this.yearBase + i;
        return `<button type="button" class="dp-cell${yy === y ? ' cur' : ''}${String(yy) === today.slice(0, 4) ? ' today' : ''}${value && String(yy) === value.slice(0, 4) ? ' sel' : ''}" data-year="${yy}">${yy}</button>`;
      }).join('')}</div>`;
    }
    const quick = QUICK_PICKS.map((q) => { const d = this._clamp(q.date(today)); return `<button type="button" class="dp-chip${d === value ? ' on' : ''}" data-date="${d}" title="${longDate(d)}"${this._allowed(q.date(today)) ? '' : ' disabled'}>${q.label}</button>`; }).join('');
    const status = value ? `<b>${longDate(value)}</b> · ${relativeDay(value, today)}` : 'No date';
    el.innerHTML = `${head}${body}<div class="dp-quick">${quick}</div><div class="dp-foot"><span class="dp-status" aria-live="polite">${status}</span>${this.input.required ? '' : '<button type="button" class="dp-clear" data-act="clear">Clear</button>'}</div>`;
    el.dataset.mode = this.mode;
  }
  _place() {
    const el = this.el, input = this.input; if (!el || !input) return;
    const s = uiScale(), r = input.getBoundingClientRect();
    const w = el.offsetWidth * s, h = el.offsetHeight * s, W = window.innerWidth, H = window.innerHeight;
    let x = Math.min(Math.max(8, r.left), W - w - 8), y = r.bottom + 6;
    if (y + h > H - 8) y = r.top - h - 6 >= 8 ? r.top - h - 6 : Math.max(8, H - h - 8);
    const key = `${Math.round(x)}|${Math.round(y)}`;
    if (key === this._placed) return;
    this._placed = key;
    el.style.left = `${(x / s).toFixed(1)}px`; el.style.top = `${(y / s).toFixed(1)}px`;
  }

  /** Write the value like the native control does (input + change), then close. */
  pick(d) {
    const input = this.input; if (!input) return;
    if (d && !this._allowed(d)) return;
    input.value = d || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.close();
  }
  _moveMonth(n) { this.cursor = this._clamp(addMonthsIso(this.cursor, n)); this.render(); }
  _click(e) {
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    e.stopPropagation();
    if (t.dataset.nav) {
      const n = +t.dataset.nav;
      if (this.mode === 'days') this._moveMonth(n);
      else if (this.mode === 'months') { this.cursor = addMonthsIso(this.cursor, 12 * n); this.render(); }
      else { this.yearBase += 12 * n; this.render(); }
      return;
    }
    if (t.dataset.act === 'mode') {
      if (this.mode === 'days') this.mode = 'months';
      else if (this.mode === 'months') { this.mode = 'years'; this.yearBase = +this.cursor.slice(0, 4) - 5; }
      else this.mode = 'days';
      this.render(); this._placed = ''; this._place(); return;
    }
    if (t.dataset.act === 'clear') { this.pick(''); return; }
    if (t.dataset.month) { const y = +this.cursor.slice(0, 4), d = +this.cursor.slice(8); const last = new Date(Date.UTC(y, +t.dataset.month + 1, 0)).getUTCDate(); this.cursor = `${y}-${pad(+t.dataset.month + 1)}-${pad(Math.min(d, last))}`; this.mode = 'days'; this.render(); this._placed = ''; this._place(); return; }
    if (t.dataset.year) { this.cursor = addMonthsIso(this.cursor, 12 * (+t.dataset.year - +this.cursor.slice(0, 4))); this.mode = 'months'; this.render(); return; }
    if (t.dataset.date) this.pick(t.dataset.date);
  }
  _key(e) {
    if (!this.el) return;
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'Escape') { stop(); this.close(); return; }
    if (k === 'Tab') { this.close(); return; }
    if (this.mode !== 'days') { if (k === 'Enter') { stop(); this.mode = 'days'; this.render(); } return; }
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[k] !== undefined && !e.altKey) { stop(); this.cursor = this._clamp(addDaysIso(this.cursor, moves[k])); this.render(); return; }
    if (k === 'PageUp' || k === 'PageDown') { stop(); this._moveMonth((k === 'PageDown' ? 1 : -1) * (e.shiftKey ? 12 : 1)); return; }
    if (k === 'Home' || k === 'End') { stop(); this.cursor = this._clamp(addDaysIso(this.cursor, k === 'Home' ? -dow(this.cursor) : 6 - dow(this.cursor))); this.render(); return; }
    if (k.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) { stop(); this.cursor = this._clamp(todayIso()); this.render(); return; }
    if (k === 'Enter' || k === ' ') { stop(); this.pick(this.cursor); }
  }
}

const picker = new Picker();
/** Open the picker on a date input (the face field editor calls this as its date editor opens). */
export function openDatePicker(input) { picker.open(input); }
export function closeDatePicker() { picker.close(); }
export const datePickerOpen = () => picker.isOpen;

/** Take over every date input in the page: a click or Alt+↓ / F4 opens the themed picker instead of the browser's. */
export function installDatePicker(root = document) {
  const isDate = (t) => t instanceof HTMLInputElement && t.type === 'date' && !t.hasAttribute('data-native-picker');
  root.addEventListener('click', (e) => { if (!isDate(e.target)) return; e.preventDefault(); picker.open(e.target); }, true);
  root.addEventListener('keydown', (e) => {
    if (!isDate(e.target) || picker.isOpen) return;
    if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') { e.preventDefault(); e.stopPropagation(); picker.open(e.target); }
  }, true);
  root.addEventListener('focusout', (e) => { if (isDate(e.target) && picker.input === e.target) setTimeout(() => { if (picker.input === e.target && document.activeElement !== e.target) picker.close(); }, 0); }, true);
}
