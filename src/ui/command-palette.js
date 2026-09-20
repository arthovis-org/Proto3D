// ui/command-palette.js — Ctrl+K / Cmd+K: a centred overlay with a text field and a ranked list,
// in the properties-panel visual language. Sources, merged and ranked by fuzzy match:
//
//   Commands  every leaf of the menu bar model (label, shortcut, enabled / checked state), read
//             the moment the palette opens so labels like "Undo Delete 2 items" and disabled
//             states are current; grouped under their menu name, submenus as "Parent › Child"
//             (Open recent, Examples, Navigation, theme…). Disabled ones are dimmed, not runnable.
//   Add       "Add <component>" for every registry definition — the same addComponent path as the
//             left toolbar and the Add menu (placed at the camera target).
//   Go to     "Go to <block title>" for every block in the scene: frames and selects it.
//
// Ranking: prefix > word prefix > substring > subsequence on the label (hint and group count
// less and take no subsequence); multi-word queries must match every word; the last 8 run commands (localStorage) are
// boosted, and with an empty query they lead the list as "Recent". Keys: ↑ ↓ move, Enter runs,
// Esc closes, Tab / Shift+Tab cycle the source filter (All · Commands · Add · Go to). Opening
// remembers the focused element; closing gives focus back to a panel field that had it, else to
// the canvas, so shortcuts work again at once.
import { icons } from '../icons.js';

const KEY = 'proto3d.palette.v1';
const RECENT_MAX = 8;
const ROW_MAX = 200;
const FILTERS = [['all', 'All'], ['command', 'Commands'], ['add', 'Add'], ['goto', 'Go to']];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Score one lower-case needle against one lower-case haystack. Returns { s, pos } — 0 when it
 * does not match; `pos` are the matched character indices (for highlighting). `subsequence`
 * false keeps to prefix / word-prefix / substring (hints and groups are long: scattered letters
 * in a description are not a match).
 */
export function fuzzy(q, text, { subsequence = true } = {}) {
  if (!q) return { s: 1, pos: [] };
  const i = text.indexOf(q);
  if (i >= 0) {
    const pos = Array.from({ length: q.length }, (_, k) => i + k);
    if (i === 0) return { s: 100, pos };
    if (!/[a-z0-9]/.test(text[i - 1])) return { s: 80 - i * 0.1, pos };   // word prefix
    return { s: 60 - i * 0.1, pos };
  }
  if (!subsequence) return { s: 0, pos: [] };
  let from = 0, gaps = 0, first = -1; const pos = [];
  for (const ch of q) {
    const j = text.indexOf(ch, from); if (j < 0) return { s: 0, pos: [] };
    if (first < 0) first = j; else gaps += j - from;
    pos.push(j); from = j + 1;
  }
  return { s: Math.max(1, 40 - gaps * 2 - first * 0.5), pos };
}
/** Every word of the query must match; the label scores fully, hint and group at a discount. */
export function scoreItem(query, item) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { s: 1, pos: [] };
  const label = item.label.toLowerCase(), hint = (item.hint || '').toLowerCase(), group = (item.group || '').toLowerCase();
  let total = 0; const pos = [];
  for (const w of words) {
    const a = fuzzy(w, label), b = fuzzy(w, hint, { subsequence: false }), c = fuzzy(w, group, { subsequence: false });
    const best = Math.max(a.s, b.s * 0.5, c.s * 0.4);
    if (best <= 0) return { s: 0, pos: [] };
    if (a.s >= best) pos.push(...a.pos);
    total += best;
  }
  return { s: total, pos };
}

export class CommandPalette {
  /**
   * @param {object} o { sources: () => Item[], canvas, onOpenChange?(open) }
   *   Item: { id, kind: 'command' | 'add' | 'goto', group, label, hint?, shortcut?, icon?, disabled?, checked?, run() }
   */
  constructor({ sources, canvas, onOpenChange = () => {} }) {
    Object.assign(this, { sources, canvas, onOpenChange });
    this.filter = 'all';
    this.items = []; this.rows = []; this.active = 0;
    this.recent = this._loadRecent();
    if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1;   // focusable by script, not by Tab
    this._build();
  }

