// ui/menubar.js — the desktop-style menu bar along the top: File · Edit · View · Add · Help.
// Presentation and keyboard model only: main.js hands it the menus as data, every item calling
// the same code path as the button, key or panel control it mirrors. Items are rebuilt each time
// a menu opens, so disabled states, check marks and labels ("Undo Delete") are always current.
//
//   menus:  [{ id, label, items: () => Item[] }]
//   Item:   { label, hint?, shortcut?, icon?, checked?, radio?, disabled?, run?() }   leaf
//           { label, icon?, disabled?, items: Item[] | () => Item[] }                submenu (flies out)
//           { sep: true, label? }                                                    separator / heading
//   mouse:  click a title to open, hover another title to switch, hover an item to open its submenu,
//           click outside or Esc closes; a leaf runs after the menus have closed
//   keys:   ← → switch menus, ↑ ↓ move, → opens a submenu, ← closes it, Enter / Space runs, Home / End
//   narrow: below `collapseBelow` px the titles fold into one ☰ button whose menu lists them as submenus
//   tools:  an optional element (icon toggles) appended at the right end of the bar, after a flexible gap
import { icons } from '../icons.js';
import { uiScale, uiPrefs } from './ui-prefs.js';

const OPEN_DELAY = 90;   // ms before a hovered item opens its submenu

export class MenuBar {
  /** @param {object} o { el, menus, brand?, tools?, collapseBelow?, onOpenChange?(open) } */
  constructor({ el, menus, brand = 'Proto3D', tools = null, collapseBelow = 720, onOpenChange = () => {} }) {
    Object.assign(this, { el, menus, brand, tools, collapseBelow, onOpenChange });
    this.openId = null;        // id of the open top-level menu (or 'all' for the ☰ menu)
    this.levels = [];          // open menu elements, root first: [{ el, items, parent }]
    this._timer = 0;
    this._build();
    window.addEventListener('pointerdown', (e) => { if (this.isOpen && !this.el.contains(e.target) && !this.levels.some((l) => l.el.contains(e.target))) this.close(); }, true);
    window.addEventListener('keydown', (e) => this._onKey(e), true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => { if (this.isOpen) this.close(); this._syncCollapse(); });
    uiPrefs.onChange(() => { if (this.isOpen) this.close(); this._syncCollapse(); });
    this._syncCollapse();
  }

