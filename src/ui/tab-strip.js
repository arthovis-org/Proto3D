// ui/tab-strip.js — the slim strip under the menu bar: a permanent Home tab first (the Home page,
// ui/home.js: not closable, not draggable, `aria-current` while Home is shown), one tab per open
// project (name, a dot while it has unsaved changes, × to close, a preview badge for a read-only
// version), a "+" for a new project and, at the right end, the autosave indicator ("Saved · 2 min ago", "Saving…",
// "Unsaved changes", "Autosave off") whose hover card shows when and where the last save went
// and offers Save now, Download JSON and Version history. Presentation only: it renders from the
// Tabs model (tabs.js) and calls back into it. The DOM is reconciled by tab id so a tab element
// survives re-renders — a pointer drag to reorder keeps its capture, an inline rename its focus.
//
//   click / Enter activates · middle-click or × closes · double-click renames · drag reorders
//   ← → move focus between tabs · Delete closes the focused tab · the Home tab opens Home (Alt+H)
import { icons } from '../icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": '&#39;' }[c]));
export const timeAgo = (t) => { if (!t) return 'never'; const s = Math.max(0, (Date.now() - t) / 1000); return s < 5 ? 'just now' : s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const clock = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

export class TabStrip {
  /** @param {object} o { el, tabs, onNew, onDownload, onVersions, onHome?, isHome?, onActivate? } — `onActivate` fires on every click on a project tab (also the active one), so Home can step aside */
  constructor({ el, tabs, onNew, onDownload, onVersions, onHome = null, isHome = () => false, onActivate = () => {} }) {
    Object.assign(this, { el, tabs, onNew, onDownload, onVersions, onHome, isHome, onActivate });
    this.els = new Map();          // tab id → element
    this.drag = null;
    this._build();
    tabs.onChange(() => this.render());
    tabs.onStatus((s) => this.renderStatus(s));
    this.render(); this.renderStatus(tabs.status);
    this._tick = setInterval(() => this.renderStatus(tabs.status), 30000);
  }
  _build() {
    this.el.innerHTML = '';
    this.el.setAttribute('role', 'tablist'); this.el.setAttribute('aria-label', 'Open projects');
    // the Home tab: fixed before the project tabs (not in the Tabs model)
    this.home = document.createElement('button'); this.home.type = 'button'; this.home.className = 'ptab home'; this.home.title = 'Home · projects, tasks, calendar (Alt+H)'; this.home.setAttribute('aria-label', 'Home'); this.home.innerHTML = `${icons.home}<span class="ptab-name">Home</span>`;
    this.home.addEventListener('click', () => this.onHome?.());
    this.home.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); this.els.get(this.tabs.tabs[0]?.id)?.focus(); } });
    if (this.onHome) this.el.appendChild(this.home);
    this.list = document.createElement('div'); this.list.className = 'ptabs';
    this.add = document.createElement('button'); this.add.type = 'button'; this.add.className = 'ptab-add'; this.add.title = 'New project (Alt+N)'; this.add.setAttribute('aria-label', 'New project'); this.add.innerHTML = icons.plus;
    this.add.addEventListener('click', () => this.onNew?.());
    this.el.appendChild(this.list); this.el.appendChild(this.add);
    // autosave indicator + hover card
    this.wrap = document.createElement('div'); this.wrap.className = 'asv-wrap';
    this.wrap.innerHTML = `<button type="button" class="asv" aria-live="polite" aria-haspopup="dialog"><i class="asv-dot"></i><span class="asv-text">Saved</span></button>
      <div class="asv-pop" role="dialog" aria-label="Autosave">
        <div class="asv-head"><b>Autosave</b><label class="asv-switch"><input type="checkbox" class="asv-on"><span>on</span></label></div>
        <p class="asv-p">Every change is written to this browser (IndexedDB) 1.5 s after you stop. It stays on this device — <kbd>Ctrl</kbd>+<kbd>S</kbd> downloads a JSON file you can keep or share.</p>
        <dl class="asv-dl"><dt>Last saved</dt><dd class="asv-when">—</dd><dt>Where</dt><dd>this browser · IndexedDB</dd><dt>Project</dt><dd class="asv-proj">—</dd></dl>
        <div class="asv-btns"><button type="button" data-act="save">Save now</button><button type="button" data-act="download">Download JSON</button><button type="button" data-act="versions">Version history…</button></div>
      </div>`;
    this.el.appendChild(this.wrap);
    this.asv = this.wrap.querySelector('.asv'); this.pop = this.wrap.querySelector('.asv-pop');
    this.asv.addEventListener('click', () => { this.wrap.classList.toggle('pinned'); });
    this.pop.querySelector('[data-act="save"]').addEventListener('click', () => { this.tabs.saveNow({ reason: 'auto', force: true }); });
    this.pop.querySelector('[data-act="download"]').addEventListener('click', () => { this.wrap.classList.remove('pinned'); this.onDownload?.(); });
    this.pop.querySelector('[data-act="versions"]').addEventListener('click', () => { this.wrap.classList.remove('pinned'); this.onVersions?.(); });
    this.onSwitch = this.pop.querySelector('.asv-on');
    this.onSwitch.addEventListener('change', () => this.tabs.setAutosave(this.onSwitch.checked));
    window.addEventListener('pointerdown', (e) => { if (!this.wrap.contains(e.target)) this.wrap.classList.remove('pinned'); }, true);
  }

  /* ---------- tabs ---------- */
  _tabEl(tab) {
    const el = document.createElement('div'); el.className = 'ptab'; el.setAttribute('role', 'tab'); el.tabIndex = -1; el.dataset.id = tab.id; el.draggable = false;
    el.innerHTML = `<span class="ptab-dot" aria-hidden="true"></span><span class="ptab-badge" aria-label="Read-only preview">${icons.eye}</span><span class="ptab-name"></span><button type="button" class="ptab-close" aria-label="Close" tabindex="-1">${icons.close}</button>`;
    const close = el.querySelector('.ptab-close');
    close.addEventListener('click', (e) => { e.stopPropagation(); this.tabs.close(tab.id); });
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => this._down(e, tab.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); this.tabs.close(tab.id); } });
    el.addEventListener('dblclick', (e) => { if (!e.target.closest('.ptab-close') && !this.tabs.byId(tab.id)?.preview) this.rename(tab.id); });
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.tabs.activate(tab.id); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.tabs.close(tab.id); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const i = this.tabs.indexOf(tab.id) + (e.key === 'ArrowRight' ? 1 : -1); const t = this.tabs.tabs[i]; if (t) this.els.get(t.id)?.focus(); else if (i < 0 && this.onHome) this.home.focus(); }
      else if (e.key === 'F2') { e.preventDefault(); this.rename(tab.id); }
    });
    return el;
  }
  render() {
    const seen = new Set();
    let prev = null;
    this.renderHome();
    for (const tab of this.tabs.tabs) {
      let el = this.els.get(tab.id);
      if (!el) { el = this._tabEl(tab); this.els.set(tab.id, el); }
      seen.add(tab.id);
      const active = tab.id === this.tabs.activeId;
      el.classList.toggle('active', active); el.classList.toggle('dirty', !!tab.dirty && !tab.preview); el.classList.toggle('preview', !!tab.preview);
      el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1;
      const name = this.tabs.displayName(tab);
      const nameEl = el.querySelector('.ptab-name');
      if (!el.classList.contains('renaming') && nameEl.textContent !== name) nameEl.textContent = name;
      el.title = tab.preview ? `${name} · read-only preview of an earlier version` : `${name}${tab.dirty ? ' · unsaved changes' : ''}${tab.savedAt ? ` · saved ${timeAgo(tab.savedAt)}` : ''}`;
      // keep DOM order = model order (during a drag the elements lead and the model follows on release)
      if (!el.parentNode) this.list.appendChild(el);
      else if (!this.drag) { const want = prev ? prev.nextSibling : this.list.firstChild; if (el !== want) this.list.insertBefore(el, want); }
      prev = el;
    }
    for (const [id, el] of this.els) if (!seen.has(id)) { el.remove(); this.els.delete(id); }
    this.add.disabled = !this.tabs.canOpenMore;
    this.add.title = this.tabs.canOpenMore ? 'New project (Alt+N)' : `Up to ${this.tabs.limit} projects can be open at once`;
    const active = this.els.get(this.tabs.activeId);
    if (active && this.list.scrollWidth > this.list.clientWidth) active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    this.renderStatus(this.tabs.status);
  }
  /** The Home tab's state: current while the Home page is shown (the active project tab keeps `aria-selected`). */
  renderHome() {
    if (!this.onHome) return;
    const on = !!this.isHome();
    this.home.classList.toggle('current', on);
    if (on) this.home.setAttribute('aria-current', 'page'); else this.home.removeAttribute('aria-current');
  }
  /** Inline rename of a tab (double-click, F2). */
  rename(id) {
    const el = this.els.get(id), tab = this.tabs.byId(id); if (!el || !tab || el.classList.contains('renaming')) return;
    const nameEl = el.querySelector('.ptab-name');
    const input = document.createElement('input'); input.type = 'text'; input.className = 'ptab-input'; input.value = tab.name || ''; input.placeholder = 'Untitled'; input.spellcheck = false;
    el.classList.add('renaming'); nameEl.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = (commit) => { if (done) return; done = true; if (commit) this.tabs.rename(id, input.value); el.classList.remove('renaming'); const span = document.createElement('span'); span.className = 'ptab-name'; span.textContent = this.tabs.displayName(this.tabs.byId(id) || tab); input.replaceWith(span); el.focus(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /* ---------- pointer: activate, drag to reorder (window listeners: moving a captured element in the DOM would drop its capture) ---------- */
  _down(e, id) {
    if (e.button === 1) { e.preventDefault(); return; }      // auxclick closes
    if (e.button !== 0 || e.target.closest('.ptab-close, .ptab-input')) return;
    const el = this.els.get(id);
    this.drag = { id, el, x0: e.clientX, moved: false, pointerId: e.pointerId };
    this._onMove = (ev) => this._move(ev); this._onUp = (ev) => this._up(ev);
    window.addEventListener('pointermove', this._onMove, true); window.addEventListener('pointerup', this._onUp, true); window.addEventListener('pointercancel', this._onUp, true);
    this.tabs.activate(id);
    this.onActivate(id);
  }
  _move(e) {
    const d = this.drag; if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) { if (Math.abs(e.clientX - d.x0) < 6) return; d.moved = true; d.el.classList.add('dragging'); this.el.classList.add('reordering'); }
    // the slot under the pointer: after every tab whose centre is left of it
    const others = [...this.list.children].filter((c) => c !== d.el);
    let index = 0;
    for (const c of others) { const r = c.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) index++; }
    const ref = others[index] || null;
    if (d.el.nextSibling !== ref) this.list.insertBefore(d.el, ref);
  }
  _up(e) {
    const d = this.drag; if (!d || e.pointerId !== d.pointerId) return;
    const index = d.moved ? [...this.list.children].indexOf(d.el) : -1;
    this._end();
    if (index >= 0) this.tabs.move(d.id, index);
  }
  _end() {
    if (this.drag) this.drag.el.classList.remove('dragging');
    this.drag = null; this.el.classList.remove('reordering');
    window.removeEventListener('pointermove', this._onMove, true); window.removeEventListener('pointerup', this._onUp, true); window.removeEventListener('pointercancel', this._onUp, true);
    this.render();
  }

  /* ---------- autosave indicator ---------- */
  renderStatus(s = this.tabs.status) {
    const tab = this.tabs.active;
    const state = tab?.preview ? 'preview' : s.state;
    const at = tab?.autosavedAt || 0;
    const text = state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes' : state === 'off' ? (s.reason === 'no-storage' ? 'No browser storage' : 'Autosave off') : state === 'error' ? 'Could not save' : state === 'preview' ? 'Read-only preview' : at ? `Saved · ${timeAgo(at)}` : 'Saved';
    this.asv.dataset.state = state;
    this.asv.querySelector('.asv-text').textContent = text;
    this.asv.title = state === 'saved' && at ? `Saved to this browser at ${clock(at)}` : state === 'off' ? 'Autosave is off — changes stay in memory until you save' : text;
    this.pop.querySelector('.asv-when').textContent = at ? `${clock(at)} · ${timeAgo(at)}` : 'not yet';
    this.pop.querySelector('.asv-proj').textContent = tab ? this.tabs.displayName(tab) : '—';
    this.onSwitch.checked = this.tabs.autosaveOn; this.onSwitch.disabled = !this.tabs.store.available;
    this.pop.querySelector('.asv-switch span').textContent = this.tabs.autosaveOn ? 'on' : 'off';
    this.pop.querySelector('[data-act="save"]').disabled = !this.tabs.store.available || !!tab?.preview;
    for (const el of this.els.values()) { const t = this.tabs.byId(el.dataset.id); if (t) el.classList.toggle('dirty', !!t.dirty && !t.preview); }
  }
}