  /* ---------- DOM ---------- */
  _build() {
    const el = document.createElement('div'); el.className = 'modal-backdrop cmdk-backdrop'; el.id = 'cmdk'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Command palette');
    el.innerHTML = `<div class="cmdk">
      <div class="cmdk-head"><span class="cmdk-ic">${icons.search}</span><input type="text" class="cmdk-input" placeholder="Type a command, a component to add or a block to go to…" autocomplete="off" spellcheck="false" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list" /><kbd class="cmdk-esc">Esc</kbd></div>
      <div class="cmdk-filters" role="tablist">${FILTERS.map(([id, l]) => `<button type="button" role="tab" data-f="${id}">${l}</button>`).join('')}<span class="cmdk-hint">Tab switches</span></div>
      <div class="cmdk-list" id="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> run</span><span><kbd>Tab</kbd> filter</span><span><kbd>Esc</kbd> close</span></div>
    </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.input = el.querySelector('.cmdk-input');
    this.list = el.querySelector('.cmdk-list');
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.close(); });
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { this.setFilter(b.dataset.f); this.input.focus(); }));
    this.input.addEventListener('input', () => this.render());
    el.addEventListener('keydown', (e) => this._onKey(e));
    this.list.addEventListener('pointermove', (e) => { const row = e.target.closest?.('.cmdk-row'); if (row && +row.dataset.i !== this.active) this._setActive(+row.dataset.i, false); });
    this.list.addEventListener('click', (e) => { const row = e.target.closest?.('.cmdk-row'); if (row) this.run(this.rows[+row.dataset.i]); });
  }

  /* ---------- open / close ---------- */
  get isOpen() { return !this.el.hidden; }
  open({ query = '', filter = 'all' } = {}) {
    if (this.isOpen) { this.input.focus(); return; }
    this._prev = document.activeElement;
    this.items = this.sources();
    this.filter = filter;
    this.el.hidden = false;
    this.input.value = query;
    this._syncFilter();
    this.render();
    this.input.focus(); this.input.select();
    this.onOpenChange(true);
  }
  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.onOpenChange(false);
    // a panel field that had focus gets it back; otherwise the canvas, so keys reach the workspace
    const p = this._prev;
    const field = p && p.isConnected && /^(INPUT|TEXTAREA|SELECT)$/.test(p.tagName) && p.closest('#panel');
    if (field) p.focus({ preventScroll: true }); else this.canvas?.focus?.({ preventScroll: true });
    this._prev = null;
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  setFilter(f) { if (!FILTERS.some(([id]) => id === f)) return; this.filter = f; this._syncFilter(); this.render(); }
  _syncFilter() { this.el.querySelectorAll('[data-f]').forEach((b) => { const on = b.dataset.f === this.filter; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }); }
  _cycleFilter(dir) { const ids = FILTERS.map(([id]) => id); this.setFilter(ids[((ids.indexOf(this.filter) + dir) % ids.length + ids.length) % ids.length]); }

  /* ---------- ranking ---------- */
  /** The rows for the current query and filter: [{ item, pos, group }] with group headings implied by `group`. */
  rank(query = this.input.value) {
    const q = query.trim();
    const pool = this.items.filter((it) => this.filter === 'all' || it.kind === this.filter);
    const recentIndex = (it) => this.recent.indexOf(it.id);
    if (!q) {
      const recent = this.recent.map((id) => pool.find((it) => it.id === id)).filter(Boolean).map((it) => ({ item: it, pos: [], group: 'Recent' }));
      const rest = pool.map((it) => ({ item: it, pos: [], group: it.group }));
      return [...recent, ...rest].slice(0, ROW_MAX);
    }
    const scored = [];
    for (const it of pool) {
      const r = scoreItem(q, it); if (r.s <= 0) continue;
      const ri = recentIndex(it);
      scored.push({ item: it, pos: r.pos, group: it.group, s: r.s + (ri >= 0 ? 15 - ri * 1.5 : 0) });
    }
    scored.sort((a, b) => b.s - a.s || a.item.label.length - b.item.label.length || a.item.label.localeCompare(b.item.label));
    return scored.slice(0, ROW_MAX);
  }
  render() {
    this.rows = this.rank();
    this.list.innerHTML = '';
    if (!this.rows.length) {
      const q = this.input.value.trim();
      const e = document.createElement('div'); e.className = 'cmdk-empty';
      e.innerHTML = q ? `No match for “${esc(q)}”<small>Try a command name, a component (“add sticky”) or a block title (“go launch”)</small>` : 'Nothing here yet<small>Add a component or switch the filter</small>';
      this.list.appendChild(e);
      this.active = -1; return;
    }
    let lastGroup = null;
    this.rows.forEach((row, i) => {
      if (row.group !== lastGroup) { lastGroup = row.group; const h = document.createElement('div'); h.className = 'cmdk-group'; h.textContent = row.group; this.list.appendChild(h); }
      const it = row.item;
      const b = document.createElement('div'); b.className = 'cmdk-row'; b.dataset.i = String(i); b.setAttribute('role', 'option'); b.id = `cmdk-row-${i}`;
      if (it.disabled) { b.classList.add('disabled'); b.setAttribute('aria-disabled', 'true'); }
      if (it.checked) b.classList.add('checked');
      b.innerHTML = `<span class="cmdk-row-ic">${it.icon || (it.kind === 'add' ? icons.plus : it.kind === 'goto' ? icons.frame : icons.command)}</span>`
        + `<span class="cmdk-row-label"><span class="cmdk-row-title">${highlight(it.label, row.pos)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>`
        + (it.checked ? `<span class="cmdk-row-check">${icons.check}</span>` : '')
        + (it.shortcut ? `<kbd>${esc(it.shortcut)}</kbd>` : '');
      this.list.appendChild(b);
    });
    this._setActive(this.rows.findIndex((r) => !r.item.disabled), true);
  }
  _setActive(i, scroll = true) {
    this.active = i;
    this.list.querySelectorAll('.cmdk-row').forEach((r) => { const on = +r.dataset.i === i; r.classList.toggle('active', on); r.setAttribute('aria-selected', String(on)); });
    const row = i >= 0 ? this.list.querySelector(`.cmdk-row[data-i="${i}"]`) : null;
    this.input.setAttribute('aria-activedescendant', row ? row.id : '');
    if (row && scroll) row.scrollIntoView({ block: 'nearest' });
  }
  _move(dir) {
    if (!this.rows.length) return;
    let i = this.active;
    for (let n = 0; n < this.rows.length; n++) { i = ((i + dir) % this.rows.length + this.rows.length) % this.rows.length; if (!this.rows[i].item.disabled) break; }
    this._setActive(i);
  }

  /* ---------- run ---------- */
  run(row) {
    if (!row || row.item.disabled || !row.item.run) return false;
    this._remember(row.item.id);
    this.close();
    row.item.run();
    return true;
  }
  _onKey(e) {
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); this.close(); return;
      case 'ArrowDown': e.preventDefault(); e.stopPropagation(); this._move(1); return;
      case 'ArrowUp': e.preventDefault(); e.stopPropagation(); this._move(-1); return;
      case 'Home': if (e.target === this.input && this.input.value) return; e.preventDefault(); this._setActive(this.rows.findIndex((r) => !r.item.disabled)); return;
      case 'End': if (e.target === this.input && this.input.value) return; e.preventDefault(); this._setActive(this.rows.length - 1); return;
      case 'Tab': e.preventDefault(); e.stopPropagation(); this._cycleFilter(e.shiftKey ? -1 : 1); return;
      case 'Enter': e.preventDefault(); e.stopPropagation(); this.run(this.rows[this.active]); return;
      default: e.stopPropagation();   // typing never reaches the workspace shortcuts
    }
  }

  /* ---------- recents ---------- */
  _loadRecent() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : []; } catch (_) { return []; } }
  _remember(id) {
    if (!id) return;
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    try { localStorage.setItem(KEY, JSON.stringify(this.recent)); } catch (_) { /* private mode */ }
  }
  clearRecent() { this.recent = []; try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } }
}

/** Wrap the matched characters of `label` in <mark>. */
function highlight(label, pos) {
  if (!pos || !pos.length) return esc(label);
  const set = new Set(pos); let out = '', open = false;
  for (let i = 0; i < label.length; i++) {
    const m = set.has(i);
    if (m && !open) { out += '<mark>'; open = true; } else if (!m && open) { out += '</mark>'; open = false; }
    out += esc(label[i]);
  }
  return open ? `${out}</mark>` : out;
}

/**
 * Flatten a menu bar model into palette items: every leaf, submenus as "Parent › Child", grouped
 * under the menu label. `skip(menuId, path)` may drop a branch (the Add menu's categories, which
 * the Add source lists with icons).
 */
export function menuCommands(menus, { skip = () => false } = {}) {
  const out = [];
  const walk = (menuId, group, items, path) => {
    const list = typeof items === 'function' ? items() : items || [];
    for (const it of list) {
      if (!it || it.sep) continue;
      const label = path ? `${path} › ${it.label}` : it.label;
      if (skip(menuId, label, it)) continue;
      if (it.items) { walk(menuId, group, it.items, label); continue; }
      if (!it.run) continue;
      const stable = String(it.label).replace(/^(Undo|Redo)\b.*/, '$1');
      out.push({ id: `cmd:${menuId}/${path ? `${path}/` : ''}${stable}`, kind: 'command', group, label, hint: it.hint, shortcut: it.shortcut, icon: it.icon, disabled: !!it.disabled, checked: it.checked === true, run: it.run });
    }
  };
  for (const m of menus) walk(m.id, m.label, m.items, '');
  return out;
}