  _build() {
    this.el.innerHTML = '';
    this.el.setAttribute('role', 'menubar');
    const brand = document.createElement('span'); brand.className = 'mnu-brand'; brand.textContent = this.brand;
    this.el.appendChild(brand);
    this.titles = new Map();
    for (const m of this.menus) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mnu-title'; b.dataset.menu = m.id; b.textContent = m.label;
      b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.openId === m.id ? this.close() : this.open(m.id); });
      b.addEventListener('pointerenter', () => { if (this.isOpen && this.openId !== m.id) this.open(m.id); });
      b.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(m.id, { focusFirst: true }); } });
      this.el.appendChild(b);
      this.titles.set(m.id, b);
    }
    const all = document.createElement('button'); all.type = 'button'; all.className = 'mnu-title mnu-all'; all.dataset.menu = 'all'; all.innerHTML = icons.menu; all.title = 'Menu';
    all.setAttribute('role', 'menuitem'); all.setAttribute('aria-haspopup', 'menu'); all.setAttribute('aria-expanded', 'false'); all.setAttribute('aria-label', 'Menu');
    all.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.openId === 'all' ? this.close() : this.open('all'); });
    this.el.appendChild(all);
    this.titles.set('all', all);
    const grow = document.createElement('span'); grow.className = 'mnu-grow'; this.el.appendChild(grow);
    if (this.tools) this.el.appendChild(this.tools);
  }
  _syncCollapse() { this.el.classList.toggle('collapsed', window.innerWidth / uiScale() < this.collapseBelow); }
  get isOpen() { return this.openId !== null; }
  get collapsed() { return this.el.classList.contains('collapsed'); }

  /* ---------- open / close ---------- */
  open(id, { focusFirst = false } = {}) {
    if (this.collapsed && id !== 'all') { this.open('all', { focusFirst }); return; }
    const items = id === 'all' ? this.menus.map((m) => ({ label: m.label, items: m.items })) : this.menus.find((m) => m.id === id)?.items;
    if (!items) return;
    this._closeLevels(0);
    this.openId = id;
    for (const [k, b] of this.titles) { const on = k === id; b.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on)); }
    // menus are drawn at the UI scale (ui-prefs.js): place them in its units — screen px / scale
    const s = uiScale(), W = window.innerWidth / s, H = window.innerHeight / s;
    const a = this.titles.get(id).getBoundingClientRect(), anchor = { left: a.left / s, bottom: a.bottom / s };
    const el = this._menuEl(typeof items === 'function' ? items() : items, 0);
    document.body.appendChild(el);
    el.style.left = `${Math.max(4, Math.min(anchor.left, W - el.offsetWidth - 4))}px`;
    el.style.top = `${anchor.bottom + 2}px`;
    el.style.maxHeight = `${H - anchor.bottom - 12}px`;
    this.levels = [{ el, parent: null }];
    if (focusFirst) this._focusIndex(el, 0, 1); else el.focus({ preventScroll: true });
    this.onOpenChange(true);
  }
  close() {
    if (!this.isOpen) return;
    this._closeLevels(0);
    this.openId = null;
    for (const b of this.titles.values()) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }
    this.onOpenChange(false);
  }
  _closeLevels(from) {
    clearTimeout(this._timer);
    for (const l of this.levels.splice(from)) { l.el.remove(); l.parent?.classList.remove('open'); l.parent?.setAttribute('aria-expanded', 'false'); }
  }

  /* ---------- rendering ---------- */
  _menuEl(items, depth) {
    const el = document.createElement('div'); el.className = 'mnu-menu'; el.setAttribute('role', 'menu'); el.tabIndex = -1; el.dataset.depth = String(depth);
    let hasCheck = false;
    for (const it of items) if (it.checked !== undefined) hasCheck = true;
    el.classList.toggle('with-checks', hasCheck);
    for (const it of items) {
      if (it.sep) {
        const s = document.createElement('div'); s.className = it.label ? 'mnu-heading' : 'mnu-sep'; if (it.label) s.textContent = it.label; el.appendChild(s); continue;
      }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mnu-item';
      const sub = !!it.items;
      b.setAttribute('role', it.checked !== undefined ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem');
      if (it.checked !== undefined) b.setAttribute('aria-checked', String(!!it.checked));
      if (it.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (sub) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.classList.add('has-sub'); }
      if (it.danger) b.classList.add('danger');
      b.innerHTML = `<span class="mnu-check">${it.checked ? (it.radio ? '<i></i>' : icons.check) : ''}</span>`
        + (it.icon ? `<span class="mnu-ic">${it.icon}</span>` : '')
        + `<span class="mnu-label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>`
        + (it.shortcut ? `<kbd>${esc(it.shortcut)}</kbd>` : '')
        + (sub ? `<span class="mnu-arrow">${icons.chevron}</span>` : '');
      b._item = it;
      b.addEventListener('pointerenter', () => {
        if (b.disabled) return;
        b.focus({ preventScroll: true });
        clearTimeout(this._timer);
        this._timer = setTimeout(() => { this._closeLevels(depth + 1); if (sub) this._openSub(b, depth); }, OPEN_DELAY);
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sub) { clearTimeout(this._timer); if (b.classList.contains('open')) this._closeLevels(depth + 1); else { this._closeLevels(depth + 1); this._openSub(b, depth, { focusFirst: false }); } return; }
        this._activate(it);
      });
      el.appendChild(b);
    }
    el.addEventListener('pointerenter', () => clearTimeout(this._timer));
    return el;
  }
  _openSub(button, depth, { focusFirst = false } = {}) {
    const it = button._item;
    const items = typeof it.items === 'function' ? it.items() : it.items;
    const el = this._menuEl(items, depth + 1);
    document.body.appendChild(el);
    const s = uiScale(), W = window.innerWidth / s, H = window.innerHeight / s;
    const b = button.getBoundingClientRect(), r = { left: b.left / s, right: b.right / s, top: b.top / s };
    let left = r.right - 2, top = r.top - 6;
    if (left + el.offsetWidth > W - 4) left = Math.max(4, r.left - el.offsetWidth + 2);
    const maxH = H - 8;
    el.style.maxHeight = `${maxH}px`;
    if (top + el.offsetHeight > H - 4) top = Math.max(4, H - el.offsetHeight - 4);
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    button.classList.add('open'); button.setAttribute('aria-expanded', 'true');
    this.levels.push({ el, parent: button });
    if (focusFirst) this._focusIndex(el, 0, 1);
  }
  _activate(it) {
    if (it.disabled || !it.run) return;
    this.close();
    it.run();
  }

  /* ---------- keyboard ---------- */
  _items(el) { return [...el.querySelectorAll(':scope > .mnu-item:not(:disabled)')]; }
  _focusIndex(el, index, dir) {
    const list = this._items(el); if (!list.length) return;
    const i = ((index % list.length) + list.length) % list.length;
    list[i].focus({ preventScroll: true });
    void dir;
  }
  _onKey(e) {
    if (!this.isOpen) return;
    const top = this.levels[this.levels.length - 1];
    const active = document.activeElement;
    const inTop = top && active && active.parentElement === top.el && active.classList.contains('mnu-item');
    const list = top ? this._items(top.el) : [];
    const idx = inTop ? list.indexOf(active) : -1;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'Escape': stop(); if (this.levels.length > 1) { const parent = top.parent; this._closeLevels(this.levels.length - 1); parent?.focus(); } else this.close(); return;
      case 'ArrowDown': stop(); this._focusIndex(top.el, idx + 1, 1); return;
      case 'ArrowUp': stop(); this._focusIndex(top.el, idx < 0 ? -1 : idx - 1, -1); return;
      case 'Home': stop(); this._focusIndex(top.el, 0, 1); return;
      case 'End': stop(); this._focusIndex(top.el, -1, -1); return;
      case 'ArrowRight':
        stop();
        if (inTop && active.classList.contains('has-sub')) { this._closeLevels(this.levels.length); this._openSub(active, this.levels.length - 1, { focusFirst: true }); }
        else if (this.openId !== 'all') this._step(1);
        return;
      case 'ArrowLeft':
        stop();
        if (this.levels.length > 1) { const parent = top.parent; this._closeLevels(this.levels.length - 1); parent?.focus(); }
        else if (this.openId !== 'all') this._step(-1);
        return;
      case 'Enter': case ' ':
        stop();
        if (inTop) { if (active.classList.contains('has-sub')) { this._closeLevels(this.levels.length); this._openSub(active, this.levels.length - 1, { focusFirst: true }); } else this._activate(active._item); }
        return;
      case 'Tab': stop(); this.close(); return;
      default: {
        // a letter jumps to the next item starting with it
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && list.length) {
          stop();
          const k = e.key.toLowerCase();
          for (let n = 1; n <= list.length; n++) { const b = list[(idx + n) % list.length]; if (b.querySelector('.mnu-label').textContent.trim().toLowerCase().startsWith(k)) { b.focus({ preventScroll: true }); break; } }
        } else if (e.key.length === 1) stop();   // swallow shortcuts while a menu is open
      }
    }
  }
  _step(dir) {
    const ids = this.menus.map((m) => m.id);
    const i = ids.indexOf(this.openId);
    this.open(ids[((i + dir) % ids.length + ids.length) % ids.length], { focusFirst: true });
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "Ctrl+Shift+Z" → "⌘⇧Z" on Apple platforms, unchanged elsewhere. */
export function shortcutText(s) {
  if (!s) return s;
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  return mac ? s.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : s;
}
